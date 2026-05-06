import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — per-period attendance for a single student on a single day.
// Powers the daily-attendance drawer that opens when staff clicks a
// student's name in any of the buckets (full_absence, escape, ...).
//
// Query params:
//   ?date=YYYY-MM-DD          required
//   ?from_period=N            default 1
//   ?to_period=N              default 0 → max period in school
//
// Response shape:
//   { data: {
//       date,
//       student: { id, name, grade_name, section_name, phone, health_info },
//       periods: [
//         { period_number, period_name, status, teacher_name, recorded_at }
//       ]
//   }}
//
// `status` values:
//   - 'absent'        → has period_absences row with status='absent'
//   - 'late'          → row with status='late'
//   - 'excused'       → row with status='excused'
//   - 'present'       → session was recorded for the section but no
//                       absence row → student was present
//   - 'not_recorded'  → no session exists for that section/period yet
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const studentId = parseInt(params.id, 10);
  if (Number.isNaN(studentId)) {
    return NextResponse.json({ error: 'معرّف الطالب غير صالح' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'صيغة التاريخ غير صالحة' }, { status: 400 });
  }
  const fromPeriod = Math.max(1, parseInt(searchParams.get('from_period') || '1', 10) || 1);
  const toPeriodRaw = parseInt(searchParams.get('to_period') || '0', 10);

  const supabase = await createServerSupabaseClient();

  // 1. Student basics + section.
  const { data: student, error: stuErr } = await supabase
    .from('students')
    .select('id, student_id, first_name, father_name, last_name, phone, section_id, health_info, social_info, grades(name), sections(name)')
    .eq('id', studentId)
    .single();

  if (stuErr || !student) {
    return NextResponse.json({ error: 'لم يتم العثور على الطالب' }, { status: 404 });
  }

  // 2. Resolve max period if to_period was 0/missing.
  const { data: periodsList } = await supabase
    .from('periods')
    .select('id, number, name')
    .order('number');
  const allPeriods = (periodsList || []).filter(
    (p: any) => typeof p.number === 'number',
  );
  const maxPeriod = allPeriods.reduce((m, p: any) => Math.max(m, p.number), 0);
  const toPeriod = toPeriodRaw > 0 ? toPeriodRaw : maxPeriod;

  if (toPeriod < fromPeriod) {
    return NextResponse.json({ error: 'نطاق الحصص غير صالح' }, { status: 400 });
  }

  // 3. All sessions recorded for THIS student's section on this date.
  const { data: sessions } = await supabase
    .from('period_sessions')
    .select('id, period_id, recorded_by, recorded_at, periods!inner(id, number, name)')
    .eq('section_id', student.section_id)
    .eq('attendance_date', date);

  const sessionsInRange = (sessions || []).filter((s: any) => {
    const n = s.periods?.number;
    return typeof n === 'number' && n >= fromPeriod && n <= toPeriod;
  });

  // 4. Per-student absence rows for those sessions (if any).
  const sessionIds = sessionsInRange.map((s: any) => s.id);
  const { data: absences } = sessionIds.length === 0
    ? { data: [] }
    : await supabase
        .from('period_absences')
        .select('session_id, status, recorded_at')
        .in('session_id', sessionIds)
        .eq('student_id', studentId);

  const absenceBySession = new Map<number, { status: string; recorded_at: string }>();
  for (const a of (absences || []) as any[]) {
    absenceBySession.set(a.session_id, { status: a.status, recorded_at: a.recorded_at });
  }

  // 5. Resolve teacher names for sessions that have a recorder.
  const teacherIds = Array.from(
    new Set(
      sessionsInRange
        .map((s: any) => s.recorded_by)
        .filter((v: any): v is string => !!v),
    ),
  );
  const teacherMap = new Map<string, string>();
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', teacherIds);
    for (const p of profiles || []) {
      if (p.full_name) teacherMap.set(p.user_id, p.full_name);
    }
  }

  // 6. Build the per-period array — one entry for every period in
  // [from..to], whether the section has a session or not.
  const sessionByPeriod = new Map<number, any>();
  for (const s of sessionsInRange as any[]) {
    sessionByPeriod.set(s.periods.number, s);
  }

  const periods: Array<{
    period_number: number;
    period_name: string | null;
    status: 'absent' | 'late' | 'excused' | 'present' | 'not_recorded';
    teacher_name: string | null;
    recorded_at: string | null;
  }> = [];

  for (let n = fromPeriod; n <= toPeriod; n++) {
    const sess = sessionByPeriod.get(n);
    if (!sess) {
      // Look up the period name from the catalog so the UI can still
      // render "الحصة الثالثة" even when the section hasn't recorded.
      const cat = allPeriods.find((p: any) => p.number === n);
      periods.push({
        period_number: n,
        period_name: cat?.name ?? null,
        status: 'not_recorded',
        teacher_name: null,
        recorded_at: null,
      });
      continue;
    }
    const absence = absenceBySession.get(sess.id);
    periods.push({
      period_number: n,
      period_name: sess.periods?.name ?? null,
      status: (absence?.status as any) || 'present',
      teacher_name: sess.recorded_by ? teacherMap.get(sess.recorded_by) ?? null : null,
      recorded_at: absence?.recorded_at || sess.recorded_at || null,
    });
  }

  const fullName = [student.first_name, student.father_name, student.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return NextResponse.json({
    data: {
      date,
      range: { from: fromPeriod, to: toPeriod },
      student: {
        id: student.id,
        student_code: student.student_id,
        name: fullName,
        phone: student.phone,
        grade_name: (student as any).grades?.name ?? null,
        section_name: (student as any).sections?.name ?? null,
        health_info: student.health_info,
        social_info: (student as any).social_info ?? null,
      },
      periods,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
