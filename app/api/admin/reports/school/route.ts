// GET /api/admin/reports/school — м6.3 school aggregate report.
//
// =====================================================================
// SCOPE / GATE
// =====================================================================
// Gate: requireSchoolReports() — super_admin OR holders of the
// `view_school_reports` permission flag (added in
// 2026_07_05_001_school_reports_flag.sql). Anyone else gets 403 with
// the Arabic message documented in the helper.
//
// =====================================================================
// PRIVACY BOUNDARY (DB-anchored in 2026_07_05_001_school_reports_flag.sql)
// =====================================================================
// This endpoint enforces the boundary in CODE — the gate only checks
// the flag; the privacy contract is the handler's responsibility.
//
// THIS ENDPOINT MUST NEVER RETURN:
//   - student names, student IDs, or any per-student row
//   - case titles, descriptions, resolutions, close/reopen reasons
//   - session content, content_preview, topic
//   - plan titles, milestones, progress notes
//   - note text (recorded_by / counselor name)
//   - any top-N student list, any per-student detail
//   - average risk score (only buckets — they're the canonical view here)
//   - per-section breakdowns (only per-grade in v1, with k>=5)
//   - by_type / by_severity at GRADE level (only at school level)
//   - notes by_type (positive/negative) at any level
//   - currently_active case count (point-in-time correlation risk)
//   - any new metric not enumerated below — see "metric drift policy"
//
// METRIC DRIFT POLICY (committed): any new metric requires a fresh
// privacy review with the owner, recorded in the conversation history
// of the change, BEFORE landing. Not even "obviously aggregate"
// additions get a free pass — the user explicitly chose this.
//
// =====================================================================
// SERVICE-ROLE RATIONALE
// =====================================================================
// Counselor surfaces (м6.1/м6.2) use a user-bound client so RLS narrows
// to the counselor's counselor_assignments scope automatically. Here
// the scope is fixed ("the school") — RLS adds nothing, and dragging
// it in would create false hopes that the DB is the boundary. The
// boundary IS the flag check + the k-anonymity computation in this
// file. Service-role lets us aggregate without RLS noise, and there
// is no row-level output that could leak (we never return student_id
// or names anywhere).
//
// =====================================================================
// DATE RANGE SEMANTICS (mirrors м6.1)
// =====================================================================
// from_ts = `${from}T00:00:00+03:00`  (Riyadh-anchored ISO)
// to_ts   = `${to}T23:59:59.999+03:00`
// DATE-only columns (session_date) compare against YYYY-MM-DD strings.
// Default range: last 30 days rolling. Max range: 365 days. Future `to`
// is silently capped to today (Riyadh). `from > to` → 400.
//
// =====================================================================
// K-ANONYMITY (n>=5 per grade)
// =====================================================================
// Threshold lives here as a constant + echoed in scope.k_threshold so
// the UI can label suppressed rows accurately. If a grade has fewer
// than K_THRESHOLD active students, the row is returned with ALL
// metric fields = null and `suppressed: true`. The row's identifying
// fields (grade_id, grade_name, student_count) remain — the UI shows
// "—" for the data. School-wide totals are NOT subject to k (n >> 5
// at school level by definition).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireSchoolReports } from '@/lib/personas/auth-gate';
import { todayInRiyadh, addDaysKsa, ksaDateSchema } from '@/lib/dates/ksa';
import { logConfidentialRead } from '@/lib/audit/confidential-read';

export const dynamic = 'force-dynamic';

// --- Constants ---------------------------------------------------------
const K_THRESHOLD       = 5;
const MAX_RANGE_DAYS    = 365;
const DEFAULT_RANGE_DAYS = 30;

const querySchema = z.object({
  from: ksaDateSchema.optional(),
  to:   ksaDateSchema.optional(),
});

// --- Types -------------------------------------------------------------

type Mode = 'principal' | 'super_admin';

interface CaseRow      { student_id: number; case_type: string; severity: string; created_at: string; }
interface HistoryRow   { case_id: number; from_status: string | null; to_status: string; }
interface PlanRow      { student_id: number; created_at: string; completed_at: string | null; cancelled_at: string | null; target_date: string | null; status: string; }
interface SessionRow   { student_id: number; session_type: string; duration_minutes: number | null; }
interface NoteRow      { student_id: number; is_confidential: boolean; }
interface RiskRow      { student_id: number; total_score: number; is_stale: boolean; }

interface GradeAgg {
  grade_id:      number;
  grade_name:    string;
  student_count: number;
  suppressed:    boolean;
  cases:         { opened_in_range: number; resolved_in_range: number; closed_in_range: number; reopened_in_range: number } | null;
  plans:         { created_in_range: number; completed_in_range: number; cancelled_in_range: number; currently_overdue: number } | null;
  sessions:      { held_in_range: number; total_duration_minutes: number } | null;
  notes:         { recorded_in_range: number; confidential: number; non_confidential: number } | null;
  risk_buckets:  Record<string, number> | null;
}

// --- Helpers -----------------------------------------------------------

// Bucket boundaries: [0-29], [30-49], [50-69], [70+].
// Names match the user spec verbatim — UI labels them as is.
function bucketLabel(score: number): '0-29' | '30-49' | '50-69' | '70+' {
  if (score >= 70) return '70+';
  if (score >= 50) return '50-69';
  if (score >= 30) return '30-49';
  return '0-29';
}

function emptyBuckets(): Record<string, number> {
  return { '0-29': 0, '30-49': 0, '50-69': 0, '70+': 0 };
}

// =====================================================================
// Handler
// =====================================================================

export async function GET(request: NextRequest) {
  // ----- Gate -----
  const auth = await requireSchoolReports();
  if (!auth.ok) return auth.res;

  // ----- Parse + validate dates (same rules as м6.1) -----
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

  if (to > today) to = today;

  if (from > to) {
    return NextResponse.json(
      { error: 'from يجب أن يكون قبل أو يساوي to' },
      { status: 400 },
    );
  }

  const fromMid = new Date(`${from}T12:00:00+03:00`).getTime();
  const toMid   = new Date(`${to}T12:00:00+03:00`).getTime();
  const days = Math.round((toMid - fromMid) / (1000 * 60 * 60 * 24));
  if (days > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `المدى الزمني يتجاوز ${MAX_RANGE_DAYS} يومًا` },
      { status: 400 },
    );
  }

  const fromTs = `${from}T00:00:00+03:00`;
  const toTs   = `${to}T23:59:59.999+03:00`;

  // ----- Service-role client (flag check IS the security boundary) -----
  const admin = createAdminSupabaseClient();

  // ----- Step 1: load independent thin projections concurrently -----
  // Active = `is_active` IS NOT FALSE (treats NULL as active, matches
  // the м5.3 backfill semantics).
  // Case mapping and report events do not depend on the grade maps. Starting
  // everything together removes two network round trips from this endpoint.
  const [
    studentsRes, sectionsRes, gradesRes, caseMapRes,
    casesRes, historyRes, plansRes, sessionsRes, notesRes, risksRes,
  ] = await Promise.all([
    admin.from('students').select('id, section_id').neq('is_active', false),
    admin.from('sections').select('id, grade_id'),
    admin.from('grades').select('id, name'),
    // ALL cases are required because range events can belong to older cases.
    admin.from('student_cases').select('id, student_id'),
    admin
      .from('student_cases')
      .select('student_id, case_type, severity, created_at')
      .gte('created_at', fromTs).lte('created_at', toTs),
    admin
      .from('case_history')
      .select('case_id, from_status, to_status')
      .gte('changed_at', fromTs).lte('changed_at', toTs),
    admin
      .from('student_followup_plans')
      .select('student_id, created_at, completed_at, cancelled_at, target_date, status'),
    admin
      .from('counseling_sessions')
      .select('student_id, session_type, duration_minutes')
      .gte('session_date', from).lte('session_date', to),
    admin
      .from('student_notes')
      .select('student_id, is_confidential')
      .gte('recorded_at', fromTs).lte('recorded_at', toTs),
    admin
      .from('student_risk_scores')
      .select('student_id, total_score, is_stale'),
  ]);

  const firstErr =
    studentsRes.error ?? sectionsRes.error ?? gradesRes.error ?? caseMapRes.error ??
    casesRes.error ?? historyRes.error ?? plansRes.error ??
    sessionsRes.error ?? notesRes.error ?? risksRes.error;
  if (firstErr) {
    return NextResponse.json(
      { error: 'فشل تحميل التقرير: ' + firstErr.message },
      { status: 500 },
    );
  }

  const sectionToGrade = new Map<number, number>();
  for (const s of (sectionsRes.data ?? []) as Array<{ id: number; grade_id: number | null }>) {
    if (s.grade_id !== null) sectionToGrade.set(s.id, s.grade_id);
  }
  const gradeNames = new Map<number, string>();
  for (const g of (gradesRes.data ?? []) as Array<{ id: number; name: string }>) {
    gradeNames.set(g.id, g.name);
  }

  // student_id → grade_id (null for students without section/grade).
  // We keep these students in the school totals but exclude them from
  // by_grade aggregates (they don't belong to any specific row).
  const studentToGrade = new Map<number, number>();
  const studentsByGrade = new Map<number, Set<number>>();
  let totalActiveStudents = 0;
  for (const s of (studentsRes.data ?? []) as Array<{ id: number; section_id: number | null }>) {
    totalActiveStudents += 1;
    const gradeId = s.section_id !== null ? sectionToGrade.get(s.section_id) : undefined;
    if (gradeId !== undefined && gradeNames.has(gradeId)) {
      studentToGrade.set(s.id, gradeId);
      if (!studentsByGrade.has(gradeId)) studentsByGrade.set(gradeId, new Set());
      studentsByGrade.get(gradeId)!.add(s.id);
    }
  }

  // ----- Step 2: case_id → student_id map (ALL cases, not range-
  // filtered — needed for case_history and sessions which reference
  // case_id but events may belong to cases created outside the range)
  const caseToStudent = new Map<number, number>();
  for (const c of (caseMapRes.data ?? []) as Array<{ id: number; student_id: number }>) {
    caseToStudent.set(c.id, c.student_id);
  }

  // ----- Step 3: aggregate the already-loaded event projections -----
  const cases    = (casesRes.data    ?? []) as CaseRow[];
  const history  = (historyRes.data  ?? []) as HistoryRow[];
  const plans    = (plansRes.data    ?? []) as PlanRow[];
  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  const notes    = (notesRes.data    ?? []) as NoteRow[];
  const risks    = (risksRes.data    ?? []) as RiskRow[];

  // ----- Step 4: school-wide totals (never suppressed) -----
  // by_type / by_severity / by_type-sessions live HERE only, not in
  // by_grade rows.

  const schoolCases = {
    opened_in_range:   0,
    resolved_in_range: 0,
    closed_in_range:   0,
    reopened_in_range: 0,
    by_type:           {} as Record<string, number>,
    by_severity:       {} as Record<string, number>,
  };
  for (const c of cases) {
    schoolCases.opened_in_range += 1;
    schoolCases.by_type[c.case_type] = (schoolCases.by_type[c.case_type] ?? 0) + 1;
    schoolCases.by_severity[c.severity] = (schoolCases.by_severity[c.severity] ?? 0) + 1;
  }
  for (const h of history) {
    if      (h.to_status === 'resolved') schoolCases.resolved_in_range += 1;
    else if (h.to_status === 'closed')   schoolCases.closed_in_range   += 1;
    else if (h.to_status === 'open' && (h.from_status === 'resolved' || h.from_status === 'closed')) {
      schoolCases.reopened_in_range += 1;
    }
  }

  const schoolPlans = {
    created_in_range:   0,
    completed_in_range: 0,
    cancelled_in_range: 0,
    currently_overdue:  0,
  };
  for (const p of plans) {
    if (p.created_at   >= fromTs && p.created_at   <= toTs) schoolPlans.created_in_range   += 1;
    if (p.completed_at && p.completed_at >= fromTs && p.completed_at <= toTs) schoolPlans.completed_in_range += 1;
    if (p.cancelled_at && p.cancelled_at >= fromTs && p.cancelled_at <= toTs) schoolPlans.cancelled_in_range += 1;
    if (p.status === 'active' && p.target_date && p.target_date < today)     schoolPlans.currently_overdue  += 1;
  }

  const schoolSessions = {
    held_in_range:           sessions.length,
    total_duration_minutes:  0,
    by_type:                 {} as Record<string, number>,
  };
  for (const s of sessions) {
    if (s.duration_minutes != null) schoolSessions.total_duration_minutes += s.duration_minutes;
    schoolSessions.by_type[s.session_type] = (schoolSessions.by_type[s.session_type] ?? 0) + 1;
  }

  const schoolNotes = {
    recorded_in_range: notes.length,
    confidential:      0,
    non_confidential:  0,
  };
  for (const n of notes) {
    if (n.is_confidential) schoolNotes.confidential += 1;
    else                   schoolNotes.non_confidential += 1;
  }

  const schoolRisk = {
    students_scored: risks.length,
    stale_count:     0,
    buckets:         emptyBuckets(),
  };
  for (const r of risks) {
    if (r.is_stale) schoolRisk.stale_count += 1;
    schoolRisk.buckets[bucketLabel(r.total_score)] += 1;
  }

  // ----- Step 5: per-grade with k-anonymity -----
  // Pre-build per-grade event indexes so we don't re-filter the full
  // event arrays for every grade.

  type GradeEventBuckets = {
    cases_opened: number;
    cases_resolved: number;
    cases_closed: number;
    cases_reopened: number;
    plans_created: number;
    plans_completed: number;
    plans_cancelled: number;
    plans_overdue: number;
    sessions_held: number;
    sessions_total_minutes: number;
    notes_total: number;
    notes_confidential: number;
    notes_non_confidential: number;
    risk_buckets: Record<string, number>;
  };
  const perGrade = new Map<number, GradeEventBuckets>();
  function gradeBuckets(gradeId: number): GradeEventBuckets {
    let g = perGrade.get(gradeId);
    if (!g) {
      g = {
        cases_opened: 0, cases_resolved: 0, cases_closed: 0, cases_reopened: 0,
        plans_created: 0, plans_completed: 0, plans_cancelled: 0, plans_overdue: 0,
        sessions_held: 0, sessions_total_minutes: 0,
        notes_total: 0, notes_confidential: 0, notes_non_confidential: 0,
        risk_buckets: emptyBuckets(),
      };
      perGrade.set(gradeId, g);
    }
    return g;
  }

  for (const c of cases) {
    const g = studentToGrade.get(c.student_id);
    if (g !== undefined) gradeBuckets(g).cases_opened += 1;
  }
  for (const h of history) {
    const studentId = caseToStudent.get(h.case_id);
    if (studentId === undefined) continue;
    const g = studentToGrade.get(studentId);
    if (g === undefined) continue;
    const b = gradeBuckets(g);
    if      (h.to_status === 'resolved') b.cases_resolved += 1;
    else if (h.to_status === 'closed')   b.cases_closed   += 1;
    else if (h.to_status === 'open' && (h.from_status === 'resolved' || h.from_status === 'closed')) {
      b.cases_reopened += 1;
    }
  }
  for (const p of plans) {
    const g = studentToGrade.get(p.student_id);
    if (g === undefined) continue;
    const b = gradeBuckets(g);
    if (p.created_at   >= fromTs && p.created_at   <= toTs) b.plans_created   += 1;
    if (p.completed_at && p.completed_at >= fromTs && p.completed_at <= toTs) b.plans_completed += 1;
    if (p.cancelled_at && p.cancelled_at >= fromTs && p.cancelled_at <= toTs) b.plans_cancelled += 1;
    if (p.status === 'active' && p.target_date && p.target_date < today)     b.plans_overdue   += 1;
  }
  for (const s of sessions) {
    const g = studentToGrade.get(s.student_id);
    if (g === undefined) continue;
    const b = gradeBuckets(g);
    b.sessions_held += 1;
    if (s.duration_minutes != null) b.sessions_total_minutes += s.duration_minutes;
  }
  for (const n of notes) {
    const g = studentToGrade.get(n.student_id);
    if (g === undefined) continue;
    const b = gradeBuckets(g);
    b.notes_total += 1;
    if (n.is_confidential) b.notes_confidential += 1;
    else                   b.notes_non_confidential += 1;
  }
  for (const r of risks) {
    const g = studentToGrade.get(r.student_id);
    if (g === undefined) continue;
    gradeBuckets(g).risk_buckets[bucketLabel(r.total_score)] += 1;
  }

  // ----- Step 6: emit by_grade rows with k-check -----
  // Sort by grade_id ASC for deterministic ordering.
  const sortedGradeIds = Array.from(studentsByGrade.keys()).sort((a, b) => a - b);
  let suppressedGradeCount = 0;
  const byGrade: GradeAgg[] = sortedGradeIds.map((gid) => {
    const studentCount = studentsByGrade.get(gid)!.size;
    const gradeName    = gradeNames.get(gid) ?? '—';
    if (studentCount < K_THRESHOLD) {
      suppressedGradeCount += 1;
      return {
        grade_id:      gid,
        grade_name:    gradeName,
        student_count: studentCount,
        suppressed:    true,
        cases:         null,
        plans:         null,
        sessions:      null,
        notes:         null,
        risk_buckets:  null,
      };
    }
    const b = perGrade.get(gid) ?? {
      cases_opened: 0, cases_resolved: 0, cases_closed: 0, cases_reopened: 0,
      plans_created: 0, plans_completed: 0, plans_cancelled: 0, plans_overdue: 0,
      sessions_held: 0, sessions_total_minutes: 0,
      notes_total: 0, notes_confidential: 0, notes_non_confidential: 0,
      risk_buckets: emptyBuckets(),
    };
    return {
      grade_id:      gid,
      grade_name:    gradeName,
      student_count: studentCount,
      suppressed:    false,
      cases: {
        opened_in_range:   b.cases_opened,
        resolved_in_range: b.cases_resolved,
        closed_in_range:   b.cases_closed,
        reopened_in_range: b.cases_reopened,
      },
      plans: {
        created_in_range:   b.plans_created,
        completed_in_range: b.plans_completed,
        cancelled_in_range: b.plans_cancelled,
        currently_overdue:  b.plans_overdue,
      },
      sessions: {
        held_in_range:          b.sessions_held,
        total_duration_minutes: b.sessions_total_minutes,
      },
      notes: {
        recorded_in_range: b.notes_total,
        confidential:      b.notes_confidential,
        non_confidential:  b.notes_non_confidential,
      },
      risk_buckets: b.risk_buckets,
    };
  });

  // ----- Step 7: response -----
  const mode: Mode = auth.ctx.role === 'super_admin' ? 'super_admin' : 'principal';

  const logged = await logConfidentialRead({
    accessedBy: auth.ctx.userId,
    request,
    entries: [{
      tableName: 'school_aggregate_report',
      recordId: `${from}:${to}`,
      studentId: null,
    }],
  });
  if (!logged.ok) return logged.res;

  return NextResponse.json(
    {
      data: {
        range: { from, to },
        scope: {
          mode,
          k_threshold:           K_THRESHOLD,
          total_students:        totalActiveStudents,
          suppressed_grade_count: suppressedGradeCount,
        },
        cases:    schoolCases,
        plans:    schoolPlans,
        sessions: schoolSessions,
        notes:    schoolNotes,
        risk_landscape: schoolRisk,
        by_grade: byGrade,
      },
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
