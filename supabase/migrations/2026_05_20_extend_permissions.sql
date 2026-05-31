-- Extend per-user permissions with a persona identifier + role-specific flags.
--
-- BEFORE: user_profiles.permissions held 10 granular boolean flags for admins
-- (take_attendance, manage_dismissals, etc.). Every admin was effectively
-- equivalent — the principal could only differentiate them by which flags
-- they granted.
--
-- AFTER: a `persona` key identifies what KIND of admin a user is
-- (principal / vice_principal / counselor / general_admin). The frontend
-- routes them to different dashboards based on persona, and `vp_scope`
-- further differentiates vice principals by their area of responsibility
-- (academic / administrative / student_affairs / general).
--
-- A new column `vp_grade_scope INTEGER[]` lets the school have multiple
-- vice principals of the same vp_scope, each responsible for different
-- grade ranges. NULL = all grades. (Codex review note: this array column
-- is acceptable for the soft UI gate only — if RLS ever needs to filter
-- on grade scope, replace with a relational vp_grade_assignments table.)
--
-- This migration only adds new OPTIONAL keys + one new column + helper
-- functions + lightweight CHECK constraints + GRANTs. Existing admins
-- keep working with no behaviour change — they default to
-- persona="general_admin" via COALESCE in the helper.
--
-- New keys in permissions (all booleans, default false unless noted):
--
--   persona:  'principal' | 'vice_principal' | 'counselor' | 'general_admin'
--   vp_scope: 'academic' | 'administrative' | 'student_affairs' | 'general'
--
--   -- VP capabilities (4)
--   manage_substitutions       — توزيع حصص الانتظار
--   manage_incidents           — مراجعة المخالفات (VP الطلابي)
--   approve_teacher_leave      — موافقة على إجازات المعلمين
--   view_morning_dashboard     — لوحة الصباح
--
--   -- Counselor capabilities (7)
--   manage_counseling_sessions — جلسات الإرشاد
--   manage_cases               — إنشاء وإدارة الحالات
--   manage_followup_plans      — خطط متابعة الطلاب
--   view_confidential_notes    — قراءة الملاحظات السرية
--   view_health_info           — معلومات صحية للطلاب
--   view_social_info           — معلومات اجتماعية للطلاب
--   view_risk_watchlist        — قائمة الطلاب المعرضين للخطر
--
--   -- Shared capabilities (2)
--   review_teacher_incidents   — مراجعة مخالفات المعلمين
--   escalate_to_case           — ترقية مخالفة إلى حالة

-- ============= 1. New column: vp_grade_scope =============
-- For schools with multiple VPs of the same vp_scope. Example: two
-- academic VPs, one for primary grades, another for intermediate.
-- NULL means "all grades" (the common case).
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS vp_grade_scope INTEGER[] DEFAULT NULL;

COMMENT ON COLUMN user_profiles.vp_grade_scope IS
  'For VPs assigned to a subset of grades. NULL = all grades. NOTE: this is a soft UI gate only. If grade-scoped RLS is needed later, replace with a relational vp_grade_assignments table (no FK guarantees today).';

-- ============= 2. Update permissions column documentation =============
COMMENT ON COLUMN user_profiles.permissions IS
  'JSONB capability flags + persona identifier for admins.

Persona keys (string):
  persona:  "principal" | "vice_principal" | "counselor" | "general_admin"
  vp_scope: "academic" | "administrative" | "student_affairs" | "general"

Existing flags (10, all bool):
  take_attendance, manage_dismissals, write_notes, send_whatsapp,
  view_reports, manage_students, manage_users, override_pickup,
  manage_schedule, manage_settings

VP flags (4, all bool):
  manage_substitutions, manage_incidents, approve_teacher_leave,
  view_morning_dashboard

Counselor flags (7, all bool):
  manage_counseling_sessions, manage_cases, manage_followup_plans,
  view_confidential_notes, view_health_info, view_social_info,
  view_risk_watchlist

Shared flags (2, all bool):
  review_teacher_incidents, escalate_to_case

Persona/vp_scope values are protected by CHECK constraints (see below).
NULL permissions = teacher/super_admin (implicit) or pre-personas legacy
admin (the helper defaults to persona="general_admin").';

-- ============= 3. CHECK constraints — guard persona/vp_scope values =============
-- Without these, a typo in the JSONB (e.g. "councilor") silently breaks
-- routing without any DB-level error. The check is permissive: NULL,
-- key-absent, and valid-value all pass; only present-but-wrong fails.

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_persona_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_persona_check
  CHECK (
    permissions IS NULL
    OR NOT (permissions ? 'persona')
    OR (permissions ->> 'persona') IN (
      'principal', 'vice_principal', 'counselor', 'general_admin'
    )
  );

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_vp_scope_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_vp_scope_check
  CHECK (
    permissions IS NULL
    OR NOT (permissions ? 'vp_scope')
    OR (permissions ->> 'vp_scope') IN (
      'academic', 'administrative', 'student_affairs', 'general'
    )
  );

-- ============= 4. Helper functions =============
--
-- All four functions are SECURITY DEFINER + STABLE + SET search_path,
-- matching the project's existing pattern (is_admin, is_super_admin,
-- current_user_role). SECURITY DEFINER is required here because these
-- functions read user_profiles which has RLS — without SECURITY DEFINER
-- they would either need an "I can read my own row" policy (which the
-- existing one is) or risk silent NULLs if that policy ever tightens.
--
-- The COALESCE wraps the entire scalar subquery so a missing user_profiles
-- row returns the documented default ('general_admin' / FALSE) instead
-- of NULL. (Codex review fix: previously the COALESCE was inside the
-- SELECT, which only handled present-row+null-value, not missing-row.)

-- ---- current_user_persona() ----
CREATE OR REPLACE FUNCTION current_user_persona()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT permissions ->> 'persona'
      FROM public.user_profiles
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    'general_admin'
  );
$$;

COMMENT ON FUNCTION current_user_persona() IS
  'Returns auth.uid()''s persona from user_profiles.permissions. Defaults to "general_admin" for legacy admins, missing rows, or missing key — never NULL.';

-- ---- current_user_has_flag(flag) ----
CREATE OR REPLACE FUNCTION current_user_has_flag(flag TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN permissions ? flag
          THEN COALESCE((permissions ->> flag)::boolean, FALSE)
        ELSE FALSE
      END
      FROM public.user_profiles
      WHERE user_id = auth.uid()
      LIMIT 1
    ),
    FALSE
  );
$$;

COMMENT ON FUNCTION current_user_has_flag(TEXT) IS
  'Returns TRUE if the current user has the given permission flag set to true. Returns FALSE for missing flag, missing user_profiles row, or non-boolean value — never NULL.';

-- ---- current_user_vp_scope() ----
-- Returns NULL ONLY when the user is not a VP — that NULL is the signal
-- RLS policies use to gate VP-only screens. (Other helpers default to a
-- safe non-NULL value, but here NULL is meaningful.)
CREATE OR REPLACE FUNCTION current_user_vp_scope()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT permissions ->> 'vp_scope'
  FROM public.user_profiles
  WHERE user_id = auth.uid()
    AND (permissions ->> 'persona') = 'vice_principal'
  LIMIT 1;
$$;

COMMENT ON FUNCTION current_user_vp_scope() IS
  'Returns the current VP user''s scope. NULL if user is not a vice_principal — that NULL is the gate condition in VP RLS policies.';

-- ---- current_user_is_counselor() ----
CREATE OR REPLACE FUNCTION current_user_is_counselor()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND (permissions ->> 'persona') = 'counselor'
  );
$$;

COMMENT ON FUNCTION current_user_is_counselor() IS
  'Returns TRUE if the current user has persona="counselor". Convenience wrapper around current_user_persona() for cleaner RLS expressions.';

-- ============= 5. GRANT EXECUTE to authenticated =============
-- Required for the functions to be callable from RLS policies under the
-- Supabase authenticated role. Without GRANT, policies fail with
-- "permission denied for function" at query time.

GRANT EXECUTE ON FUNCTION current_user_persona()        TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_has_flag(TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_vp_scope()       TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_is_counselor()   TO authenticated;
