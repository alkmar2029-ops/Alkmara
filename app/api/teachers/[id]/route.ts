import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { updateTeacherSchema, validateBody } from '@/lib/validations/schemas';
import { normalizePhone } from '@/lib/teachers/credentials';

export const dynamic = 'force-dynamic';

// PATCH — update name, phone, or active flag.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(updateTeacherSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (v.data.full_name !== undefined) patch.full_name = v.data.full_name.trim();
  if (v.data.phone !== undefined) patch.phone = normalizePhone(v.data.phone);
  if (v.data.is_active !== undefined) patch.is_active = v.data.is_active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'لا توجد حقول للتحديث' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('user_profiles')
    .update(patch)
    .eq('user_id', params.id)
    .eq('role', 'teacher')
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: 'فشل التحديث' }, { status: 500 });
  }

  // If admin disabled the teacher, also revoke their sessions immediately.
  if (v.data.is_active === false) {
    await admin.auth.admin.updateUserById(params.id, { ban_duration: 'none' }).catch(() => {});
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher.update',
    targetType: 'teacher',
    targetId: params.id,
    details: { changed_keys: Object.keys(patch) },
    request,
  });

  return NextResponse.json({ data });
}

// DELETE — hard delete (cascades to attendance via FK ON DELETE SET NULL).
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  // Delete the auth user — the profile FK will cascade on delete because
  // user_profiles.user_id references auth.users(id) with ON DELETE CASCADE.
  const { error } = await admin.auth.admin.deleteUser(params.id);
  if (error) {
    return NextResponse.json({ error: 'فشل حذف الحساب: ' + error.message }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher.delete',
    targetType: 'teacher',
    targetId: params.id,
    request,
  });

  return NextResponse.json({ message: 'تم الحذف' });
}
