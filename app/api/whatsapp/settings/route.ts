import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, updateWhatsappSettingsSchema } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { maskKey } from '@/lib/whatsapp/wasender-client';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

export async function GET() {
  // Reading the table is admin-only by RLS; enforce here too for clearer errors.
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from('whatsapp_settings').select('*').eq('id', 1).maybeSingle();
  if (error) return NextResponse.json({ error: 'حدث خطأ في جلب الإعدادات' }, { status: 400 });

  const row = data || { id: 1, api_key: null, session_id: null, phone_number: null, status: 'disconnected', last_checked_at: null, updated_at: null };
  return NextResponse.json({
    data: {
      id: row.id,
      api_key: maskKey(row.api_key),
      api_key_set: !!row.api_key,
      session_id: row.session_id,
      phone_number: row.phone_number,
      status: row.status,
      last_checked_at: row.last_checked_at,
      updated_at: row.updated_at,
    },
  }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(updateWhatsappSettingsSchema, body);
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // If client sent a masked key (or empty), keep the existing one.
  const incomingKey = validation.data.api_key;
  const isMasked = typeof incomingKey === 'string' && incomingKey.startsWith('••••');
  const update: Record<string, unknown> = {
    session_id: validation.data.session_id ?? null,
    updated_at: new Date().toISOString(),
  };
  if (incomingKey && !isMasked) update.api_key = incomingKey;

  // Ensure singleton row exists (id=1) — tolerate first run on databases that
  // were migrated before the seed insert in schema.sql.
  await supabase.from('whatsapp_settings').upsert({ id: 1 }, { onConflict: 'id' });

  const { data, error } = await supabase
    .from('whatsapp_settings')
    .update(update)
    .eq('id', 1)
    .select('id, session_id, phone_number, status, last_checked_at, updated_at, api_key')
    .single();

  if (error) return NextResponse.json({ error: 'حدث خطأ في حفظ الإعدادات' }, { status: 400 });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.settings.update',
    targetType: 'whatsapp_settings',
    targetId: 1,
    details: { changed_keys: Object.keys(update).filter((k) => k !== 'updated_at') },
    request,
  });

  return NextResponse.json({
    data: {
      id: data.id,
      api_key: maskKey(data.api_key),
      api_key_set: !!data.api_key,
      session_id: data.session_id,
      phone_number: data.phone_number,
      status: data.status,
      last_checked_at: data.last_checked_at,
      updated_at: data.updated_at,
    },
  }, { headers: NO_STORE });
}
