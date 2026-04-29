import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — analyze a single school day and classify every student into:
//   • present (no absences in the chosen range)
//   • full_absence (absent in EVERY recorded period within range)
//   • escape (absent in SOME but not all periods → list the period numbers)
//   • dismissal (has a student_dismissals row for the day → silenced)
//
// Query params:
//   ?date=YYYY-MM-DD       (default: today)
//   ?from_period=N         (default: 1)
//   ?to_period=N           (default: highest period number in school)
//
// The range lets the deputy say "today is a half day, analyze 1-5 only"
// or "Sunday → Wednesday is 1-7, but Thursday is 1-6". Sessions outside
// the range are entirely ignored.
//
// Important: only sessions actually recorded count. If the teacher of
// section الأول/أ hasn't recorded period 4 yet, that period doesn't
// inflate the "expected" count for that section's students. This avoids
// false-positive escape flags.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const fromPeriod = Math.max(1, parseInt(searchParams.get('from_period') || '1', 10) || 1);
  const toPeriodRaw = parseInt(searchParams.get('to_period') || '0', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'صيغة التاريخ غير صالحة' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // 1. Resolve "to_period" — caller can pass 0 to mean "the largest
  // period number defined in school_settings/periods table".
  const { data: periods } = await supabase
    .from('periods')
    .select('id, number')
    .order('number');
  const maxPeriod = (periods || []).reduce((m, p: any) => Math.max(m, p.number || 0), 0);
  const toPeriod = toPeriodRaw > 0 ? toPeriodRaw : maxPeriod;

  if (toPeriod < fromPeriod) {
    return NextResponse.json({ error: 'نطاق الحصص غير صالح' }, { status: 400 });
  }

  // 2. Pull ALL period_sessions for the day with the period number, then
  // filter in JS (cleaner than chained Supabase joins for the range
  // semantics — and the day's sessions for a school are at most ~200).
  const { data: sessions } = await supabase
    .from('period_sessions')
    .select(`
      id, section_id, period_id, total_count, absent_count, late_count, excused_count,
      sections!inner ( id, name, grade_id, grades!inner ( id, name ) ),
      periods!inner ( id, number, name )
    `)
    .eq('attendance_date', date);

  // Restrict to sessions within the requested period range.
  const sessionsInRange = (sessions || []).filter((s: any) => {
    const n = s.periods?.number;
    return n != null && n >= fromPeriod && n <= toPeriod;
  });

  // 3. Pull all absence rows for these sessions.
  const sessionIds = sessionsInRange.map((s: any) => s.id);
  const { data: absences } = sessionIds.length === 0
    ? { data: [] }
    : await supabase
        .from('period_absences')
        .select(`
          session_id, student_id, status,
          students!inner ( id, student_id, first_name, father_name, last_name, phone, section_id )
        `)
        .in('session_id', sessionIds)
        .eq('status', 'absent');  // ← only 'absent' counts toward escape/full-absence

  // 4. Pull dismissals for the day — these students go to a separate bucket
  // and get NO WhatsApp from this flow (they already got the dismissal one).
  const { data: dismissals } = await supabase
    .from('student_dismissals')
    .select(`student_id,
      students!inner ( id, student_id, first_name, father_name, last_name, phone, section_id )
    `)
    .eq('dismissal_date', date);

  // 5. Build per-student rollups. For each (student × section), we need:
  //    - how many sessions were recorded for their section in range
  //      (= number of periods we can evaluate for that student)
  //    - how many of those sessions had this student marked absent
  //    - which period numbers they were absent from
  type Rollup = {
    student_id: number;
    student_code: string;
    student_name: string;
    phone: string | null;
    section_id: number;
    section_name: string;
    grade_name: string;
    expected_periods: number;
    absent_periods: number[];
  };

  // Index sessions by section for quick "expected count" lookup, and
  // build a Map<student_id, missed period numbers[]>.
  const sectionsToSessions = new Map<number, any[]>();
  for (const s of sessionsInRange) {
    const arr = sectionsToSessions.get(s.section_id) || [];
    arr.push(s);
    sectionsToSessions.set(s.section_id, arr);
  }

  // Map session_id → period.number for fast lookup.
  const sessionPeriodMap = new Map<number, number>();
  for (const s of sessionsInRange as any[]) {
    sessionPeriodMap.set(s.id, s.periods?.number || 0);
  }

  // Group absences by student_id.
  const absencesByStudent = new Map<number, { session_ids: number[]; student: any }>();
  for (const a of (absences || []) as any[]) {
    const cur = absencesByStudent.get(a.student_id) || { session_ids: [], student: a.students };
    cur.session_ids.push(a.session_id);
    absencesByStudent.set(a.student_id, cur);
  }

  // Build rollups for every student that has at least one absent row.
  const rollups: Rollup[] = [];
  for (const [studentId, info] of absencesByStudent) {
    const stu = info.student;
    if (!stu) continue;
    const sectionSessions = sectionsToSessions.get(stu.section_id) || [];
    const expected = sectionSessions.length;
    if (expected === 0) continue;  // section had no recorded sessions in range
    const missedPeriods = info.session_ids
      .map((sid) => sessionPeriodMap.get(sid))
      .filter((n): n is number => !!n)
      .sort((a, b) => a - b);
    rollups.push({
      student_id: studentId,
      student_code: stu.student_id,
      student_name: [stu.first_name, stu.father_name, stu.last_name].filter(Boolean).join(' ').trim(),
      phone: stu.phone || null,
      section_id: stu.section_id,
      section_name: (sectionSessions[0] as any).sections?.name || '—',
      grade_name: (sectionSessions[0] as any).sections?.grades?.name || '—',
      expected_periods: expected,
      absent_periods: missedPeriods,
    });
  }

  // 6. Classify rollups into buckets.
  const dismissedIds = new Set((dismissals || []).map((d: any) => d.student_id));
  const fullAbsences: Rollup[] = [];
  const escapes: Rollup[] = [];
  for (const r of rollups) {
    if (dismissedIds.has(r.student_id)) continue;  // already in dismissal bucket
    if (r.absent_periods.length >= r.expected_periods) {
      fullAbsences.push(r);
    } else if (r.absent_periods.length > 0) {
      escapes.push(r);
    }
  }

  // 7. Surface sections with recording gaps so the deputy knows the
  // analysis isn't complete for them yet.
  const incompleteSections: any[] = [];
  const sectionsAll = await supabase.from('sections').select('id, name, grade_id, grades(name)');
  for (const sec of sectionsAll.data || []) {
    const recorded = (sectionsToSessions.get(sec.id) || []).map((s: any) => s.periods?.number);
    const missingPeriods: number[] = [];
    for (let p = fromPeriod; p <= toPeriod; p++) {
      if (!recorded.includes(p)) missingPeriods.push(p);
    }
    if (missingPeriods.length > 0) {
      incompleteSections.push({
        section_id: sec.id,
        section_name: sec.name,
        grade_name: (sec as any).grades?.name || '—',
        missing_periods: missingPeriods,
      });
    }
  }

  // 8. Dismissals — pass through with student details.
  const dismissalRows = (dismissals || []).map((d: any) => ({
    student_id: d.student_id,
    student_code: d.students?.student_id,
    student_name: [d.students?.first_name, d.students?.father_name, d.students?.last_name].filter(Boolean).join(' ').trim(),
    phone: d.students?.phone || null,
  }));

  // Sort biggest-impact first inside each list.
  fullAbsences.sort((a, b) => `${a.grade_name} ${a.section_name}`.localeCompare(`${b.grade_name} ${b.section_name}`, 'ar'));
  escapes.sort((a, b) => b.absent_periods.length - a.absent_periods.length);

  // Total students for context — straight count, no RLS surprises since
  // admin/staff are already past requireRole.
  const { count: totalStudents } = await supabase
    .from('students').select('id', { count: 'exact', head: true }).eq('is_active', true);

  return NextResponse.json({
    data: {
      date,
      range: { from: fromPeriod, to: toPeriod, max_period: maxPeriod },
      stats: {
        total_students: totalStudents ?? 0,
        full_absences: fullAbsences.length,
        escapes: escapes.length,
        dismissals: dismissalRows.length,
        incomplete_sections: incompleteSections.length,
      },
      full_absences: fullAbsences,
      escapes,
      dismissals: dismissalRows,
      incomplete_sections: incompleteSections,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
