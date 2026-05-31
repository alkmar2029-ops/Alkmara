// GET /api/me/persona — the current user's persona context.
//
// Lightweight endpoint: any authenticated user can call it (no flag
// gate), and the response is scoped strictly to their own row — the
// query filters by auth.uid() and uses the RLS-bound server client.
// Service-role is deliberately NOT used; this endpoint never reads
// other users' data.
//
// Frontend usage:
//   - hook `usePersona()` (م1.7a) wraps this with TanStack Query
//
// Middleware deliberately does NOT call this endpoint. Persona-based
// gating happens at the layout / page level (client-side after mount),
// not in the Edge runtime — keeps the middleware coarse (role-only via
// JWT claims) and avoids the latency / complexity of an internal fetch
// from inside middleware.
//
// Response defaults mirror the SQL helper current_user_persona():
//   - missing permissions JSONB    → persona='general_admin'
//   - missing user_profiles row    → role='viewer', persona='general_admin'
//   - vp_scope not set / invalid   → null
//
// Cache: 'no-store' for security. If an admin downgrades this user via
// م1.4, the next request must reflect it immediately — a stale 60s
// cache would leave the user with stale flags. The frontend's React
// Query layer provides the perceived snappiness via in-memory caching.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  isPersona,
  isVpScope,
  type Persona,
  type VpScope,
  type MePersonaResponse,
} from '@/lib/personas/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  // RLS-bound client. The user reading their own user_profiles row
  // passes the existing self-read policy — no service-role needed.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('user_id, role, full_name, permissions, vp_grade_scope')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'فشل قراءة بيانات الحساب: ' + error.message },
      { status: 500 },
    );
  }

  // Defensive defaults — a freshly-signed-up user might not have a
  // user_profiles row yet (depending on signup trigger timing).
  const perms = (profile?.permissions ?? {}) as Record<string, unknown>;
  const persona: Persona = isPersona(perms.persona)
    ? perms.persona
    : 'general_admin';
  const vp_scope: VpScope | null = isVpScope(perms.vp_scope)
    ? perms.vp_scope
    : null;

  // Strip the string keys (persona, vp_scope) — they're top-level
  // fields. Only boolean entries belong in the `permissions` map.
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(perms)) {
    if (typeof value === 'boolean') {
      flags[key] = value;
    }
  }

  const data: MePersonaResponse = {
    user_id: user.id,
    email: user.email ?? null,
    full_name: profile?.full_name ?? null,
    role: profile?.role ?? 'viewer',
    persona,
    vp_scope,
    vp_grade_scope: profile?.vp_grade_scope ?? null,
    permissions: flags,
  };

  return NextResponse.json(
    { data },
    {
      headers: {
        'Cache-Control': 'no-store',
        // Vary on Cookie because the response is fully personalized —
        // signals intermediate caches (CDN, etc.) not to share across users.
        Vary: 'Cookie',
      },
    },
  );
}
