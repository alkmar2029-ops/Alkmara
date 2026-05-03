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
  // Default = today's date in SCHOOL local time (Asia/Riyadh), not UTC.
  // Otherwise admins working past midnight Riyadh / before 3am UTC would
  // get yesterday's data unexpectedly.
  const { todayInSchoolTz } = await import('@/lib/utils/school-time');
  const date = searchParams.get('date') || todayInSchoolTz();
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

  // 6. Classify rollups into 6 buckets — granular escape categories
  // per the school's request:
  //   🟢 (no bucket — present all day, not surfaced)
  //   🔴 full_absence       — absent in every recorded period
  //   🟠 escape_after_first — present in P1 only, absent rest
  //   🔵 mid_day_departure  — present early periods (P1..Pk, k≥2),
  //                           absent every period after Pk
  //   🟡 selective_skip     — non-contiguous pattern OR only 1-2
  //                           random periods missed (kid skipped a
  //                           specific teacher's class)
  //   🟣 dismissal          — already filtered to its own bucket below
  //
  // The buckets are mutually exclusive — each student lands in exactly
  // one. Sort order inside each bucket: most-absent first.
  type Bucket = Rollup & { category: 'full_absence' | 'escape_after_first' | 'mid_day_departure' | 'selective_skip' };
  const dismissedIds = new Set((dismissals || []).map((d: any) => d.student_id));
  const fullAbsences: Bucket[] = [];
  const escapeAfterFirst: Bucket[] = [];
  const midDayDeparture: Bucket[] = [];
  const selectiveSkip: Bucket[] = [];

  for (const r of rollups) {
    if (dismissedIds.has(r.student_id)) continue;  // own bucket below
    if (r.absent_periods.length === 0) continue;   // pure present

    // Compute the period numbers the student WAS present in (within range).
    const sectionSessions = sectionsToSessions.get(r.section_id) || [];
    const allPeriodNumbers = sectionSessions
      .map((s: any) => s.periods?.number)
      .filter((n: any): n is number => typeof n === 'number')
      .sort((a, b) => a - b);
    const absentSet = new Set(r.absent_periods);
    const presentNumbers = allPeriodNumbers.filter((n) => !absentSet.has(n));

    // Full absence: missed every recorded period in range.
    if (r.absent_periods.length >= r.expected_periods) {
      fullAbsences.push({ ...r, category: 'full_absence' });
      continue;
    }

    // The student attended at least one period. Check the pattern.
    const sortedAbsent = [...r.absent_periods].sort((a, b) => a - b);
    const sortedPresent = [...presentNumbers].sort((a, b) => a - b);

    // Both arrays non-empty here (full_absence handled, present.length > 0).
    const startsAtP1 = sortedPresent[0] === 1;
    const lastPresent = sortedPresent[sortedPresent.length - 1];
    const firstAbsent = sortedAbsent[0];
    const allAbsentAfterPresent = firstAbsent > lastPresent;
    // "Contiguous early presence" = the present periods are 1, 2, ..., k
    // with no gaps. If there's a gap (e.g., present 1,3 missing 2), the
    // pattern is selective rather than a clean mid-day departure.
    const presentContiguousFromOne =
      startsAtP1 && sortedPresent.every((n, i) => n === i + 1);

    if (presentContiguousFromOne && allAbsentAfterPresent) {
      if (sortedPresent.length === 1) {
        // Only P1 attended — classic "checked in then ran".
        escapeAfterFirst.push({ ...r, category: 'escape_after_first' });
      } else {
        // Multiple early periods attended, then disappeared — went home.
        midDayDeparture.push({ ...r, category: 'mid_day_departure' });
      }
    } else {
      // Anything else: scattered absences, skipping specific teachers.
      selectiveSkip.push({ ...r, category: 'selective_skip' });
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
  escapeAfterFirst.sort((a, b) => b.absent_periods.length - a.absent_periods.length);
  midDayDeparture.sort((a, b) => b.absent_periods.length - a.absent_periods.length);
  selectiveSkip.sort((a, b) => b.absent_periods.length - a.absent_periods.length);

  // Backwards-compatible "escapes" union — older clients that haven't
  // updated their UI keep working. The granular buckets are added
  // alongside, not in place of, the old field.
  const escapes = [...escapeAfterFirst, ...midDayDeparture, ...selectiveSkip];

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
        escapes: escapes.length,                    // legacy total
        escape_after_first: escapeAfterFirst.length,
        mid_day_departure: midDayDeparture.length,
        selective_skip: selectiveSkip.length,
        dismissals: dismissalRows.length,
        incomplete_sections: incompleteSections.length,
      },
      full_absences: fullAbsences,
      // Granular buckets — each row also has `category` so a single
      // unified UI list can color-code based on the field.
      escape_after_first: escapeAfterFirst,
      mid_day_departure: midDayDeparture,
      selective_skip: selectiveSkip,
      // Kept for backwards compatibility with any caller that still
      // reads `escapes` as a flat array.
      escapes,
      dismissals: dismissalRows,
      incomplete_sections: incompleteSections,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
