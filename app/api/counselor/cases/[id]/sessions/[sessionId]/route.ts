// GET /api/counselor/cases/[id]/sessions/[sessionId] — decrypt + return
// one counseling session's verbatim content (م4.21.4 — the deferred read
// path that completes the encryption story).
//
// =====================================================================
// SAME AUTH + KEY MODEL AS THE CREATE SIBLING (../sessions/route.ts)
// =====================================================================
//   1. requireCounselorWorkspace gate (super_admin OR persona='counselor').
//   2. COUNSELING_SESSION_KEY from server env — fail-closed 503 if
//      missing / under-length. Never defaulted, never logged.
//   3. decrypt_session_content RPC via the SERVICE-ROLE admin client.
//      The RPC is REVOKEd from `authenticated`, so service-role is the
//      ONLY path through — keeping p_key off the browser. The RPC
//      re-validates counselor scope against counselor_assignments AND
//      writes the action='decrypt' confidential_access_log row, so every
//      read of a minor's verbatim content is attributable.
//
// =====================================================================
// CONTENT EXPOSURE
// =====================================================================
// Response carries ONLY { content }. Session metadata (topic, date,
// preview) already comes from the case-detail endpoint — we don't echo
// it here. Cache-Control: no-store so the decrypted plaintext never
// lands in a shared/browser cache.
//
// The [id] (caseId) path segment is for RESTful nesting only; the RPC
// resolves the session → its case → student and re-checks scope on that,
// so authorization does not depend on the caller passing a matching
// caseId.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  sessionId: z.coerce.number().int().positive(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await requireCounselorWorkspace();
  if (!auth.ok) return auth.res;

  const parsed = paramsSchema.safeParse({
    id: params.id,
    sessionId: params.sessionId,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }
  const sessionId = parsed.data.sessionId;

  // Encryption key — fail-closed, no fallback. Same discipline as the
  // create sibling: distinguish missing-vs-short server-side, never leak
  // the value itself.
  const key = (process.env.COUNSELING_SESSION_KEY || '').trim();
  if (!key || key.length < 32) {
    console.error(
      '[counseling-decrypt] COUNSELING_SESSION_KEY missing/short — refusing decrypt',
    );
    return NextResponse.json(
      { error: 'خدمة التشفير غير مهيأة — اتصل بمسؤول النظام' },
      { status: 503 },
    );
  }

  // Best-effort audit metadata — NULL when unavailable (no failure path).
  const xff = request.headers.get('x-forwarded-for');
  const ipAddress = xff
    ? xff.split(',')[0].trim()
    : request.headers.get('x-real-ip') || null;
  const userAgent = request.headers.get('user-agent') || null;

  // RPC via service-role admin client — the only path (REVOKEd from
  // authenticated) so p_key stays server-side.
  const admin = createAdminSupabaseClient();
  const { data: content, error } = await admin.rpc('decrypt_session_content', {
    p_actor_user_id: auth.ctx.userId,
    p_session_id: sessionId,
    p_key: key,
    p_ip_address: ipAddress,
    p_user_agent: userAgent,
  });

  if (error) {
    // 42501 from the RPC = out-of-scope or non-existent session (the RPC
    // deliberately makes them indistinguishable). Map to 403 with a
    // generic message; log the real code server-side for non-priv errors
    // (e.g. a wrong/rotated key surfaces as a pgcrypto error → 500).
    const isPriv =
      error.code === '42501' ||
      (error.message ?? '').includes('insufficient_privilege');
    if (!isPriv) {
      console.error('[counseling-decrypt] RPC error', { code: error.code });
    }
    return NextResponse.json(
      {
        error: isPriv
          ? 'لا تملك صلاحية عرض محتوى هذه الجلسة'
          : 'فشل فكّ تشفير محتوى الجلسة',
      },
      { status: isPriv ? 403 : 500 },
    );
  }

  return NextResponse.json(
    { data: { content } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
