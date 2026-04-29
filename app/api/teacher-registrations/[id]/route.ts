import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { updateRegistrationSchema, validateBody } from '@/lib/validations/schemas';
import {
  generatePassword,
  sendCredentialsViaWhatsapp,
  normalizePhone,
} from '@/lib/teachers/credentials';

export const dynamic = 'force-dynamic';

// PATCH — admin approves or rejects a pending registration.
//
// On approve we do the *full* teacher-creation dance (auth user → profile →
// WhatsApp). On reject we just flip the status. Either way, the row is left
// in the table so admin can see history.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'معرّف الطلب غير صالح' }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(updateRegistrationSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const admin = createAdminSupabaseClient();

  // Load the registration row first — we need its data and want to verify
  // it's still pending (idempotency: prevent double-approval if admin clicks
  // twice on a slow connection).
  const { data: reg, error: regErr } = await admin
    .from('teacher_registrations')
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

  // === REJECT path ===
  if (v.data.status === 'rejected') {
    const { data, error } = await admin
      .from('teacher_registrations')
      .update({
        status: 'rejected',
        rejected_by: auth.ctx.userId,
        rejected_at: new Date().toISOString(),
        notes: v.data.notes ?? null,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: 'فشل تحديث الطلب' }, { status: 500 });
    }
    await writeAuditLog({
      ctx: auth.ctx,
      action: 'teacher_registration.reject',
      targetType: 'teacher_registration',
      targetId: id,
      details: { email: reg.email, full_name: reg.full_name },
      request,
    });
    return NextResponse.json({ data });
  }

  // === APPROVE path ===
  // Defensive: someone might have been registered manually with this email
  // since the application came in. Block instead of failing midway.
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

  // 1. Create auth user
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: reg.email,
    password,
    email_confirm: true,
    app_metadata: { role: 'teacher' },
    user_metadata: { full_name: reg.full_name },
  });
  if (createErr || !created.user) {
    // Log the underlying error server-side; surface a generic message to
    // the client so we don't leak Supabase internals.
    console.error('createUser failed for teacher registration:', createErr?.message);
    return NextResponse.json(
      { error: 'فشل إنشاء حساب المعلم، حاول لاحقاً' },
      { status: 500 },
    );
  }
  const userId = created.user.id;

  // 2. Profile row
  const { error: profileErr } = await admin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      role: 'teacher',
      full_name: reg.full_name,
      phone: normalizedPhone,
      is_active: true,
    }, { onConflict: 'user_id' });
  if (profileErr) {
    // Rollback auth user — keep the system clean.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.error('user_profiles upsert failed:', profileErr.message);
    return NextResponse.json(
      { error: 'تعذّر إنشاء ملف المعلم، حاول لاحقاً' },
      { status: 500 },
    );
  }

  // 3. Mark registration approved BEFORE sending WhatsApp — if WhatsApp fails
  // we still want the account live and the row updated; admin can re-send
  // credentials manually from the teachers page.
  await admin
    .from('teacher_registrations')
    .update({
      status: 'approved',
      approved_by: auth.ctx.userId,
      approved_at: new Date().toISOString(),
      user_id: userId,
      notes: v.data.notes ?? reg.notes,
    })
    .eq('id', id);

  // 4. Send the elegant welcome WhatsApp message.
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
    fullName: reg.full_name,
    email: reg.email,
    phone: normalizedPhone,
    password,
    portalUrl,
    schoolName: (settingsRow?.school_name as string) || undefined,
    teacherUserId: userId,
    sentBy: auth.ctx.userId,
  });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher_registration.approve',
    targetType: 'teacher_registration',
    targetId: id,
    details: {
      user_id: userId,
      email: reg.email,
      full_name: reg.full_name,
      whatsapp_sent: wa.ok,
      whatsapp_error: wa.error || null,
    },
    request,
  });

  // Return the password only when WhatsApp delivery failed (so admin can
  // hand it over manually). Hide it on success for security.
  return NextResponse.json({
    data: {
      id,
      user_id: userId,
      email: reg.email,
      full_name: reg.full_name,
      phone: normalizedPhone,
      whatsapp_sent: wa.ok,
      whatsapp_error: wa.error || null,
      password: wa.ok ? null : password,
    },
  });
}

// DELETE — admin can hard-delete a row (cleanup of old/spam applications).
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'معرّف الطلب غير صالح' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('teacher_registrations').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'فشل حذف الطلب' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher_registration.delete',
    targetType: 'teacher_registration',
    targetId: id,
    request,
  });

  return NextResponse.json({ message: 'تم الحذف' });
}
