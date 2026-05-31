-- م4.7 — RLS policies batch for all Sprint 4 tables + student_notes update.
--
-- This is the largest Sprint 4 migration. It wires the privacy
-- model that the previous 7 migrations only sketched. Ordering
-- matters: every CREATE POLICY runs FIRST, then the LAST
-- statement (Step 9) drops the م4.8 `student_notes_confidential_
-- disabled_until_rls` CHECK guard. By dropping last, any
-- partial-apply failure leaves the system over-restricted (guard
-- still on, policies maybe partially in place) — never
-- permissive. See the "NOTE on the guard removal ORDER" block
-- below for full rationale.
--
-- =====================================================================
-- ACCESS MODEL (one paragraph, then code)
-- =====================================================================
--   super_admin                           → all tables, all rows
--   counselor in scope                    → cases / sessions /
--                                           plans / case_history /
--                                           confidential notes for
--                                           students inside their
--                                           counselor_assignments
--   review_confidential flag holder       → SELECT-only oversight on
--                                           cases / plans /
--                                           case_history / sessions
--                                           METADATA; can read
--                                           confidential notes within
--                                           their admin_section_assignments.
--                                           Cannot write, cannot
--                                           decrypt session content.
--   teacher / staff / viewer              → only non-confidential
--                                           rows on student_notes;
--                                           NOTHING on cases /
--                                           sessions / plans / log
--   service-role (admin client / trigger) → bypasses RLS entirely.
--                                           Used by the (deferred)
--                                           decrypt_session_content
--                                           function and audit-log
--                                           writes.
--
-- =====================================================================
-- The "view_confidential_notes" permission flag
-- =====================================================================
-- A new persona permission key, granted via the existing personas
-- UI to principals / general_admin who need read-only oversight on
-- counseling data. Counselors don't need this flag — they have
-- counselor_can_see_student. The flag is meaningful only when
-- combined with admin_section_assignments scope (we never grant
-- view of confidential rows outside the holder's admin scope —
-- otherwise a principal in a different building could read
-- everything).
--
-- =====================================================================
-- counseling_sessions metadata vs content
-- =====================================================================
-- The flag-holder SELECT path on counseling_sessions surfaces the
-- ROW (date, type, topic, duration, content_preview, etc.) but
-- NOT the decrypted content. content_encrypted is BYTEA — the
-- value is visible, but useless without the key. The deferred
-- decrypt_session_content() helper will gate decryption strictly
-- to super_admin + counselor (no flag-based decrypt).

-- =====================================================================
-- NOTE on the guard removal ORDER
-- =====================================================================
-- The temporary `student_notes_confidential_disabled_until_rls`
-- CHECK constraint (added in م4.8) is DROPPED at the END of this
-- file (Step 9), AFTER all new policies are created and active.
-- Rationale (Codex Sprint 4 review — High): psql -f executes each
-- statement in its own implicit transaction (unless explicitly
-- wrapped). If a CREATE POLICY in the middle fails AND the DROP
-- had run first, we would have an open window with confidential
-- writes possible under the old broad policies. By DROPping
-- last, the worst-case partial-apply leaves the system over-
-- restricted (guard still on, policies maybe partially in place)
-- — never permissive. Easy to retry.
--
-- CREATE POLICY does NOT need the guard removed first: the
-- guard restricts column VALUES, not policy creation.

-- =====================================================================
-- STEP 1 — student_cases policies
-- =====================================================================
DROP POLICY IF EXISTS student_cases_select ON student_cases;
DROP POLICY IF EXISTS student_cases_insert ON student_cases;
DROP POLICY IF EXISTS student_cases_update ON student_cases;
DROP POLICY IF EXISTS student_cases_delete ON student_cases;

-- SELECT — super / counselor-in-scope / flag-holder-in-scope
CREATE POLICY student_cases_select ON student_cases
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR counselor_can_see_student(student_id)
    OR (
      current_user_has_flag('view_confidential_notes')
      AND student_id IN (
        SELECT s.id FROM students s WHERE s.section_id IN (
          SELECT section_id FROM admin_section_assignments
          WHERE admin_user_id = auth.uid()
        )
      )
    )
  );

-- INSERT — super OR counselor-in-scope. created_by must equal
-- auth.uid() (no impersonation).
CREATE POLICY student_cases_insert ON student_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      is_super_admin()
      OR counselor_can_see_student(student_id)
    )
  );

-- UPDATE — same as INSERT. Counselor-in-scope can edit any case
-- (collaboration). State-machine transitions are enforced by the
-- API layer (lib/cases/state-machine.ts) — RLS gates "who can
-- touch", not "what transitions are valid".
CREATE POLICY student_cases_update ON student_cases
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR counselor_can_see_student(student_id)
  )
  WITH CHECK (
    is_super_admin()
    OR counselor_can_see_student(student_id)
  );

-- DELETE — super only. Cases are historical records; close them
-- via status='closed', don't delete.
CREATE POLICY student_cases_delete ON student_cases
  FOR DELETE TO authenticated
  USING (is_super_admin());

-- =====================================================================
-- STEP 2 — case_history policies (SELECT only)
-- =====================================================================
-- Trigger writes via SECURITY DEFINER (bypasses RLS). Reads
-- mirror the parent case's SELECT visibility — if you can see
-- the case, you can see its status history.
DROP POLICY IF EXISTS case_history_select ON case_history;
CREATE POLICY case_history_select ON case_history
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM student_cases sc
      WHERE sc.id = case_history.case_id
        AND (
          counselor_can_see_student(sc.student_id)
          OR (
            current_user_has_flag('view_confidential_notes')
            AND sc.student_id IN (
              SELECT s.id FROM students s WHERE s.section_id IN (
                SELECT section_id FROM admin_section_assignments
                WHERE admin_user_id = auth.uid()
              )
            )
          )
        )
    )
  );

-- =====================================================================
-- STEP 3 — student_followup_plans policies
-- =====================================================================
DROP POLICY IF EXISTS student_followup_plans_select ON student_followup_plans;
DROP POLICY IF EXISTS student_followup_plans_insert ON student_followup_plans;
DROP POLICY IF EXISTS student_followup_plans_update ON student_followup_plans;
DROP POLICY IF EXISTS student_followup_plans_delete ON student_followup_plans;

CREATE POLICY student_followup_plans_select ON student_followup_plans
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR counselor_can_see_student(student_id)
    OR (
      current_user_has_flag('view_confidential_notes')
      AND student_id IN (
        SELECT s.id FROM students s WHERE s.section_id IN (
          SELECT section_id FROM admin_section_assignments
          WHERE admin_user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY student_followup_plans_insert ON student_followup_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      is_super_admin()
      OR counselor_can_see_student(student_id)
    )
  );

-- UPDATE allows any counselor-in-scope (collaboration), not just creator.
CREATE POLICY student_followup_plans_update ON student_followup_plans
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR counselor_can_see_student(student_id)
  )
  WITH CHECK (
    is_super_admin()
    OR counselor_can_see_student(student_id)
  );

CREATE POLICY student_followup_plans_delete ON student_followup_plans
  FOR DELETE TO authenticated
  USING (is_super_admin());

-- =====================================================================
-- STEP 4 — counseling_sessions policies
-- =====================================================================
-- More restrictive than cases/plans: the conducting counselor
-- (counselor_user_id) has INSERT + UPDATE on their own sessions.
-- DELETE is super_admin only — session records are a permanent
-- clinical artifact (Codex Sprint 4 review — comment alignment).
-- Other counselors in scope can SELECT but not edit/delete.
-- This matches the clinical norm that session records belong to
-- the conducting counselor.
DROP POLICY IF EXISTS counseling_sessions_select ON counseling_sessions;
DROP POLICY IF EXISTS counseling_sessions_insert ON counseling_sessions;
DROP POLICY IF EXISTS counseling_sessions_update ON counseling_sessions;
DROP POLICY IF EXISTS counseling_sessions_delete ON counseling_sessions;

CREATE POLICY counseling_sessions_select ON counseling_sessions
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR counselor_can_see_student(student_id)
    OR (
      current_user_has_flag('view_confidential_notes')
      AND student_id IN (
        SELECT s.id FROM students s WHERE s.section_id IN (
          SELECT section_id FROM admin_section_assignments
          WHERE admin_user_id = auth.uid()
        )
      )
    )
  );

-- INSERT — counselor records their own session. counselor_user_id
-- must equal auth.uid() (no impersonation).
CREATE POLICY counseling_sessions_insert ON counseling_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    counselor_user_id = auth.uid()
    AND (
      is_super_admin()
      OR counselor_can_see_student(student_id)
    )
  );

-- UPDATE — only the conducting counselor (or super_admin) can
-- edit, AND only within their counselor_can_see_student scope on
-- BOTH the OLD and NEW row.
--
-- Why the scope check on both sides (Codex Sprint 4 review —
-- High): `case_id` is mutable, and the sync trigger overwrites
-- NEW.student_id from the new case. Without scope check on
-- WITH CHECK, a counselor could move their session to a case
-- whose student lives outside their scope — silently importing
-- session-content access for that student. With WITH CHECK on
-- the post-trigger student_id, the move is denied.
--
-- USING checks the OLD row scope (you own this session); WITH
-- CHECK checks the NEW row scope (you can't move it away).
CREATE POLICY counseling_sessions_update ON counseling_sessions
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      counselor_user_id = auth.uid()
      AND counselor_can_see_student(student_id)
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      counselor_user_id = auth.uid()
      AND counselor_can_see_student(student_id)
    )
  );

CREATE POLICY counseling_sessions_delete ON counseling_sessions
  FOR DELETE TO authenticated
  USING (is_super_admin());

-- =====================================================================
-- STEP 5 — confidential_access_log policies (SELECT only)
-- =====================================================================
-- Audit channel — super_admin only. The audit-of-the-audit
-- principle: only the very top tier can read the log. Counselors
-- and flag-holders never see who-accessed-what; that's an admin
-- forensic responsibility.
--
-- Writes happen via SECURITY DEFINER triggers / API service-role
-- (both bypass RLS), so no INSERT/UPDATE/DELETE policies needed.
DROP POLICY IF EXISTS confidential_access_log_select ON confidential_access_log;
CREATE POLICY confidential_access_log_select ON confidential_access_log
  FOR SELECT TO authenticated
  USING (is_super_admin());

-- =====================================================================
-- STEP 6 — student_notes policies (rewrite with is_confidential)
-- =====================================================================
-- Strategy: DROP all existing student_notes policies and CREATE a
-- single coherent set. Reusing the existing teacher / admin /
-- staff / viewer scope logic, but factoring is_confidential into
-- the SELECT branch and adding a RESTRICTIVE write-gate that
-- blocks non-counselors from creating or flipping rows to
-- is_confidential = TRUE.
DROP POLICY IF EXISTS "student_notes read"        ON student_notes;
DROP POLICY IF EXISTS "student_notes ins staff"   ON student_notes;
DROP POLICY IF EXISTS "student_notes ins teacher" ON student_notes;
DROP POLICY IF EXISTS "student_notes upd staff"   ON student_notes;
DROP POLICY IF EXISTS "student_notes upd teacher" ON student_notes;
DROP POLICY IF EXISTS "student_notes del admin"   ON student_notes;

-- SELECT — three branches (Codex Sprint 4 review — High):
--
--   1. super_admin                              → all rows
--   2. counselor-in-scope                        → all rows (conf
--      + non-conf) for their assigned students.
--      Without this, a counselor would see their students'
--      CONFIDENTIAL notes (via the dedicated branch) but NOT
--      their non-confidential notes (the legacy branch checks
--      admin_section_assignments, which counselors usually
--      don't hold). Asymmetry that contradicts the basic
--      "counselor sees their students' record" expectation.
--   3. legacy non-confidential branch            → staff/viewer
--      always, admin/teacher within their existing assignment
--      scopes. is_confidential=FALSE only.
--   4. view_confidential_notes flag holder       → confidential
--      rows within admin_section_assignments scope (read-only
--      oversight for principals).
CREATE POLICY "student_notes read" ON student_notes
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR counselor_can_see_student(student_id)
    OR (
      is_confidential = FALSE
      AND (
        current_user_role() IN ('staff', 'viewer')
        OR (
          current_user_role() = 'admin'
          AND student_id IN (
            SELECT s.id FROM students s WHERE s.section_id IN (
              SELECT section_id FROM admin_section_assignments
              WHERE admin_user_id = auth.uid()
            )
          )
        )
        OR (
          current_user_role() = 'teacher'
          AND (
            recorded_by = auth.uid()
            OR student_id IN (
              SELECT s.id FROM students s WHERE s.section_id IN (
                SELECT section_id FROM teacher_section_assignments
                WHERE teacher_user_id = auth.uid()
              )
            )
          )
        )
      )
    )
    OR (
      is_confidential = TRUE
      AND current_user_has_flag('view_confidential_notes')
      AND student_id IN (
        SELECT s.id FROM students s WHERE s.section_id IN (
          SELECT section_id FROM admin_section_assignments
          WHERE admin_user_id = auth.uid()
        )
      )
    )
  );

-- INSERT (staff / admin path) — non-confidential only. Confidential
-- writes go through the counselor INSERT policy below + the
-- RESTRICTIVE gate.
--
-- `AND NOT current_user_is_counselor()` (Codex Sprint 4 review —
-- High): counselors are role='admin', so is_staff_or_admin()
-- includes them. Without this exclusion, a counselor would
-- inherit the school-wide INSERT path on non-confidential notes,
-- bypassing their counselor_can_see_student scope (same lesson
-- as Sprint 1's "role=admin alone is not authority"). Counselors
-- use the dedicated "ins counselor" policy below for both
-- confidential and non-confidential writes within their scope.
CREATE POLICY "student_notes ins staff" ON student_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    is_staff_or_admin()
    AND NOT current_user_is_counselor()
    AND is_confidential = FALSE
  );

-- INSERT (teacher path) — non-confidential, within teacher's sections.
CREATE POLICY "student_notes ins teacher" ON student_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = 'teacher'
    AND is_confidential = FALSE
    AND student_id IN (
      SELECT s.id FROM students s WHERE s.section_id IN (
        SELECT section_id FROM teacher_section_assignments
        WHERE teacher_user_id = auth.uid()
      )
    )
  );

-- INSERT (counselor path) — confidential OR non-confidential, within
-- counselor's assigned scope. recorded_by must equal auth.uid().
DROP POLICY IF EXISTS "student_notes ins counselor" ON student_notes;
CREATE POLICY "student_notes ins counselor" ON student_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND (
      is_super_admin()
      OR counselor_can_see_student(student_id)
    )
  );

-- UPDATE (staff / admin) — non-confidential only on both sides,
-- excluding counselors (same rationale as "ins staff" — counselors
-- use the dedicated "upd counselor" policy and must not inherit
-- the school-wide path).
CREATE POLICY "student_notes upd staff" ON student_notes
  FOR UPDATE TO authenticated
  USING (
    is_staff_or_admin()
    AND NOT current_user_is_counselor()
    AND is_confidential = FALSE
  )
  WITH CHECK (
    is_staff_or_admin()
    AND NOT current_user_is_counselor()
    AND is_confidential = FALSE
  );

-- UPDATE (teacher) — own recordings only, non-confidential.
CREATE POLICY "student_notes upd teacher" ON student_notes
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = 'teacher'
    AND recorded_by = auth.uid()
    AND is_confidential = FALSE
  )
  WITH CHECK (
    current_user_role() = 'teacher'
    AND recorded_by = auth.uid()
    AND is_confidential = FALSE
  );

-- UPDATE (counselor) — within scope; can touch confidential.
DROP POLICY IF EXISTS "student_notes upd counselor" ON student_notes;
CREATE POLICY "student_notes upd counselor" ON student_notes
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR counselor_can_see_student(student_id)
  )
  WITH CHECK (
    is_super_admin()
    OR counselor_can_see_student(student_id)
  );

-- DELETE — split rules by row sensitivity (Codex Sprint 4 review
-- — Critical, then second-pass refinement). The previous
-- `USING (is_admin())` was too broad: is_admin() includes
-- counselors (role='admin'), so any counselor could delete any
-- note across the whole school. RESTRICTIVE gates only cover
-- INSERT/UPDATE, so DELETE was unguarded.
--
-- New rule:
--   super_admin                    → always
--   admin (NOT counselor)          → only NON-confidential rows,
--                                    no scope check (legacy parity
--                                    for principal-level cleanup)
--   counselor-in-scope             → ALL rows (conf + non-conf)
--                                    for their assigned students.
--                                    Collaboration norm: a
--                                    counselor sharing scope may
--                                    tidy another counselor's
--                                    note. Tighten to
--                                    `AND recorded_by = auth.uid()`
--                                    if "own notes only" becomes
--                                    a policy requirement later.
CREATE POLICY "student_notes del admin" ON student_notes
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      is_confidential = FALSE
      AND is_admin()
      AND NOT current_user_is_counselor()
    )
    OR counselor_can_see_student(student_id)
  );

-- =====================================================================
-- STEP 7 — RESTRICTIVE write-gate on confidential rows
-- =====================================================================
-- Defense-in-depth: even if some future PERMISSIVE policy allowed
-- a non-counselor to write `is_confidential = TRUE`, this
-- RESTRICTIVE policy AND's on top and blocks the row. PostgreSQL
-- requires ALL restrictive policies to pass in addition to at
-- least ONE permissive policy.
--
-- One policy each for INSERT and UPDATE (RLS doesn't accept
-- multi-command policy definitions).

DROP POLICY IF EXISTS "student_notes confidential ins gate" ON student_notes;
CREATE POLICY "student_notes confidential ins gate" ON student_notes
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    is_confidential = FALSE
    OR is_super_admin()
    OR (current_user_is_counselor() AND counselor_can_see_student(student_id))
  );

DROP POLICY IF EXISTS "student_notes confidential upd gate" ON student_notes;
CREATE POLICY "student_notes confidential upd gate" ON student_notes
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (TRUE)  -- existing-row USING is unrestricted; permissive policies handle it
  WITH CHECK (
    is_confidential = FALSE
    OR is_super_admin()
    OR (current_user_is_counselor() AND counselor_can_see_student(student_id))
  );

-- =====================================================================
-- STEP 8 — Comments documenting the final access model
-- =====================================================================
COMMENT ON POLICY student_cases_select ON student_cases IS
  'Read access: super_admin / counselor-in-scope / view_confidential_notes flag holder with admin_section_assignments scope.';
COMMENT ON POLICY student_cases_insert ON student_cases IS
  'Create: super_admin OR counselor-in-scope. created_by must equal auth.uid().';
COMMENT ON POLICY student_cases_update ON student_cases IS
  'Update: super_admin OR counselor-in-scope (collaboration). State-machine transitions enforced at API layer.';
COMMENT ON POLICY student_cases_delete ON student_cases IS
  'Delete: super_admin only. Cases are historical; close via status=closed.';

COMMENT ON POLICY case_history_select ON case_history IS
  'Visibility mirrors parent case (counselor-in-scope OR flag-holder-in-scope). Trigger writes via SECURITY DEFINER bypass RLS.';

COMMENT ON POLICY counseling_sessions_select ON counseling_sessions IS
  'Read row + metadata. content_encrypted is visible as raw BYTEA but useless without the key; decrypt_session_content gates decryption strictly to super_admin + conducting counselor.';
COMMENT ON POLICY counseling_sessions_update ON counseling_sessions IS
  'Update: only conducting counselor (counselor_user_id=auth.uid()) OR super_admin. Other counselors in scope can SELECT but not edit.';

COMMENT ON POLICY confidential_access_log_select ON confidential_access_log IS
  'super_admin only. Audit-of-the-audit principle — only the top tier reads access logs.';

COMMENT ON POLICY "student_notes read" ON student_notes IS
  'Four branches: (1) super_admin all rows; (2) counselor-in-scope all rows for assigned students (conf + non-conf); (3) legacy role/scope rules for is_confidential=FALSE (staff/viewer all; admin/teacher within their assignment scopes); (4) view_confidential_notes flag holder for is_confidential=TRUE within admin_section_assignments scope.';
COMMENT ON POLICY "student_notes confidential ins gate" ON student_notes IS
  'RESTRICTIVE — blocks any INSERT of is_confidential=TRUE by a user who is neither super_admin nor counselor-in-scope. Layered on top of the permissive staff / teacher / counselor INSERT policies.';
COMMENT ON POLICY "student_notes confidential upd gate" ON student_notes IS
  'RESTRICTIVE — blocks any UPDATE that sets is_confidential=TRUE unless caller is super_admin or counselor-in-scope. Prevents non-counselor from flipping the confidentiality flag.';

-- =====================================================================
-- STEP 9 — DROP the م4.8 "confidential disabled" guard (LAST)
-- =====================================================================
-- Now that all policies are in place — including the RESTRICTIVE
-- write-gates that block non-counselor writes of
-- is_confidential=TRUE — it is safe to remove the temporary CHECK
-- constraint. See the "NOTE on the guard removal ORDER" comment
-- at the top of this file for rationale (partial-apply safety).
ALTER TABLE student_notes
  DROP CONSTRAINT IF EXISTS student_notes_confidential_disabled_until_rls;
