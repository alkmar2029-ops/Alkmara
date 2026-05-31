// POST /api/counselor/cases/[id]/notes — first counselor write path (م4.21.1).
//
// Adds a case-linked student_note recorded by the calling counselor.
// is_confidential defaults to TRUE because the counselor's primary
// use case is private case-related observations; non-confidential is an
// explicit opt-out (e.g. a milestone note the counselor wants visible
// to the rest of staff via the existing read policies).
//
// =====================================================================
// AUTH + RLS LAYERS
// =====================================================================
// Gate: requireCounselorWorkspace (super_admin OR persona='counselor').
// RLS on the INSERT runs THREE policies:
//   - PERMISSIVE  "student_notes ins counselor":
//       recorded_by = auth.uid() AND
//       (is_super_admin() OR counselor_can_see_student(student_id))
//   - PERMISSIVE  "student_notes ins staff" (excluded by counselor branch)
//   - RESTRICTIVE "student_notes confidential ins gate":
//       is_confidential = FALSE OR is_super_admin() OR
//       (current_user_is_counselor() AND counselor_can_see_student(...))
// All three combine: counselor-in-scope can write either flag value;
// non-counselor cannot flip is_confidential=TRUE.
//
// =====================================================================
// CASE VISIBILITY PRE-CHECK
// =====================================================================
// We do a user-bound `select id, student_id from student_cases where
// id = ?` first. Two reasons:
//   1. Gives us a clean 404 if the case is out of scope (or doesn't
//      exist). Insert-only would surface the RLS denial as a 403/500,
//      conflating "wrong case" with "wrong shape".
//   2. Sources the canonical student_id for the note so the caller
//      doesn't pass it (avoids a "decoy student_id" attack — sending
//      a different student_id than the case's actual one).
//
// =====================================================================
// CONSTANTS / SHAPE
// =====================================================================
// text:           1-2000 chars (length cap mirrors progress_notes
//                 to discourage long entries that look like session
//                 content — counselor session detail lives elsewhere).
// type:           CHECK in student_notes ('positive' | 'negative').
// source:         CHECK in student_notes ('template' | 'text' | 'voice').
// is_confidential: boolean, default TRUE.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const bodySchema = z.object({
  text: z.string().trim().min(1, 'نص الملاحظة مطلوب').max(2000, 'الحد الأقصى 2000 حرف'),
  type: z.enum(['positive', 'negative']),
  is_confidential: z.boolean().default(true),
  source: z.enum(['template', 'text', 'voice']).default('text'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
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

  // ----- 1. Verify case visibility + source canonical student_id -----
  const caseRes = await supabase
    .from('student_cases')
    .select('id, student_id')
    .eq('id', caseId)
    .maybeSingle();
  if (caseRes.error) {
    return NextResponse.json(
      { error: 'فشل التحقق من الحالة: ' + caseRes.error.message },
      { status: 500 },
    );
  }
  if (!caseRes.data) {
    // Same Sprint 1 rule as case detail: do not distinguish "not found"
    // from "not authorised" externally.
    return NextResponse.json(
      { error: 'الحالة غير موجودة أو خارج نطاقك' },
      { status: 404 },
    );
  }

  // ----- 2. Insert through the user-bound client -----
  // RLS layers (permissive "ins counselor" + restrictive conf gate)
  // gate the write. recorded_by MUST equal auth.uid() for the permissive
  // policy; the user-bound client carries the JWT so we pass auth.ctx.userId
  // explicitly to keep the API contract honest at the SQL layer.
  const insertRes = await supabase
    .from('student_notes')
    .insert({
      case_id: caseId,
      student_id: caseRes.data.student_id,
      recorded_by: auth.ctx.userId,
      text: body.text,
      type: body.type,
      source: body.source,
      is_confidential: body.is_confidential,
    })
    .select('id, recorded_at, is_confidential')
    .single();

  if (insertRes.error) {
    // Postgres errcode 42501 = insufficient_privilege (RLS denial).
    // Surface as 403 to make the contract clean for the UI.
    const isRls = insertRes.error.code === '42501';
    return NextResponse.json(
      {
        error: isRls
          ? 'لا تملك صلاحية إضافة ملاحظة لهذه الحالة'
          : 'فشل إضافة الملاحظة: ' + insertRes.error.message,
      },
      { status: isRls ? 403 : 500 },
    );
  }

  return NextResponse.json(
    { data: insertRes.data },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
