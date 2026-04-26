import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getConnectedDeviceIds } from '@/lib/zkteco/device-service';
import { validateBody, createDeviceSchemaStrict } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  // Disambiguate the embed: there are two FKs between devices and sections
  // (sections.device_id → devices.id, and devices.section_id → sections.id).
  // We want the section the device belongs to.
  const { data, error } = await supabase
    .from('devices')
    .select('*, sections!devices_section_id_fkey(id, name, grades(id, name, stage))')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[api/devices] supabase error:', error.message);
    return NextResponse.json({ error: error.message || 'حدث خطأ في جلب الأجهزة' }, { status: 400 });
  }

  const connectedIds = getConnectedDeviceIds();
  const devices = (data || []).map((d: any) => ({
    ...d,
    is_online: connectedIds.includes(d.id),
    section_name: d.sections?.name || null,
    grade_name: d.sections?.grades?.name || null,
    grade_stage: d.sections?.grades?.stage || null,
    sections: undefined,
  }));

  return NextResponse.json({ data: devices });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(createDeviceSchemaStrict, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { data, error } = await supabase.from('devices').insert(validation.data).select().single();
  if (error) return NextResponse.json({ error: 'حدث خطأ في إضافة الجهاز' }, { status: 400 });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'device.create',
    targetType: 'device',
    targetId: data?.id ?? null,
    details: { ip: data?.ip_address, name: data?.name },
    request,
  });

  return NextResponse.json({ data }, { status: 201 });
}
