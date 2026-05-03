import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — return the list of students who were marked absent in any
// EARLIER period of the same (section, date), so the teacher loading
// period 3 can pre-populate "Ahmed, Khalid — already absent in P1".
//
// Query params:
//   section_id  (required)  — section being recorded now
//   date        (required)  — YYYY-MM-DD
//   period_id   (required)  — current period being filled. We exclude
//                             this one from the lookup so re-opening the
//                             same period doesn't suggest itself.
//
// Response shape:
//   {
//     data: {
//       earliest_period_number: number | null,  // smallest period in lookup
//       cascade: Array<{
//         student_id: number,
//         student_code: string,
//         name: string,
//         earliest_absent_period: number,   // first period they were absent
//         absent_period_numbers: number[],  // every prior period they missed
//         latest_status: 'absent' | 'late' | 'excused',
//       }>
//     }
//   }
//
// Empty list is normal — period 1 has no prior, and a fully present
// section also returns []. The teacher UI just hides the banner when
// length === 0.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff', 'teacher', 'viewer']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const sectionId = parseInt(searchParams.get('section_id') || '', 10);
  const periodId = parseInt(searchParams.get('period_id') || '', 10);
  const date = searchParams.get('date');
  if (!sectionId || !periodId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'يجب تحديد section_id و period_id و date' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // 1. Resolve the current period's "number" — the cascade looks at
  // periods with a SMALLER number, not smaller period_id (ids aren't
  // necessarily sequential by school day order).
  const { data: currentPeriod } = await supabase
    .from('periods')
    .select('id, number')
    .eq('id', periodId)
    .maybeSingle();

  if (!currentPeriod) {
    return NextResponse.json({ error: 'الحصة غير موجودة' }, { status: 404 });
  }
  const currentNumber = (currentPeriod as any).number as number;
  if (currentNumber <= 1) {
    // Period 1 has no prior — empty cascade.
    return NextResponse.json({
      data: { earliest_period_number: null, cascade: [] },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // 2. Find session ids for THIS section + date that belong to periods
  // BEFORE the current one.
  const { data: priorSessions } = await supabase
    .from('period_sessions')
    .select('id, period_id, periods!inner ( number )')
    .eq('section_id', sectionId)
    .eq('attendance_date', date)
    .lt('periods.number', currentNumber);

  if (!priorSessions || priorSessions.length === 0) {
    return NextResponse.json({
      data: { earliest_period_number: null, cascade: [] },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const priorSessionIds = priorSessions.map((s: any) => s.id);
  const sessionToPeriodNumber = new Map<number, number>();
  for (const s of priorSessions as any[]) {
    sessionToPeriodNumber.set(s.id, s.periods?.number ?? 0);
  }

  // 3. Pull every absence row that belongs to those sessions, joined
  // with student details. We include 'late' and 'excused' too — the UI
  // shows them with different labels, but a teacher entering period 3
  // also wants to know "Ahmed was late in P1". We only auto-apply the
  // 'absent' rows though (handled client-side).
  const { data: absences } = await supabase
    .from('period_absences')
    .select(`
      session_id, student_id, status,
      students!inner ( id, student_id, first_name, father_name, last_name )
    `)
    .in('session_id', priorSessionIds);

  // 4. Roll up per student: track which period numbers they missed and
  // what the most-recent status was (which we display as a hint).
  type Roll = {
    student_id: number;
    student_code: string;
    name: string;
    periods: number[];
    latest_status: 'absent' | 'late' | 'excused';
    latest_period_number: number;
  };
  const byStudent = new Map<number, Roll>();
  for (const a of (absences || []) as any[]) {
    const num = sessionToPeriodNumber.get(a.session_id) ?? 0;
    if (num === 0) continue;
    const stu = a.students;
    const fullName = [stu?.first_name, stu?.father_name, stu?.last_name]
      .filter(Boolean).join(' ').trim();
    const existing = byStudent.get(a.student_id);
    if (existing) {
      existing.periods.push(num);
      // Track the latest (largest period number) status — that's what
      // the cascade should suggest to the teacher.
      if (num > existing.latest_period_number) {
        existing.latest_period_number = num;
        existing.latest_status = a.status;
      }
    } else {
      byStudent.set(a.student_id, {
        student_id: a.student_id,
        student_code: stu?.student_id || '',
        name: fullName,
        periods: [num],
        latest_status: a.status,
        latest_period_number: num,
      });
    }
  }

  // 5. Shape the response — only include students whose latest status
  // is 'absent'. A student who was 'late' in P1 then 'absent' in P2
  // shows up. A student who was 'absent' in P1 then 'late' in P2 also
  // shows up but with status='late' (suggesting late, not absent).
  const cascade = Array.from(byStudent.values())
    .map((r) => ({
      student_id: r.student_id,
      student_code: r.student_code,
      name: r.name,
      earliest_absent_period: Math.min(...r.periods),
      absent_period_numbers: [...new Set(r.periods)].sort((a, b) => a - b),
      latest_status: r.latest_status,
    }))
    // Only suggest cascade for absentees — late/excused are informational
    // (the UI shows them in a different tone and doesn't auto-apply).
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  const earliestPeriodNumber = priorSessions
    .map((s: any) => s.periods?.number || 0)
    .filter((n) => n > 0)
    .reduce((min, n) => Math.min(min, n), Number.POSITIVE_INFINITY);

  return NextResponse.json({
    data: {
      earliest_period_number: Number.isFinite(earliestPeriodNumber)
        ? earliestPeriodNumber
        : null,
      cascade,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
