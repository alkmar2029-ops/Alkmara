// POST /api/counselor/cases/[id]/sessions — first content_encrypted write (م4.21.3).
//
// Calls the create_counseling_session RPC (migration 009) inside Postgres,
// which encrypts the body with pgp_sym_encrypt and writes the
// confidential_access_log audit row in one atomic transaction.
//
// =====================================================================
// AUTH MODEL — TWO LAYERS
// =====================================================================
// 1. API gate: requireCounselorWorkspace (super_admin OR persona='counselor').
//    Resolves the validated caller's UUID we pass to the RPC.
// 2. DB-side scope check INSIDE the RPC: re-validates the caller's
//    p_actor_user_id has counselor_assignments scope on the case's
//    student. Defense in depth: even if a future API regression
//    weakens the gate, the function refuses with 42501.
//
// The RPC is GRANT-EXECUTE'd to service_role ONLY (not to authenticated)
// because it accepts p_key as a parameter. If `authenticated` could
// execute it, any in-scope counselor could submit their own arbitrary
// key from the browser and produce undecryptable rows. We avoid that by
// going through the service-role admin client here.
//
// =====================================================================
// KEY HANDLING
// =====================================================================
// COUNSELING_SESSION_KEY env (≥32 chars). Read once per request, passed
// as RPC parameter via TLS connection. Missing/short → 503 with a
// generic Arabic message; the value itself is NEVER logged or echoed,
// only the absence/under-length condition.
//
// Rotation: not supported hot. Any rotation requires a migration that
// decrypts every row with the old key and re-encrypts with the new
// one, alongside an atomic env swap. See migration 009 header.
//
// =====================================================================
// AUDIT TRAIL
// =====================================================================
// Every successful call writes a confidential_access_log row inside
// the RPC. The ip_address / user_agent here are best-effort sourced
// from request headers; NULL when not available (no failure path).
//
// =====================================================================
// CONTENT EXPOSURE
// =====================================================================
// Response contains ONLY the new row's id. We never echo back:
//   - content (the plaintext we just encrypted)
//   - content_preview (already plaintext-by-design in the DB, but
//     echoing it back encourages the client to log it)
//   - content_encrypted (the bytea is useless to the client and
//     surfacing it would bloat the response without benefit)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const SESSION_TYPES = [
  'individual',
  'group',
  'family',
  'parent',
  'assessment',
  'follow_up',
  'emergency',
] as const;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.object({
  session_date: z.string().regex(dateRegex, 'صيغة التاريخ يجب أن تكون YYYY-MM-DD'),
  session_type: z.enum(SESSION_TYPES),
  topic: z.string().trim().min(1, 'الموضوع مطلوب').max(200, 'الحد الأقصى 200 حرف'),
  // Plaintext session body. Larger cap than notes/plans because this
  // IS the surface where verbatim session content lives. The encrypted
  // form is opaque to size limits beyond pg's TOAST handling.
  content: z
    .string()
    .trim()
    .min(1, 'محتوى الجلسة مطلوب')
    .max(20000, 'الحد الأقصى 20000 حرف'),
  // Optional plaintext summary — counselor-authored, deliberately short
  // and warned in the UI.
  content_preview: z
    .string()
    .trim()
    .max(160, 'الحد الأقصى 160 حرفًا')
    .optional()
    .nullable(),
  duration_minutes: z
    .number()
    .int()
    .min(1, 'المدة يجب أن تكون بين 1 و 240 دقيقة')
    .max(240, 'المدة يجب أن تكون بين 1 و 240 دقيقة')
    .optional()
    .nullable(),
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

  // ----- Encryption key check (fail-closed, no fallback) -----
  // Server-side log distinguishes missing-vs-short — neither leaks the
  // value itself. We never default a key, never skip encryption.
  const key = (process.env.COUNSELING_SESSION_KEY || '').trim();
  if (!key) {
    console.error('[counseling-session] COUNSELING_SESSION_KEY missing — refusing write');
    return NextResponse.json(
      { error: 'خدمة التشفير غير مهيأة — اتصل بمسؤول النظام' },
      { status: 503 },
    );
  }
  if (key.length < 32) {
    console.error('[counseling-session] COUNSELING_SESSION_KEY too short — refusing write');
    return NextResponse.json(
      { error: 'خدمة التشفير غير مهيأة — اتصل بمسؤول النظام' },
      { status: 503 },
    );
  }

  // ----- Audit metadata (best-effort) -----
  // x-forwarded-for is the standard proxy chain; take the first hop
  // (the original client). x-real-ip is a fallback. Either may be
  // missing in local dev — NULL is acceptable per migration 009.
  const xff = request.headers.get('x-forwarded-for');
  const ipAddress = xff ? xff.split(',')[0].trim() : (request.headers.get('x-real-ip') || null);
  const userAgent = request.headers.get('user-agent') || null;

  // ----- RPC call via service-role admin client -----
  // The user-bound client CANNOT call this RPC — it's REVOKED from
  // authenticated. The admin client (service-role) is the ONLY way
  // through, and that's intentional: it ensures p_key stays server-side.
  const admin = createAdminSupabaseClient();
  const { data: newId, error } = await admin.rpc('create_counseling_session', {
    p_actor_user_id: auth.ctx.userId,
    p_case_id: caseId,
    p_session_date: body.session_date,
    p_session_type: body.session_type,
    p_topic: body.topic,
    p_content: body.content,
    p_content_preview: body.content_preview ?? null,
    p_duration_minutes: body.duration_minutes ?? null,
    p_key: key,
    p_ip_address: ipAddress,
    p_user_agent: userAgent,
  });

  if (error) {
    // RPC's RAISE EXCEPTION ERRCODE='42501' surfaces as code '42501'
    // in supabase-js. Translate to 403 with a generic message so the
    // caller can't distinguish "case not found" from "out of scope".
    // Server-side log carries the actual code for debugging; the
    // plaintext / key are never referenced.
    const isPriv =
      error.code === '42501' ||
      (error.message ?? '').includes('insufficient_privilege');
    if (!isPriv) {
      console.error('[counseling-session] RPC error', { code: error.code });
    }
    return NextResponse.json(
      {
        error: isPriv
          ? 'لا تملك صلاحية إضافة جلسة لهذه الحالة'
          : 'فشل إنشاء الجلسة',
      },
      { status: isPriv ? 403 : 500 },
    );
  }

  // Minimal response: only the new id. No echo of content / preview /
  // session metadata. The UI's onSuccess invalidates the case detail
  // query, which refetches the full record from the read API.
  return NextResponse.json(
    { data: { id: newId } },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
