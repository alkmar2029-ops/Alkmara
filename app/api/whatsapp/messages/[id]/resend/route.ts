import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { sendTextAndLog } from '@/lib/whatsapp/log';

export const dynamic = 'force-dynamic';

// POST — re-send a previously logged WhatsApp message verbatim.
// We keep the old failed row as a history record and write a fresh row for
// the new attempt — so the log shows both attempts and the audit trail stays
// honest.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // 1. Load the original message.
  const { data: orig, error: fetchErr } = await supabase
    .from('whatsapp_messages')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr || !orig) {
    return NextResponse.json({ error: 'الرسالة غير موجودة' }, { status: 404 });
  }

  // 2. WhatsApp credentials.
  const { data: ws } = await supabase
    .from('whatsapp_settings').select('api_key').eq('id', 1).maybeSingle();
  if (!ws?.api_key) {
    return NextResponse.json({ error: 'مفتاح API للواتساب غير مضبوط' }, { status: 400 });
  }

  // 3. Resend with the same body & metadata. The wrapper writes a new
  //    whatsapp_messages row with the new outcome.
  const result = await sendTextAndLog({
    supabase,
    apiKey: ws.api_key,
    phone: orig.recipient_phone,
    message: orig.message_body,
    recipientName: orig.recipient_name,
    recipientType: orig.recipient_type,
    templateName: orig.template_name,
    contextType: orig.context_type,
    contextId: orig.context_id,
    sentBy: auth.ctx.userId,
  });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.resend',
    targetType: 'whatsapp_message',
    targetId: id,
    details: {
      ok: result.ok,
      error: result.error || null,
      original_status: orig.status,
    },
    request,
  });

  return NextResponse.json({
    data: {
      ok: result.ok,
      error: result.error || null,
    },
  });
}
