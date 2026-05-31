-- daily_teacher_absences — teacher absence log driving the VP's
-- substitution workflow (م2.4-2.9).
--
-- One row per (teacher, date). The VP marks a teacher absent and the
-- system then surfaces their scheduled periods on the substitutions
-- screen so the VP can pick a substitute for each one. The UNIQUE
-- constraint prevents duplicate absences (the same teacher marked
-- twice on the same day) — a re-mark just updates the existing row
-- via the API layer.
--
-- Reads: admin family + staff + teacher (own rows only).
-- Writes: super_admin OR users with the manage_substitutions flag.
--   This mirrors the eventual API gate; the flag is the VP-academic
--   capability that lets a VP run the daily substitution workflow.
--   General-admin / principal / general_admin get the flag set
--   alongside their other powers.
--
-- Cascading: ON DELETE CASCADE on teacher_user_id so removing a
-- teacher account also clears their absence history. assigned_by
-- column is SET NULL to keep absence rows alive even if the reporter
-- account is deleted.

CREATE TABLE IF NOT EXISTS daily_teacher_absences (
  id                BIGSERIAL PRIMARY KEY,
  teacher_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  absence_date      DATE NOT NULL,

  -- Free-text-but-capped reason. The UI surfaces a fixed dropdown
  -- (sick / personal / official / other) but stores it as text so we
  -- don't need a migration to add a category later.
  reason            VARCHAR(50),
  expected_return   DATE,
  notes             TEXT,

  reported_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One absence row per (teacher, date). Re-marking just updates the
  -- existing row via the API layer; the constraint catches accidental
  -- duplicates from concurrent submissions.
  UNIQUE (teacher_user_id, absence_date)
);

-- Hot path: "who's absent today?" — sort by absence_date DESC and
-- filter by date range. The composite avoids a separate teacher-id
-- index for the most common query.
CREATE INDEX IF NOT EXISTS daily_teacher_absences_date_idx
  ON daily_teacher_absences (absence_date DESC, teacher_user_id);

-- Reverse lookup: "show me this teacher's absence history". Used by
-- their profile page + smart alerts ("3 days this week").
CREATE INDEX IF NOT EXISTS daily_teacher_absences_teacher_idx
  ON daily_teacher_absences (teacher_user_id, absence_date DESC);

-- ============= RLS =============
ALTER TABLE daily_teacher_absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_teacher_absences_read  ON daily_teacher_absences;
DROP POLICY IF EXISTS daily_teacher_absences_write ON daily_teacher_absences;

-- Read: admin family + staff (front-desk needs visibility) + teacher's
-- own rows (so they see what's recorded against them and can dispute).
-- The teacher self-read is intentional: a missing day on their own
-- attendance record is something they should notice.
CREATE POLICY daily_teacher_absences_read
  ON daily_teacher_absences
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR current_user_role() = 'staff'
    OR teacher_user_id = auth.uid()
  );

-- Write: super_admin OR users with manage_substitutions flag. Note we
-- deliberately don't use is_admin() here — counselor carries role=admin
-- (with persona='counselor'), and a counselor should NOT be able to
-- mark teachers absent. The flag is the precise gate (Codex lesson
-- from م1.2).
CREATE POLICY daily_teacher_absences_write
  ON daily_teacher_absences
  FOR ALL TO authenticated
  USING (
    current_user_role() = 'super_admin'
    OR current_user_has_flag('manage_substitutions')
  )
  WITH CHECK (
    current_user_role() = 'super_admin'
    OR current_user_has_flag('manage_substitutions')
  );

COMMENT ON TABLE daily_teacher_absences IS
  'Per-day teacher absence log. Drives the substitution workflow. One row per (teacher, date); the unique constraint prevents accidental double-marking. RLS write-gated by super_admin OR manage_substitutions flag (not is_admin — counselors carry role=admin and must not write here).';

COMMENT ON COLUMN daily_teacher_absences.reason IS
  'Free-text but capped at 50 chars. UI uses a fixed dropdown (sick/personal/official/other); stored as text so categories can evolve without a schema change.';

COMMENT ON COLUMN daily_teacher_absences.expected_return IS
  'Optional. Lets the UI compute "still absent today" without re-prompting the VP every day for multi-day leave.';
