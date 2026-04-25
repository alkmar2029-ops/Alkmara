import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, updateSettingsSchema } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from('school_settings').select('*').limit(1);

  if (error) return NextResponse.json({ error: 'حدث خطأ في جلب الإعدادات' }, { status: 400 });

  // If no settings row exists, return default settings
  if (!data || data.length === 0) {
    return NextResponse.json({
      data: {
        id: 1,
        school_name: '',
        stage: 'elementary',
        academic_year: '',
      },
    }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
  }

  return NextResponse.json({ data: data[0] }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(updateSettingsSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Always update row id=1 (single school)
  const { data, error } = await supabase
    .from('school_settings')
    .update({ ...validation.data, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'حدث خطأ في حفظ الإعدادات' }, { status: 400 });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'settings.update',
    targetType: 'school_settings',
    targetId: 1,
    details: { changed_keys: Object.keys(validation.data) },
    request,
  });

  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
