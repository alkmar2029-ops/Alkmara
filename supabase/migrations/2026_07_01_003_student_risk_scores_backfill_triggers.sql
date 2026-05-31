-- м5.3 — Risk-score staleness pipeline: helper + backfill + 5 triggers.
--
-- Wires the async staleness flow:
--
--   upstream write (5 tables)
--          │
--          ▼  AFTER trigger
--   risk_score_mark_stale_from_row()  ── reads NEW.student_id ──┐
--                                                                │
--                                                                ▼
--                                  mark_student_risk_stale(p_student_id)
--                                          │
--                                          ▼
--                                  UPSERT into student_risk_scores
--                                  (insert placeholder OR mark stale)
--
-- The m5.4 compute RPC (next migration) is the ONLY writer of
-- scores / signals / computed_at — this migration deliberately
-- never touches those columns even on existing rows. Separation of
-- concerns: triggers maintain freshness signals only; compute owns
-- the score model.
--
-- =====================================================================
-- BACKFILL POLICY
-- =====================================================================
-- INSERT one placeholder row per active student
-- (`students.is_active IS NOT FALSE` — treats NULL as active to match
-- defensive existing reads in the codebase). `ON CONFLICT (student_id)
-- DO NOTHING` makes the migration idempotent: re-running on staging
-- does not overwrite scores already computed by m5.4 + onward.
--
-- Students added AFTER this migration are NOT backfilled by a new
-- students-INSERT trigger — that's an extra surface and the m5.3
-- design doesn't include it. Instead, the UPSERT in
-- mark_student_risk_stale catches them the first time any of the
-- 5 upstream tables references them. Students with zero signals
-- legitimately don't belong on the watchlist anyway (score = 0
-- defaults push them to the bottom of any sort).
--
-- =====================================================================
-- UPSERT SEMANTICS — what the helper TOUCHES vs LEAVES ALONE
-- =====================================================================
--   Touches:
--     - is_stale := TRUE     (the whole point of the function)
--     - section_id := students.section_id  (cheap to keep fresh; the
--                              student may have moved sections since
--                              the last compute, and we want the
--                              watchlist section filter to reflect that)
--     - updated_at           (auto via the BEFORE UPDATE trigger)
--   Leaves alone:
--     - total_score / 4 sub-scores  (compute RPC owns the model)
--     - signals JSONB        (same)
--     - computed_at          (NULL until first compute; subsequent
--                              compute runs SET it. Staleness flips
--                              NEVER pretend to be a compute.)
--
-- =====================================================================
-- RLS NOTE
-- =====================================================================
-- mark_student_risk_stale runs SECURITY DEFINER + search_path locked
-- so it bypasses RLS on student_risk_scores entirely. That's
-- intentional — m5.2 grants no INSERT/UPDATE/DELETE policies on the
-- table; the only path to write is this SECURITY DEFINER helper plus
-- the m5.4 compute RPC. The owner-level write is the documented
-- write surface.
--
-- =====================================================================
-- TWO TRIGGER WRAPPERS — one generic + one for students
-- =====================================================================
-- The 5 SIGNAL source tables (incidents / cases / plans / sessions /
-- notes) all expose `NEW.student_id`, so they share
-- `risk_score_mark_stale_from_row()`.
--
-- The `students` table itself uses `NEW.id` (the student's PK), not
-- `student_id`. We add a SECOND wrapper `risk_score_mark_stale_from_student_row()`
-- that adapts. The students trigger fires on:
--   - UPDATE OF section_id  → student moved sections; watchlist
--                              filter must reflect the new section,
--                              and the helper's UPSERT does that.
--   - UPDATE OF is_active   → student deactivated/reactivated;
--                              compute (m5.4) decides whether to
--                              score 0 / hide. We mark stale so
--                              that decision runs on the next sweep.
-- NO INSERT trigger on students — a brand-new student has no signals
-- yet and doesn't need a row until the first signal write upserts
-- them. NO DELETE trigger — the FK ON DELETE CASCADE on
-- student_risk_scores already cleans up.

-- =====================================================================
-- STEP 1 — Helper function: UPSERT mark stale
-- =====================================================================
CREATE OR REPLACE FUNCTION mark_student_risk_stale(p_student_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_section_id INTEGER;
  v_exists     BOOLEAN;
BEGIN
  -- Pull current section from students. NULL is acceptable
  -- (matches the nullable section_id on student_risk_scores).
  SELECT section_id, TRUE INTO v_section_id, v_exists
  FROM students WHERE id = p_student_id;

  -- Defensive: if the student row doesn't exist (e.g., a stale
  -- trigger fired after a CASCADE delete somehow propagated), do
  -- nothing. The UPSERT below would otherwise raise FK 23503.
  IF v_exists IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO student_risk_scores (student_id, section_id, is_stale)
  VALUES (p_student_id, v_section_id, TRUE)
  ON CONFLICT (student_id) DO UPDATE
    SET is_stale   = TRUE,
        section_id = EXCLUDED.section_id;
  -- updated_at is bumped automatically by the BEFORE UPDATE trigger.
  -- total_score / sub-scores / signals / computed_at are deliberately
  -- NOT in this UPDATE — see the header.
END;
$$;

COMMENT ON FUNCTION mark_student_risk_stale(INTEGER) IS
  'UPSERT helper: inserts a placeholder row if missing, otherwise flips is_stale=TRUE and refreshes section_id. Deliberately does NOT touch scores / signals / computed_at — those belong to the compute RPC (м5.4). SECURITY DEFINER so it bypasses RLS on student_risk_scores; the only write surfaces on this table are this helper and the compute RPC.';

-- =====================================================================
-- STEP 2 — Backfill placeholder rows for active students
-- =====================================================================
-- `IS NOT FALSE` treats NULL as active (defensive). ON CONFLICT
-- DO NOTHING makes the migration idempotent.
INSERT INTO student_risk_scores (student_id, section_id, is_stale)
SELECT s.id, s.section_id, TRUE
FROM students s
WHERE s.is_active IS NOT FALSE
ON CONFLICT (student_id) DO NOTHING;

-- =====================================================================
-- STEP 3 — Generic trigger wrapper (calls the helper with NEW.student_id)
-- =====================================================================
-- All 5 source tables expose NEW.student_id (NOT NULL on incidents /
-- cases / plans / sessions; recorded NULL-safe path on notes via the
-- IF below — student_notes.student_id is NOT NULL too, but the guard
-- is cheap defense).
CREATE OR REPLACE FUNCTION risk_score_mark_stale_from_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.student_id IS NOT NULL THEN
    PERFORM mark_student_risk_stale(NEW.student_id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION risk_score_mark_stale_from_row() IS
  'Generic AFTER trigger wrapper. PERFORMs mark_student_risk_stale(NEW.student_id) and RETURNs NEW. Registered against the 5 upstream source tables (student_incidents / student_cases / student_followup_plans / counseling_sessions / student_notes) — see the m5.3 migration for the registration list.';

-- =====================================================================
-- STEP 4 — Register triggers on the 5 source tables
-- =====================================================================

-- 4a. student_incidents — INSERT OR UPDATE OF status, severity
DROP TRIGGER IF EXISTS student_incidents_risk_stale_trigger ON student_incidents;
CREATE TRIGGER student_incidents_risk_stale_trigger
  AFTER INSERT OR UPDATE OF status, severity ON student_incidents
  FOR EACH ROW
  EXECUTE FUNCTION risk_score_mark_stale_from_row();

-- 4b. student_cases — INSERT OR UPDATE OF status, severity, reopen_count
DROP TRIGGER IF EXISTS student_cases_risk_stale_trigger ON student_cases;
CREATE TRIGGER student_cases_risk_stale_trigger
  AFTER INSERT OR UPDATE OF status, severity, reopen_count ON student_cases
  FOR EACH ROW
  EXECUTE FUNCTION risk_score_mark_stale_from_row();

-- 4c. student_followup_plans — INSERT OR UPDATE OF status, target_date
-- (student_id on plans is denormalised + synced by the BEFORE trigger
-- on the same table; our AFTER trigger sees the post-sync value.)
DROP TRIGGER IF EXISTS student_followup_plans_risk_stale_trigger ON student_followup_plans;
CREATE TRIGGER student_followup_plans_risk_stale_trigger
  AFTER INSERT OR UPDATE OF status, target_date ON student_followup_plans
  FOR EACH ROW
  EXECUTE FUNCTION risk_score_mark_stale_from_row();

-- 4d. counseling_sessions — INSERT ONLY (sessions are append-only;
-- their lifecycle doesn't include status changes from the counselor UI).
DROP TRIGGER IF EXISTS counseling_sessions_risk_stale_trigger ON counseling_sessions;
CREATE TRIGGER counseling_sessions_risk_stale_trigger
  AFTER INSERT ON counseling_sessions
  FOR EACH ROW
  EXECUTE FUNCTION risk_score_mark_stale_from_row();

-- 4e. student_notes — INSERT OR UPDATE OF type, is_confidential, case_id.
-- Edits to those three columns shift the signal counts:
--   type           — positive vs negative shifts engagement direction
--   is_confidential — confidential count is a signal of its own
--   case_id        — moving a note onto / off a case changes the
--                    case's attached-note count for the velocity signal
-- Other edits (text content, recorded_at) don't shift counts so we
-- don't trigger on them.
DROP TRIGGER IF EXISTS student_notes_risk_stale_trigger ON student_notes;
CREATE TRIGGER student_notes_risk_stale_trigger
  AFTER INSERT OR UPDATE OF type, is_confidential, case_id ON student_notes
  FOR EACH ROW
  EXECUTE FUNCTION risk_score_mark_stale_from_row();

-- =====================================================================
-- STEP 5 — Students wrapper + trigger (separate wrapper for NEW.id)
-- =====================================================================
CREATE OR REPLACE FUNCTION risk_score_mark_stale_from_student_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- students.id is the canonical student_id everywhere else.
  IF NEW.id IS NOT NULL THEN
    PERFORM mark_student_risk_stale(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION risk_score_mark_stale_from_student_row() IS
  'AFTER trigger wrapper specifically for the students table. Adapts NEW.id (the student PK) into the mark_student_risk_stale call — separate from risk_score_mark_stale_from_row() which reads NEW.student_id. Registered AFTER UPDATE OF section_id, is_active so a section move or deactivation refreshes the watchlist filter + flips stale for the next compute sweep.';

DROP TRIGGER IF EXISTS students_risk_stale_trigger ON students;
CREATE TRIGGER students_risk_stale_trigger
  AFTER UPDATE OF section_id, is_active ON students
  FOR EACH ROW
  EXECUTE FUNCTION risk_score_mark_stale_from_student_row();
