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
