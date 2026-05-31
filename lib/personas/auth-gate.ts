// Shared auth gate for persona/counselor-assignment management endpoints.
//
// Stricter than the project's default `requireRole(['admin'])` because
// counselors keep role='admin' (with persona='counselor' inside the
// JSONB). is_admin() / requireRole(['admin']) lets them through, which
// would defeat the entire persona separation. This gate enforces:
//
//   1. authenticated + role='admin' or 'super_admin'
//   2. EITHER role='super_admin' OR permissions.manage_users === true
//
// Used by:
//   - GET    /api/admin/personas                  (م1.3)
//   - PATCH  /api/admin/users/[id]/persona       (م1.4)
//   - GET    /api/admin/counselor-assignments    (م1.5)
//   - POST   /api/admin/counselor-assignments    (م1.5)
//   - DELETE /api/admin/counselor-assignments/[id] (م1.5)

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireRole, type AuthContext } from '@/lib/supabase/auth';

export async function requireManageUsers(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }
> {
  // Gate 1: JWT-side role check. requireRole prefers app_metadata.role
  // (cheap) and falls back to user_profiles. super_admin passes any
  // requireRole call.
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth;

  // Gate 2: re-confirm role + manage_users from the DB. (Codex Sprint 1
  // review — high severity fix.) The JWT app_metadata.role can lag
  // behind user_profiles.role if a recent demotion didn't trigger a
  // token refresh. Without re-checking the DB role here, a user whose
  // token still claims 'admin' AND whose permissions still carry
  // manage_users=true could keep editing personas after being demoted.
  // Reading role + permissions in one query keeps it to a single round
  // trip.
  const supabase = await createServerSupabaseClient();
  const { data: caller } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('user_id', auth.ctx.userId)
    .maybeSingle();

  // No row, or role no longer in the admin family → reject. Note this
  // is the AUTHORITATIVE check; the JWT role above is just the cheap
  // first filter.
  if (!caller || (caller.role !== 'admin' && caller.role !== 'super_admin')) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'لا تملك صلاحية إدارة الأدوار' },
        { status: 403 },
      ),
    };
  }

  // Return a NORMALISED ctx that carries the AUTHORITATIVE role from
  // the DB — not the JWT role from requireRole(). The JWT can be stale
  // (app_metadata cached past a demotion/promotion), and downstream
  // callers branch on ctx.role to decide super_admin-only paths
  // (e.g. PATCH user persona refuses to edit a super_admin unless the
  // caller is one). Without this normalisation, a stale JWT claiming
  // super_admin would let a plain admin escalate. (Codex Sprint 1
  // review — critical fix.)
  const ctx: AuthContext = {
    ...auth.ctx,
    role: caller.role as 'admin' | 'super_admin',
  };

  // super_admin always passes — flag check below is for plain admins.
  if (caller.role === 'super_admin') {
    return { ok: true, ctx };
  }

  const callerPerms = (caller.permissions ?? {}) as Record<string, unknown>;
  if (callerPerms.manage_users !== true) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'لا تملك صلاحية إدارة الأدوار (يلزم manage_users)' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, ctx };
}

// ===========================================================================
// requireAdminWithFlag — generalised gate for VP / counselor flags
// ===========================================================================
// Same shape as requireManageUsers but parameterised on the flag and the
// Arabic error message. Used by VP endpoints (م2.4+) which gate on
// view_morning_dashboard / manage_substitutions / approve_teacher_leave.
//
// IMPORTANT: same DB-role re-check pattern as requireManageUsers — must
// return a normalised ctx with the AUTHORITATIVE role, not the original
// auth.ctx (stale JWT defence). Codex Sprint 1 critical fix applies here
// too.

export async function requireAdminWithFlag(
  flag: string,
  errorMsg: string,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }> {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth;

  const supabase = await createServerSupabaseClient();
  const { data: caller } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('user_id', auth.ctx.userId)
    .maybeSingle();

  if (!caller || (caller.role !== 'admin' && caller.role !== 'super_admin')) {
    return {
      ok: false,
      res: NextResponse.json({ error: errorMsg }, { status: 403 }),
    };
  }

  const ctx: AuthContext = {
    ...auth.ctx,
    role: caller.role as 'admin' | 'super_admin',
  };

  if (caller.role === 'super_admin') {
    return { ok: true, ctx };
  }

  const callerPerms = (caller.permissions ?? {}) as Record<string, unknown>;
  if (callerPerms[flag] !== true) {
    return {
      ok: false,
      res: NextResponse.json({ error: errorMsg }, { status: 403 }),
    };
  }
  return { ok: true, ctx };
}

// Convenience: VP dashboard / operational endpoints (م2.4-م2.11).
// Equivalent to requireAdminWithFlag('view_morning_dashboard', '...').
export const requireVpDashboard = () =>
  requireAdminWithFlag(
    'view_morning_dashboard',
    'لا تملك صلاحية لوحة الوكيل (يلزم view_morning_dashboard)',
  );

// Convenience: substitution write endpoints (POST /vp/absences,
// /vp/substitutions/assign, ...). Mirrors the SQL RLS gate on
// daily_teacher_absences and substitution_assignments.
export const requireManageSubstitutions = () =>
  requireAdminWithFlag(
    'manage_substitutions',
    'لا تملك صلاحية إدارة حصص الانتظار (يلزم manage_substitutions)',
  );

// Convenience: teacher leave decision endpoint (PATCH
// /vp/teacher-leaves/[id]/decision). Mirrors the SQL RLS gate on
// teacher_leaves UPDATE policy.
export const requireApproveTeacherLeave = () =>
  requireAdminWithFlag(
    'approve_teacher_leave',
    'لا تملك صلاحية الموافقة على الإجازات (يلزم approve_teacher_leave)',
  );

// ===========================================================================
// requireIncidentsQueue — review-queue access for م3.6 + related views
// ===========================================================================
// The incidents review queue is read by either:
//   - holders of the review_teacher_incidents flag (VPs, principals,
//     admins granted explicit review authority), OR
//   - counselors (persona='counselor') — they see incidents in their
//     counselor_assignments scope per RLS, and need read access to
//     the queue UI to triage incidents that touch their students.
//
// Action endpoints (dismiss/action/escalate — م3.7-م3.9) tighten this
// to flag holders ONLY via requireAdminWithFlag('review_teacher_incidents').
// Counselors can READ the queue but cannot decide.
//
// Same defence-in-depth pattern as requireAdminWithFlag: re-read
// role + permissions from DB so a stale JWT can't escalate. Persona
// lives INSIDE the permissions JSONB (not a separate column — see
// 2026_05_20_extend_permissions.sql), so we read it via the JSONB
// key after the SELECT.

export async function requireIncidentsQueue(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }
> {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth;

  const supabase = await createServerSupabaseClient();
  const { data: caller } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('user_id', auth.ctx.userId)
    .maybeSingle();

  if (!caller || (caller.role !== 'admin' && caller.role !== 'super_admin')) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'لا تملك صلاحية عرض قائمة مراجعة المخالفات' },
        { status: 403 },
      ),
    };
  }

  // Normalised ctx with DB role (Codex Sprint 1 critical fix —
  // never trust the JWT role for downstream branching).
  const ctx: AuthContext = {
    ...auth.ctx,
    role: caller.role as 'admin' | 'super_admin',
  };

  if (caller.role === 'super_admin') {
    return { ok: true, ctx };
  }

  // persona is a JSONB key inside permissions, not a column. Same
  // shape as the SQL helper current_user_persona() which reads
  // `permissions ->> 'persona'`.
  const perms = (caller.permissions ?? {}) as Record<string, unknown>;
  const hasReviewFlag = perms.review_teacher_incidents === true;
  const isCounselor = perms.persona === 'counselor';

  if (!hasReviewFlag && !isCounselor) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error:
            'لا تملك صلاحية عرض قائمة مراجعة المخالفات (يلزم review_teacher_incidents أو persona=counselor)',
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, ctx };
}

// ===========================================================================
// requireCounselorWorkspace — gate for the counselor home (م4.18 +)
// ===========================================================================
// Allows super_admin OR persona='counselor'. Specifically does NOT include
// view_confidential_notes flag holders — that flag is for read-only oversight
// surfaces (a separate Sprint 5+ screen), not the counselor's daily
// workspace. Mixing the two would blur operational surfaces and put a
// principal's oversight UI into the same place a counselor is writing
// confidential notes.
//
// Same defence-in-depth pattern as requireIncidentsQueue: re-read role +
// permissions from DB so a stale JWT app_metadata.role can't escalate.
//
// Used by:
//   - GET /api/counselor/workspace-summary  (م4.18)
//   - GET /api/counselor/cases             (م4.19 — incoming)
//   - GET /api/counselor/cases/[id]        (م4.20 — incoming)

export async function requireCounselorWorkspace(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }
> {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth;

  const supabase = await createServerSupabaseClient();
  const { data: caller } = await supabase
    .from('user_profiles')
    .select('role, permissions')
    .eq('user_id', auth.ctx.userId)
    .maybeSingle();

  if (!caller || (caller.role !== 'admin' && caller.role !== 'super_admin')) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'لا تملك صلاحية لوحة المرشد' },
        { status: 403 },
      ),
    };
  }

  // Normalised ctx with DB role (Codex Sprint 1 critical fix).
  const ctx: AuthContext = {
    ...auth.ctx,
    role: caller.role as 'admin' | 'super_admin',
  };

  if (caller.role === 'super_admin') {
    return { ok: true, ctx };
  }

  const perms = (caller.permissions ?? {}) as Record<string, unknown>;
  if (perms.persona !== 'counselor') {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error:
            'لا تملك صلاحية لوحة المرشد (يلزم persona=counselor)',
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, ctx };
}

// ===========================================================================
// requireSchoolReports — principal aggregate report surface (م6.3)
// ===========================================================================
// Gates access to the school-wide aggregate report endpoint (and any future
// surface bound to the same privacy boundary). Allows:
//
//   - super_admin (always)
//   - admin/super_admin with `permissions.view_school_reports === true`
//
// IMPORTANT — what this flag is NOT a license to do:
//
//   - read student names (no drill-down, no top-N)
//   - read counselor-attributed activity (deanonymization risk)
//   - read confidential note CONTENT (that's view_confidential_notes,
//     a SEPARATE flag still gated behind a privacy review)
//   - read per-section breakdowns (only per-grade in v1, with k>=5)
//   - read average risk scores (only buckets)
//
// Those constraints live in 2026_07_05_001_school_reports_flag.sql as
// the canonical DB-anchored policy. Endpoints under this gate must
// enforce them in code (k-anonymity is computed in the API handler,
// not delegated to the caller). This helper only ensures the caller
// HAS the flag — the privacy boundary is the endpoint's responsibility.
//
// Returns a normalised ctx with the authoritative role (defence in
// depth: requireAdminWithFlag re-reads role + permissions from DB so a
// stale JWT can't bypass).

export async function requireSchoolReports(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }
> {
  return requireAdminWithFlag(
    'view_school_reports',
    'لا تملك صلاحية تقارير المدرسة الإجمالية (يلزم view_school_reports)',
  );
}

// ===========================================================================
// requireSuperAdmin — strictly super_admin only (no flag, no persona)
// ===========================================================================
// Used by system/operator endpoints that aren't part of a user workflow:
//   - POST /api/admin/risk-scores/sweep (м5.5)
//   - (future) admin tooling that mutates derived state across personas
//
// Same defence-in-depth pattern as requireIncidentsQueue: re-read role
// from DB so a stale JWT app_metadata.role can't escalate. Returns a
// normalised ctx with the authoritative role.

export async function requireSuperAdmin(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; res: NextResponse }
> {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth;

  const supabase = await createServerSupabaseClient();
  const { data: caller } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', auth.ctx.userId)
    .maybeSingle();

  if (!caller || caller.role !== 'super_admin') {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'هذه العملية متاحة لـ super_admin فقط' },
        { status: 403 },
      ),
    };
  }

  const ctx: AuthContext = {
    ...auth.ctx,
    role: 'super_admin',
  };
  return { ok: true, ctx };
}
