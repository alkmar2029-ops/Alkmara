'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  Persona,
  VpScope,
  MePersonaResponse,
} from '@/lib/personas/types';

// Internal: fetch /api/me/persona and unwrap the envelope. A 401 (not
// signed in) resolves to `null` rather than throwing so React Query's
// error state stays clean — the UI just renders "logged out" branches.
async function fetchPersona(): Promise<MePersonaResponse | null> {
  const r = await fetch('/api/me/persona');
  if (r.status === 401) return null;
  if (!r.ok) {
    throw new Error(`فشل جلب بيانات الحساب (${r.status})`);
  }
  const body = (await r.json()) as { data?: MePersonaResponse; error?: string };
  return body.data ?? null;
}

export interface UsePersonaResult {
  /** Raw response (or null while loading / when signed-out). */
  data: MePersonaResponse | null;
  isLoading: boolean;
  /** Always-defined persona — falls back to 'general_admin' so callers don't need null-checks. */
  persona: Persona;
  /** VP scope, or null when the user isn't a VP. */
  vp_scope: VpScope | null;
  /** True for role IN ('admin','super_admin'). The minimum bar to see admin UI. */
  isAdmin: boolean;
  /** True only for role='super_admin'. */
  isSuperAdmin: boolean;
  /** True when persona='counselor' AND role is admin/super_admin. */
  isCounselor: boolean;
  /** True when persona='vice_principal' AND role is admin/super_admin. */
  isVicePrincipal: boolean;
  /**
   * Returns true when the user has the given permission flag enabled.
   * Performs a defensive role check first — a viewer whose JSONB
   * somehow carries flags still returns false. Use this for ALL
   * flag-based UI gating; never read data.permissions[flag] directly.
   */
  can: (flag: string) => boolean;
}

/**
 * Persona context for the current user, with derived helpers.
 *
 * Defaults match the SQL helper current_user_persona():
 *   role 'viewer' + persona 'general_admin' for unauthenticated /
 *   missing-profile users. Every gate (isAdmin / can / isCounselor /
 *   isVicePrincipal) returns false for those defaults — fail-closed.
 *
 * Caching: 5-minute staleTime in React Query (persona rarely changes
 * mid-session). The server endpoint sends Cache-Control: no-store, so
 * any explicit refetch — or remount after staleTime — gets fresh data.
 */
export function usePersona(): UsePersonaResult {
  const { data, isLoading } = useQuery({
    queryKey: ['me', 'persona'],
    queryFn: fetchPersona,
    // 5 min stale — matches useMyAssignedSections convention.
    staleTime: 5 * 60_000,
    // Keep cached across mounts (page navs) for half an hour.
    gcTime: 30 * 60_000,
  });

  // Role gate: precomputed once per render so the derived booleans
  // and the `can` closure share the same check.
  const isAdminRole = data?.role === 'admin' || data?.role === 'super_admin';

  // useCallback so `can` keeps a stable identity across renders when
  // the underlying data is unchanged. Without this, consumers that
  // place `can` in a useMemo/useEffect dependency array would re-run
  // on every parent render. TanStack Query's structural sharing keeps
  // `data` stable when the network response is identical.
  const can = useCallback(
    (flag: string): boolean => {
      if (!isAdminRole) return false;
      return data?.permissions[flag] === true;
    },
    [isAdminRole, data],
  );

  return {
    data: data ?? null,
    isLoading,
    persona: data?.persona ?? 'general_admin',
    vp_scope: data?.vp_scope ?? null,
    isAdmin: isAdminRole,
    isSuperAdmin: data?.role === 'super_admin',
    // Persona checks require an admin role on top — protects against a
    // viewer with fallback persona='general_admin' being mistaken for
    // an actual admin.
    isCounselor: isAdminRole && data?.persona === 'counselor',
    isVicePrincipal: isAdminRole && data?.persona === 'vice_principal',
    can,
  };
}

/**
 * Convenience wrapper for components that only check a single flag.
 * Equivalent to `usePersona().can(flag)` but reads cleaner at the call
 * site:
 *
 *     const canSubstitute = useCan('manage_substitutions');
 *     if (canSubstitute) {  ... }
 */
export function useCan(flag: string): boolean {
  return usePersona().can(flag);
}
