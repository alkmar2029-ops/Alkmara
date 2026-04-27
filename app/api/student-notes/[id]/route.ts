import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// PATCH — used to mark notes as printed/whatsapp-sent. Body accepts
// { mark_printed: true } or { mark_whatsapp_sent: true }.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* empty body is OK */ }

  const patch: Record<string, unknown> = {};
  if (body.mark_printed) patch.printed_at = new Date().toISOString();
  if (body.mark_whatsapp_sent) patch.whatsapp_sent_at = new Date().toISOString();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'لا توجد حقول للتحديث' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('student_notes')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في التحديث' }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// DELETE — admin only.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from('student_notes').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في الحذف' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'student_notes.delete',
    targetType: 'student_note',
    targetId: id,
    request,
  });

  return NextResponse.json({ message: 'تم الحذف' });
}
