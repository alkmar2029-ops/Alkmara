// GET /api/incidents/mine — caller's own submitted incidents.
//
// م3.5 — the teacher's "my submissions" list. Open to teachers and
// any admin who has personally submitted (rare but legitimate — a
// counselor might submit on a teacher's behalf and want to track it).
//
// Filters:
//   status      — optional, one of INCIDENT_STATUSES
//   date_from   — optional YYYY-MM-DD, applied to incident_date >=
//   date_to     — optional YYYY-MM-DD, applied to incident_date <=
//
// Scope:
//   Explicit `submitted_by = auth.uid()` filter narrows the set to
//   what the caller owns. RLS would also let an admin / counselor /
//   reviewer see other rows in their scope — we don't want those
//   here. "Mine" means MINE.
//
// Auth client:
//   User-bound (createServerSupabaseClient) for the incidents SELECT
//   so any future RLS change still narrows by submitter. Admin
//   client only for the student-name + reviewer-name lookups (FK to
//   auth.users prevents PostgREST embedding; same pattern as
//   م1.5 counselor-assignments and م2.10 teacher-leaves).
//
// Response cap: 200 rows. If a teacher has > 200 incidents on
// record, paginate at the UI level — tech debt, same as the
// teacher-leaves "last 200" tab.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { requireRole } from '@/lib/supabase/auth';
import { ksaDateSchema } from '@/lib/dates/ksa';
import { INCIDENT_STATUSES } from '@/lib/incidents/types';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  date_from: ksaDateSchema.optional(),
  date_to: ksaDateSchema.optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireRole(['teacher', 'admin', 'super_admin']);
  if (!auth.ok) return auth.res;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
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

  // User-bound client: RLS would also surface scope-visible rows
  // (reviewer/counselor paths). The explicit submitted_by filter
  // narrows to "mine only" regardless of those paths.
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from('student_incidents')
    .select(
      'id, student_id, incident_date, incident_type, severity, description, status, submitted_at, reviewed_by, reviewed_at, review_notes, action_taken, parent_notified, parent_notified_at, case_id, escalated_to',
    )
    .eq('submitted_by', auth.ctx.userId)
    .order('submitted_at', { ascending: false })
    .limit(200);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.date_from) query = query.gte('incident_date', filters.date_from);
  if (filters.date_to) query = query.lte('incident_date', filters.date_to);

  const incidentsRes = await query;
  if (incidentsRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب المخالفات: ' + incidentsRes.error.message },
      { status: 500 },
    );
  }

  const incidents = (incidentsRes.data ?? []) as Array<{
    id: number;
    student_id: number;
    incident_date: string;
    incident_type: string;
    severity: string;
    description: string;
    status: string;
    submitted_at: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_notes: string | null;
    action_taken: string | null;
    parent_notified: boolean;
    parent_notified_at: string | null;
    case_id: number | null;
    escalated_to: string | null;
  }>;

  // Fast path: no rows means no joins needed.
  if (incidents.length === 0) {
    return NextResponse.json(
      { data: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Resolve names via admin client. Safe — the caller submitted
  // these incidents; surfacing student / reviewer names for THEIR
  // OWN submissions cannot leak more than they already know.
  const admin = createAdminSupabaseClient();
  const studentIds = Array.from(new Set(incidents.map((i) => i.student_id)));
  const userIds = Array.from(
    new Set(
      [
        ...incidents.map((i) => i.reviewed_by),
        ...incidents.map((i) => i.escalated_to),
      ].filter((x): x is string => !!x),
    ),
  );

  const [studentsRes, profilesRes] = await Promise.all([
    admin
      .from('students')
      .select('id, first_name, last_name')
      .in('id', studentIds),
    userIds.length > 0
      ? admin
          .from('user_profiles')
          .select('user_id, full_name')
          .in('user_id', userIds)
      : Promise.resolve({ data: [] as Array<{ user_id: string; full_name: string | null }>, error: null }),
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
    reviewed_by_name: i.reviewed_by ? profileMap.get(i.reviewed_by) ?? null : null,
    escalated_to_name: i.escalated_to ? profileMap.get(i.escalated_to) ?? null : null,
  }));

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
