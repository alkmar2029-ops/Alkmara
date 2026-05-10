import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';
import { canManageSupervision } from '@/lib/supervision/permissions';

export const dynamic = 'force-dynamic';

// PATCH — rename / re-order / soft-disable.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  if (!(await canManageSupervision(auth.ctx, admin))) {
    return NextResponse.json({ error: 'لا تملك صلاحية إدارة جدول الإشراف' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }); }

  const update: any = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (n.length < 2 || n.length > 200) return NextResponse.json({ error: 'اسم غير صالح' }, { status: 400 });
    update.name = n;
  }
  if (Number.isFinite(body.sort_order)) update.sort_order = Math.floor(body.sort_order);
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active;

  const { data, error } = await admin
    .from('supervision_locations')
    .update(update).eq('id', id)
    .select('id, name, sort_order, is_active').single();
  if (error) return NextResponse.json({ error: 'فشل التعديل: ' + error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// DELETE — hard-delete (cascades assignments). Used sparingly; soft-disable
// via PATCH is preferred to preserve history.
export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  if (!(await canManageSupervision(auth.ctx, admin))) {
    return NextResponse.json({ error: 'لا تملك صلاحية إدارة جدول الإشراف' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });

  const { error } = await admin.from('supervision_locations').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'فشل الحذف: ' + error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
