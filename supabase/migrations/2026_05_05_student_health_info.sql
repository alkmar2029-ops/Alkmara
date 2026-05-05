-- Track per-student health conditions so the school nurse, deputy,
-- and any teacher entering an attendance/dismissal flow can see at a
-- glance whether the student has a condition that affects emergency
-- response (diabetes → insulin, asthma → inhaler, epilepsy → seizure
-- protocol, allergies → epi-pen, etc.).
--
-- Shape: { "conditions": ["diabetes", "asthma"], "notes": "حر" }
-- A NULL column means "no health info recorded" (most students).

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS health_info JSONB DEFAULT NULL;

-- Index on the conditions array — most queries are "students with at
-- least one condition" or "students with X condition" for emergency
-- preparedness reports.
CREATE INDEX IF NOT EXISTS students_health_conditions_idx
  ON students USING GIN ((health_info -> 'conditions'))
  WHERE health_info IS NOT NULL;

-- Backfill nothing — existing rows stay NULL until edited.
