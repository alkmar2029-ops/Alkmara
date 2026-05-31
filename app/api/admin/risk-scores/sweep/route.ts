// POST /api/admin/risk-scores/sweep — risk-score compute sweep (м5.5).
//
// Operator/system endpoint. NOT a counselor user-flow:
//   - Compute touches derived signals that are themselves confidential
//     (counseling_sessions counts, conf notes counts). Even though the
//     ENDPOINT returns only a count summary, exposing "run compute"
//     to a counselor amounts to letting them trigger reads across
//     their entire scope on demand.
//   - The DB function (`compute_student_risk_score`) is already
//     REVOKE'd from authenticated; this endpoint enforces the same
//     boundary at the HTTP layer.
//
// =====================================================================
// AUTH
// =====================================================================
// requireSuperAdmin — strictly super_admin only. The DB-side
// re-check defends against a stale JWT carrying super_admin while
// the user_profiles row has been demoted.
//
// =====================================================================
// USAGE PATTERNS
// =====================================================================
// 1. Batch sweep (the canonical path; will be wired to cron in а later
//    sub-migration):
//      POST { limit?: 1-200 (default 50) }
//      → picks up to `limit` rows where is_stale=TRUE, oldest-touched
//        first (`ORDER BY updated_at ASC`), and recomputes each.
//
// 2. Force one student (operator escape hatch):
//      POST { student_id: number }
//      → recomputes that student even if is_stale=FALSE. Useful when
//        an operator needs to verify the math against a known case
//        without waiting for the next sweep.
//
// Both paths use the same RPC (`compute_student_risk_score`) via the
// service-role admin client. The RPC is the SINGLE writer of scores
// per м5.4.
//
// =====================================================================
// RESPONSE SHAPE
// =====================================================================
//   { data: { attempted, computed, skipped_missing, errors: [...] } }
//
//   attempted        — total students the sweep targeted
//   computed         — RPC returned a row (active or inactive student)
//   skipped_missing  — RPC returned 0 rows (student record gone;
//                       defensive no-op per m5.4 contract)
//   errors[]         — { student_id, message } — RPC raised an error.
//                       The endpoint does NOT abort on per-row errors;
//                       it collects them so the operator sees the
//                       full picture of one sweep.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/personas/auth-gate';
import { isWorkerRequest } from '@/lib/security/worker-secret';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  // Optional force-compute single student. When provided, `limit` is
  // ignored (only this one student is processed).
  student_id: z.number().int().positive().optional(),
});

interface SweepSummary {
  attempted: number;
  computed: number;
  skipped_missing: number;
  errors: Array<{ student_id: number; message: string }>;
}

export async function POST(request: NextRequest) {
  const workerRequest = isWorkerRequest(request);
  if (!workerRequest) {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.res;
  }

  // Body parse — empty body is valid (uses defaults).
  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    body = parsed.data;
    if (workerRequest && body.student_id !== undefined) {
      return NextResponse.json(
        { error: 'worker sweep cannot force a single student' },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'الـ body ليس JSON صالحًا' },
      { status: 400 },
    );
  }

  const admin = createAdminSupabaseClient();

  // ----- Resolve the candidate list -----
  let candidateIds: number[];
  if (body.student_id !== undefined) {
    candidateIds = [body.student_id];
  } else {
    const { data, error } = await admin
      .from('student_risk_scores')
      .select('student_id')
      .eq('is_stale', true)
      .order('updated_at', { ascending: true })
      .limit(body.limit);
    if (error) {
      return NextResponse.json(
        { error: 'فشل جلب الصفوف المؤجَّلة: ' + error.message },
        { status: 500 },
      );
    }
    candidateIds = (data ?? []).map((r) => (r as { student_id: number }).student_id);
  }

  // ----- Sweep -----
  // Sequential — each RPC is ~20-30ms; for 200 rows the worst case
  // is ~6s wall clock which is fine for an operator endpoint. If the
  // cron later hits scale problems, parallel batches go in a separate
  // change (and need throttling against pg connection limits).
  const summary: SweepSummary = {
    attempted: candidateIds.length,
    computed: 0,
    skipped_missing: 0,
    errors: [],
  };

  for (const sid of candidateIds) {
    const { data, error } = await admin.rpc('compute_student_risk_score', {
      p_student_id: sid,
    });

    if (error) {
      summary.errors.push({ student_id: sid, message: error.message });
      continue;
    }

    // RETURNS TABLE → supabase-js gives us an array. Empty = missing
    // student (the RPC's defensive no-op per m5.4). Anything else = ok.
    if (!data || (Array.isArray(data) && data.length === 0)) {
      summary.skipped_missing += 1;
      continue;
    }

    summary.computed += 1;
  }

  return NextResponse.json(
    { data: summary },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
