// POST /api/counselor/cases/[id]/plans — second counselor write path (م4.21.2).
//
// Adds a case-linked student_followup_plan. New plans always start at
// status='active' (the DB default) — the lifecycle transitions
// (on_hold / completed / cancelled) live in a separate state-machine
// endpoint that hasn't been drafted yet and is intentionally out of
// scope.
//
// =====================================================================
// AUTH + RLS LAYERS
// =====================================================================
// Gate: requireCounselorWorkspace (super_admin OR persona='counselor').
// RLS on the INSERT:
//   - "student_followup_plans_insert" policy:
//       created_by = auth.uid() AND
//       (is_super_admin() OR counselor_can_see_student(student_id))
// Same Sprint-1-style pre-check: user-bound case lookup returns null
// when the case is out of scope → we surface that as 404, not 403
// (don't distinguish "not found" from "not authorised" externally).
//
// =====================================================================
// student_id IS NEVER SENT BY THE CLIENT
// =====================================================================
// The case_id alone is enough. The migration's
// student_followup_plans_sync_student_id BEFORE INSERT trigger
// (م4.5) overwrites NEW.student_id with `case.student_id` regardless
// of what the caller passed. We deliberately OMIT student_id from the
// INSERT object so the trigger sees NULL and fills the canonical value
// — there's no "decoy student_id" code path on this surface.
//
// =====================================================================
// VALIDATION
// =====================================================================
// title:        10-200 chars (matches student_cases_title_check; same
//               minimum keeps the two surfaces' expectations aligned).
// description:  20-2000 chars (matches student_followup_plans schema
//               CHECK `length(description) >= 20`).
// target_date:  optional YYYY-MM-DD, no Riyadh-tz parsing required
//               (DATE column).
// milestones:   optional array of milestone objects, max 20 — shape
//               documented in the م4.5 migration header
//               (date / description / status / completed_at?).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const milestoneSchema = z.object({
  date: z.string().regex(dateRegex, 'صيغة التاريخ يجب أن تكون YYYY-MM-DD'),
  description: z.string().trim().min(1, 'وصف المعلم مطلوب').max(200),
  status: z.enum(['pending', 'completed', 'cancelled']).default('pending'),
  completed_at: z.string().datetime().optional(),
});

const bodySchema = z.object({
  title: z
    .string()
    .trim()
    .min(10, 'العنوان يجب أن يكون 10 أحرف على الأقل')
    .max(200, 'الحد الأقصى 200 حرف'),
  description: z
    .string()
    .trim()
    .min(20, 'الوصف يجب أن يكون 20 حرفًا على الأقل')
    .max(2000, 'الحد الأقصى 2000 حرف'),
  target_date: z
    .string()
    .regex(dateRegex, 'صيغة التاريخ يجب أن تكون YYYY-MM-DD')
    .optional()
    .nullable(),
  milestones: z.array(milestoneSchema).max(20, 'الحد الأقصى 20 معلَمًا').default([]),
});

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
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

  // ----- 1. Case visibility pre-check -----
  // We don't need the student_id (the trigger sources it); we only need
  // to confirm the case exists in the caller's scope. A NULL data row
  // means either the case doesn't exist or RLS hid it.
  const caseRes = await supabase
    .from('student_cases')
    .select('id')
    .eq('id', caseId)
    .maybeSingle();
  if (caseRes.error) {
    return NextResponse.json(
      { error: 'فشل التحقق من الحالة: ' + caseRes.error.message },
      { status: 500 },
    );
  }
  if (!caseRes.data) {
    return NextResponse.json(
      { error: 'الحالة غير موجودة أو خارج نطاقك' },
      { status: 404 },
    );
  }

  // ----- 2. INSERT (no student_id — sync trigger fills it) -----
  // Note: status is NOT sent either; the DB column defaults to 'active'
  // and lifecycle transitions go through a separate endpoint (not in
  // м4.21.2's scope). milestones default to [] when absent — schema
  // default also '[]'::jsonb, but Zod normalises so the JSON column
  // always sees an array even if the client sent nothing.
  const insertRes = await supabase
    .from('student_followup_plans')
    .insert({
      case_id: caseId,
      created_by: auth.ctx.userId,
      title: body.title,
      description: body.description,
      target_date: body.target_date ?? null,
      milestones: body.milestones,
    })
    .select('id, status, created_at')
    .single();

  if (insertRes.error) {
    const isRls = insertRes.error.code === '42501';
    return NextResponse.json(
      {
        error: isRls
          ? 'لا تملك صلاحية إضافة خطة لهذه الحالة'
          : 'فشل إضافة الخطة: ' + insertRes.error.message,
      },
      { status: isRls ? 403 : 500 },
    );
  }

  return NextResponse.json(
    { data: insertRes.data },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
