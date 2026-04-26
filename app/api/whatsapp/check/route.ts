import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { checkSession, maskKey } from '@/lib/whatsapp/wasender-client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const { data: row } = await supabase.from('whatsapp_settings').select('*').eq('id', 1).maybeSingle();
  if (!row?.api_key) {
    return NextResponse.json({ error: 'يجب حفظ مفتاح API أولاً' }, { status: 400 });
  }

  const result = await checkSession(row.api_key, row.session_id);

  // Persist whatever we learned (even on failure we mark status=error so the UI reflects it).
  await supabase
    .from('whatsapp_settings')
    .update({
      status: result.status,
      phone_number: result.phone_number ?? row.phone_number,
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', 1);

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.check',
    targetType: 'whatsapp_settings',
    targetId: 1,
    details: { status: result.status, http: result.http, error: result.error },
    request,
  });

  return NextResponse.json({
    data: {
      api_key: maskKey(row.api_key),
      api_key_set: true,
      session_id: row.session_id,
      phone_number: result.phone_number ?? row.phone_number,
      status: result.status,
      last_checked_at: new Date().toISOString(),
      error: result.error || null,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
