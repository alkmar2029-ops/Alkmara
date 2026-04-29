import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Single source of truth for "is the teacher WhatsApp channel enabled?".
 * Reads `whatsapp_settings.teachers_enabled` (admin-managed toggle).
 *
 * Defaults to TRUE on any read failure — the safer side: admins explicitly
 * turn it off, and a transient DB error shouldn't silently muzzle the
 * whole school's notifications.
 */
export async function isTeacherWhatsappEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('whatsapp_settings')
      .select('teachers_enabled')
      .eq('id', 1)
      .maybeSingle();
    // teachers_enabled may be undefined on installations that haven't run
    // the migration yet — treat undefined as enabled.
    return data?.teachers_enabled !== false;
  } catch {
    return true;
  }
}

/** Stable error message returned by every send path when the toggle is off. */
export const TEACHER_WHATSAPP_DISABLED_ERROR = 'إرسال الواتساب للمعلمين موقوف من الإعدادات';

/**
 * Reads `whatsapp_settings.teachers_can_send_whatsapp` — whether a
 * teacher account is permitted to send WhatsApp to parents from their
 * notes flow. Defaults to FALSE on read failure (the safer side: an
 * outage should not silently expand teacher privileges).
 */
export async function canTeachersSendWhatsapp(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('whatsapp_settings')
      .select('teachers_can_send_whatsapp')
      .eq('id', 1)
      .maybeSingle();
    return data?.teachers_can_send_whatsapp === true;
  } catch {
    return false;
  }
}

export const TEACHER_CANNOT_SEND_WHATSAPP_ERROR =
  'لا يُسمح للمعلمين بإرسال رسائل الواتساب من الإعدادات';
