import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { upsertPeriodSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('periods')
    .select('*')
    .order('sort_order')
    .order('number');
  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في جلب الحصص' }, { status: 500 });
  }
  return NextResponse.json({ data: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — admin replaces the full list of periods (simpler than per-row CRUD).
// Body: { periods: [{ number, name, start_time?, end_time?, is_active?, sort_order? }, ...] }
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  if (!Array.isArray(body?.periods)) {
    return NextResponse.json({ error: 'يجب إرسال قائمة الحصص' }, { status: 400 });
  }
  // Validate each row.
  const cleaned: any[] = [];
  for (const p of body.periods) {
    const v = validateBody(upsertPeriodSchema, p);
    if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });
    cleaned.push({
      number: v.data.number,
      name: v.data.name.trim(),
      start_time: v.data.start_time || null,
      end_time: v.data.end_time || null,
      is_active: v.data.is_active,
      sort_order: v.data.sort_order,
      updated_at: new Date().toISOString(),
    });
  }

  const supabase = await createServerSupabaseClient();
  // Upsert by `number` (UNIQUE). Rows whose `number` isn't in the list are
  // left alone (admin can deactivate via is_active=false instead of delete,
  // since deleting a period would cascade attendance rows).
  const { error } = await supabase
    .from('periods')
    .upsert(cleaned, { onConflict: 'number' });
  if (error) {
    return NextResponse.json({ error: 'فشل حفظ الحصص: ' + error.message }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'periods.upsert',
    targetType: 'periods',
    details: { count: cleaned.length },
    request,
  });
  return NextResponse.json({ data: { count: cleaned.length } });
}
