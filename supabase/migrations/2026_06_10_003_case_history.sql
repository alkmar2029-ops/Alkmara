-- م4.3 — Case-status audit trigger + history table.
--
-- Why a DB trigger (not just API-level audit_logs):
--   audit_logs depends on the API actually being called. Direct DB
--   writes (psql, admin migrations, future Edge Functions) wouldn't
--   fire it. This trigger is defence-in-depth — any UPDATE that
--   changes student_cases.status leaves a forensic trail no matter
--   where it originated.
--
--   audit_logs and case_history are complementary:
--     - audit_logs     = "who took which API action, with what
--                        payload" (rich context: IP, user-agent, ...)
--     - case_history   = "every status transition that ever hit
--                        this case row" (narrow, immutable, DB-level)
--
-- Mirrors the م3.3 incidents_status_history design exactly. The two
-- audit tables stay structurally identical so admin-side reporting
-- can pivot across both in the same UI.
--
-- RLS: ENABLE ROW LEVEL SECURITY (fail-closed) — NO policies in
-- this migration. م4.7 wires policies for all Sprint 4 tables in
-- one consistent batch (per the user's explicit "لا policies جزئية"
-- guidance). Until м4.7, case_history is service-role-only.
--
-- FK behavior:
--   case_id → student_cases(id) ON DELETE CASCADE. If a super_admin
--     ever purges a case, its history goes with it (the audit_logs
--     side keeps the API action record — see الـ standing comment
--     on student_incidents history table for the same logic).
--   changed_by → auth.users(id) ON DELETE SET NULL. A deleted
--     reviewer just becomes "(unknown)" in the audit trail rather
--     than blocking deletion.

-- ============== History table ==============
-- CHECK constraints mirror student_cases.status enum — defense-in-
-- depth so a malformed direct INSERT can't pollute the audit log
-- with garbage states (same pattern as incidents_status_history
-- Codex Sprint 3 fix).
CREATE TABLE IF NOT EXISTS case_history (
  id            BIGSERIAL PRIMARY KEY,
  case_id       BIGINT NOT NULL REFERENCES student_cases(id) ON DELETE CASCADE,
  from_status   VARCHAR(20) CHECK (
    from_status IS NULL
    OR from_status IN ('open', 'in_progress', 'resolved', 'closed')
  ),
  to_status     VARCHAR(20) NOT NULL CHECK (
    to_status IN ('open', 'in_progress', 'resolved', 'closed')
  ),
  -- changed_by is nullable: a service-role migration could
  -- legitimately bump statuses (rare, e.g. backfill) and auth.uid()
  -- returns NULL in that context. Better a NULL than a fabricated UUID.
  changed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Optional note — populated by the trigger from the transition-
  -- appropriate column on student_cases. Helps reviewers reading
  -- the history see WHY the status changed without joining back
  -- to audit_logs.
  --
  -- Picked via CASE NEW.status:
  --   resolved → NEW.resolution
  --   closed   → NEW.close_reason
  --   else     → NULL (reopen and other transitions carry no
  --             dedicated reason text on student_cases itself)
  reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_case_history_case
  ON case_history (case_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_case_history_changed_by
  ON case_history (changed_by, changed_at DESC)
  WHERE changed_by IS NOT NULL;

-- ============== Fail-closed RLS ==============
-- Same fail-closed default as student_cases — enable RLS now, no
-- policies until м4.7. Trigger writes via SECURITY DEFINER so it
-- still works under the no-policy regime (RLS doesn't restrict
-- SECURITY DEFINER functions' own writes).
ALTER TABLE case_history ENABLE ROW LEVEL SECURITY;

-- ============== Trigger function ==============
-- SECURITY DEFINER + search_path lock — matches the existing
-- helper-function pattern (Codex Sprint 1 fix, repeated in м3.3).
-- The function inserts into case_history regardless of the calling
-- user's INSERT privileges on that table — that's the whole point
-- of an audit trigger.
CREATE OR REPLACE FUNCTION log_case_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log when status actually changed. IS DISTINCT FROM handles
  -- NULL safely.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO case_history (
      case_id,
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
      -- Pick the transition-appropriate field. resolution / close_reason
      -- are required by their respective terminal-state CHECK constraints
      -- on student_cases (см. م4.2), so they're guaranteed non-null on
      -- those transitions. Other transitions (open→in_progress, reopen)
      -- carry no dedicated reason field; NULL is honest here.
      CASE NEW.status
        WHEN 'resolved' THEN NEW.resolution
        WHEN 'closed'   THEN NEW.close_reason
        ELSE NULL
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ============== Trigger ==============
-- AFTER UPDATE OF status — column-narrow so unrelated field edits
-- (e.g. updated_at touch by م4.2's existing trigger) do NOT pay
-- the audit cost. ROW-level for per-row OLD/NEW access.
DROP TRIGGER IF EXISTS case_status_history_trigger ON student_cases;
CREATE TRIGGER case_status_history_trigger
  AFTER UPDATE OF status ON student_cases
  FOR EACH ROW
  EXECUTE FUNCTION log_case_status_change();

-- ============== Comments ==============
COMMENT ON TABLE case_history IS
  'Append-only audit log of every status transition on student_cases. Written by the AFTER UPDATE OF status trigger (SECURITY DEFINER), never directly by API. Complements audit_logs which captures API-action context. RLS enabled fail-closed; policies land in م4.7.';

COMMENT ON FUNCTION log_case_status_change() IS
  'AFTER UPDATE trigger function — appends one row to case_history when student_cases.status changes. SECURITY DEFINER + search_path locked so the insert succeeds regardless of caller privileges. auth.uid() returns NULL for service-role / admin contexts, which is preserved as-is.';

COMMENT ON TRIGGER case_status_history_trigger ON student_cases IS
  'Fires AFTER UPDATE OF status — narrow column trigger so unrelated edits (resolution touch-up, reopen_count bump, updated_at refresh) do not pay the audit cost. ROW-level for per-row OLD/NEW access.';
