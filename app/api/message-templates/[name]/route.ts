import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { updateMessageTemplateSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// GET single template by name — used by the editor to load current body.
export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .eq('name', params.name)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'القالب غير موجود' }, { status: 404 });
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}

// PATCH — update body / is_active / description. Admin only.
export async function PATCH(request: NextRequest, { params }: { params: { name: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(updateMessageTemplateSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const patch: Record<string, unknown> = {
    body: v.data.body,
    updated_at: new Date().toISOString(),
  };
  if (v.data.description !== undefined) patch.description = v.data.description;
  if (v.data.is_active !== undefined) patch.is_active = v.data.is_active;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('message_templates')
    .update(patch)
    .eq('name', params.name)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في الحفظ' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'message_template.update',
    targetType: 'message_template',
    targetId: params.name,
    details: { changed_keys: Object.keys(patch) },
    request,
  });

  return NextResponse.json({ data });
}
