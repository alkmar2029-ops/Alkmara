// GET /api/counselor/workspace-summary — feeds the counselor home shell.
//
// م4.18 — first surface built on top of the م4.7 RLS policies. Returns the
// counts + recent lists the workspace dashboard renders.
//
// =====================================================================
// AUTH MODEL
// =====================================================================
// Gate: requireCounselorWorkspace = super_admin OR persona='counselor'.
// view_confidential_notes flag holders are intentionally EXCLUDED — their
// oversight surface lives in a separate Sprint 5+ screen so the two
// operational contexts don't mix.
//
// =====================================================================
// QUERY STRATEGY — RLS first, NOT service-role
// =====================================================================
// All aggregate / recent-list queries run against `createServerSupabaseClient()`
// (the cookie-bound, RLS-respecting client). That's deliberate: this is the
// first real production read built on the new م4.7 policies, and using the
// user client treats RLS as the single source of truth for scope rather
// than re-implementing `counselor_can_see_student` in TypeScript.
//
//   - Super admin     → RLS returns every row (matches the SELECT policy's
//                       is_super_admin() branch).
//   - Counselor       → RLS scopes by counselor_can_see_student (section/grade
//                       assignment) on cases / plans / sessions / notes.
//
// Service-role (createAdminSupabaseClient) is used ONLY for the trailing
// name lookup on students. The RLS-filtered parent rows already established
// that the caller can see those students; surfacing their names is
// in-scope information. Same pattern as /api/incidents/pending-review.
//
// =====================================================================
// CONTENT EXPOSURE
// =====================================================================
// counseling_sessions.content_encrypted is NEVER returned — the SELECT
// statement explicitly omits the column. content_preview IS returned
// because it's plaintext-by-design (counselor-authored ≤160-char summary,
// м4.4 schema). The UI labels it so users don't mistake it for decrypted
// content.
//
// =====================================================================
// CACHE
// =====================================================================
// no-store. Counselor data is sensitive and freshness matters more than
// any HTTP cache win.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';
import { todayInRiyadh, addDaysKsa } from '@/lib/dates/ksa';
import { logConfidentialRead } from '@/lib/audit/confidential-read';

export const dynamic = 'force-dynamic';

interface RecentCase {
  id: number;
  case_number: string;
  title: string;
  severity: string;
  status: string;
  student_id: number;
  student_name: string | null;
  updated_at: string;
}

interface RecentSession {
  id: number;
  session_date: string;
  session_type: string;
  topic: string;
  duration_minutes: number | null;
  // Counselor-authored plaintext summary, NOT decrypted content. The UI
  // labels this column explicitly so it isn't read as session content.
  content_preview: string | null;
  student_id: number;
  student_name: string | null;
}

interface WorkspaceSummary {
  user: { name: string };
  scope: {
    mode: 'counselor' | 'super_admin';
    sections_count: number;
    grades_count: number;
  };
  counts: {
    active_cases: number;
    total_cases: number;
    active_plans: number;
    sessions_last_7d: number;
    confidential_notes_last_7d: number;
  };
  recent_cases: RecentCase[];
  recent_sessions: RecentSession[];
}

export async function GET(request: NextRequest) {
  const auth = await requireCounselorWorkspace();
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const isSuperAdmin = auth.ctx.role === 'super_admin';

  // 7-day window for the "recent" metrics. Riyadh-anchored — uses the
  // same lib/dates/ksa helpers as the VP morning dashboard so the
  // calendar boundary is consistent across runtimes.
  const today = todayInRiyadh();
  const sevenDaysAgo = addDaysKsa(today, -7);

  // ----- Caller display name + scope summary -----
  // Run in parallel — both touch user_profiles / counselor_assignments
  // independently, neither blocks the heavier aggregate queries below.
  const [profileRes, assignRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', auth.ctx.userId)
      .maybeSingle(),
    // counselor_assignments RLS already restricts the caller to their
    // own rows (counselor_assignments_read: self OR super OR manage_users).
    // For super_admin we get ALL rows back; we just skip the count by
    // setting it to 0 below since "your sections" doesn't apply.
    supabase
      .from('counselor_assignments')
      .select('section_id, grade_id')
      .eq('counselor_user_id', auth.ctx.userId),
  ]);

  // Explicit error surface — Codex Sprint 2 lesson. A silent fallback to
  // an empty name + scope=0 would mask a real DB/RLS failure and make
  // the workspace look "almost loaded" instead of clearly broken.
  if (profileRes.error || assignRes.error) {
    const err = profileRes.error ?? assignRes.error;
    return NextResponse.json(
      { error: 'فشل تحميل نطاق المرشد: ' + err!.message },
      { status: 500 },
    );
  }

  const displayName = profileRes.data?.full_name ?? '';
  const myAssignments = assignRes.data ?? [];
  const sectionsCount = isSuperAdmin
    ? 0
    : myAssignments.filter((a) => a.section_id !== null).length;
  const gradesCount = isSuperAdmin
    ? 0
    : myAssignments.filter((a) => a.grade_id !== null).length;

  // ----- Aggregated counts (5 parallel queries) -----
  // count:'exact' + head:true → DB-side count, no payload, single round
  // trip per query. RLS filters the underlying set; the count reflects
  // what the caller could SELECT.
  const [
    activeCasesRes,
    totalCasesRes,
    activePlansRes,
    sessions7dRes,
    confNotes7dRes,
  ] = await Promise.all([
    supabase
      .from('student_cases')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress']),
    supabase
      .from('student_cases')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('student_followup_plans')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('counseling_sessions')
      .select('id', { count: 'exact', head: true })
      .gte('session_date', sevenDaysAgo),
    // recorded_at is TIMESTAMPTZ; compare against sevenDaysAgo start-of-
    // day. Tightening to "since 00:00 KSA of that day" by using the
    // Riyadh offset directly — the resulting instant is the same in
    // every runtime.
    supabase
      .from('student_notes')
      .select('id', { count: 'exact', head: true })
      .eq('is_confidential', true)
      .gte('recorded_at', `${sevenDaysAgo}T00:00:00+03:00`),
  ]);

  // Surface ANY error rather than degrading silently to 0 (Codex Sprint 2
  // lesson — a forgotten error check returned 0 from a real failure).
  const aggErr =
    activeCasesRes.error ??
    totalCasesRes.error ??
    activePlansRes.error ??
    sessions7dRes.error ??
    confNotes7dRes.error;
  if (aggErr) {
    return NextResponse.json(
      { error: 'فشل تحميل ملخص اللوحة: ' + aggErr.message },
      { status: 500 },
    );
  }

  // ----- Top-5 lists (recent cases + recent sessions) -----
  // counseling_sessions select list intentionally OMITS content_encrypted.
  // Even if RLS lets the user read the column, surfacing the raw BYTEA
  // serves no purpose in a list view and would inflate the payload.
  // Decryption goes through a separate, audit-logged endpoint (deferred
  // pending key-management review).
  const [recentCasesRes, recentSessionsRes] = await Promise.all([
    supabase
      .from('student_cases')
      .select(
        'id, case_number, title, severity, status, student_id, updated_at',
      )
      .in('status', ['open', 'in_progress'])
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase
      .from('counseling_sessions')
      .select(
        'id, session_date, session_type, topic, duration_minutes, content_preview, student_id',
      )
      .order('session_date', { ascending: false })
      .limit(5),
  ]);

  if (recentCasesRes.error || recentSessionsRes.error) {
    const err = recentCasesRes.error ?? recentSessionsRes.error;
    return NextResponse.json(
      { error: 'فشل جلب القوائم الأخيرة: ' + err!.message },
      { status: 500 },
    );
  }

  const recentCases = (recentCasesRes.data ?? []) as Array<{
    id: number;
    case_number: string;
    title: string;
    severity: string;
    status: string;
    student_id: number;
    updated_at: string;
  }>;
  const recentSessions = (recentSessionsRes.data ?? []) as Array<{
    id: number;
    session_date: string;
    session_type: string;
    topic: string;
    duration_minutes: number | null;
    content_preview: string | null;
    student_id: number;
  }>;

  // ----- Resolve student names via admin client -----
  // RLS already gated the parent rows; surfacing the names of those
  // students is in-scope information. Same pattern as the incidents
  // pending-review route. PostgREST can't embed students through the
  // FK to a non-public schema name → separate fetch.
  const studentIds = Array.from(
    new Set([
      ...recentCases.map((c) => c.student_id),
      ...recentSessions.map((s) => s.student_id),
    ]),
  );

  const studentMap = new Map<number, string | null>();
  if (studentIds.length > 0) {
    const admin = createAdminSupabaseClient();
    const studentsRes = await admin
      .from('students')
      .select('id, first_name, last_name')
      .in('id', studentIds);
    if (studentsRes.error) {
      return NextResponse.json(
        { error: 'فشل جلب أسماء الطلاب: ' + studentsRes.error.message },
        { status: 500 },
      );
    }
    for (const s of studentsRes.data ?? []) {
      const name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim();
      studentMap.set(s.id, name || null);
    }
  }

  const payload: WorkspaceSummary = {
    user: { name: displayName },
    scope: {
      mode: isSuperAdmin ? 'super_admin' : 'counselor',
      sections_count: sectionsCount,
      grades_count: gradesCount,
    },
    counts: {
      active_cases: activeCasesRes.count ?? 0,
      total_cases: totalCasesRes.count ?? 0,
      active_plans: activePlansRes.count ?? 0,
      sessions_last_7d: sessions7dRes.count ?? 0,
      confidential_notes_last_7d: confNotes7dRes.count ?? 0,
    },
    recent_cases: recentCases.map((c) => ({
      ...c,
      student_name: studentMap.get(c.student_id) ?? null,
    })),
    recent_sessions: recentSessions.map((s) => ({
      ...s,
      student_name: studentMap.get(s.student_id) ?? null,
    })),
  };

  const logged = await logConfidentialRead({
    accessedBy: auth.ctx.userId,
    request,
    entries: [{
      tableName: 'counselor_workspace_summary',
      recordId: `workspace:${auth.ctx.userId}`,
      studentId: null,
    }],
  });
  if (!logged.ok) return logged.res;

  return NextResponse.json(
    { data: payload },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
