// PATCH /api/counselor/cases/[id]/transition — case status state-machine (م4.22).
//
// Drives the open ↔ in_progress / → resolved / → closed / reopen
// workflow. The DB `case_history` trigger (migration 003 + 010) writes
// the audit row automatically, so this endpoint owns three concerns:
//
//   1. Authorization gate (requireCounselorWorkspace) + RLS-scoped read
//   2. State-machine validation (pure lib/cases/state-machine.ts)
//   3. Atomic, race-safe UPDATE with the transition's payload
//
// =====================================================================
// AUTH + RLS
// =====================================================================
// User-bound client only. The case is loaded via `.maybeSingle()` first;
// null = out-of-scope or missing → 404 generic (Sprint 1 rule). The
// UPDATE runs through the same client, so policy `student_cases_update`
// gates the write (super_admin OR counselor_can_see_student).
//
// =====================================================================
// RACE-SAFE UPDATE
// =====================================================================
// The UPDATE adds `.eq('status', currentStatus)` so a concurrent
// transition (e.g. two counselors clicking resolve at once) results
// in zero rows updated. We surface that as 409 with a refresh hint
// rather than racing the second writer's UPDATE on top of the first.
//
// =====================================================================
// REOPEN MECHANICS
// =====================================================================
// terminal → open is the only transition that bumps `reopen_count`
// and sets `is_reopened=true`. The increment is computed from the
// row we already loaded (currentReopenCount + 1) in the same UPDATE
// payload — atomic with the status change. NOT a trigger so the
// behavior is explicit and test-able.
//
// =====================================================================
// CONTENT POLICY
// =====================================================================
// The endpoint NEVER reads / writes counseling_sessions.content_encrypted.
// case_history.reason is sourced by the existing trigger (migration 010
// added the reopen_reason CASE arm), so this endpoint just sets the
// canonical column (resolution / close_reason / reopen_reason) and the
// trigger handles the audit.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';
import {
  CASE_STATUSES,
  isCaseTransitionAllowed,
  isReopen,
  validateCaseTransitionBody,
  type CaseStatus,
} from '@/lib/cases/state-machine';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const bodySchema = z.object({
  to_status: z.enum(CASE_STATUSES),
  // Optional reason fields; the state machine validates which one is
  // required per transition.
  resolution:    z.string().trim().max(2000).optional().nullable(),
  close_reason:  z.string().trim().max(2000).optional().nullable(),
  reopen_reason: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireCounselorWorkspace();
  if (!auth.ok) return auth.res;

  const paramsParsed = paramsSchema.safeParse({ id: params.id });
  if (!paramsParsed.success) {
    return NextResponse.json(
      { error: 'معرف الحالة غير صالح' },
      { status: 400 },
    );
  }
  const caseId = paramsParsed.data.id;

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(
      { error: 'الـ body ليس JSON صالحًا' },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  // ----- 1. Load current case (RLS-scoped) -----
  const caseRes = await supabase
    .from('student_cases')
    .select('id, status, reopen_count')
    .eq('id', caseId)
    .maybeSingle();
  if (caseRes.error) {
    return NextResponse.json(
      { error: 'فشل تحميل الحالة: ' + caseRes.error.message },
      { status: 500 },
    );
  }
  if (!caseRes.data) {
    return NextResponse.json(
      { error: 'الحالة غير موجودة أو خارج نطاقك' },
      { status: 404 },
    );
  }
  const currentStatus = caseRes.data.status as CaseStatus;
  const currentReopenCount = caseRes.data.reopen_count as number;
  const toStatus = body.to_status;

  // ----- 2. State-machine validation -----
  if (currentStatus === toStatus) {
    return NextResponse.json(
      { error: 'الحالة في الوضع المطلوب بالفعل' },
      { status: 422 },
    );
  }
  if (!isCaseTransitionAllowed(currentStatus, toStatus)) {
    return NextResponse.json(
      { error: 'الانتقال من «' + currentStatus + '» إلى «' + toStatus + '» غير مسموح' },
      { status: 422 },
    );
  }
  const reasonErr = validateCaseTransitionBody(currentStatus, toStatus, body);
  if (reasonErr) {
    return NextResponse.json(
      { error: reasonErr.message, field: reasonErr.field },
      { status: 422 },
    );
  }

  // ----- 3. Compose UPDATE payload -----
  // Always clear the OTHER reason columns so a leftover from a previous
  // lifecycle doesn't surface in case_history later. The DB CHECK
  // constraints on cases_resolved_needs_resolution / cases_closed_needs_close_reason
  // guard the resolved / closed side; reopen_reason is soft-CHECK'd.
  const updatePayload: Record<string, unknown> = { status: toStatus };

  if (toStatus === 'resolved') {
    updatePayload.resolution    = body.resolution!.trim();
    updatePayload.close_reason  = null;
    updatePayload.reopen_reason = null;
  } else if (toStatus === 'closed') {
    updatePayload.close_reason  = body.close_reason!.trim();
    updatePayload.resolution    = null;
    updatePayload.reopen_reason = null;
  } else if (isReopen(currentStatus, toStatus)) {
    // terminal → open: reopen bookkeeping.
    updatePayload.reopen_reason = body.reopen_reason!.trim();
    updatePayload.resolution    = null;
    updatePayload.close_reason  = null;
    updatePayload.is_reopened   = true;
    updatePayload.reopen_count  = currentReopenCount + 1;
  } else {
    // open ↔ in_progress (rollback or first promotion). Clear all
    // reason fields so the case is clean.
    updatePayload.resolution    = null;
    updatePayload.close_reason  = null;
    updatePayload.reopen_reason = null;
  }

  // ----- 4. Race-safe UPDATE -----
  // `.eq('status', currentStatus)` makes the UPDATE no-op if a
  // concurrent transition flipped the status between load and write.
  // `.maybeSingle()` returns null in that case → 409.
  const updateRes = await supabase
    .from('student_cases')
    .update(updatePayload)
    .eq('id', caseId)
    .eq('status', currentStatus)
    .select('id, status, reopen_count, is_reopened, updated_at')
    .maybeSingle();

  if (updateRes.error) {
    const isPriv = updateRes.error.code === '42501';
    return NextResponse.json(
      {
        error: isPriv
          ? 'لا تملك صلاحية تعديل الحالة'
          : 'فشل تنفيذ التحويل: ' + updateRes.error.message,
      },
      { status: isPriv ? 403 : 500 },
    );
  }
  if (!updateRes.data) {
    // Either RLS denied silently (unlikely — we already RLS-loaded the
    // row) OR the race-guard fired. Treat both as "stale state".
    return NextResponse.json(
      { error: 'تغيرت حالة هذه الحالة أثناء المعالجة. أعد تحميل الصفحة وحاول مرة أخرى.' },
      { status: 409 },
    );
  }

  // case_history is populated by the trigger; no manual audit write here.
  return NextResponse.json(
    { data: updateRes.data },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
