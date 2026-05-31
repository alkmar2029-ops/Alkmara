-- Hardening fixes for the persona helper functions and constraints.
-- Applies after 2026_05_20_extend_permissions.sql and 2026_05_20_counselor_assignments.sql.
--
-- Three fixes after Codex Sprint 1 review:
--
-- 1. current_user_has_flag() used (permissions ->> flag)::boolean directly.
--    A non-'true'/'false' value (e.g. {"manage_users": "abc"} from a typo
--    or legacy import) raises a runtime cast error, taking down ANY RLS
--    policy that calls the helper. The fix compares the JSONB value
--    directly against 'true'::jsonb after a typeof check — safe against
--    any value, never throws.
--
-- 2. current_user_is_counselor() returned TRUE whenever persona='counselor'
--    appeared in the JSONB, even if the user had been demoted out of an
--    admin role. The leftover persona key in permissions would let them
--    keep counseling visibility in any code that branches on the helper.
--    Adds an explicit role IN ('admin','super_admin') filter.
--
-- 3. CHECK constraint enforcing persona='vice_principal' implies a
--    non-null vp_scope string. The API rejects this state in the PATCH
--    handler (م1.4), but a direct DB write or an admin script could
--    leave the row inconsistent. Defense in depth.

-- ============= 1. Safe boolean check for current_user_has_flag =============
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
          AND jsonb_typeof(permissions -> flag) = 'boolean'
          THEN (permissions -> flag) = 'true'::jsonb
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
  'Returns TRUE if the current user has the given permission flag set to true. Safe against non-boolean JSONB values — returns FALSE on type mismatch, missing flag, or missing user_profiles row. Never raises a cast error.';

-- ============= 2. current_user_is_counselor with role gate =============
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
      -- Role gate first — a demoted user whose JSONB still carries
      -- persona='counselor' must NOT be treated as a counselor.
      AND role IN ('admin', 'super_admin')
      AND (permissions ->> 'persona') = 'counselor'
  );
$$;

COMMENT ON FUNCTION current_user_is_counselor() IS
  'Returns TRUE if the current user is role admin/super_admin AND persona=counselor. The role gate prevents demoted users with stale persona keys from being treated as counselors.';

-- ============= 3. VP requires vp_scope (DB-level enforcement) =============
-- Drop first for idempotency (re-running the migration won't fail).
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_vp_scope_required;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_vp_scope_required
  CHECK (
    permissions IS NULL
    OR NOT (permissions ? 'persona')
    OR (permissions ->> 'persona') != 'vice_principal'
    OR (
      permissions ? 'vp_scope'
      AND jsonb_typeof(permissions -> 'vp_scope') = 'string'
    )
  );

COMMENT ON CONSTRAINT user_profiles_vp_scope_required ON user_profiles IS
  'persona=vice_principal must come with a string vp_scope. Other personas may omit vp_scope. Defense in depth against direct DB writes that bypass the PATCH API.';
