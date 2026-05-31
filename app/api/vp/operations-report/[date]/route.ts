// GET /api/vp/operations-report/[date] — daily operations digest for
// any date (past, today, or future). The morning-summary endpoint
// (م2.4) is the "now" view; this one lets the VP review a specific
// historical day or plan ahead.
//
// Returns more detail than morning-summary:
//   - Named lists of absent teachers + empty supervision posts (not
//     just counts)
//   - Dismissals broken down by reason
//   - Leave decisions made on this date + active/pending leaves
//     overlapping it
//   - Substitution coverage percentage
//
// Gate: requireVpDashboard (read-only).
// Service-role client because RLS would scope a non-super VP's reads.
//
// Date param: strict real YYYY-MM-DD calendar date in the URL path.
// Past and future dates both allowed — VPs review history AND plan
// ahead.

import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireVpDashboard } from '@/lib/personas/auth-gate';
import { dayOfWeekKsa, addDaysKsa, isValidKsaDate } from '@/lib/dates/ksa';

export const dynamic = 'force-dynamic';

interface AbsentTeacherEntry {
  user_id: string;
  full_name: string | null;
  reason: string | null;
  expected_return: string | null;
}

interface EmptyPost {
  location_id: number;
  name: string;
}

interface OperationsReport {
  date: string;
  day_of_week: number;
  teachers: {
    absent_count: number;
    absent_list: AbsentTeacherEntry[];
  };
  substitutions: {
    total_class_periods_needing_sub: number;
    assigned_count: number;
    pending_count: number;
    coverage_pct: number; // 0..100 — assigned / total * 100
    unique_substitutes_count: number;
  };
  leaves: {
    decisions_on_date: {
      approved: number;
      rejected: number;
    };
    active_overlapping: number;  // approved leaves covering this date
    pending_overlapping: number; // pending leaves covering this date
  };
  supervision: {
    day_of_week: number;
    active_locations_count: number;
    assigned_count: number;
    empty_count: number;
    empty_list: EmptyPost[];
  };
  dismissals: {
    total: number;
    by_reason: Record<string, number>;
  };
  // Live Sprint 3/4 metrics (Wave A bridge): incidents actioned and
  // counselor cases opened ON this date.
  incidents_actioned: number;
  cases_opened: number;
}

export async function GET(
  _request: Request,
  { params }: { params: { date: string } },
) {
  const auth = await requireVpDashboard();
  if (!auth.ok) return auth.res;

  if (!isValidKsaDate(params.date)) {
    return NextResponse.json(
      { error: 'التاريخ غير صالح — يجب أن يكون تاريخًا حقيقيًا بصيغة YYYY-MM-DD' },
      { status: 400 },
    );
  }
  const date = params.date;
  const day_of_week = dayOfWeekKsa(date);
  const nextDateIso = `${addDaysKsa(date, 1)}T00:00:00+03:00`;
  const dateIso = `${date}T00:00:00+03:00`;

  const admin = createAdminSupabaseClient();

  // Parallel fetches for all the independent metrics. The substitution
  // coverage needs the absences list first to compute, so it runs in
  // a second round.
  const [
    absencesRes,
    leavesDecidedRes,
    leavesActiveRes,
    leavesPendingRes,
    activeLocationsRes,
    supervisionAssignedRes,
    dismissalsRes,
    incidentsActionedRes,
    casesOpenedRes,
  ] = await Promise.all([
    admin
      .from('daily_teacher_absences')
      .select('id, teacher_user_id, reason, expected_return')
      .eq('absence_date', date)
      .order('reported_at', { ascending: false }),
    // Decisions MADE ON this date — bounded by [date, date+1) so we
    // don't depend on the runtime tz.
    admin
      .from('teacher_leaves')
      .select('status', { count: 'exact' })
      .gte('decided_at', dateIso)
      .lt('decided_at', nextDateIso)
      .in('status', ['approved', 'rejected']),
    // Approved leaves whose range overlaps this date.
    admin
      .from('teacher_leaves')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'approved')
      .lte('start_date', date)
      .gte('end_date', date),
    // Pending leaves whose range overlaps this date.
    admin
      .from('teacher_leaves')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lte('start_date', date)
      .gte('end_date', date),
    admin
      .from('supervision_locations')
      .select('id, name')
      .eq('is_active', true)
      .order('sort_order'),
    admin
      .from('supervision_assignments')
      .select('location_id')
      .eq('day_of_week', day_of_week),
    admin
      .from('student_dismissals')
      .select('id, reason')
      .eq('dismissal_date', date),

    // Incidents actioned ON this date — reviewed_at within [date, date+1)
    // (Riyadh-bounded ISO range, tz-stable like the leave-decision query).
    admin
      .from('student_incidents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'actioned')
      .gte('reviewed_at', dateIso)
      .lt('reviewed_at', nextDateIso),

    // Counselor cases opened ON this date — created_at within [date, date+1).
    admin
      .from('student_cases')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', dateIso)
      .lt('created_at', nextDateIso),
  ]);

  if (
    absencesRes.error ||
    leavesDecidedRes.error ||
    leavesActiveRes.error ||
    leavesPendingRes.error ||
    activeLocationsRes.error ||
    supervisionAssignedRes.error ||
    dismissalsRes.error ||
    incidentsActionedRes.error ||
    casesOpenedRes.error
  ) {
    const err =
      absencesRes.error ??
      leavesDecidedRes.error ??
      leavesActiveRes.error ??
      leavesPendingRes.error ??
      activeLocationsRes.error ??
      supervisionAssignedRes.error ??
      dismissalsRes.error ??
      incidentsActionedRes.error ??
      casesOpenedRes.error;
    return NextResponse.json(
      { error: 'فشل تحميل التقرير: ' + err!.message },
      { status: 500 },
    );
  }

  const absences = (absencesRes.data ?? []) as Array<{
    id: number;
    teacher_user_id: string;
    reason: string | null;
    expected_return: string | null;
  }>;
  const absentTeacherIds = absences.map((a) => a.teacher_user_id);

  // Second round: substitution counts (depend on absences list) +
  // teacher names (FK to auth.users — separate query as always).
  let totalClassPeriods = 0;
  let assignedCount = 0;
  let uniqueSubstitutesCount = 0;
  const teacherProfileMap = new Map<string, string | null>();

  if (absentTeacherIds.length > 0) {
    const absenceIds = absences.map((a) => a.id);
    const [periodsRes, assignmentsRes, profilesRes] = await Promise.all([
      admin
        .from('teacher_schedule')
        .select('id', { count: 'exact', head: true })
        .in('teacher_user_id', absentTeacherIds)
        .eq('day_of_week', day_of_week)
        .eq('duty_type', 'class'),
      admin
        .from('substitution_assignments')
        .select('substitute_user_id')
        .in('absence_id', absenceIds)
        .eq('day_of_week', day_of_week),
      admin
        .from('user_profiles')
        .select('user_id, full_name')
        .in('user_id', absentTeacherIds),
    ]);

    if (periodsRes.error || assignmentsRes.error || profilesRes.error) {
      const err = periodsRes.error ?? assignmentsRes.error ?? profilesRes.error;
      return NextResponse.json(
        { error: 'فشل تحميل تفاصيل الانتظار: ' + err!.message },
        { status: 500 },
      );
    }
    totalClassPeriods = periodsRes.count ?? 0;
    const assignments = (assignmentsRes.data ?? []) as Array<{
      substitute_user_id: string;
    }>;
    assignedCount = assignments.length;
    uniqueSubstitutesCount = new Set(
      assignments.map((a) => a.substitute_user_id),
    ).size;
    for (const p of profilesRes.data ?? []) {
      teacherProfileMap.set((p as any).user_id, (p as any).full_name ?? null);
    }
  }

  // Supervision: empty = active − assigned.
  const activeLocations = (activeLocationsRes.data ?? []) as Array<{
    id: number;
    name: string;
  }>;
  const assignedLocationIds = new Set(
    (supervisionAssignedRes.data ?? []).map(
      (r: any) => r.location_id as number,
    ),
  );
  const emptyPosts = activeLocations.filter(
    (l) => !assignedLocationIds.has(l.id),
  );

  // Dismissals: count + groupBy reason in JS (small N, no need for SQL agg).
  const dismissalRows = (dismissalsRes.data ?? []) as Array<{
    id: number;
    reason: string | null;
  }>;
  const byReason: Record<string, number> = {};
  for (const d of dismissalRows) {
    const key = d.reason ?? 'other';
    byReason[key] = (byReason[key] ?? 0) + 1;
  }

  // Leave decisions: split approved vs rejected by counting the
  // returned rows (status is in the select but not aggregated).
  const decisions = (leavesDecidedRes.data ?? []) as Array<{ status: string }>;
  const decisionsApproved = decisions.filter((d) => d.status === 'approved').length;
  const decisionsRejected = decisions.filter((d) => d.status === 'rejected').length;

  // Coverage pct — defined as 100 when there's nothing to cover, so
  // an empty day doesn't render as "0% covered" alarm in the UI.
  const pendingCount = Math.max(0, totalClassPeriods - assignedCount);
  const coveragePct = totalClassPeriods === 0
    ? 100
    : Math.round((assignedCount / totalClassPeriods) * 100);

  const data: OperationsReport = {
    date,
    day_of_week,
    teachers: {
      absent_count: absences.length,
      absent_list: absences.map((a) => ({
        user_id: a.teacher_user_id,
        full_name: teacherProfileMap.get(a.teacher_user_id) ?? null,
        reason: a.reason,
        expected_return: a.expected_return,
      })),
    },
    substitutions: {
      total_class_periods_needing_sub: totalClassPeriods,
      assigned_count: assignedCount,
      pending_count: pendingCount,
      coverage_pct: coveragePct,
      unique_substitutes_count: uniqueSubstitutesCount,
    },
    leaves: {
      decisions_on_date: {
        approved: decisionsApproved,
        rejected: decisionsRejected,
      },
      active_overlapping: leavesActiveRes.count ?? 0,
      pending_overlapping: leavesPendingRes.count ?? 0,
    },
    supervision: {
      day_of_week,
      active_locations_count: activeLocations.length,
      assigned_count: activeLocations.length - emptyPosts.length,
      empty_count: emptyPosts.length,
      empty_list: emptyPosts.map((l) => ({ location_id: l.id, name: l.name })),
    },
    dismissals: {
      total: dismissalRows.length,
      by_reason: byReason,
    },
    incidents_actioned: incidentsActionedRes.count ?? 0,
    cases_opened: casesOpenedRes.count ?? 0,
  };

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
