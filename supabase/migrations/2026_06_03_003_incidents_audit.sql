-- م3.3 — Status-change audit trigger for student_incidents.
--
-- Why a DB trigger (not just API-level audit_logs):
--   The API uses writeAuditLog() for normal CRUD, but that depends on
--   the API actually being called. Direct DB writes via psql, admin
--   migrations, or future Edge Functions wouldn't fire it. This
--   trigger is defence-in-depth — any UPDATE that changes `status`
--   leaves a forensic trail, no matter where it originated.
--
--   The trigger and the API audit are complementary:
--     - audit_logs   = "who took which API action and with what
--                       payload" (rich context: IP, user-agent, ...)
--     - incidents_status_history = "every status transition that ever
--                       hit this row" (narrow, immutable, DB-level)
--
-- Schema decision — separate table vs. column on the row:
--   A separate history table preserves prior transitions even after
--   later ones overwrite the row's reviewed_by/reviewed_at. A
--   JSONB column on student_incidents would lose history if the row
--   was re-reviewed.
--
-- FK behavior:
--   incident_id ON DELETE CASCADE — the only legitimate way an
--   incident gets DELETEd is super_admin via RLS, and at that point
--   the row's history is gone with it (the audit_logs entry for the
--   DELETE itself lives in the separate API audit channel).

-- ============== History table ==============
-- CHECK constraints mirror the parent student_incidents.status set —
-- defense-in-depth so a malformed direct INSERT (manual SQL, future
-- backfill script) can't pollute the audit log with garbage states
-- (Codex Sprint 3 review should-fix #2).
CREATE TABLE IF NOT EXISTS incidents_status_history (
  id            BIGSERIAL PRIMARY KEY,
  incident_id   BIGINT NOT NULL REFERENCES student_incidents(id) ON DELETE CASCADE,
  from_status   VARCHAR(20) CHECK (
    from_status IS NULL
    OR from_status IN ('submitted', 'under_review', 'dismissed', 'actioned', 'escalated')
  ),
  to_status     VARCHAR(20) NOT NULL CHECK (
    to_status IN ('submitted', 'under_review', 'dismissed', 'actioned', 'escalated')
  ),
  -- changed_by is nullable: a service-role admin migration could
  -- legitimately bump statuses (rare, e.g. backfill) and auth.uid()
  -- returns NULL in that context. Better a NULL than a fabricated UUID.
  changed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Optional note — populated by the trigger from the transition-
  -- appropriate column on student_incidents. Helps a reviewer reading
  -- the history see WHY the status changed without joining back to
  -- audit_logs.
  reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_history_incident
  ON incidents_status_history (incident_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_incidents_history_changed_by
  ON incidents_status_history (changed_by, changed_at DESC)
  WHERE changed_by IS NOT NULL;

-- ============== Fail-closed RLS ==============
ALTER TABLE incidents_status_history ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can read the parent incident. Mirrors the
-- incidents_select policy via the FK lookup so the history doesn't
-- leak more visibility than the row itself. INSERT/UPDATE/DELETE all
-- left without policies (only the SECURITY DEFINER trigger writes,
-- and only super_admin can purge — service-role bypasses RLS).
--
-- IMPORTANT: must use reviewer_can_see_student(si.student_id), NOT
-- raw current_user_has_flag(). The raw flag check would let a scoped
-- VP-academic read the history of incidents outside their
-- vp_grade_scope — reintroducing exactly the leak Codex Sprint 3
-- caught in incidents_select. The parent policy and this one must
-- stay in lockstep.
DROP POLICY IF EXISTS incidents_history_select ON incidents_status_history;
CREATE POLICY incidents_history_select
  ON incidents_status_history
  FOR SELECT TO authenticated
  USING (
    current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1
      FROM student_incidents si
      WHERE si.id = incidents_status_history.incident_id
        AND (
          si.submitted_by = auth.uid()
          OR reviewer_can_see_student(si.student_id)
          OR counselor_can_see_student(si.student_id)
        )
    )
  );

-- ============== Trigger function ==============
-- SECURITY DEFINER + search_path lock — matches the existing
-- helper-function pattern (Codex Sprint 1 fix). The function inserts
-- into incidents_status_history regardless of the calling user's
-- INSERT privileges on that table — that's the whole point of an
-- audit trigger.
CREATE OR REPLACE FUNCTION log_incident_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log when status actually changed. IS DISTINCT FROM handles
  -- NULL safely (no false positive on first set when OLD.status is
  -- a default-already-NOT-NULL value, but kept for safety).
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO incidents_status_history (
      incident_id,
      from_status,
      to_status,
      changed_by,
      reason
    )
    VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      auth.uid(),
      -- Pick the transition-appropriate field. COALESCE was wrong
      -- here: when a row goes pending→actioned, a stale review_notes
      -- from an earlier under_review transition would mask the actual
      -- action_taken. The CASE keys off the new status so each
      -- transition records its own reason text (Codex Sprint 3
      -- review should-fix #1).
      CASE NEW.status
        WHEN 'actioned'     THEN NEW.action_taken
        WHEN 'dismissed'    THEN NEW.review_notes
        WHEN 'escalated'    THEN NEW.review_notes
        WHEN 'under_review' THEN NEW.review_notes
        ELSE NULL
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ============== Trigger ==============
-- AFTER UPDATE so we capture the post-change state. ROW-level (not
-- statement-level) because we need per-row OLD/NEW comparison.
DROP TRIGGER IF EXISTS incidents_status_change_trigger ON student_incidents;
CREATE TRIGGER incidents_status_change_trigger
  AFTER UPDATE OF status ON student_incidents
  FOR EACH ROW
  EXECUTE FUNCTION log_incident_status_change();

-- ============== Comments ==============
COMMENT ON TABLE incidents_status_history IS
  'Append-only audit log of every status transition on student_incidents. Written by the AFTER UPDATE trigger (SECURITY DEFINER), never directly by API. Complements audit_logs which captures API-action context.';

COMMENT ON FUNCTION log_incident_status_change() IS
  'AFTER UPDATE trigger function — appends one row to incidents_status_history when status changes. SECURITY DEFINER + search_path locked so the insert succeeds regardless of caller privileges. auth.uid() returns NULL for service-role / admin contexts, which is preserved as-is.';

COMMENT ON TRIGGER incidents_status_change_trigger ON student_incidents IS
  'Fires AFTER UPDATE OF status — narrow column trigger so unrelated field updates (e.g. parent_notified_at) do not pay the audit cost. ROW-level for per-row OLD/NEW access.';
