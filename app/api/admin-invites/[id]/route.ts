import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// DELETE — revoke an invite code (soft revoke). Used codes are kept for
// audit; only their `revoked_at` flag is set. The validate endpoint
// rejects any code with revoked_at set.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'مخصّص للمدير العام فقط' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from('admin_invite_codes')
    .update({ revoked_at: new Date().toISOString(), revoked_by: ctx.userId })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'تعذّر إلغاء الرمز' }, { status: 500 });
  }

  await writeAuditLog({
    ctx,
    action: 'admin_invite.revoke',
    targetType: 'admin_invite',
    targetId: id,
    request,
  });

  return NextResponse.json({ message: 'تم الإلغاء' });
}
