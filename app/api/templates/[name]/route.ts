import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, updateTemplateSchema } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .eq('name', params.name)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'فشل تحميل القالب' }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'القالب غير موجود' }, { status: 404 });
  return NextResponse.json({ data }, { headers: NO_STORE });
}

export async function PUT(req: NextRequest, { params }: { params: { name: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const validation = validateBody(updateTemplateSchema, body);
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const update: Record<string, unknown> = {
    body: validation.data.body,
    updated_at: new Date().toISOString(),
  };
  if (typeof validation.data.description === 'string') update.description = validation.data.description;
  if (typeof validation.data.is_active === 'boolean') update.is_active = validation.data.is_active;

  const { data, error } = await supabase
    .from('message_templates')
    .update(update)
    .eq('name', params.name)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'فشل حفظ القالب' }, { status: 400 });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'template.update',
    targetType: 'message_template',
    targetId: data.id,
    details: { name: params.name },
    request: req,
  });

  return NextResponse.json({ data }, { headers: NO_STORE });
}
