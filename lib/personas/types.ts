// Shared constants + types for the persona system.
//
// Lives here (not in route.ts) because Next.js App Router routes should
// only export HTTP handlers + route config (`dynamic`, `runtime`, ...).
// Extra named exports from a route.ts can trip newer Next.js type
// checks or be lost from the public type surface during build.
//
// Used by:
//   - app/api/admin/personas/route.ts                — م1.3 (GET list)
//   - app/api/admin/users/[id]/persona/route.ts     — م1.4 (PATCH)
//   - app/dashboard/admin/personas/page.tsx          — UI (later in م1)
//   - lib/auth/use-persona.ts                        — client hook (م1.12)
//
// Values mirror the DB CHECK constraints in
// supabase/migrations/2026_05_20_extend_permissions.sql.
// Keep in sync — a typo here = silent UI bug; a typo in DB = INSERT
// rejected at write time.

export const PERSONA_VALUES = [
  'principal',
  'vice_principal',
  'counselor',
  'general_admin',
] as const;

export type Persona = (typeof PERSONA_VALUES)[number];

export const VP_SCOPE_VALUES = [
  'academic',
  'administrative',
  'student_affairs',
  'general',
] as const;

export type VpScope = (typeof VP_SCOPE_VALUES)[number];

// Shape returned by GET /api/admin/personas. Persona-specific fields are
// hoisted from the permissions JSONB to top level so the UI doesn't need
// to know the JSONB layout.
export interface PersonaListItem {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: 'admin' | 'super_admin';
  is_active: boolean;
  persona: Persona;
  vp_scope: VpScope | null;
  vp_grade_scope: number[] | null;
  // Full granular flags map (10 existing + 13 new — see migration comments).
  permissions: Record<string, unknown>;
}

// Shape returned by GET /api/me/persona — what THIS user is. The frontend
// hook usePersona() consumes this. Compared to PersonaListItem:
//  - `role` is a string (any UserRole, not narrowed to admin)
//  - `permissions` is strictly boolean-keyed (string keys like persona/
//    vp_scope are filtered out — they're surfaced as top-level fields).
export interface MePersonaResponse {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  persona: Persona;
  vp_scope: VpScope | null;
  vp_grade_scope: number[] | null;
  permissions: Record<string, boolean>;
}

// Arabic display labels — used wherever the UI needs to show the
// persona/scope to a user (admin screen, sidebar headers, etc.).
export const PERSONA_LABELS: Record<Persona, string> = {
  principal:      'مدير المدرسة',
  vice_principal: 'وكيل',
  counselor:      'مرشد طلابي',
  general_admin:  'إداري عام',
};

export const VP_SCOPE_LABELS: Record<VpScope, string> = {
  academic:        'الشؤون التعليمية',
  administrative:  'الشؤون الإدارية',
  student_affairs: 'شؤون الطلاب',
  general:         'عام',
};

// Type guards — narrow unknown values from the DB / API safely.
// Used in the GET handler to fall back to 'general_admin' / null when
// the DB has a value that's outside the validated set (defensive: the
// CHECK constraint should prevent this, but guards survive constraint
// changes).
export function isPersona(v: unknown): v is Persona {
  return typeof v === 'string' && (PERSONA_VALUES as readonly string[]).includes(v);
}

export function isVpScope(v: unknown): v is VpScope {
  return typeof v === 'string' && (VP_SCOPE_VALUES as readonly string[]).includes(v);
}

// ===========================================================================
// Permission flag keys added by 2026_05_20_extend_permissions.sql
// ===========================================================================
// The existing 10 flags live in lib/validations/schemas.ts as PERMISSION_KEYS.
// These NEW flags + the existing ones = the full allowed flag set inside
// user_profiles.permissions JSONB (alongside the special string keys
// `persona` and `vp_scope`, which have dedicated top-level API treatment).
//
// API validators combine PERMISSION_KEYS + NEW_PERSONA_FLAG_KEYS into one
// allowlist and reject any key outside it — this prevents JSONB pollution
// from typos like { manage_substitution: true } (missing trailing 's').

// 4 flags — vice principal capabilities
export const VP_FLAG_KEYS = [
  'manage_substitutions',
  'manage_incidents',
  'approve_teacher_leave',
  'view_morning_dashboard',
] as const;

// 7 flags — counselor capabilities
export const COUNSELOR_FLAG_KEYS = [
  'manage_counseling_sessions',
  'manage_cases',
  'manage_followup_plans',
  'view_confidential_notes',
  'view_health_info',
  'view_social_info',
  'view_risk_watchlist',
] as const;

// 2 flags — shared between VP-student and Counselor
export const SHARED_PERSONA_FLAG_KEYS = [
  'review_teacher_incidents',
  'escalate_to_case',
] as const;

// 1 flag — principal-level aggregate reports (Sprint 6 / م6.3).
// SCOPE BOUNDARY (DB-anchored in 2026_07_05_001_school_reports_flag.sql):
// aggregates only، k-anonymity n>=5، لا أسماء، لا top-N، لا content.
// Any future drill-down/section-level/by-counselor expansion needs a
// separate privacy review and likely a separate flag.
export const PRINCIPAL_FLAG_KEYS = [
  'view_school_reports',
] as const;

// 14 new flags total (4 + 7 + 2 + 1). Combined with the legacy 10 = 24 booleans.
export const NEW_PERSONA_FLAG_KEYS = [
  ...VP_FLAG_KEYS,
  ...COUNSELOR_FLAG_KEYS,
  ...SHARED_PERSONA_FLAG_KEYS,
  ...PRINCIPAL_FLAG_KEYS,
] as const;

export type NewPersonaFlagKey = (typeof NEW_PERSONA_FLAG_KEYS)[number];

// Arabic UI labels for the 13 new flags. Mirrors the shape used by the
// legacy PERMISSION_LABELS in lib/validations/schemas.ts (label + emoji),
// so the personas admin page can render both sets uniformly.
export const NEW_PERSONA_FLAG_LABELS: Record<NewPersonaFlagKey, { label: string; emoji: string }> = {
  // VP capabilities
  manage_substitutions:       { label: 'توزيع حصص الانتظار',         emoji: '🔄' },
  manage_incidents:           { label: 'مراجعة المخالفات',             emoji: '⚠️' },
  approve_teacher_leave:      { label: 'موافقة على إجازات المعلمين',   emoji: '🏖️' },
  view_morning_dashboard:     { label: 'لوحة الصباح',                  emoji: '🌅' },
  // Counselor capabilities
  manage_counseling_sessions: { label: 'جلسات الإرشاد',                emoji: '👥' },
  manage_cases:               { label: 'إدارة الحالات',                emoji: '📋' },
  manage_followup_plans:      { label: 'خطط المتابعة',                 emoji: '📝' },
  view_confidential_notes:    { label: 'الملاحظات السرية',             emoji: '🔒' },
  view_health_info:           { label: 'المعلومات الصحية للطلاب',      emoji: '🏥' },
  view_social_info:           { label: 'المعلومات الاجتماعية للطلاب',  emoji: '👨‍👩‍👧' },
  view_risk_watchlist:        { label: 'قائمة المتابعة (Risk Score)',  emoji: '🚨' },
  // Shared (VP-student_affairs + counselor)
  review_teacher_incidents:   { label: 'مراجعة مخالفات المعلمين',       emoji: '👁️' },
  escalate_to_case:           { label: 'تصعيد مخالفة إلى حالة',        emoji: '⬆️' },
  // Principal capabilities
  view_school_reports:        { label: 'تقارير المدرسة الإجمالية',      emoji: '📊' },
};
