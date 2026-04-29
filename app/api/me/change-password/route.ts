import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, writeAuditLog } from '@/lib/supabase/auth';
import { changePasswordSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// POST — change my own password.
//
// Requires the *current* password. This is the textbook defense against
// session hijacking: even if someone steals an active session (stolen device,
// XSS, an unattended browser), they can't permanently lock out the legitimate
// owner without knowing the current password.
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }
  if (!ctx.email) {
    return NextResponse.json({ error: 'البريد غير معروف للحساب' }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(changePasswordSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  // 1. Verify the current password by attempting a fresh sign-in. We use a
  // throwaway client so this verification doesn't disturb the active session
  // cookies. Wrong password → 401 with a generic message (no enumeration hint).
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: verifyErr } = await verifier.auth.signInWithPassword({
    email: ctx.email,
    password: v.data.current_password,
  });
  if (verifyErr) {
    return NextResponse.json({ error: 'كلمة السر الحالية غير صحيحة' }, { status: 401 });
  }

  // 2. Update the password. Use the admin client so we don't depend on the
  // calling session's update permissions.
  const admin = createAdminSupabaseClient();
  const { error: updErr } = await admin.auth.admin.updateUserById(ctx.userId, {
    password: v.data.new_password,
  });
  if (updErr) {
    // Log the underlying error server-side; surface a generic message.
    console.error('change-password update failed:', updErr.message);
    return NextResponse.json({ error: 'تعذّر تغيير كلمة السر، حاول لاحقاً' }, { status: 500 });
  }

  await writeAuditLog({
    ctx,
    action: 'password.change',
    targetType: 'user',
    targetId: ctx.userId,
    request,
  });

  return NextResponse.json({ message: 'تم تغيير كلمة السر' });
}
