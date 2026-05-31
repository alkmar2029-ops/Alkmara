// GET /api/counselor/reports/operational — m6.1 counselor operational report.
//
// Live aggregates over the counselor's RLS-visible scope across a date
// range. No content fields — counts + categorical breakdowns only.
//
// =====================================================================
// SCOPE RULES (per the Sprint 6 plan)
// =====================================================================
//   - counselor in scope (counselor_assignments)   → only their students
//   - super_admin                                  → all students
//   - view_confidential_notes flag holder          → 0 results
//                                                    (same privacy
//                                                    decision as the
//                                                    risk score: derived
//                                                    aggregates are
//                                                    not surfaced to
//                                                    oversight without
//                                                    a separate review)
//
// =====================================================================
// HARD RULE: USER-BOUND CLIENT ONLY (м6.1)
// =====================================================================
// No service-role calls anywhere — even for name lookups in top_5.
// Rationale: if the counselor's assignment somehow drifts between
// risk-score visibility and students visibility, we'd rather show
// `student_name: null` than leak a name RLS would otherwise hide.
// The risk-score policy + students RLS share the same helper, so in
// the common case the lookup will return the name; the null fallback
// is purely defensive.
//
// =====================================================================
// DATE RANGE SEMANTICS
// =====================================================================
// All TIMESTAMPTZ comparisons use Riyadh-anchored boundaries:
//   from_ts = `${from}T00:00:00+03:00`
//   to_ts   = `${to}T23:59:59.999+03:00`
// DATE columns (session_date) compare against the YYYY-MM-DD strings
// directly. Default range is the rolling last 30 days; max range is
// 365 days. `to` is silently capped to today (Riyadh); old `from`
// values are allowed.
//
// =====================================================================
// AGGREGATION STRATEGY
// =====================================================================
// JS grouping over thin-projection SELECTs, NOT SQL GROUP BY. Reasons:
//   - PostgREST doesn't expose GROUP BY without an RPC
//   - Counselor scope is ~50-300 cases; in-memory grouping is trivial
//   - Keeps every query a single SELECT with RLS auto-applied
//
// =====================================================================
// CONTENT GUARANTEE
// =====================================================================
// Every SELECT explicitly lists only count-able fields. NO request
// touches:
//   - student_notes.text
//   - counseling_sessions.content_encrypted / content_preview / topic
//   - student_cases.title / description / resolution / close_reason / reopen_reason
//   - student_followup_plans.title / description / milestones / progress_notes
//   - student_incidents.* (intentionally NOT in this report — see plan)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';
import { todayInRiyadh, addDaysKsa, ksaDateSchema } from '@/lib/dates/ksa';
import { logConfidentialRead } from '@/lib/audit/confidential-read';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: ksaDateSchema.optional(),
  to:   ksaDateSchema.optional(),
});

const MAX_RANGE_DAYS = 365;
const DEFAULT_RANGE_DAYS = 30;
const TOP_N = 5;
const AVERAGE_MIN_SCORED = 20;

interface CasesRow {
  case_type: string;
  severity:  string;
  status:    string;
  created_at: string;
}
interface CaseHistoryRow {
  from_status: string | null;
  to_status:   string;
}
interface PlanRow {
  status:        string;
  created_at:    string;
  completed_at:  string | null;
  cancelled_at:  string | null;
  target_date:   string | null;
}
interface SessionRow {
  session_type:      string;
  duration_minutes:  number | null;
}
interface NoteRow {
  type:             string;
  is_confidential:  boolean;
}
interface RiskRow {
  student_id:  number;
  total_score: number;
  is_stale:    boolean;
}

export async function GET(request: NextRequest) {
  const auth = await requireCounselorWorkspace();
  if (!auth.ok) return auth.res;

  // ----- Parse + validate dates -----
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to:   url.searchParams.get('to')   ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'تاريخ غير صالح (يجب YYYY-MM-DD)', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const today = todayInRiyadh();
  const defaultFrom = addDaysKsa(today, -DEFAULT_RANGE_DAYS);
  let from = parsed.data.from ?? defaultFrom;
  let to   = parsed.data.to   ?? today;

  // Silent cap on future `to`.
  if (to > today) to = today;

  if (from > to) {
    return NextResponse.json(
      { error: 'from يجب أن يكون قبل أو يساوي to' },
      { status: 400 },
    );
  }

  // Range guard — Math.floor on (to - from) days. We use UTC arithmetic
  // pinned to NOON +03 to dodge DST/runtime-tz drift, same approach as
  // lib/dates/ksa internals.
  const fromMid = new Date(`${from}T12:00:00+03:00`).getTime();
  const toMid   = new Date(`${to}T12:00:00+03:00`).getTime();
  const days = Math.round((toMid - fromMid) / (1000 * 60 * 60 * 24));
  if (days > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `المدى الزمني يتجاوز ${MAX_RANGE_DAYS} يومًا` },
      { status: 400 },
    );
  }

  // ISO boundaries for TIMESTAMPTZ comparisons.
  const fromTs = `${from}T00:00:00+03:00`;
  const toTs   = `${to}T23:59:59.999+03:00`;

  // ----- All queries user-bound; RLS does the scoping -----
  const supabase = await createServerSupabaseClient();

  const [
    casesRes,
    historyRes,
    plansRes,
    sessionsRes,
    notesRes,
    risksRes,
  ] = await Promise.all([
    // Cases — pull case_type/severity/status/created_at; group in JS.
    supabase
      .from('student_cases')
      .select('case_type, severity, status, created_at'),
    // Case history events in range (RLS mirrors parent case).
    supabase
      .from('case_history')
      .select('from_status, to_status')
      .gte('changed_at', fromTs)
      .lte('changed_at', toTs),
    // Plans — pull lifecycle dates; group in JS.
    supabase
      .from('student_followup_plans')
      .select('status, created_at, completed_at, cancelled_at, target_date'),
    // Sessions IN RANGE only (we don't need history of all sessions).
    supabase
      .from('counseling_sessions')
      .select('session_type, duration_minutes')
      .gte('session_date', from)
      .lte('session_date', to),
    // Notes — recorded BY THIS counselor in range. The operational
    // report is about "my work"; co-workers' notes on the same students
    // are visible via RLS but don't belong in this counselor's tally.
    // Super_admin sees their own (typically zero); m6.3 will surface
    // school-wide note totals.
    supabase
      .from('student_notes')
      .select('type, is_confidential')
      .eq('recorded_by', auth.ctx.userId)
      .gte('recorded_at', fromTs)
      .lte('recorded_at', toTs),
    // Risk scores — full snapshot (no date filter; "currently scored").
    supabase
      .from('student_risk_scores')
      .select('student_id, total_score, is_stale'),
  ]);

  // Single error gate (Codex Sprint 2 lesson — surface real failures
  // rather than degrading to zeros).
  const firstErr =
    casesRes.error ??
    historyRes.error ??
    plansRes.error ??
    sessionsRes.error ??
    notesRes.error ??
    risksRes.error;
  if (firstErr) {
    return NextResponse.json(
      { error: 'فشل تحميل التقرير: ' + firstErr.message },
      { status: 500 },
    );
  }

  // ----- Group + aggregate in JS -----
  const cases     = (casesRes.data ?? []) as CasesRow[];
  const history   = (historyRes.data ?? []) as CaseHistoryRow[];
  const plans     = (plansRes.data ?? []) as PlanRow[];
  const sessions  = (sessionsRes.data ?? []) as SessionRow[];
  const notes     = (notesRes.data ?? []) as NoteRow[];
  const risks     = (risksRes.data ?? []) as RiskRow[];

  // Cases
  const casesByType: Record<string, number> = {};
  const casesBySeverity: Record<string, number> = {};
  let casesOpenedInRange = 0;
  let casesCurrentlyActive = 0;
  for (const c of cases) {
    casesByType[c.case_type] = (casesByType[c.case_type] ?? 0) + 1;
    casesBySeverity[c.severity] = (casesBySeverity[c.severity] ?? 0) + 1;
    if (c.created_at >= fromTs && c.created_at <= toTs) casesOpenedInRange += 1;
    if (c.status === 'open' || c.status === 'in_progress') casesCurrentlyActive += 1;
  }

  // Case history events in range
  let casesResolvedInRange = 0;
  let casesClosedInRange   = 0;
  let casesReopenedInRange = 0;
  for (const h of history) {
    if (h.to_status === 'resolved') casesResolvedInRange += 1;
    else if (h.to_status === 'closed') casesClosedInRange += 1;
    else if (h.to_status === 'open' && (h.from_status === 'resolved' || h.from_status === 'closed')) {
      casesReopenedInRange += 1;
    }
  }

  // Plans
  let plansCreatedInRange = 0;
  let plansCompletedInRange = 0;
  let plansCancelledInRange = 0;
  let plansCurrentlyActive = 0;
  let plansCurrentlyOnHold = 0;
  let plansCurrentlyOverdue = 0;
  for (const p of plans) {
    if (p.created_at >= fromTs && p.created_at <= toTs) plansCreatedInRange += 1;
    if (p.completed_at && p.completed_at >= fromTs && p.completed_at <= toTs) plansCompletedInRange += 1;
    if (p.cancelled_at && p.cancelled_at >= fromTs && p.cancelled_at <= toTs) plansCancelledInRange += 1;
    if (p.status === 'active') plansCurrentlyActive += 1;
    if (p.status === 'on_hold') plansCurrentlyOnHold += 1;
    if (p.status === 'active' && p.target_date && p.target_date < today) plansCurrentlyOverdue += 1;
  }

  // Sessions
  const sessionsByType: Record<string, number> = {};
  let sessionsTotalMinutes = 0;
  for (const s of sessions) {
    sessionsByType[s.session_type] = (sessionsByType[s.session_type] ?? 0) + 1;
    if (s.duration_minutes != null) sessionsTotalMinutes += s.duration_minutes;
  }

  // Notes
  let notesConfidential = 0;
  let notesNonConfidential = 0;
  let notesByPositive = 0;
  let notesByNegative = 0;
  for (const n of notes) {
    if (n.is_confidential) notesConfidential += 1; else notesNonConfidential += 1;
    if (n.type === 'positive') notesByPositive += 1;
    else if (n.type === 'negative') notesByNegative += 1;
  }

  // Risk landscape
  const studentsScored = risks.length;
  const staleCount     = risks.filter((r) => r.is_stale).length;
  const sumScore       = risks.reduce((acc, r) => acc + r.total_score, 0);
  const averageScore   = studentsScored >= AVERAGE_MIN_SCORED
    ? Math.round(sumScore / studentsScored)
    : null;
  const above50        = risks.filter((r) => r.total_score >= 50).length;
  const above70        = risks.filter((r) => r.total_score >= 70).length;

  // Top-N highest scores. Sort + slice + enrich with names (user-bound).
  const topRows = [...risks]
    .sort((a, b) => (b.total_score - a.total_score) || (a.student_id - b.student_id))
    .slice(0, TOP_N);

  // User-bound name lookup. If RLS hides any (defensive — should match
  // risk-score policy), student_name falls back to null.
  let nameMap = new Map<number, string | null>();
  if (topRows.length > 0) {
    const ids = topRows.map((r) => r.student_id);
    const namesRes = await supabase
      .from('students')
      .select('id, first_name, last_name')
      .in('id', ids);
    if (namesRes.error) {
      // Soft-fail: keep the report; names go null with a server-side log.
      console.error('[reports/operational] student names lookup failed:', namesRes.error.message);
    } else {
      for (const s of (namesRes.data ?? []) as Array<{ id: number; first_name: string | null; last_name: string | null }>) {
        const name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim();
        nameMap.set(s.id, name || null);
      }
    }
  }

  const top5 = topRows.map((r) => ({
    student_id:   r.student_id,
    student_name: nameMap.get(r.student_id) ?? null,
    score:        r.total_score,
    is_stale:     r.is_stale,
  }));

  const logged = await logConfidentialRead({
    accessedBy: auth.ctx.userId,
    request,
    entries: [{
      tableName: 'counselor_operational_report',
      recordId: `${from}:${to}`,
      studentId: null,
    }],
  });
  if (!logged.ok) return logged.res;

  // ----- Response -----
  return NextResponse.json(
    {
      data: {
        range: { from, to },
        scope: {
          mode: auth.ctx.role === 'super_admin' ? 'super_admin' : 'counselor',
          students_in_scope: studentsScored,
        },
        cases: {
          opened_in_range:    casesOpenedInRange,
          resolved_in_range:  casesResolvedInRange,
          closed_in_range:    casesClosedInRange,
          reopened_in_range:  casesReopenedInRange,
          currently_active:   casesCurrentlyActive,
          by_type:            casesByType,
          by_severity:        casesBySeverity,
        },
        plans: {
          created_in_range:   plansCreatedInRange,
          completed_in_range: plansCompletedInRange,
          cancelled_in_range: plansCancelledInRange,
          currently_active:   plansCurrentlyActive,
          currently_on_hold:  plansCurrentlyOnHold,
          currently_overdue:  plansCurrentlyOverdue,
        },
        sessions: {
          held_in_range:           sessions.length,
          total_duration_minutes:  sessionsTotalMinutes,
          by_type:                 sessionsByType,
        },
        notes: {
          recorded_in_range: notes.length,
          confidential:      notesConfidential,
          non_confidential:  notesNonConfidential,
          by_type: { positive: notesByPositive, negative: notesByNegative },
        },
        risk_landscape: {
          students_scored: studentsScored,
          stale_count:     staleCount,
          average_score:   averageScore,
          above_50:        above50,
          above_70:        above70,
          top_5:           top5,
        },
      },
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
