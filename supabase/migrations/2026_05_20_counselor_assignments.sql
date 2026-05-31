-- Counselor → student scope assignments + RLS helper.
--
-- A counselor's authority is limited to students assigned to them. Without
-- this, a counselor would either see all students (privacy violation) or
-- none (useless). The pattern mirrors teacher_section_assignments
-- (2026_04_29) — admin-managed grant, read-only for the counselor.
--
-- Assignment granularity:
--   - grade-wide:   grade_id NOT NULL, section_id NULL
--                   counselor sees ALL sections under that grade
--   - section-only: grade_id NULL, section_id NOT NULL
--                   counselor sees ONLY that specific section
--
-- A CHECK constraint enforces EXACTLY ONE of grade_id / section_id is set.
-- Multiple assignments per counselor are allowed (e.g., grade 4 + grade 5
-- + section 12). Multiple counselors per grade/section also allowed (e.g.,
-- one primary + one substitute counselor).
--
-- The companion function `counselor_can_see_student(student_id)` is the
-- single authoritative gate used by RLS on:
--   - student_cases               (المرحلة 4)
--   - counseling_sessions         (المرحلة 4)
--   - student_followup_plans      (المرحلة 4)
--   - student_risk_scores         (المرحلة 5)
--   - student_notes (confidential) (المرحلة 4 — patch on existing)
-- It enforces TWO conditions: caller IS a counselor AND has matching
-- assignment. Calling code never needs to check both separately.

-- ============= 1. Table =============
CREATE TABLE IF NOT EXISTS counselor_assignments (
  id                  BIGSERIAL PRIMARY KEY,
  counselor_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grade_id            INTEGER REFERENCES grades(id) ON DELETE CASCADE,
  section_id          INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  assigned_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exactly one of grade_id / section_id must be set, never both, never
  -- neither. This is what differentiates a grade-wide assignment from a
  -- section-only one — and lets the RLS function branch on which is NULL.
  CONSTRAINT counselor_assignments_scope_xor CHECK (
    (grade_id IS NOT NULL AND section_id IS NULL)
    OR (grade_id IS NULL AND section_id IS NOT NULL)
  )
);

COMMENT ON TABLE counselor_assignments IS
  'Scope of students each counselor can see/manage. Either grade-wide OR section-only per row (CHECK enforced). Multiple rows per counselor allowed.';

COMMENT ON COLUMN counselor_assignments.grade_id IS
  'NULL if assignment is section-specific. Set for grade-wide coverage (counselor sees all sections under this grade).';

COMMENT ON COLUMN counselor_assignments.section_id IS
  'NULL if assignment is grade-wide. Set for single-section coverage.';

-- ============= 2. Indexes =============
-- Uniqueness: a counselor can't be assigned to the same grade twice
-- (or the same section twice). Partial indexes because the WHERE
-- conditions are mutually exclusive due to the XOR check.
CREATE UNIQUE INDEX IF NOT EXISTS counselor_assignments_grade_uq
  ON counselor_assignments (counselor_user_id, grade_id)
  WHERE section_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS counselor_assignments_section_uq
  ON counselor_assignments (counselor_user_id, section_id)
  WHERE grade_id IS NULL;

-- Performance: RLS lookups hit (counselor_user_id) frequently, and
-- reverse lookups ("which counselors cover this grade/section?") hit
-- the grade_id / section_id sides.
CREATE INDEX IF NOT EXISTS counselor_assignments_counselor_idx
  ON counselor_assignments (counselor_user_id);

CREATE INDEX IF NOT EXISTS counselor_assignments_grade_idx
  ON counselor_assignments (grade_id) WHERE grade_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS counselor_assignments_section_idx
  ON counselor_assignments (section_id) WHERE section_id IS NOT NULL;

-- ============= 3. RLS =============
ALTER TABLE counselor_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS counselor_assignments_read     ON counselor_assignments;
DROP POLICY IF EXISTS counselor_assignments_write    ON counselor_assignments;

-- IMPORTANT (Codex review fix): the original draft used is_admin() for
-- both read and write. That was a security hole — since persona-based
-- counselors keep role='admin' (with persona='counselor' inside the
-- JSONB), is_admin() returns TRUE for them. The counselor would then
-- be able to read/write ALL counselor_assignments rows, bypassing the
-- self-scoping intent entirely.
--
-- Fix: gate read+write on EITHER super_admin OR an explicit
-- manage_users flag (granted to principal / general_admin, never to
-- counselor). The counselor retains a single carve-out: read own rows
-- (so the watchlist UI knows their scope).

-- Read: super_admin (full), admins with manage_users flag (principal),
-- counselor (own rows only).
CREATE POLICY counselor_assignments_read
  ON counselor_assignments
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR current_user_has_flag('manage_users')
    OR counselor_user_id = auth.uid()
  );

-- Write: super_admin or admin with manage_users flag.
-- Counselor cannot create/modify/delete assignments — even their own.
CREATE POLICY counselor_assignments_write
  ON counselor_assignments
  FOR ALL TO authenticated
  USING (
    is_super_admin()
    OR current_user_has_flag('manage_users')
  )
  WITH CHECK (
    is_super_admin()
    OR current_user_has_flag('manage_users')
  );

-- ============= 4. Helper function: counselor_can_see_student =============
--
-- The single authoritative answer to "is the current counselor allowed
-- to see this student?" Used by RLS on every counseling-related table.
--
-- Returns TRUE only if BOTH conditions hold:
--   1. The current user has persona='counselor' (defense in depth — the
--      function refuses to grant access to non-counselors even if their
--      uid happens to appear in counselor_assignments).
--   2. The student is in a section that matches one of the counselor's
--      assignment rows (either by section_id directly, or by the
--      section's grade_id matching a grade-wide assignment).
--
-- SECURITY DEFINER + search_path: matches the project's existing pattern
-- (is_admin, current_user_role, ...). Reading user_profiles and
-- counselor_assignments inside an RLS-bound function is more reliable
-- when the function owns the row-level access.

CREATE OR REPLACE FUNCTION counselor_can_see_student(p_student_id INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT
    -- Persona check: never grant counselor access to a non-counselor,
    -- even if their uid somehow appears in counselor_assignments.
    current_user_is_counselor()
    AND EXISTS (
      SELECT 1
      FROM public.students s
      LEFT JOIN public.sections sec ON sec.id = s.section_id
      WHERE s.id = p_student_id
        AND EXISTS (
          SELECT 1
          FROM public.counselor_assignments ca
          WHERE ca.counselor_user_id = auth.uid()
            AND (
              -- Section-only assignment matches this student's section
              ca.section_id = s.section_id
              -- OR grade-wide assignment matches this student's grade
              OR (ca.grade_id IS NOT NULL AND ca.grade_id = sec.grade_id)
            )
        )
    );
$$;

COMMENT ON FUNCTION counselor_can_see_student(INTEGER) IS
  'Returns TRUE iff the current authenticated user is persona=counselor AND has a matching assignment (section_id direct match OR grade_id grade-wide match) for the given student. Single gate function for all counseling RLS.';

GRANT EXECUTE ON FUNCTION counselor_can_see_student(INTEGER) TO authenticated;
