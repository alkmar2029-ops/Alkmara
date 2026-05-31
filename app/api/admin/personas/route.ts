// GET /api/admin/personas — list admins with their persona + vp_scope +
// vp_grade_scope + permission flags. Powers the personas management UI
// at /dashboard/admin/personas.
//
// Restricted gate: only super_admin OR admins with the `manage_users`
// flag can call this. This is stricter than the rest of the admin API
// (which uses `is_admin()`) because a counselor — who keeps role='admin'
// with persona='counselor' inside permissions JSONB — must NOT be able
// to enumerate other admins' personas or change them.
//
// Response shape: identity + role + persona + vp_scope + vp_grade_scope
// + permissions + is_active. Deliberately omits phone / last_login_at /
// created_at to avoid leaking unnecessary data.

import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requireManageUsers } from '@/lib/personas/auth-gate';
import {
  isPersona,
  isVpScope,
  type PersonaListItem,
} from '@/lib/personas/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Gated to super_admin OR admins with manage_users flag. See the
  // shared helper for the two-gate logic (lib/personas/auth-gate.ts).
  // Refactored 2026-05-20 — was inline; centralised after م1.5 added a
  // 3rd usage that needed the same check.
  const auth = await requireManageUsers();
  if (!auth.ok) return auth.res;

  // Read all admins via the service-role client (bypasses RLS — same
  // pattern as /api/admins). RLS would block reading other admins'
  // rows when the caller is a plain admin, even one with manage_users.
  const admin = createAdminSupabaseClient();
  const { data: profiles, error } = await admin
    .from('user_profiles')
    .select('user_id, full_name, role, is_active, permissions, vp_grade_scope')
    .in('role', ['admin', 'super_admin'])
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'فشل جلب قائمة الأدوار: ' + error.message },
      { status: 500 },
    );
  }

  // Pull emails from auth.users for display. listUsers pages at 1000
  // which is more than any school will hit — same approach as /api/admins.
  const userIds = (profiles ?? []).map((p) => p.user_id);
  const emailMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersData?.users ?? []) {
      if (userIds.includes(u.id) && u.email) emailMap.set(u.id, u.email);
    }
  }

  // Shape the response: hoist persona/vp_scope from the JSONB to top-level
  // fields. The type guards fall back to safe defaults if the DB ever
  // contains a value outside the CHECK constraint (defensive — guards
  // survive constraint changes / pre-constraint legacy rows).
  const data: PersonaListItem[] = (profiles ?? []).map((p) => {
    const perms = (p.permissions ?? {}) as Record<string, unknown>;
    return {
      user_id: p.user_id,
      full_name: p.full_name,
      email: emailMap.get(p.user_id) ?? null,
      role: p.role as 'admin' | 'super_admin',
      is_active: p.is_active,
      persona: isPersona(perms.persona) ? perms.persona : 'general_admin',
      vp_scope: isVpScope(perms.vp_scope) ? perms.vp_scope : null,
      vp_grade_scope: p.vp_grade_scope ?? null,
      permissions: perms,
    };
  });

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
