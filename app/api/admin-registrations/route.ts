import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/supabase/auth';
import { normalizePhone } from '@/lib/teachers/credentials';
import { sendAdminRegistrationConfirmation } from '@/lib/admins/registration-confirmation';
import { checkRateLimit, clientIp } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

const submitSchema = z.object({
  invite_code: z.string().min(4).max(20),
  full_name: z.string().min(3, 'الاسم الكامل مطلوب').max(200),
  email: z.string().email('بريد إلكتروني غير صالح').max(255),
  phone: z.string().regex(/^(9665\d{8}|05\d{8})$/, 'رقم الجوال غير صالح'),
  // Honeypot — must be empty.
  website: z.string().max(0).optional(),
});

const GENERIC_SUCCESS = NextResponse.json(
  { data: { message: 'تم استلام طلبك. ستتم مراجعته قريباً.' } },
  { status: 201 },
);

// POST — public submission. The invite code is the gate: no valid code,
// no row inserted. Same rate-limit + honeypot pattern as the teacher
// registration endpoint.
export async function POST(request: NextRequest) {
  // 1. Per-IP rate limit — 5 submissions / 10 minutes.
  const ip = clientIp(request);
  const rl = checkRateLimit(`register-admin:${ip}`, 5, 10 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'لقد تجاوزت الحد المسموح، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(rl.resetIn) } },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }
  const { invite_code, full_name, email, phone, website } = parsed.data;

  // Honeypot tripped → silent success (don't tell the bot).
  if (website && website.length > 0) return GENERIC_SUCCESS;

  const admin = createAdminSupabaseClient();
  const code = invite_code.toUpperCase().trim();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = normalizePhone(phone);

  // 2. Validate the invite code. We need a server-side authoritative check
  // because the validate endpoint is public (clients could lie).
  const { data: codeRow } = await admin
    .from('admin_invite_codes')
    .select('id, used_at, revoked_at, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (!codeRow) {
    return NextResponse.json({ error: 'رمز الدعوة غير صحيح' }, { status: 400 });
  }
  if (codeRow.revoked_at) {
    return NextResponse.json({ error: 'تم إلغاء رمز الدعوة' }, { status: 400 });
  }
  if (codeRow.used_at) {
    return NextResponse.json({ error: 'رمز الدعوة مستخدم مسبقاً' }, { status: 400 });
  }
  if (new Date(codeRow.expires_at) <= new Date()) {
    return NextResponse.json({ error: 'انتهت صلاحية رمز الدعوة' }, { status: 400 });
  }

  // 3. Check duplicates — same generic-success policy as teacher reg
  // (avoid revealing which emails are registered).
  const { data: existingPending } = await admin
    .from('admin_registrations')
    .select('id')
    .ilike('email', normalizedEmail)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingPending) return GENERIC_SUCCESS;

  const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const taken = (usersData?.users || []).some(
    (u) => (u.email || '').toLowerCase() === normalizedEmail,
  );
  if (taken) return GENERIC_SUCCESS;

  // 4. Insert registration + atomic claim of the code (set used_at).
  const { data: regRow, error: insErr } = await admin
    .from('admin_registrations')
    .insert({
      full_name: full_name.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      invite_code_id: codeRow.id,
      status: 'pending',
    })
    .select('id, full_name, phone')
    .single();
  if (insErr || !regRow) {
    console.error('admin_registrations insert failed:', insErr?.message);
    return NextResponse.json({ error: 'تعذّر حفظ طلبك، حاول لاحقاً' }, { status: 500 });
  }

  await admin
    .from('admin_invite_codes')
    .update({ used_at: new Date().toISOString(), used_by_registration_id: regRow.id })
    .eq('id', codeRow.id);

  // 5. Best-effort confirmation WhatsApp.
  (async () => {
    try {
      const { data: settings } = await admin
        .from('school_settings').select('school_name').eq('id', 1).maybeSingle();
      await sendAdminRegistrationConfirmation({
        supabase: admin,
        fullName: regRow.full_name,
        phone: regRow.phone,
        schoolName: (settings?.school_name as string) || undefined,
      });
    } catch (e) {
      console.error('admin registration confirmation send failed:', e);
    }
  })();

  return NextResponse.json({ data: regRow }, { status: 201 });
}

// GET — list registrations (super_admin only).
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'مخصّص للمدير العام فقط' }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get('status') || 'pending';
  const admin = createAdminSupabaseClient();

  let query = admin
    .from('admin_registrations')
    .select('*')
    .order('created_at', { ascending: false });
  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'فشل جلب الطلبات' }, { status: 500 });
  }

  const { count: pendingCount } = await admin
    .from('admin_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  return NextResponse.json(
    { data, pendingCount: pendingCount ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
