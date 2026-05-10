import { sendText, type SendResult } from './wasender-client';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type WhatsappRecipientType = 'parent' | 'teacher' | 'admin' | 'unknown';
export type WhatsappContextType =
  | 'note'
  | 'late'
  | 'teacher_credentials'
  | 'teacher_registration_confirmation'
  | 'manual'
  | 'bulk_announcement';   // bulk parent broadcast (school announcements)

export interface SendAndLogParams {
  /**
   * @deprecated No longer used — the log now always writes through the
   * service-role client so RLS doesn't silently drop entries when the
   * sender is a teacher (whatsapp_messages is staff/admin-only). Left
   * in the type for backwards compatibility with existing callers.
   */
  supabase?: SupabaseClient;
  apiKey: string;
  phone: string;
  message: string;
  recipientName?: string | null;
  recipientType?: WhatsappRecipientType;
  templateName?: string | null;
  contextType?: WhatsappContextType | null;
  contextId?: string | number | null;
  sentBy?: string | null;
}

/**
 * Send a WhatsApp message and persist a row in `whatsapp_messages` whether it
 * succeeded or failed. Logging never throws — if the insert fails we still
 * return the underlying send result so callers behave normally.
 *
 * The log insert uses the service-role client so it succeeds regardless of
 * who triggered the send. whatsapp_messages has staff/admin-only RLS, but
 * teachers can also send (gated upstream by canTeachersSendWhatsapp); their
 * activity must still appear in the audit log so admins can review it. The
 * `sent_by` column always records the actual user who triggered the send.
 */
export async function sendTextAndLog(params: SendAndLogParams): Promise<SendResult> {
  const {
    apiKey, phone, message,
    recipientName = null,
    recipientType = 'unknown',
    templateName = null,
    contextType = null,
    contextId = null,
    sentBy = null,
  } = params;

  const result = await sendText(apiKey, phone, message);

  // Best-effort log. Failure to log must not break the send flow.
  try {
    const adminClient = createAdminSupabaseClient();
    await adminClient.from('whatsapp_messages').insert({
      recipient_phone: phone.slice(0, 20),  // matches column length
      recipient_name: recipientName,
      recipient_type: recipientType,
      template_name: templateName,
      context_type: contextType,
      context_id: contextId === null ? null : String(contextId),
      message_body: message,
      status: result.ok ? 'success' : 'failed',
      http_status: result.http ?? null,
      error_message: result.ok ? null : (result.error || 'unknown error'),
      msg_id: extractMsgId(result.raw),
      sent_by: sentBy,
    });
  } catch {
    // ignore — we don't want logging failures to surface to callers
  }

  return result;
}

/** Pull the WasenderAPI msgId out of the raw response (best-effort). */
function extractMsgId(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as any;
  const id = r?.data?.msgId ?? r?.msgId ?? r?.data?.id;
  if (typeof id === 'number') return id;
  if (typeof id === 'string' && /^\d+$/.test(id)) return parseInt(id, 10);
  return null;
}
