import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { updateNoteTemplateSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// PATCH — partial update of a template. Admin only.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'معرف القالب غير صالح' }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const v = validateBody(updateNoteTemplateSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  // Strip undefineds and trim text so the DB row stays clean.
  const patch: Record<string, unknown> = {};
  if (v.data.text !== undefined) patch.text = v.data.text.trim();
  if (v.data.type !== undefined) patch.type = v.data.type;
  if (v.data.category !== undefined) patch.category = v.data.category;
  if (v.data.audience !== undefined) patch.audience = v.data.audience;
  if (v.data.icon !== undefined) patch.icon = v.data.icon || null;
  if (v.data.is_active !== undefined) patch.is_active = v.data.is_active;
  if (v.data.sort_order !== undefined) patch.sort_order = v.data.sort_order;
  patch.updated_at = new Date().toISOString();

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('note_templates')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في تعديل القالب' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'note_template.update',
    targetType: 'note_template',
    targetId: id,
    details: { changed_keys: Object.keys(patch) },
    request,
  });

  return NextResponse.json({ data });
}

// DELETE — hard delete (no soft-delete column). Admin only.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'معرف القالب غير صالح' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from('note_templates').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في حذف القالب' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'note_template.delete',
    targetType: 'note_template',
    targetId: id,
    request,
  });

  return NextResponse.json({ message: 'تم الحذف' });
}
