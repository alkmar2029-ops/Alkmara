// GET /api/vp/morning-summary — the VP's daily operations digest.
//
// Returns a single payload that powers the VP morning dashboard
// (المرحلة 2 م2.12). Aggregates 6 metrics in parallel:
//
//   1. Absent teachers today (count + first names for the alert ribbon)
//   2. Substitutions needed / assigned / pending today
//   3. Pending teacher leave requests
//   4. Pending student dismissals
//   5. Empty supervision posts for today
//   6. Pending student incidents + open counselor cases (Sprint 3/4
//      tables now exist — wired live by the Wave A bridge).
//
// Gate: super_admin OR view_morning_dashboard flag. The flag is granted
// to principals, VP-academic, VP-student_affairs by the admin in the
// personas screen (م1.7d). Counselors NEVER get this flag, so even
// though they carry role=admin they fail the gate.
//
// Cache: 'no-store' for security (just like /api/me/persona). The
// frontend will use TanStack Query + refetchInterval for the
// auto-refresh feel; we don't need HTTP caching.

import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireVpDashboard } from '@/lib/personas/auth-gate';
import { todayInRiyadh, dayOfWeekKsa } from '@/lib/dates/ksa';

export const dynamic = 'force-dynamic';

interface AbsentTeacherSummary {
  user_id: string;
  full_name: string | null;
  reason: string | null;
}

interface MorningSummary {
  date: string;
  day_of_week: number; // 0=Sun .. 4=Thu
  teachers: {
    absent_today: number;
    absent_list: AbsentTeacherSummary[]; // top 10 for the alert ribbon
  };
  substitutions: {
    total_needed: number;
    assigned: number;
    pending: number;
  };
  leaves: {
    pending_requests: number;
  };
  dismissals: {
    // Total student dismissals recorded today. student_dismissals has
    // no `status` column — every row is an authoritative "left early"
    // event recorded by the deputy at the gate. So "pending" doesn't
    // apply; today_total is the actionable count for the VP digest.
    today_total: number;
  };
  supervision: {
    empty_posts_today: number;
  };
  // Live Sprint 3/4 metrics (Wave A bridge): pending incident reviews
  // and active counselor cases, school-wide.
  pending_incidents: number;
  open_cases: number;
}

export async function GET() {
  const auth = await requireVpDashboard();
  if (!auth.ok) return auth.res;

  // Today's date in Riyadh + its weekday. Both go through lib/dates/ksa
  // so the result is stable on UTC runtimes (Vercel) — see comment in
  // that module for the previous drift bug.
  const todayDate = todayInRiyadh();
  const todayDow = dayOfWeekKsa(todayDate);

  // Service-role: the VP can see all teachers' absences, all supervision
  // posts, all dismissals — RLS would block some of these for a non-
  // super VP, so we bypass and rely on the gate above.
  const admin = createAdminSupabaseClient();

  // Parallel fetches. Each is independent — Promise.all keeps the
  // round-trip under ~150ms even on cold cache.
  const [
    absencesRes,
    leavesRes,
    dismissalsRes,
    supervisionRes,
    pendingIncidentsRes,
    openCasesRes,
  ] = await Promise.all([
    // 1. Today's teacher absences + their names for the ribbon.
    //    LEFT JOIN to user_profiles via a separate fetch since the FK
    //    on teacher_user_id points to auth.users (same constraint that
    //    bit us in م1.5).
    admin
      .from('daily_teacher_absences')
      .select('id, teacher_user_id, reason, expected_return')
      .eq('absence_date', todayDate)
      .order('reported_at', { ascending: false }),

    // 2. Pending leave requests (any date — VP needs to see backlog).
    admin
      .from('teacher_leaves')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // 3. Total student dismissals today. The student_dismissals table
    //    has no status column — each row is a recorded event at the
    //    gate by the deputy. So we just count today's events.
    admin
      .from('student_dismissals')
      .select('id', { count: 'exact', head: true })
      .eq('dismissal_date', todayDate),

    // 4. Active supervision locations (universe for the "empty posts"
    //    calculation). Ignoring inactive locations is critical — a
    //    deactivated location with a stale assignment shouldn't
    //    inflate "filled" or "empty" counts. Returns the id list so we
    //    can intersect with assignments below.
    admin
      .from('supervision_locations')
      .select('id')
      .eq('is_active', true),

    // 5. Pending student incidents (submitted or under_review) — the
    //    VP triage queue. School-wide count (service-role), consistent
    //    with the rest of this digest.
    admin
      .from('student_incidents')
      .select('id', { count: 'exact', head: true })
      .in('status', ['submitted', 'under_review']),

    // 6. Open counselor cases (open or in_progress) — active caseload.
    admin
      .from('student_cases')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress']),
  ]);

  // Surface ANY query error rather than silently degrading to 0s.
  // Codex Sprint 2 review: a forgotten error check on dismissals
  // (status filter on a non-existent column) returned 0 silently.
  // From now on, every query result is validated explicitly.
  if (
    absencesRes.error ||
    leavesRes.error ||
    dismissalsRes.error ||
    supervisionRes.error ||
    pendingIncidentsRes.error ||
    openCasesRes.error
  ) {
    const firstErr =
      absencesRes.error ??
      leavesRes.error ??
      dismissalsRes.error ??
      supervisionRes.error ??
      pendingIncidentsRes.error ??
      openCasesRes.error;
    return NextResponse.json(
      { error: 'فشل تحميل بيانات اللوحة: ' + firstErr!.message },
      { status: 500 },
    );
  }

  const absences = absencesRes.data ?? [];
  const absentTeacherIds = absences.map((a) => a.teacher_user_id);

  // Resolve absent teacher names via a separate query (FK to auth.users
  // prevents PostgREST embed; same pattern as counselor-assignments).
  // Codex Sprint 2 review (should-fix #2): explicit error check — a
  // silent failure here would null out the ribbon names without telling
  // the VP anything went wrong.
  const profileMap = new Map<string, string | null>();
  if (absentTeacherIds.length > 0) {
    const profilesRes = await admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', absentTeacherIds);
    if (profilesRes.error) {
      return NextResponse.json(
        { error: 'فشل جلب أسماء المعلمين الغائبين: ' + profilesRes.error.message },
        { status: 500 },
      );
    }
    for (const p of profilesRes.data ?? []) {
      profileMap.set(p.user_id, p.full_name);
    }
  }

  const absentList: AbsentTeacherSummary[] = absences.slice(0, 10).map((a) => ({
    user_id: a.teacher_user_id,
    full_name: profileMap.get(a.teacher_user_id) ?? null,
    reason: a.reason,
  }));

  // ---- Substitutions: needed vs assigned vs pending ----
  // "Needed" = sum of class periods (duty_type='class') across all absent
  // teachers' schedules on today's day_of_week.
  // "Assigned" = rows in substitution_assignments tied to today's absences.
  // "Pending" = needed - assigned.
  let totalNeeded = 0;
  let assigned = 0;
  if (absences.length > 0) {
    const [needsRes, assignedRes] = await Promise.all([
      admin
        .from('teacher_schedule')
        .select('id', { count: 'exact', head: true })
        .in('teacher_user_id', absentTeacherIds)
        .eq('day_of_week', todayDow)
        .eq('duty_type', 'class'),
      admin
        .from('substitution_assignments')
        .select('id', { count: 'exact', head: true })
        .in(
          'absence_id',
          absences.map((a) => a.id),
        )
        // Defensive day_of_week filter (Codex Sprint 2 review). The
        // absence_id IN clause should already constrain to today, but
        // pinning the day too keeps the count honest if a row's date
        // ever drifts.
        .eq('day_of_week', todayDow),
    ]);
    if (needsRes.error || assignedRes.error) {
      return NextResponse.json(
        {
          error:
            'فشل حساب حصص الانتظار: ' +
            (needsRes.error ?? assignedRes.error)!.message,
        },
        { status: 500 },
      );
    }
    totalNeeded = needsRes.count ?? 0;
    assigned = assignedRes.count ?? 0;
  }
  const pending = Math.max(0, totalNeeded - assigned);

  // ---- Supervision: filled vs empty (ACTIVE locations only) ----
  // Codex Sprint 2 review: filter both sides by is_active. A stale
  // assignment to a deactivated location shouldn't inflate either
  // count.
  const activeLocations = supervisionRes.data ?? [];
  const activeLocationIds = activeLocations.map((l) => l.id);
  let emptyPosts = activeLocationIds.length;
  if (activeLocationIds.length > 0) {
    const filledRes = await admin
      .from('supervision_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('day_of_week', todayDow)
      .in('location_id', activeLocationIds);
    if (filledRes.error) {
      return NextResponse.json(
        { error: 'فشل حساب نقاط الإشراف: ' + filledRes.error.message },
        { status: 500 },
      );
    }
    emptyPosts = Math.max(0, activeLocationIds.length - (filledRes.count ?? 0));
  }

  const data: MorningSummary = {
    date: todayDate,
    day_of_week: todayDow,
    teachers: {
      absent_today: absences.length,
      absent_list: absentList,
    },
    substitutions: {
      total_needed: totalNeeded,
      assigned,
      pending,
    },
    leaves: {
      pending_requests: leavesRes.count ?? 0,
    },
    dismissals: {
      today_total: dismissalsRes.count ?? 0,
    },
    supervision: {
      empty_posts_today: emptyPosts,
    },
    // Live counts now that the Sprint 3/4 tables exist (Wave A bridge).
    pending_incidents: pendingIncidentsRes.count ?? 0,
    open_cases: openCasesRes.count ?? 0,
  };

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
