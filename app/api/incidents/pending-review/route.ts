// GET /api/incidents/pending-review — the reviewer's queue.
//
// م3.6 — returns incidents with status IN ('submitted','under_review')
// that the caller has scope to act on, sorted by severity priority
// then submission age (oldest critical first).
//
// Gate: requireIncidentsQueue (super_admin OR review_teacher_incidents
// flag OR persona='counselor'). The flag/counselor path read here;
// action endpoints (м3.7-м3.9) further restrict writes to the flag.
//
// Key design notes (per Codex Sprint 3 review):
//
//   1. EXPLICIT status filter — the RLS SELECT policy on
//      student_incidents legitimately surfaces a user's OWN
//      submissions regardless of status. The queue UI must show
//      only pending work, so we filter status server-side. Trusting
//      RLS alone would show "actioned" / "dismissed" rows the
//      reviewer already closed.
//
//   2. EXCLUDE caller's own submissions — same RLS path lets a
//      reviewer see their own incidents; for the queue UI, this is
//      a conflict-of-interest. A reviewer should not see their own
//      incidents in their decision queue.
//
//   3. SCOPE via RLS — beyond the two filters above we trust RLS:
//        - super_admin sees all
//        - flag holder sees within vp_grade_scope (reviewer_can_see_student)
//        - counselor sees within counselor_assignments
//      The DB does the filtering; the API doesn't manually
//      replicate scope checks.
//
//   4. Severity ordering happens in JS — VARCHAR severity strings
//      sort alphabetically (critical < high < low < medium), which
//      is wrong. We fetch ordered by submitted_at ASC then re-sort
//      by [severityPriority DESC, submitted_at ASC] in JS. The
//      200-row cap keeps the sort O(n log n) on a small N.
//
// Cap: 200 rows. A pending queue this large signals operational
// failure (reviewers are too slow) and is the right place for a
// dashboard alarm rather than pagination at this stage.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { requireIncidentsQueue } from '@/lib/personas/auth-gate';
import { ksaDateSchema } from '@/lib/dates/ksa';
import {
  INCIDENT_SEVERITIES,
  type IncidentSeverity,
} from '@/lib/incidents/types';

export const dynamic = 'force-dynamic';

// Higher = more urgent. Reviewer should see critical at the top.
const SEVERITY_PRIORITY: Record<IncidentSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const querySchema = z.object({
  // Optional severity floor — e.g. "high" hides medium + low.
  // Useful for an "urgent only" toggle in the UI.
  min_severity: z.enum(INCIDENT_SEVERITIES).optional(),
  date_from: ksaDateSchema.optional(),
  date_to: ksaDateSchema.optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireIncidentsQueue();
  if (!auth.ok) return auth.res;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    min_severity: url.searchParams.get('min_severity') ?? undefined,
    date_from: url.searchParams.get('date_from') ?? undefined,
    date_to: url.searchParams.get('date_to') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات الفلتر غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const filters = parsed.data;

  // User-bound: RLS scopes (vp_grade_scope / counselor_assignments).
  // Manual filters layer on top: status + exclude-self.
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from('student_incidents')
    .select(
      'id, student_id, incident_date, incident_type, severity, description, status, submitted_by, submitted_at, reviewed_at, review_notes',
    )
    .in('status', ['submitted', 'under_review'])
    .neq('submitted_by', auth.ctx.userId)
    .order('submitted_at', { ascending: true })
    .limit(200);

  if (filters.date_from) query = query.gte('incident_date', filters.date_from);
  if (filters.date_to) query = query.lte('incident_date', filters.date_to);

  const incidentsRes = await query;
  if (incidentsRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب قائمة المراجعة: ' + incidentsRes.error.message },
      { status: 500 },
    );
  }

  let incidents = (incidentsRes.data ?? []) as Array<{
    id: number;
    student_id: number;
    incident_date: string;
    incident_type: string;
    severity: string;
    description: string;
    status: string;
    submitted_by: string;
    submitted_at: string;
    reviewed_at: string | null;
    review_notes: string | null;
  }>;

  // Optional severity floor — applied AFTER the DB fetch so the
  // 200-row cap counts pre-filter rows. (If we applied DB-side and
  // the cap removed critical items below the cutoff, the picture
  // would be misleading.) Caller already sees all severities by
  // default; this is a UI toggle convenience.
  if (filters.min_severity) {
    const floor = SEVERITY_PRIORITY[filters.min_severity];
    incidents = incidents.filter(
      (i) => (SEVERITY_PRIORITY[i.severity as IncidentSeverity] ?? 0) >= floor,
    );
  }

  // Re-sort: critical first, then by oldest-submitted within each
  // severity bucket. JS sort because PostgREST can't order a
  // VARCHAR column by custom priority.
  incidents.sort((a, b) => {
    const sa = SEVERITY_PRIORITY[a.severity as IncidentSeverity] ?? 0;
    const sb = SEVERITY_PRIORITY[b.severity as IncidentSeverity] ?? 0;
    if (sa !== sb) return sb - sa; // higher priority first
    return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
  });

  // Fast path: nothing to enrich.
  if (incidents.length === 0) {
    return NextResponse.json(
      { data: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Resolve student + submitter names via admin client. The reviewer
  // already has scope to see these rows via RLS — surfacing the
  // names is in-scope information.
  const admin = createAdminSupabaseClient();
  const studentIds = Array.from(new Set(incidents.map((i) => i.student_id)));
  const userIds = Array.from(new Set(incidents.map((i) => i.submitted_by)));

  const [studentsRes, profilesRes] = await Promise.all([
    admin
      .from('students')
      .select('id, first_name, last_name')
      .in('id', studentIds),
    admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', userIds),
  ]);

  if (studentsRes.error || profilesRes.error) {
    const err = studentsRes.error ?? profilesRes.error;
    return NextResponse.json(
      { error: 'فشل جلب الأسماء: ' + err!.message },
      { status: 500 },
    );
  }

  const studentMap = new Map<number, string | null>();
  for (const s of studentsRes.data ?? []) {
    const name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim();
    studentMap.set(s.id, name || null);
  }
  const profileMap = new Map<string, string | null>();
  for (const p of profilesRes.data ?? []) {
    profileMap.set(p.user_id, p.full_name);
  }

  const data = incidents.map((i) => ({
    ...i,
    student_name: studentMap.get(i.student_id) ?? null,
    submitted_by_name: profileMap.get(i.submitted_by) ?? null,
  }));

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
