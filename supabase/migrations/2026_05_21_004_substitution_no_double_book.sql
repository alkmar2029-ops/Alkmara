-- Codex Sprint 2 review (م2.8): prevent a substitute from being
-- assigned to TWO different absences at the same date + period.
--
-- The existing UNIQUE in substitution_assignments is
--   (absence_id, day_of_week, period_number)
-- which prevents the same absence from having two subs at the same
-- slot. But it does NOT prevent ONE substitute from being booked
-- against two different absences in the same period — e.g., the VP
-- picks teacher X to cover Teacher A's period 3 AND Teacher B's
-- period 3 on the same day. The application-side suggester used to
-- miss this because it only checked teacher_schedule, not existing
-- assignments.
--
-- Fix: denormalise the parent absence_date as a column on
-- substitution_assignments, then UNIQUE on
--   (substitute_user_id, assignment_date, period_number).
--
-- Why denormalise? The UNIQUE can't reference a JOIN, and day_of_week
-- alone isn't enough — Sunday this week and Sunday next week would
-- collide. assignment_date pins to the specific calendar date. The
-- API layer keeps the column in sync; ON DELETE CASCADE from
-- daily_teacher_absences keeps drift impossible.

-- 1. Add the column. NULLable temporarily to allow backfill.
ALTER TABLE substitution_assignments
  ADD COLUMN IF NOT EXISTS assignment_date DATE;

-- 2. Backfill from the parent absence row. Idempotent — only fills
--    rows that still have NULL.
UPDATE substitution_assignments sa
SET assignment_date = a.absence_date
FROM daily_teacher_absences a
WHERE sa.absence_id = a.id
  AND sa.assignment_date IS NULL;

-- 3. Tighten to NOT NULL now that every row has a value. If any row
--    is still null (shouldn't happen — CASCADE prevents orphans),
--    this will fail loudly so we notice.
ALTER TABLE substitution_assignments
  ALTER COLUMN assignment_date SET NOT NULL;

-- 4. The new uniqueness guard. Idempotent: drop first if it exists.
ALTER TABLE substitution_assignments
  DROP CONSTRAINT IF EXISTS substitution_assignments_no_double_book;
ALTER TABLE substitution_assignments
  ADD CONSTRAINT substitution_assignments_no_double_book
  UNIQUE (substitute_user_id, assignment_date, period_number);

-- Supporting index — the constraint above creates an automatic unique
-- index, so no extra CREATE INDEX needed. Verify with \d in psql.

COMMENT ON COLUMN substitution_assignments.assignment_date IS
  'Denormalised from daily_teacher_absences.absence_date. Required by the no-double-book UNIQUE constraint; kept in sync by the assign API. CASCADE from the parent absence prevents drift.';

COMMENT ON CONSTRAINT substitution_assignments_no_double_book ON substitution_assignments IS
  'Prevents a single substitute from being assigned to multiple absences at the same date+period. Application-side check in /api/vp/substitutions/assign catches it first with a friendly 400; this constraint is the DB-level backstop for races.';
