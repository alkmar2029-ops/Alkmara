import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

/**
 * Single source of truth for "is the teacher WhatsApp channel enabled?".
 * Reads `whatsapp_settings.teachers_enabled` (admin-managed toggle).
 *
 * IMPORTANT — uses the service-role admin client internally regardless of
 * what the caller passes. The `whatsapp_settings` table has admin-only RLS
 * (intentional: it stores the API key), but this is a policy lookup that
 * every authenticated role needs to read. The caller has already passed
 * `requireRole(...)` upstream, so bypassing RLS here is safe.
 *
 * The `supabase` argument is kept for backwards compatibility with all
 * existing call sites — it is intentionally unused.
 *
 * Defaults to TRUE on any read failure — the safer side: admins explicitly
 * turn it off, and a transient DB error shouldn't silently muzzle the
 * whole school's notifications.
 */
export async function isTeacherWhatsappEnabled(_supabase?: SupabaseClient): Promise<boolean> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
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
 * notes flow.
 *
 * Same admin-client rationale as `isTeacherWhatsappEnabled`: the table is
 * admin-only via RLS (because it stores the API key), but this single
 * boolean must be readable by teachers to gate their send action. The
 * upstream `requireRole(['teacher'])` check authorizes the caller; this
 * function only fetches the policy value.
 *
 * Defaults to FALSE on read failure (the safer side: an outage should not
 * silently expand teacher privileges).
 */
export async function canTeachersSendWhatsapp(_supabase?: SupabaseClient): Promise<boolean> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
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
