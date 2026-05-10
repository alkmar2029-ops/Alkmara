import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import {
  validateBody,
  createAdminSchema,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  PERMISSION_PROFILES,
  type PermissionKey,
} from '@/lib/validations/schemas';
import {
  generatePassword,
  normalizePhone,
  sendAdminCredentialsViaWhatsapp,
} from '@/lib/admins/credentials';

export const dynamic = 'force-dynamic';

// GET — list all admins (super_admin only). Returns role + permissions
// + email so the unified users page can render both lists side by side.
export async function GET() {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  const { data: profiles, error } = await admin
    .from('user_profiles')
    .select('user_id, role, full_name, phone, is_active, last_login_at, created_at, permissions')
    .in('role', ['admin', 'super_admin'])
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: 'فشل جلب الإداريين' }, { status: 500 });
  }

  // Pull emails from auth.users (admin client only).
  const userIds = (profiles || []).map((p) => p.user_id);
  const emailMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersData?.users || []) {
      if (userIds.includes(u.id) && u.email) emailMap.set(u.id, u.email);
    }
  }

  const data = (profiles || []).map((p) => ({
    ...p,
    email: emailMap.get(p.user_id) ?? null,
  }));
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — create admin: random password → auth.users → user_profiles
// (with permissions JSONB) → WhatsApp welcome that lists the granted
// capabilities so the new admin knows what they can do.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(createAdminSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const password = generatePassword();
  const normalizedPhone = normalizePhone(v.data.phone);

  // Resolve permissions: explicit object > profile template > all-false.
  const incomingPerms = v.data.permissions || {};
  const profileTemplate = v.data.profile && PERMISSION_PROFILES[v.data.profile]
    ? PERMISSION_PROFILES[v.data.profile].permissions
    : null;
  const permissions: Record<PermissionKey, boolean> = PERMISSION_KEYS.reduce((acc, k) => {
    // Explicit form value wins; otherwise fall back to the profile's
    // default; otherwise false.
    const fromForm = (incomingPerms as any)[k];
    acc[k] = typeof fromForm === 'boolean'
      ? fromForm
      : profileTemplate
        ? profileTemplate[k]
        : false;
    return acc;
  }, {} as Record<PermissionKey, boolean>);

  // 1. Create auth user with role pre-set in app_metadata.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: v.data.email.toLowerCase(),
    password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
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

  // 2. Profile row.
  const { error: profileErr } = await admin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      role: 'admin',
      full_name: v.data.full_name.trim(),
      phone: normalizedPhone,
      is_active: true,
      permissions,
    }, { onConflict: 'user_id' });
  if (profileErr) {
    // Roll back auth user so we don't leave an orphan account.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json({ error: 'فشل إنشاء ملف الأدمن: ' + profileErr.message }, { status: 500 });
  }

  // 3. Build the permission summary lines for the welcome message and
  // send WhatsApp credentials. Best-effort — failure doesn't undo the
  // account creation; we surface the password in the response so the
  // creator can hand it over manually.
  const supabase = await createServerSupabaseClient();
  const portalBase = process.env.NEXT_PUBLIC_PORTAL_URL || request.nextUrl.origin;
  const portalUrl = `${portalBase.replace(/\/$/, '')}/dashboard`;

  const { data: settingsRow } = await supabase
    .from('school_settings')
    .select('school_name')
    .eq('id', 1)
    .maybeSingle();

  const permissionLines = PERMISSION_KEYS
    .filter((k) => permissions[k])
    .map((k) => `${PERMISSION_LABELS[k].emoji} ${PERMISSION_LABELS[k].label}`);
  const profileLabel = v.data.profile && PERMISSION_PROFILES[v.data.profile]
    ? PERMISSION_PROFILES[v.data.profile].label
    : undefined;

  const wa = await sendAdminCredentialsViaWhatsapp({
    supabase: admin,
    fullName: v.data.full_name,
    email: v.data.email,
    phone: normalizedPhone,
    password,
    portalUrl,
    schoolName: (settingsRow?.school_name as string) || undefined,
    adminUserId: userId,
    sentBy: auth.ctx.userId,
    permissionLines,
    profileLabel,
  });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'admin.create',
    targetType: 'admin',
    targetId: userId,
    details: {
      full_name: v.data.full_name,
      profile: v.data.profile || null,
      permissions,
      whatsapp_sent: wa.ok,
      whatsapp_error: wa.error || null,
    },
    request,
  });

  return NextResponse.json({
    data: {
      user_id: userId,
      email: v.data.email,
      full_name: v.data.full_name,
      phone: normalizedPhone,
      role: 'admin',
      permissions,
      whatsapp_sent: wa.ok,
      whatsapp_error: wa.error || null,
      // Hide password on success; surface it on failure so admin can copy it.
      password: wa.ok ? null : password,
    },
  }, { status: 201 });
}
