-- Adds social/custody tracking to students.
--
-- social_info JSONB schema (all fields optional, see lib/validations/schemas.ts):
--   {
--     custody_type:        'father' | 'mother' | 'shared' | 'guardian' | 'other',
--     authorized_pickup:   string[],   // names allowed to take the student home
--     blocked_pickup:      string[],   // names that MUST NOT take the student
--     documentation_status:'verified' | 'pending' | 'missing',
--     court_ref:           string,     // legal/court reference
--     emergency_contact:   { name, phone, relation },
--     notes:               string      // free-text, sensitive — don't expose in non-admin/staff UIs
--   }
--
-- Surfaces in: student form, student detail page, daily-attendance drawer,
-- teacher attendance roster, and the dismissal blocking flow (Phase C).

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS social_info JSONB DEFAULT NULL;

-- GIN index on the custody_type so the students-page filter can do
-- "show me all kids with father-custody" without a full scan.
CREATE INDEX IF NOT EXISTS students_social_custody_idx
  ON students ((social_info ->> 'custody_type'))
  WHERE social_info IS NOT NULL;

-- Partial index for the documentation status filter — the common queries
-- are "show me everyone with missing docs" and "verified custody".
CREATE INDEX IF NOT EXISTS students_social_docs_idx
  ON students ((social_info ->> 'documentation_status'))
  WHERE social_info IS NOT NULL;

COMMENT ON COLUMN students.social_info IS
  'JSONB: custody/social conditions. Powers dismissal blocking + filters. See migration 2026_05_06.';
