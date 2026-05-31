-- م4.8 — Extend student_notes with confidentiality flag + case link.
--
-- Two new columns:
--   is_confidential BOOLEAN — visibility/RLS flag. When TRUE, only
--     counselors (and super_admin) see the row via the updated
--     policies in م4.7. Teachers see only is_confidential=FALSE
--     notes — same as today's behaviour.
--   case_id BIGINT — optional link to a counseling case. SET NULL
--     on case delete so a closed case's purge doesn't lose the
--     underlying note (the note may still be useful as the
--     student's general record).
--
-- IMPORTANT — "confidential" here means **visibility scope**,
-- NOT encryption:
--   student_notes.content_text remains plaintext in the DB. The
--   is_confidential flag controls who can SELECT the row, not
--   whether the content is encrypted at rest. Truly sensitive
--   detail (verbatim session content, mental-health notes, family
--   trauma context) belongs in counseling_sessions where the
--   content_encrypted column is pgp_sym-encrypted (م4.4). A
--   confidential student_note is a topic-level annotation
--   ("student mentioned anxiety about exams"), not a transcript.
--
-- RLS: this migration does NOT modify existing student_notes
-- policies (per the user's "لا policies جزئية" guidance — the
-- full policy set lands as one consistent batch in م4.7).
--
-- ⚠ Privacy footgun closed by a temporary CHECK ⚠
-- The existing student_notes RLS is broad (teachers + admins
-- see most rows). If any UI / API started setting
-- `is_confidential = TRUE` before م4.7 wired the confidential-
-- aware policies, the "confidential" row would still be visible
-- to non-counselors — the flag would be dormant but the data
-- would leak. To make this race impossible, this migration adds
-- a `CHECK (is_confidential = FALSE)` constraint that blocks
-- any TRUE write at the DB layer.
--
-- م4.7's first statement is the corresponding
-- `DROP CONSTRAINT IF EXISTS student_notes_confidential_disabled_until_rls`
-- — once the policies are in place, the flag is safe to set.
-- (Codex Sprint 4 review — High.)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS (Postgres 9.6+) and
-- CREATE INDEX IF NOT EXISTS make re-running safe.

-- ============== Add columns ==============
ALTER TABLE student_notes
  ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS case_id BIGINT;

-- FK is added separately so we can name it explicitly + make the
-- block idempotent via pg_constraint check (matches the pattern
-- used in م4.2 for incidents.case_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_notes_case_id_fk'
      AND conrelid = 'student_notes'::regclass
  ) THEN
    ALTER TABLE student_notes
      ADD CONSTRAINT student_notes_case_id_fk
      FOREIGN KEY (case_id) REFERENCES student_cases(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- Temporary "confidential disabled" guard. Validation is instant
-- because every existing row has is_confidential=FALSE (DEFAULT)
-- — no NOT VALID / VALIDATE dance needed. Idempotent via the
-- pg_constraint check (so re-running this migration in any
-- environment is safe).
--
-- DROPPED by م4.7 once the confidential-aware policies are live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_notes_confidential_disabled_until_rls'
      AND conrelid = 'student_notes'::regclass
  ) THEN
    ALTER TABLE student_notes
      ADD CONSTRAINT student_notes_confidential_disabled_until_rls
      CHECK (is_confidential = FALSE);
  END IF;
END;
$$;

-- ============== Comments ==============
COMMENT ON COLUMN student_notes.is_confidential IS
  'Visibility flag (NOT encryption). TRUE = only counselors / super_admin can SELECT the row once م4.7 lands. Until then, the student_notes_confidential_disabled_until_rls CHECK blocks any TRUE write at the DB layer so a partial UI rollout cannot leak confidential rows through the broad pre-م4.7 policies. The content remains plaintext at rest — verbatim sensitive detail belongs in counseling_sessions (pgp_sym-encrypted).';

COMMENT ON COLUMN student_notes.case_id IS
  'Optional link to student_cases. SET NULL on case delete — a closed case purge unlinks but does not lose the underlying note (it may still be a useful free-standing student record).';

-- ============== Indexes ==============

-- 1. Per-case timeline. Partial on the small subset of notes
--    that are actually linked to a case — most notes (teacher
--    daily annotations) won't have one.
CREATE INDEX IF NOT EXISTS idx_student_notes_case
  ON student_notes (case_id)
  WHERE case_id IS NOT NULL;

-- 2. Confidential notes per student. Partial on is_confidential
--    = TRUE so the index stays small (most notes are non-
--    confidential teacher comments). Supports the counselor case
--    workspace timeline that filters down to confidential entries.
--
--    If profiling later shows this is never used, it can be
--    dropped — the per-case index above covers most case-related
--    confidential lookups.
CREATE INDEX IF NOT EXISTS idx_student_notes_confidential_per_student
  ON student_notes (student_id, recorded_at DESC)
  WHERE is_confidential = TRUE;
