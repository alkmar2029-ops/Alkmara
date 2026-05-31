// GET /api/vp/absences/today — detailed view for the VP substitutions UI.
//
// Returns every teacher marked absent today, expanded to show:
//   - Their full schedule for today's day_of_week
//   - For each period: section + grade names, duty_type
//   - Whether a substitute is already assigned for that period
//   - Per-teacher stats: total / class-only / assigned / pending
//
// The morning-summary endpoint (م2.4) gives COUNTS; this endpoint gives
// the DATA the VP needs to make picks. The substitutions screen (later
// م2.13) renders this list and lets the VP toggle a substitute per
// pending class period.
//
// Gate: requireVpDashboard (super_admin OR view_morning_dashboard).
// Service-role client because RLS would block a non-super VP from
// reading other teachers' schedules.

import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireVpDashboard } from '@/lib/personas/auth-gate';
import { todayInRiyadh, dayOfWeekKsa } from '@/lib/dates/ksa';

export const dynamic = 'force-dynamic';

interface PeriodSlot {
  day_of_week: number;
  period_number: number;
  section_id: number | null;
  section_name: string | null;
  grade_name: string | null;
  subject: string | null;
  duty_type: string; // 'class' | 'monitoring' | 'free'
  // Only class periods need substitution coverage; the UI uses this to
  // disable the "assign" action on monitoring/free slots without
  // re-deriving the rule.
  slot_assignable: boolean;
  // Always null for non-class slots — substitution semantically applies
  // to class coverage only. (Codex Sprint 2 review: previously a
  // stray substitution_assignments row at a non-class period would
  // attach to the wrong slot.)
  substitute: {
    assignment_id: number;
    user_id: string;
    name: string | null;
  } | null;
}

interface AbsenceDetail {
  absence_id: number;
  teacher_user_id: string;
  teacher_name: string | null;
  reason: string | null;
  expected_return: string | null;
  reported_at: string;
  periods: PeriodSlot[];
  stats: {
    total_periods: number;
    class_periods: number;
    assigned: number;
    pending: number;
  };
}

export async function GET() {
  const auth = await requireVpDashboard();
  if (!auth.ok) return auth.res;

  // Tz-stable date + day-of-week via lib/dates/ksa.
  const todayDate = todayInRiyadh();
  const todayDow = dayOfWeekKsa(todayDate);

  const admin = createAdminSupabaseClient();

  // 1. Today's absences.
  const absencesRes = await admin
    .from('daily_teacher_absences')
    .select('id, teacher_user_id, reason, expected_return, reported_at')
    .eq('absence_date', todayDate)
    .order('reported_at', { ascending: false });

  if (absencesRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب الغياب: ' + absencesRes.error.message },
      { status: 500 },
    );
  }

  const absences = absencesRes.data ?? [];

  // Empty fast-path — no further queries needed.
  if (absences.length === 0) {
    return NextResponse.json(
      {
        data: {
          date: todayDate,
          day_of_week: todayDow,
          absences: [],
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const teacherIds = absences.map((a) => a.teacher_user_id);
  const absenceIds = absences.map((a) => a.id);

  // 2-4: schedule + substitutions + teacher profiles in parallel.
  const [scheduleRes, subsRes, teacherProfilesRes] = await Promise.all([
    // Schedule slots for these teachers on today's day_of_week. Embed
    // section + grade names via PostgREST (FK chain stays in public).
    admin
      .from('teacher_schedule')
      .select(`
        teacher_user_id,
        day_of_week,
        period_number,
        section_id,
        subject,
        duty_type,
        section:sections(name, grade:grades(name))
      `)
      .in('teacher_user_id', teacherIds)
      .eq('day_of_week', todayDow)
      .order('period_number'),

    // All substitution assignments for today's absences. Day_of_week
    // is implicit from the absence_id filter but pinning it adds
    // defence against any future absence row spanning multiple days.
    admin
      .from('substitution_assignments')
      .select('id, absence_id, substitute_user_id, period_number')
      .in('absence_id', absenceIds)
      .eq('day_of_week', todayDow),

    // Absent teachers' display names (FK to auth.users prevents
    // embedding — separate query, same pattern as م1.5).
    admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', teacherIds),
  ]);

  // Validate every query result — silent-zero bugs are the most painful
  // class of failure for an aggregator (Codex Sprint 2 review).
  if (scheduleRes.error || subsRes.error || teacherProfilesRes.error) {
    const firstErr =
      scheduleRes.error ?? subsRes.error ?? teacherProfilesRes.error;
    return NextResponse.json(
      { error: 'فشل تحميل التفاصيل: ' + firstErr!.message },
      { status: 500 },
    );
  }

  // 5: substitute names (separate query for the same FK reason).
  const substitutes = subsRes.data ?? [];
  const substituteIds = Array.from(
    new Set(substitutes.map((s) => s.substitute_user_id)),
  );
  const substituteProfileMap = new Map<string, string | null>();
  if (substituteIds.length > 0) {
    const subProfilesRes = await admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', substituteIds);
    if (subProfilesRes.error) {
      return NextResponse.json(
        { error: 'فشل تحميل أسماء البدلاء: ' + subProfilesRes.error.message },
        { status: 500 },
      );
    }
    for (const p of subProfilesRes.data ?? []) {
      substituteProfileMap.set(p.user_id, p.full_name);
    }
  }

  // Build the lookup maps once, then assemble in O(absences × periods).
  const teacherProfileMap = new Map<string, string | null>();
  for (const p of teacherProfilesRes.data ?? []) {
    teacherProfileMap.set(p.user_id, p.full_name);
  }

  // Schedule rows grouped by teacher. Preserves the order_by from the
  // query (period_number ASC) inside each teacher's list.
  type ScheduleRow = NonNullable<typeof scheduleRes.data>[number];
  const scheduleByTeacher = new Map<string, ScheduleRow[]>();
  for (const s of scheduleRes.data ?? []) {
    const arr = scheduleByTeacher.get(s.teacher_user_id) ?? [];
    arr.push(s);
    scheduleByTeacher.set(s.teacher_user_id, arr);
  }

  // Substitutions keyed by (absence_id, period_number). day_of_week is
  // already pinned in the query above.
  type SubRow = NonNullable<typeof subsRes.data>[number];
  const subMap = new Map<string, SubRow>();
  for (const sub of substitutes) {
    subMap.set(`${sub.absence_id}:${sub.period_number}`, sub);
  }

  // Helper: PostgREST may return embedded relations as a single object
  // OR as an array depending on the inferred cardinality. The schema
  // gives us single objects (teacher_schedule.section_id → sections.id
  // is many-to-one), but the typing is loose. Unwrap defensively.
  const unwrap = <T,>(v: T | T[] | null | undefined): T | null => {
    if (!v) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
  };

  const result: AbsenceDetail[] = absences.map((absence) => {
    const teacherSchedule = scheduleByTeacher.get(absence.teacher_user_id) ?? [];

    const periods: PeriodSlot[] = teacherSchedule.map((slot) => {
      const sectionObj = unwrap(slot.section as any);
      const gradeObj = unwrap(sectionObj?.grade as any);
      const slotAssignable = slot.duty_type === 'class';
      // Only attach a substitute to class periods. Substitutions are
      // semantically about class coverage; a stray substitution row at
      // a monitoring/free period (legacy data, manual SQL, ...) must
      // not be surfaced against that non-class slot. Codex Sprint 2.
      const sub = slotAssignable
        ? subMap.get(`${absence.id}:${slot.period_number}`)
        : undefined;
      return {
        day_of_week: slot.day_of_week,
        period_number: slot.period_number,
        section_id: slot.section_id,
        section_name: sectionObj?.name ?? null,
        grade_name: gradeObj?.name ?? null,
        subject: slot.subject,
        duty_type: slot.duty_type,
        slot_assignable: slotAssignable,
        substitute: sub
          ? {
              assignment_id: sub.id,
              user_id: sub.substitute_user_id,
              name: substituteProfileMap.get(sub.substitute_user_id) ?? null,
            }
          : null,
      };
    });

    // Stats: total = all periods (incl. monitoring/free), class_periods
    // = only duty_type='class' (the substitutable ones), assigned =
    // class periods with sub. pending is the actionable count.
    const classPeriods = periods.filter((p) => p.duty_type === 'class');
    const assigned = classPeriods.filter((p) => p.substitute !== null).length;

    return {
      absence_id: absence.id,
      teacher_user_id: absence.teacher_user_id,
      teacher_name: teacherProfileMap.get(absence.teacher_user_id) ?? null,
      reason: absence.reason,
      expected_return: absence.expected_return,
      reported_at: absence.reported_at,
      periods,
      stats: {
        total_periods: periods.length,
        class_periods: classPeriods.length,
        assigned,
        pending: classPeriods.length - assigned,
      },
    };
  });

  return NextResponse.json(
    {
      data: {
        date: todayDate,
        day_of_week: todayDow,
        absences: result,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
