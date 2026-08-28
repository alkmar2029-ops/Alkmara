import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { sidebarOrderSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireRole(['admin', 'staff', 'viewer', 'teacher']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('school_settings')
    .select('sidebar_order')
    .eq('id', 1)
    .single();

  if (error) {
    return NextResponse.json({ error: 'تعذر تحميل ترتيب القائمة' }, { status: 500 });
  }
  return NextResponse.json({ data: data?.sidebar_order || null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;
  if (auth.ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'ترتيب القائمة متاح للمدير العام فقط' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات غير صالحة' }, { status: 400 });
  }
  const validation = validateBody(sidebarOrderSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from('school_settings')
    .update({ sidebar_order: validation.data, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) {
    return NextResponse.json({ error: 'تعذر حفظ ترتيب القائمة' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'sidebar.order.update',
    targetType: 'school_settings',
    targetId: 1,
    details: { group_count: validation.data.group_order.length },
    request,
  });
  return NextResponse.json({ data: validation.data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;
  if (auth.ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'ترتيب القائمة متاح للمدير العام فقط' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from('school_settings')
    .update({ sidebar_order: null, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) {
    return NextResponse.json({ error: 'تعذر استعادة الترتيب الافتراضي' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'sidebar.order.reset',
    targetType: 'school_settings',
    targetId: 1,
    request,
  });
  return NextResponse.json({ data: null });
}
