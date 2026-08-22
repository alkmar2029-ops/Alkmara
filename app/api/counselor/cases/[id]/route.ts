// GET /api/counselor/cases/[id] — case detail feed for م4.20.
//
// Returns the case core + every artefact attached to it (case_history,
// student_followup_plans, student_notes with case_id, counseling_sessions
// with case_id) — minus the encrypted body of any session.
//
// =====================================================================
// AUTH
// =====================================================================
// requireCounselorWorkspace = super_admin OR persona='counselor'.
// view_confidential_notes oversight intentionally excluded (separate
// Sprint 5+ surface). Same rule as the case board / workspace summary.
//
// =====================================================================
// RLS-FIRST QUERY STRATEGY
// =====================================================================
// All FOUR table reads run against the user-bound supabase client. RLS
// is the only scope filter; if a counselor opens a case outside their
// counselor_assignments scope, the case fetch returns `null` and we
// short-circuit to 404 (we deliberately do NOT distinguish "not found"
// from "not authorised" — Sprint 1 standing rule).
//
// Service-role used ONLY for name resolution (student + actor user IDs)
// AFTER the parent case row is confirmed visible to the caller. Same
// pattern as /api/incidents/pending-review, /api/counselor/workspace-summary,
// /api/counselor/cases.
//
// =====================================================================
// CONTENT EXPOSURE
// =====================================================================
// counseling_sessions SELECT list intentionally OMITS content_encrypted.
// content_preview is included (plaintext-by-design, ≤160 chars,
// counselor-authored summary — same exposure rule as the workspace shell).
// The UI labels content_preview explicitly so it isn't read as decrypted
// content; the "view encrypted content" button is rendered DISABLED
// pending the key-management review.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';
import { logConfidentialRead } from '@/lib/audit/confidential-read';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

interface CaseCore {
  id: number;
  case_number: string;
  title: string;
  description: string;
  case_type: string;
  severity: string;
  status: string;
  resolution: string | null;
  close_reason: string | null;
  reopen_count: number;
  is_reopened: boolean;
  related_case_id: number | null;
  student_id: number;
  student_name: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface HistoryEntry {
  id: number;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

interface PlanEntry {
  id: number;
  title: string;
  description: string;
  status: string;
  milestones: unknown;
  progress_notes: string | null;
  target_date: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface NoteEntry {
  id: number;
  text: string;
  type: string;
  source: string;
  is_confidential: boolean;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
}

interface SessionEntry {
  id: number;
  session_date: string;
  session_type: string;
  topic: string;
  duration_minutes: number | null;
  content_preview: string | null;
  counselor_user_id: string;
  counselor_name: string | null;
  created_at: string;
  updated_at: string;
}

interface CaseDetailResponse {
  case: CaseCore;
  history: HistoryEntry[];
  plans: PlanEntry[];
  notes: NoteEntry[];
  sessions: SessionEntry[];
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireCounselorWorkspace();
  if (!auth.ok) return auth.res;

  const parsed = paramsSchema.safeParse({ id: params.id });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'معرف الحالة غير صالح' },
      { status: 400 },
    );
  }
  const caseId = parsed.data.id;

  const supabase = await createServerSupabaseClient();

  // ----- 1. Fetch the case core (RLS gate) -----
  // maybeSingle so "not visible" returns data:null (no PostgREST error).
  // We treat that case as 404. Sprint 1 rule: don't distinguish "not
  // found" from "not authorised" externally.
  // NOTE: SELECT list is a single string literal — Supabase's type inference
  // walks the literal at compile time and cannot follow string concatenation,
  // which would degrade `data` to `GenericStringError`.
  const caseRes = await supabase
    .from('student_cases')
    .select('id, case_number, title, description, case_type, severity, status, resolution, close_reason, reopen_count, is_reopened, related_case_id, student_id, created_by, created_at, updated_at')
    .eq('id', caseId)
    .maybeSingle();

  if (caseRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب الحالة: ' + caseRes.error.message },
      { status: 500 },
    );
  }
  if (!caseRes.data) {
    return NextResponse.json(
      { error: 'الحالة غير موجودة أو خارج نطاقك' },
      { status: 404 },
    );
  }
  const caseRow = caseRes.data;

  // ----- 2. Parallel fetch of attached artefacts -----
  // All RLS-scoped via their own policies. The case visibility check
  // above guarantees the caller has scope on the parent student, and
  // every attached table also gates on the same counselor_can_see_student
  // (case_history mirrors the case; plans/sessions denormalise student_id
  // synced by trigger; notes hit student_notes' read policy directly).
  const [histRes, plansRes, notesRes, sessionsRes] = await Promise.all([
    supabase
      .from('case_history')
      .select('id, from_status, to_status, reason, changed_by, changed_at')
      .eq('case_id', caseId)
      .order('changed_at', { ascending: false }),
    supabase
      .from('student_followup_plans')
      .select('id, title, description, status, milestones, progress_notes, target_date, completed_at, cancelled_at, created_by, created_at, updated_at')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false }),
    supabase
      .from('student_notes')
      .select('id, text, type, source, is_confidential, recorded_by, recorded_at')
      .eq('case_id', caseId)
      .order('recorded_at', { ascending: false }),
    // content_encrypted INTENTIONALLY omitted — see header.
    supabase
      .from('counseling_sessions')
      .select('id, session_date, session_type, topic, duration_minutes, content_preview, counselor_user_id, created_at, updated_at')
      .eq('case_id', caseId)
      .order('session_date', { ascending: false }),
  ]);

  const firstErr =
    histRes.error ?? plansRes.error ?? notesRes.error ?? sessionsRes.error;
  if (firstErr) {
    return NextResponse.json(
      { error: 'فشل جلب تفاصيل الحالة: ' + firstErr.message },
      { status: 500 },
    );
  }

  const history = (histRes.data ?? []) as Array<{
    id: number; from_status: string | null; to_status: string;
    reason: string | null; changed_by: string | null; changed_at: string;
  }>;
  const plans = (plansRes.data ?? []) as Array<{
    id: number; title: string; description: string; status: string;
    milestones: unknown; progress_notes: string | null; target_date: string | null;
    completed_at: string | null; cancelled_at: string | null;
    created_by: string; created_at: string; updated_at: string;
  }>;
  const notes = (notesRes.data ?? []) as Array<{
    id: number; text: string; type: string; source: string;
    is_confidential: boolean; recorded_by: string | null; recorded_at: string;
  }>;
  const sessions = (sessionsRes.data ?? []) as Array<{
    id: number; session_date: string; session_type: string; topic: string;
    duration_minutes: number | null; content_preview: string | null;
    counselor_user_id: string; created_at: string; updated_at: string;
  }>;

  // ----- 3. Resolve names via admin client -----
  // Student + actor UUIDs from all artefacts. RLS already gated each
  // parent row; surfacing the names is in-scope info.
  const userIds = new Set<string>();
  userIds.add(caseRow.created_by);
  for (const h of history) if (h.changed_by) userIds.add(h.changed_by);
  for (const p of plans) userIds.add(p.created_by);
  for (const n of notes) if (n.recorded_by) userIds.add(n.recorded_by);
  for (const s of sessions) userIds.add(s.counselor_user_id);

  const admin = createAdminSupabaseClient();
  const [studentNameRes, profilesRes] = await Promise.all([
    admin
      .from('students')
      .select('id, first_name, last_name')
      .eq('id', caseRow.student_id)
      .maybeSingle(),
    userIds.size > 0
      ? admin
          .from('user_profiles')
          .select('user_id, full_name')
          .in('user_id', Array.from(userIds))
      : Promise.resolve({ data: [] as Array<{ user_id: string; full_name: string | null }>, error: null }),
  ]);

  if (studentNameRes.error || profilesRes.error) {
    const e = studentNameRes.error ?? profilesRes.error;
    return NextResponse.json(
      { error: 'فشل جلب الأسماء: ' + e!.message },
      { status: 500 },
    );
  }

  const studentName = studentNameRes.data
    ? `${studentNameRes.data.first_name ?? ''} ${studentNameRes.data.last_name ?? ''}`.trim() || null
    : null;
  const nameMap = new Map<string, string | null>();
  for (const p of profilesRes.data ?? []) nameMap.set(p.user_id, p.full_name);

  const payload: CaseDetailResponse = {
    case: {
      ...caseRow,
      student_name: studentName,
      created_by_name: nameMap.get(caseRow.created_by) ?? null,
    },
    history: history.map((h) => ({
      ...h,
      changed_by_name: h.changed_by ? (nameMap.get(h.changed_by) ?? null) : null,
    })),
    plans: plans.map((p) => ({
      ...p,
      created_by_name: nameMap.get(p.created_by) ?? null,
    })),
    notes: notes.map((n) => ({
      ...n,
      recorded_by_name: n.recorded_by ? (nameMap.get(n.recorded_by) ?? null) : null,
    })),
    sessions: sessions.map((s) => ({
      ...s,
      counselor_name: nameMap.get(s.counselor_user_id) ?? null,
    })),
  };

  const logged = await logConfidentialRead({
    accessedBy: auth.ctx.userId,
    request,
    entries: [{
      tableName: 'student_case_detail',
      recordId: caseId,
      studentId: caseRow.student_id,
    }],
  });
  if (!logged.ok) return logged.res;

  return NextResponse.json(
    { data: payload },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
