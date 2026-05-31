-- Tighten teacher_leaves UPDATE RLS (Codex Sprint 2 review — security
-- boundary, not just UX).
--
-- BEFORE (migration 2026_05_21_003_teacher_leaves.sql):
--   UPDATE was permitted for the teacher themselves on their pending
--   row, with WITH CHECK constraining only the new status to pending
--   or cancelled. The WITH CHECK did NOT lock down which columns the
--   teacher could change. Going through the Supabase JS client a
--   teacher could PATCH their own pending row's start_date, end_date,
--   leave_type, or reason — bypassing the intended "cancel only"
--   workflow.
--
-- AFTER:
--   Teacher cannot UPDATE teacher_leaves directly via RLS. The
--   cancellation workflow will live behind a dedicated API endpoint
--   (later task) that uses the service-role client and enforces
--   "only status changes to cancelled, no other columns touched"
--   server-side.
--
-- INSERT is unchanged — teachers can still submit their own pending
-- requests. DELETE remains super_admin only.
--
-- Idempotent: drop-then-recreate so re-running the migration is safe.

DROP POLICY IF EXISTS teacher_leaves_update ON teacher_leaves;

CREATE POLICY teacher_leaves_update
  ON teacher_leaves
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = 'super_admin'
    OR current_user_has_flag('approve_teacher_leave')
  )
  WITH CHECK (
    current_user_role() = 'super_admin'
    OR current_user_has_flag('approve_teacher_leave')
  );

COMMENT ON POLICY teacher_leaves_update ON teacher_leaves IS
  'UPDATE restricted to super_admin or holders of approve_teacher_leave. Teacher self-update was REMOVED here intentionally — the cancellation workflow flows through a controlled API endpoint that can enforce "status-only" changes; raw RLS access let teachers also modify start_date/end_date/leave_type/reason, which was an unintended escape hatch (Codex Sprint 2).';

-- Refresh the table-level comment to match the new RLS surface (Codex
-- Sprint 2 should-fix #3). The original COMMENT ON TABLE from migration
-- 003 said teachers could "update only their own pending requests to
-- cancel them" — that wording is now stale: teacher self-update is
-- blocked at the RLS layer, and the cancel flow goes through a server-
-- role API endpoint (tracked as tech debt #9). Updating here so future
-- readers of the schema don't trust an out-of-date row.
COMMENT ON TABLE teacher_leaves IS
  'Teacher leave requests (sick, personal, official, ...). RLS: SELECT — teacher sees own + super_admin/dashboard-view sees all. INSERT — teacher self-insert OR admin entry. UPDATE — super_admin or holders of approve_teacher_leave ONLY (no teacher self-update; cancellation flows through a controlled API endpoint that enforces status-only changes). DELETE — super_admin only.';
