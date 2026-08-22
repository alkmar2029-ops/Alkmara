// PATCH /api/counselor/cases/[id]/plans/[planId]/transition — plan state-machine (م4.22 / plans).
//
// Mirrors the case-transition endpoint structurally but simpler:
//   - no `reason` field on any transition
//   - no `reopen_count` bookkeeping
//   - terminal lock: completed/cancelled have no exits via the API
//   - timestamps are the only side-effect we track:
//        → completed: completed_at = NOW(), cancelled_at = NULL
//        → cancelled: cancelled_at = NOW(), completed_at = NULL
//        → active / on_hold: BOTH cleared
//
// =====================================================================
// AUTH + RLS
// =====================================================================
// User-bound client only. Load `student_followup_plans` with both
// `.eq('id', planId)` AND `.eq('case_id', caseId)` so a malicious or
// stale request that uses a planId from a different case still returns
// null. The user-bound SELECT also enforces the
// `student_followup_plans_select` policy from м4.7 (super or
// counselor-in-scope).
//
// =====================================================================
// RACE-SAFE UPDATE
// =====================================================================
// `.eq('status', currentStatus)` ensures a concurrent transition wins
// nothing — `.maybeSingle()` returns null → 409 with refresh hint.
//
// =====================================================================
// TERMINAL LOCK
// =====================================================================
// completed / cancelled plans cannot transition through this endpoint
// at all. The state machine returns 422 BEFORE the UPDATE runs;
// manual SQL correction is the documented (rare) override path.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';
import {
  PLAN_STATUSES,
  isPlanTransitionAllowed,
  isTerminal,
  type PlanStatus,
} from '@/lib/plans/state-machine';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id:     z.coerce.number().int().positive(),
  planId: z.coerce.number().int().positive(),
});

const bodySchema = z.object({
  to_status: z.enum(PLAN_STATUSES),
});

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string; planId: string }> }
) {
  const params = await props.params;
  const auth = await requireCounselorWorkspace();
  if (!auth.ok) return auth.res;

  const paramsParsed = paramsSchema.safeParse({ id: params.id, planId: params.planId });
  if (!paramsParsed.success) {
    return NextResponse.json(
      { error: 'معرف غير صالح' },
      { status: 400 },
    );
  }
  const { id: caseId, planId } = paramsParsed.data;

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

  // ----- 1. Load plan, scoped to the case in the URL -----
  // Double-filter (id + case_id) defends against stale planIds that
  // belong to a different case — null result → 404 generic.
  const planRes = await supabase
    .from('student_followup_plans')
    .select('id, status, case_id')
    .eq('id', planId)
    .eq('case_id', caseId)
    .maybeSingle();
  if (planRes.error) {
    return NextResponse.json(
      { error: 'فشل تحميل الخطة: ' + planRes.error.message },
      { status: 500 },
    );
  }
  if (!planRes.data) {
    return NextResponse.json(
      { error: 'الخطة غير موجودة أو خارج نطاقك' },
      { status: 404 },
    );
  }
  const currentStatus = planRes.data.status as PlanStatus;
  const toStatus = body.to_status;

  // ----- 2. State-machine validation -----
  if (currentStatus === toStatus) {
    return NextResponse.json(
      { error: 'الخطة في الوضع المطلوب بالفعل' },
      { status: 422 },
    );
  }
  if (!isPlanTransitionAllowed(currentStatus, toStatus)) {
    // Distinguish terminal-source for a clearer error message — UX
    // benefit only; the surface is the same 422.
    const msg = isTerminal(currentStatus)
      ? 'لا يمكن التراجع عن المرحلة النهائية لهذه الخطة'
      : 'الانتقال من «' + currentStatus + '» إلى «' + toStatus + '» غير مسموح';
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  // ----- 3. Compose UPDATE payload -----
  // Timestamps mirror the DB CHECK `plans_terminal_timestamps_exclusive`
  // truth table (م4.5): the UPDATE always clears the OTHER timestamp,
  // even on non-terminal targets where both should be NULL.
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { status: toStatus };
  if (toStatus === 'completed') {
    updatePayload.completed_at = now;
    updatePayload.cancelled_at = null;
  } else if (toStatus === 'cancelled') {
    updatePayload.cancelled_at = now;
    updatePayload.completed_at = null;
  } else {
    // active / on_hold — neither timestamp should be set.
    updatePayload.completed_at = null;
    updatePayload.cancelled_at = null;
  }

  // ----- 4. Race-safe UPDATE -----
  const updateRes = await supabase
    .from('student_followup_plans')
    .update(updatePayload)
    .eq('id', planId)
    .eq('case_id', caseId)
    .eq('status', currentStatus)
    .select('id, status, completed_at, cancelled_at, updated_at')
    .maybeSingle();

  if (updateRes.error) {
    const isPriv = updateRes.error.code === '42501';
    return NextResponse.json(
      {
        error: isPriv
          ? 'لا تملك صلاحية تعديل الخطة'
          : 'فشل تنفيذ التحويل: ' + updateRes.error.message,
      },
      { status: isPriv ? 403 : 500 },
    );
  }
  if (!updateRes.data) {
    return NextResponse.json(
      { error: 'تغيرت حالة الخطة أثناء المعالجة. أعد تحميل الصفحة وحاول مرة أخرى.' },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { data: updateRes.data },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
