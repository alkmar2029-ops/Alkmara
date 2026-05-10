import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthContext } from '@/lib/supabase/auth';

/**
 * canManageSupervision — true if the current user can edit supervision
 * locations + assignments. super_admin always; other admins need the
 * `manage_schedule` permission flag in user_profiles.permissions.
 *
 * Pass in the Supabase admin client so the lookup bypasses RLS — we read
 * permissions from user_profiles which is privileged.
 */
export async function canManageSupervision(
  ctx: AuthContext,
  admin: SupabaseClient,
): Promise<boolean> {
  if (ctx.role === 'super_admin') return true;
  if (ctx.role !== 'admin') return false;
  const { data } = await admin
    .from('user_profiles')
    .select('permissions')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  const perms = (data?.permissions || {}) as Record<string, boolean>;
  return !!perms.manage_schedule;
}
