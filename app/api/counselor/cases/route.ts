// GET /api/counselor/cases — flat list feeding the case-board Kanban (م4.19).
//
// =====================================================================
// AUTH MODEL — same as the workspace summary
// =====================================================================
// Gate: requireCounselorWorkspace = super_admin OR persona='counselor'.
// view_confidential_notes flag holders intentionally EXCLUDED (oversight
// surface, separate Sprint 5+ screen).
//
// =====================================================================
// QUERY STRATEGY — RLS first (per user's standing rule)
// =====================================================================
// User-bound supabase client → RLS scopes:
//   - super_admin     → every row
//   - counselor       → counselor_can_see_student(student_id) match
//
// Service-role used ONLY for student-name resolution, same pattern as
// /api/counselor/workspace-summary and /api/incidents/pending-review.
//
// =====================================================================
// FILTERS
// =====================================================================
// Optional exact-severity filter via ?severity=<low|medium|high|critical>
// (single-pick). NOT a "floor" — `severity=medium` returns medium ONLY,
// not "medium and higher". The UI dropdown carries the same semantics;
// a floor would require a SEVERITY_PRIORITY ordering (see
// /api/incidents/pending-review for that pattern) which is intentionally
// out of scope here ("لا overbuild" — exact match is enough for the
// م4.19 Kanban). Status / search / sort happen client-side, keeping the
// API stateless and the network payload small enough for one fetch.
//
// =====================================================================
// CAP
// =====================================================================
// 500 rows. Beyond that the counselor has a real backlog problem; the
// UI surfaces a banner ("تجاوزت ٥٠٠ حالة — قائمتك مقتطعة") so the
// counselor knows to filter. Pagination is deliberately not introduced
// at this stage — a Kanban with 500+ cards is already past the
// useful-density threshold.
//
// =====================================================================
// CONTENT
// =====================================================================
// Returns case metadata only. counseling_sessions / encrypted content
// are never touched.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';
import { logConfidentialRead } from '@/lib/audit/confidential-read';

export const dynamic = 'force-dynamic';

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const querySchema = z.object({
  severity: z.enum(SEVERITIES).optional(),
});

const CASES_CAP = 500;

interface CaseRow {
  id: number;
  case_number: string;
  title: string;
  severity: string;
  case_type: string;
  status: string;
  student_id: number;
  student_name: string | null;
  updated_at: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireCounselorWorkspace();
  if (!auth.ok) return auth.res;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    severity: url.searchParams.get('severity') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'فلتر غير صالح', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const filters = parsed.data;

  const supabase = await createServerSupabaseClient();

  // We pull CAP+1 so we can flag truncation reliably (instead of guessing
  // when count === CAP — that ambiguity bites with exact-count edge cases).
  let query = supabase
    .from('student_cases')
    .select(
      'id, case_number, title, severity, case_type, status, student_id, updated_at, created_at',
    )
    .order('updated_at', { ascending: false })
    .limit(CASES_CAP + 1);

  if (filters.severity) {
    query = query.eq('severity', filters.severity);
  }

  const casesRes = await query;
  if (casesRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب الحالات: ' + casesRes.error.message },
      { status: 500 },
    );
  }

  const rawCases = (casesRes.data ?? []) as Array<{
    id: number;
    case_number: string;
    title: string;
    severity: string;
    case_type: string;
    status: string;
    student_id: number;
    updated_at: string;
    created_at: string;
  }>;
  const cap_reached = rawCases.length > CASES_CAP;
  const cases = cap_reached ? rawCases.slice(0, CASES_CAP) : rawCases;

  // Fast path — no enrichment needed.
  if (cases.length === 0) {
    const logged = await logConfidentialRead({
      accessedBy: auth.ctx.userId,
      request,
      entries: [{
        tableName: 'student_cases',
        recordId: 'list',
        studentId: null,
      }],
    });
    if (!logged.ok) return logged.res;

    return NextResponse.json(
      { data: { cases: [], cap_reached: false } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Resolve student names — RLS already authorised these students for the
  // caller; the names are in-scope info. Same pattern as workspace-summary.
  const studentIds = Array.from(new Set(cases.map((c) => c.student_id)));
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
  const studentMap = new Map<number, string | null>();
  for (const s of studentsRes.data ?? []) {
    const name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim();
    studentMap.set(s.id, name || null);
  }

  const data: CaseRow[] = cases.map((c) => ({
    ...c,
    student_name: studentMap.get(c.student_id) ?? null,
  }));

  const logged = await logConfidentialRead({
    accessedBy: auth.ctx.userId,
    request,
    entries: [{
      tableName: 'student_cases',
      recordId: 'list',
      studentId: null,
    }],
  });
  if (!logged.ok) return logged.res;

  return NextResponse.json(
    { data: { cases: data, cap_reached } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
