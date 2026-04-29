import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext, writeAuditLog } from '@/lib/supabase/auth';
import { generatePassword, normalizePhone } from '@/lib/teachers/credentials';
import { sendAdminCredentialsViaWhatsapp } from '@/lib/admins/credentials';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  notes: z.string().max(500).optional(),
  // On approval, super_admin may set the initial section assignments
  // straight from the approval modal — saves a second click.
  initial_section_ids: z.array(z.number().int().positive()).max(200).optional(),
});

// PATCH — approve or reject. Super-admin only.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'مخصّص للمدير العام فقط' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }
  const v = parsed.data;

  const admin = createAdminSupabaseClient();

  const { data: reg, error: regErr } = await admin
    .from('admin_registrations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (regErr || !reg) {
    return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
  }
  if (reg.status !== 'pending') {
    return NextResponse.json(
      { error: `سبق وأن تمت معالجة هذا الطلب (${reg.status === 'approved' ? 'مقبول' : 'مرفوض'})` },
      { status: 409 },
    );
  }

  // === REJECT ===
  if (v.status === 'rejected') {
    const { data, error } = await admin
      .from('admin_registrations')
      .update({
        status: 'rejected',
        rejected_by: ctx.userId,
        rejected_at: new Date().toISOString(),
        notes: v.notes ?? null,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: 'فشل تحديث الطلب' }, { status: 500 });
    }
    await writeAuditLog({
      ctx, action: 'admin_registration.reject',
      targetType: 'admin_registration', targetId: id,
      details: { email: reg.email, full_name: reg.full_name },
      request,
    });
    return NextResponse.json({ data });
  }

  // === APPROVE ===
  // Defensive: someone might have manually created an account with this
  // email since the request was filed.
  const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const taken = (usersData?.users || []).some(
    (u) => (u.email || '').toLowerCase() === reg.email.toLowerCase(),
  );
  if (taken) {
    return NextResponse.json(
      { error: 'البريد مسجّل مسبقاً كحساب — أرفض هذا الطلب أو احذفه' },
      { status: 409 },
    );
  }

  const password = generatePassword();
  const normalizedPhone = normalizePhone(reg.phone);

  // 1. Create auth user.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: reg.email,
    password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
    user_metadata: { full_name: reg.full_name },
  });
  if (createErr || !created.user) {
    console.error('admin createUser failed:', createErr?.message);
    return NextResponse.json({ error: 'فشل إنشاء حساب الإداري، حاول لاحقاً' }, { status: 500 });
  }
  const userId = created.user.id;

  // 2. Profile row.
  const { error: profileErr } = await admin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      role: 'admin',
      full_name: reg.full_name,
      phone: normalizedPhone,
      is_active: true,
    }, { onConflict: 'user_id' });
  if (profileErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.error('admin profile upsert failed:', profileErr.message);
    return NextResponse.json({ error: 'تعذّر إنشاء ملف الإداري، حاول لاحقاً' }, { status: 500 });
  }

  // 3. Initial section assignments — super_admin may have ticked some
  // sections in the approval modal. Skip silently if none.
  if (v.initial_section_ids && v.initial_section_ids.length > 0) {
    const rows = v.initial_section_ids.map((section_id) => ({
      admin_user_id: userId,
      section_id,
      assigned_by: ctx.userId,
    }));
    await admin.from('admin_section_assignments').insert(rows);
  }

  // 4. Mark approved.
  await admin
    .from('admin_registrations')
    .update({
      status: 'approved',
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
      user_id: userId,
      notes: v.notes ?? reg.notes,
    })
    .eq('id', id);

  // 5. Send the welcome WhatsApp (3-message split).
  const supabase = await createServerSupabaseClient();
  const portalBase = process.env.NEXT_PUBLIC_PORTAL_URL || request.nextUrl.origin;
  const portalUrl = `${portalBase.replace(/\/$/, '')}/dashboard`;
  const { data: settingsRow } = await supabase
    .from('school_settings').select('school_name').eq('id', 1).maybeSingle();

  const wa = await sendAdminCredentialsViaWhatsapp({
    supabase: admin,
    fullName: reg.full_name,
    email: reg.email,
    phone: normalizedPhone,
    password,
    portalUrl,
    schoolName: (settingsRow?.school_name as string) || undefined,
    adminUserId: userId,
    sentBy: ctx.userId,
  });

  await writeAuditLog({
    ctx, action: 'admin_registration.approve',
    targetType: 'admin_registration', targetId: id,
    details: {
      user_id: userId, email: reg.email, full_name: reg.full_name,
      whatsapp_sent: wa.ok, whatsapp_error: wa.error || null,
      initial_sections: v.initial_section_ids?.length || 0,
    },
    request,
  });

  return NextResponse.json({
    data: {
      id, user_id: userId, email: reg.email, full_name: reg.full_name,
      phone: normalizedPhone,
      whatsapp_sent: wa.ok,
      whatsapp_error: wa.error || null,
      // Show password in the response only if WhatsApp failed, so super_admin
      // can hand it over manually.
      password: wa.ok ? null : password,
    },
  });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'مخصّص للمدير العام فقط' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('admin_registrations').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'فشل حذف الطلب' }, { status: 500 });
  }

  await writeAuditLog({
    ctx, action: 'admin_registration.delete',
    targetType: 'admin_registration', targetId: id, request,
  });

  return NextResponse.json({ message: 'تم الحذف' });
}
