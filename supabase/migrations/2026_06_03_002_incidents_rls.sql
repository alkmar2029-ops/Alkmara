-- م3.2 — RLS policies for student_incidents (+ scope helpers).
--
-- RLS was already ENABLED in م3.1 (fail-closed default). This
-- migration adds the four CRUD policies AND two new scope helpers:
--   reviewer_can_see_student(int)  — flag holder + vp_grade_scope respect
--   teacher_teaches_student(int)   — teacher_section_assignments scope
--
-- Pre-existing helpers (from Sprint 1):
--   current_user_role()              → text  ('teacher'|'admin'|'super_admin'|'viewer')
--   current_user_has_flag(text)      → boolean (admin family + flag=true)
--   counselor_can_see_student(int)   → boolean (counselor_assignments scope)
--
-- Policy summary (post-Codex Sprint 3 review):
--   SELECT — super_admin, submitter, reviewer-in-scope, in-scope counselor.
--   INSERT — submitter must own auth.uid() AND either be admin/super OR
--            a teacher assigned to the student's section (no direct
--            PostgREST writes for arbitrary students).
--   UPDATE — super_admin ONLY. Reviewer decisions go through API
--            service-role endpoints (م3.7/م3.8/م3.9) so state-machine
--            transitions + column-level field rules are enforced in
--            one place with audit. RLS reviewer UPDATE was removed
--            after Codex flagged it as "any-column rewrite escape
--            hatch" — same lesson as Sprint 2 teacher_leaves.
--   DELETE — super_admin only. Teacher withdraw flows through an API
--            service-role endpoint (м3.10).
--
-- Why scope-aware reviewer (not flag-only):
--   `current_user_has_flag('review_teacher_incidents')` alone would
--   leak ALL incidents to any flag holder, ignoring their
--   `vp_grade_scope`. VP-academic for grades 7-9 shouldn't see grade
--   10-12 incidents. The helper joins through sections to compare
--   the student's grade with the reviewer's scope array. NULL scope
--   = unrestricted (e.g. principal-flagged + no scope).
--
-- Why scope-aware teacher INSERT:
--   Without it, a teacher could PostgREST-POST an incident against
--   any student_id, bypassing API-level validation. The
--   teacher_teaches_student helper joins via teacher_section_assignments
--   so the DB enforces "you can only submit incidents for students
--   in sections you actually teach". Admin / super_admin bypass this
--   scope (they enter on behalf, possibly across grades).
--
-- Idempotent — DROP IF EXISTS each policy first so re-running the
-- migration is safe.

-- ============== Scope helpers ==============
-- SECURITY DEFINER + search_path lock matches the Sprint 1 helper
-- pattern (Codex Sprint 1 fix). STABLE because the result depends
-- only on auth.uid() + the queried row state, not on side effects.

CREATE OR REPLACE FUNCTION reviewer_can_see_student(p_student_id INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT
    -- Flag check goes first — the helper is meaningless for
    -- non-reviewers, and short-circuiting saves the joins below.
    current_user_has_flag('review_teacher_incidents')
    AND EXISTS (
      SELECT 1
      FROM public.students s
      LEFT JOIN public.sections sec ON sec.id = s.section_id
      LEFT JOIN public.user_profiles up ON up.user_id = auth.uid()
      WHERE s.id = p_student_id
        AND (
          -- NULL vp_grade_scope = unrestricted (principal, super-VP).
          up.vp_grade_scope IS NULL
          -- Scope present: must include this student's grade.
          OR (sec.grade_id IS NOT NULL AND sec.grade_id = ANY(up.vp_grade_scope))
        )
    );
$$;

COMMENT ON FUNCTION reviewer_can_see_student(INTEGER) IS
  'TRUE iff caller holds review_teacher_incidents AND (vp_grade_scope is NULL OR student grade is in scope). Used by incidents_select policy to prevent cross-grade leaks to scoped reviewers. NULL vp_grade_scope means unrestricted (e.g. principal granted the flag).';

CREATE OR REPLACE FUNCTION teacher_teaches_student(p_student_id INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_section_assignments tsa
    JOIN public.students s ON s.section_id = tsa.section_id
    WHERE tsa.teacher_user_id = auth.uid()
      AND s.id = p_student_id
  );
$$;

COMMENT ON FUNCTION teacher_teaches_student(INTEGER) IS
  'TRUE iff the caller is assigned to a section containing this student via teacher_section_assignments. Used by incidents_insert policy to prevent a teacher from PostgREST-submitting an incident for a student outside their assigned sections.';

-- DB-level guard against incidents on missing or inactive students.
-- The API only does this check for super_admin (precise 404/400) —
-- non-super skip pre-validation to avoid leaking student existence
-- via probing. Without this helper, a counselor / reviewer inside
-- scope could still successfully insert against an inactive
-- student. The function returns FALSE for both "missing" and
-- "inactive", keeping the failure mode opaque (just another path
-- through the INSERT policy that produces 42501 → 403 generic).
-- Codex Sprint 3 fourth review.
CREATE OR REPLACE FUNCTION incident_student_is_active(p_student_id INTEGER)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students
    WHERE id = p_student_id
      AND is_active = true
  );
$$;

COMMENT ON FUNCTION incident_student_is_active(INTEGER) IS
  'TRUE iff the student exists AND is_active=true. Used by incidents_insert as a DB-level data-integrity gate so an inactive (or deleted-then-readded-elsewhere) student cannot receive an incident regardless of caller scope.';

-- Match the pattern set by counselor_can_see_student (Sprint 1):
-- helpers are reachable from RLS without grants, but explicit GRANT
-- to authenticated makes them callable from PostgREST RPC + lets
-- developers debug-call them in psql under their own role.
GRANT EXECUTE ON FUNCTION reviewer_can_see_student(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION teacher_teaches_student(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION incident_student_is_active(INTEGER) TO authenticated;

-- ============== Policies ==============

-- ============== SELECT ==============
DROP POLICY IF EXISTS incidents_select ON student_incidents;
CREATE POLICY incidents_select
  ON student_incidents
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'super_admin'
    -- Teacher sees own submissions (any status, any age).
    OR submitted_by = auth.uid()
    -- Reviewers see incidents within their grade scope. The helper
    -- also checks the flag, so non-reviewers short-circuit cheaply.
    OR reviewer_can_see_student(student_id)
    -- Counselors see incidents for students in their assigned scope
    -- (grade-wide or section-specific via counselor_assignments).
    -- View-only — UPDATE is super_admin only via RLS; counselor
    -- reviews go through API service-role endpoints.
    OR counselor_can_see_student(student_id)
  );

-- ============== INSERT ==============
-- Every caller submits only within their authorized scope — there is
-- no blanket "any admin" pass. The previous draft used
-- `role IN ('admin','super_admin')` which let a counselor (role=admin
-- in this system) PostgREST-submit incidents for ANY student
-- regardless of their counselor_assignments. That repeats the
-- Sprint 1 "role=admin is not authority" lesson (Codex Sprint 3
-- second review). Replaced with four scope-aware paths:
--
--   - super_admin                — any student
--   - teacher_teaches_student    — assigned section via teacher_section_assignments
--   - reviewer_can_see_student   — review_teacher_incidents flag + vp_grade_scope
--   - counselor_can_see_student  — counselor_assignments scope
--
-- A user holding none of these can't submit — including an "admin"
-- whose personas/permissions don't grant relevant scope. If a
-- general_admin needs to submit on behalf, grant them the reviewer
-- flag (with or without vp_grade_scope) via the personas UI.
DROP POLICY IF EXISTS incidents_insert ON student_incidents;
CREATE POLICY incidents_insert
  ON student_incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    -- Data-integrity gate: DB rejects any incident for a missing
    -- or inactive student, regardless of caller scope. The API
    -- pre-checks this for super_admin only (precise 400) — for
    -- everyone else, this clause produces a 42501 that the API
    -- maps to the same opaque 403 as scope denial, keeping
    -- inactive-status leak-proof.
    AND incident_student_is_active(student_id)
    AND (
      current_user_role() = 'super_admin'
      OR teacher_teaches_student(student_id)
      OR reviewer_can_see_student(student_id)
      OR counselor_can_see_student(student_id)
    )
  );

-- ============== UPDATE ==============
-- super_admin ONLY. Reviewer decisions (under_review, dismissed,
-- actioned, escalated) go through API service-role endpoints
-- (м3.7/م3.8/م3.9) so the state-machine transition rules + the
-- column-level rules (only review_notes on dismiss, only action_taken
-- on action, etc.) are enforced in one auditable place.
--
-- The earlier draft of this policy let any review_teacher_incidents
-- flag holder UPDATE any column — Codex flagged it as an
-- "any-column rewrite escape hatch", same lesson as Sprint 2
-- teacher_leaves. Removing reviewer raw UPDATE forces every decision
-- through the API audit channel.
--
-- Teacher self-update remains absent — withdraw is DELETE via API.
DROP POLICY IF EXISTS incidents_update ON student_incidents;
CREATE POLICY incidents_update
  ON student_incidents
  FOR UPDATE TO authenticated
  USING (current_user_role() = 'super_admin')
  WITH CHECK (current_user_role() = 'super_admin');

-- ============== DELETE ==============
-- super_admin only. The teacher-withdraw flow (م3.10) goes through
-- a server-role API endpoint so it can:
--   - check status='submitted' AND submitted_at < 30 min in one place
--   - write an audit entry before dropping the row
--   - notify any downstream listeners (none yet, but the seam exists)
-- A pure-RLS teacher-delete would skip all of that.
DROP POLICY IF EXISTS incidents_delete ON student_incidents;
CREATE POLICY incidents_delete
  ON student_incidents
  FOR DELETE TO authenticated
  USING (current_user_role() = 'super_admin');

-- ============== Comments ==============
COMMENT ON POLICY incidents_select ON student_incidents IS
  'Visible to: super_admin (all); the submitter (own); reviewers via reviewer_can_see_student (flag + vp_grade_scope); counselors via counselor_can_see_student (counselor_assignments).';

COMMENT ON POLICY incidents_insert ON student_incidents IS
  'INSERT requires submitted_by=auth.uid() AND student is active AND scope match — super_admin (all), teacher_teaches_student (section assignment), reviewer_can_see_student (flag + vp_grade_scope), or counselor_can_see_student (counselor assignment). DB-level active-student gate keeps inactive incidents probing-safe and uniform for all callers (Codex Sprint 3 fourth review).';

COMMENT ON POLICY incidents_update ON student_incidents IS
  'UPDATE restricted to super_admin ONLY via RLS. All reviewer decisions (dismiss/action/escalate) flow through API service-role endpoints that enforce the state-machine transitions + the column-level field rules in one auditable place (Codex Sprint 3 review).';

COMMENT ON POLICY incidents_delete ON student_incidents IS
  'DELETE restricted to super_admin via RLS. Teacher self-withdraw (status=submitted, <30 min) is handled by a server-role API endpoint that enforces the time window + writes audit before deletion (Sprint 2 teacher_leaves cancel pattern).';
