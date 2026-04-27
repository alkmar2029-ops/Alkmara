import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { createTeacherSchema, validateBody } from '@/lib/validations/schemas';
import {
  generatePassword,
  sendCredentialsViaWhatsapp,
  normalizePhone,
} from '@/lib/teachers/credentials';

export const dynamic = 'force-dynamic';

// GET — list teachers (admin only). Joins auth.users for email & created_at.
export async function GET() {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  const { data: profiles, error } = await admin
    .from('user_profiles')
    .select('user_id, role, full_name, phone, is_active, last_login_at, created_at')
    .eq('role', 'teacher')
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: 'فشل جلب المعلمين' }, { status: 500 });
  }

  // Pull emails from auth.users — admin client has access.
  const userIds = (profiles || []).map((p) => p.user_id);
  const emailMap = new Map<string, string>();
  if (userIds.length > 0) {
    // listUsers paginates; one page is enough for typical school sizes.
    const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersData?.users || []) {
      if (userIds.includes(u.id) && u.email) emailMap.set(u.id, u.email);
    }
  }

  const data = (profiles || []).map((p) => ({ ...p, email: emailMap.get(p.user_id) ?? null }));
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — create teacher: random password → auth.users → user_profiles → WhatsApp.
// On WhatsApp failure we keep the account but return the credentials so admin
// can copy them manually from the response.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(createTeacherSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const password = generatePassword();
  const normalizedPhone = normalizePhone(v.data.phone);

  // 1. Create auth user with role pre-set in app_metadata
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: v.data.email.toLowerCase(),
    password,
    email_confirm: true,
    app_metadata: { role: 'teacher' },
    user_metadata: { full_name: v.data.full_name },
  });
  if (createErr || !created.user) {
    const msg = createErr?.message || 'فشل إنشاء الحساب';
    if (msg.toLowerCase().includes('already')) {
      return NextResponse.json({ error: 'البريد مستخدم مسبقاً' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const userId = created.user.id;

  // 2. Create profile row
  const { error: profileErr } = await admin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      role: 'teacher',
      full_name: v.data.full_name.trim(),
      phone: normalizedPhone,
      is_active: true,
    }, { onConflict: 'user_id' });
  if (profileErr) {
    // Rollback auth user so we don't leave an orphan account.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json({ error: 'فشل إنشاء ملف المعلم: ' + profileErr.message }, { status: 500 });
  }

  // 3. Send WhatsApp credentials. Best-effort: failures don't undo creation.
  // The portal URL is what the teacher clicks in WhatsApp — it must point to
  // the public deployment (Vercel), not the admin's local dev server. Falls
  // back to the request origin if the env var isn't set.
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
    fullName: v.data.full_name,
    email: v.data.email,
    phone: normalizedPhone,
    password,
    portalUrl,
    schoolName: (settingsRow?.school_name as string) || undefined,
    teacherUserId: userId,
    sentBy: auth.ctx.userId,
  });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher.create',
    targetType: 'teacher',
    targetId: userId,
    details: {
      full_name: v.data.full_name,
      whatsapp_sent: wa.ok,
      whatsapp_error: wa.error || null,
    },
    request,
  });

  // Return password ONLY when WhatsApp delivery failed, so admin can hand it
  // over manually. On success we hide it for security.
  return NextResponse.json({
    data: {
      user_id: userId,
      email: v.data.email,
      full_name: v.data.full_name,
      phone: normalizedPhone,
      whatsapp_sent: wa.ok,
      whatsapp_error: wa.error || null,
      password: wa.ok ? null : password,
    },
  }, { status: 201 });
}
