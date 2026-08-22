import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireManageUsers } from '@/lib/personas/auth-gate';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { generatePassword, sendCredentialsViaWhatsapp } from '@/lib/teachers/credentials';

export const dynamic = 'force-dynamic';
// Hobby-safe cap. Resending the new password is a paced WhatsApp send
// (~15s) — exceeds Vercel's 10s default without this.
export const maxDuration = 60;

// POST — generate a new password for a teacher and resend via WhatsApp.
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireManageUsers();
  if (!auth.ok) return auth.res;

  const rl = checkRateLimit(`reset-pw:${auth.ctx.userId}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'محاولات إعادة تعيين كلمة السر كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(rl.resetIn) } },
    );
  }

  const admin = createAdminSupabaseClient();

  // 1. Look up the teacher (profile + email).
  const { data: profile, error: pErr } = await admin
    .from('user_profiles')
    .select('user_id, role, full_name, phone')
    .eq('user_id', params.id)
    .eq('role', 'teacher')
    .maybeSingle();
  if (pErr || !profile) {
    return NextResponse.json({ error: 'المعلم غير موجود' }, { status: 404 });
  }
  const { data: userRes } = await admin.auth.admin.getUserById(params.id);
  const email = userRes?.user?.email || null;
  if (!email) {
    return NextResponse.json({ error: 'تعذر العثور على البريد' }, { status: 404 });
  }

  // 2. Reset the password.
  const newPassword = generatePassword();
  const { error: updErr } = await admin.auth.admin.updateUserById(params.id, {
    password: newPassword,
  });
  if (updErr) {
    return NextResponse.json({ error: 'فشل إعادة تعيين كلمة السر: ' + updErr.message }, { status: 500 });
  }

  // 3. Send the new credentials via WhatsApp. Use the public portal URL so
  // the teacher gets a working link (not the admin's localhost).
  const supabase = await createServerSupabaseClient();
  const portalBase = process.env.NEXT_PUBLIC_PORTAL_URL || request.nextUrl.origin;
  const portalUrl = `${portalBase.replace(/\/$/, '')}/teacher`;
  const { data: settingsRow } = await supabase
    .from('school_settings')
    .select('school_name')
    .eq('id', 1)
    .maybeSingle();

  const wa = await sendCredentialsViaWhatsapp({
    supabase: admin,
    fullName: profile.full_name || email,
    email,
    phone: profile.phone || '',
    password: newPassword,
    portalUrl,
    isReset: true,
    schoolName: (settingsRow?.school_name as string) || undefined,
    teacherUserId: params.id,
    sentBy: auth.ctx.userId,
  });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher.reset_password',
    targetType: 'teacher',
    targetId: params.id,
    details: { whatsapp_sent: wa.ok, whatsapp_error: wa.error || null },
    request,
  });

  return NextResponse.json({
    data: {
      whatsapp_sent: wa.ok,
      whatsapp_error: wa.error || null,
      password: wa.ok ? null : newPassword, // shown to admin only when WA failed
    },
  });
}
