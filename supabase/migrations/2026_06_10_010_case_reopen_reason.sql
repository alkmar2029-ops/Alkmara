-- م4.22-prep — Reopen reason column + updated case_history trigger.
--
-- Sets up the DB side for case state-machine transitions (م4.22).
-- A reopen (resolved/closed → open) currently lands in case_history
-- with reason=NULL because the trigger's CASE only knows about
-- resolution / close_reason. After this migration:
--   - student_cases.reopen_reason TEXT (nullable, ≥10 when set)
--   - the API writes it on resolved/closed → open transitions
--   - the trigger picks it up so the row in case_history carries
--     the actual reason text.
--
-- =====================================================================
-- WHY a dedicated column, not reuse resolution/close_reason
-- =====================================================================
-- Reusing resolution / close_reason would lie: those fields document
-- WHY the case was resolved or closed, not WHY it was reopened. Mixing
-- them up makes timeline traces ambiguous AND breaks any future
-- reporting that filters on "what was the original resolution before
-- the reopen". A new column keeps the three reasons orthogonal:
--   resolution    — present iff status='resolved' (DB CHECK guards this)
--   close_reason  — present iff status='closed'   (DB CHECK guards this)
--   reopen_reason — present iff status='open' AFTER a terminal state
--                   (no DB CHECK — the column is nullable because not
--                   every open row was reopened; the API enforces the
--                   ≥10 length only on the actual transition).
--
-- =====================================================================
-- CHECK choice — "IS NULL OR length >= 10"
-- =====================================================================
-- Soft constraint: nullable so historical / first-open cases stay
-- valid, but when ANY value is set it must be substantive (≥10).
-- That matches the API's behaviour: it sends NULL for non-reopen
-- transitions and a validated ≥10 string on reopen. Without this
-- CHECK, a 1-char reopen_reason could leak through if a future
-- migration bypasses the API.

-- ============== Column + CHECK ==============

ALTER TABLE student_cases
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_cases_reopen_reason_length_check'
      AND conrelid = 'student_cases'::regclass
  ) THEN
    ALTER TABLE student_cases
      ADD CONSTRAINT student_cases_reopen_reason_length_check
      CHECK (reopen_reason IS NULL OR length(reopen_reason) >= 10);
  END IF;
END;
$$;

COMMENT ON COLUMN student_cases.reopen_reason IS
  'Free-text rationale captured by the API on resolved/closed → open transitions. Nullable so first-open cases stay valid; the ≥10-char minimum (CHECK constraint) ensures substantive content when set. The case_history trigger reads this column on reopen transitions so the audit row carries the reason verbatim.';

-- ============== Updated trigger function ==============
-- Same shape as the original (م4.3); the only delta is the CASE arm
-- for `NEW.status = 'open'` when reopening from a terminal state.

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
      -- Reason resolution by transition:
      --   → resolved  : NEW.resolution    (required by DB CHECK on student_cases)
      --   → closed    : NEW.close_reason  (required by DB CHECK on student_cases)
      --   → open      : NEW.reopen_reason — only meaningful when OLD was
      --                 terminal. A plain in_progress → open (rollback)
      --                 keeps reason NULL because the API doesn't accept
      --                 reopen_reason on non-terminal sources.
      --   else        : NULL (open → in_progress, in_progress → open, etc.)
      CASE
        WHEN NEW.status = 'resolved' THEN NEW.resolution
        WHEN NEW.status = 'closed'   THEN NEW.close_reason
        WHEN NEW.status = 'open' AND OLD.status IN ('resolved', 'closed')
                                  THEN NEW.reopen_reason
        ELSE NULL
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION log_case_status_change() IS
  'AFTER UPDATE OF status trigger on student_cases. Writes one case_history row per status change. Reason source: resolution (→resolved), close_reason (→closed), reopen_reason (→open from resolved/closed), NULL otherwise. The API populates the relevant column before / during the UPDATE; this function only reads NEW.* and never raises (RLS / state-machine validation happens at the API layer).';
