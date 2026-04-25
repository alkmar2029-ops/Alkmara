import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from './server';

export type UserRole = 'admin' | 'staff' | 'viewer';

export interface AuthContext {
  userId: string;
  email: string | null;
  role: UserRole;
}

/**
 * Reads the current user's role from app_metadata (Supabase dashboard) or
 * falls back to the user_profiles table. Returns null if unauthenticated.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const metaRole = (user.app_metadata as { role?: string } | null)?.role;
  let role: UserRole = (metaRole === 'admin' || metaRole === 'staff' || metaRole === 'viewer')
    ? metaRole
    : 'viewer';

  if (!metaRole) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    const profileRole = profile?.role;
    if (profileRole === 'admin' || profileRole === 'staff' || profileRole === 'viewer') {
      role = profileRole;
    }
  }

  return { userId: user.id, email: user.email ?? null, role };
}

/**
 * Returns the AuthContext if the user has one of the allowed roles,
 * otherwise returns a NextResponse error to be returned from the API route.
 */
export async function requireRole(
  allowed: UserRole[],
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }> {
  const ctx = await getAuthContext();
  if (!ctx) {
    return { ok: false, res: NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 }) };
  }
  if (!allowed.includes(ctx.role)) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'لا تملك صلاحية تنفيذ هذه العملية' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, ctx };
}

/**
 * Best-effort audit log. Never throws — failures are swallowed so they don't
 * break the actual operation.
 */
export async function writeAuditLog(input: {
  ctx: AuthContext;
  action: string;
  targetType?: string;
  targetId?: string | number | null;
  details?: Record<string, unknown>;
  request?: Request;
}): Promise<void> {
  try {
    const supabase = await createServerSupabaseClient();
    const ip = input.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || input.request?.headers.get('x-real-ip')
      || null;
    await supabase.from('audit_logs').insert({
      user_id: input.ctx.userId,
      user_email: input.ctx.email,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId !== undefined && input.targetId !== null
        ? String(input.targetId)
        : null,
      details: input.details ?? null,
      ip_address: ip,
    });
  } catch {
    // Audit failures must not break the operation.
  }
}
