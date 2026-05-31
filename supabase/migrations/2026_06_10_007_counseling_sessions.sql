-- م4.4 — Counseling sessions table.
--
-- The heaviest table in Sprint 4: every counselor session writes
-- one row here, content encrypted at rest with pgp_sym_encrypt.
-- This is the inner sanctum of the privacy story — RLS + the
-- encryption layer together make the content unreadable to
-- anyone other than the counselor with the correct key.
--
-- =====================================================================
-- SCOPE OF THIS MIGRATION — table + indexes + sync trigger + RLS only.
-- =====================================================================
--   NOT included by deliberate design (deferred to follow-up
--   migrations after a separate key-management review):
--     - encrypt_session_content() helper
--     - decrypt_session_content() helper (must log to
--       confidential_access_log + verify caller scope)
--     - key-rotation tooling
--     - policies (land in م4.7 with the other Sprint 4 tables)
--
--   The migration does NOT embed any encryption key — no secret
--   appears in SQL or COMMENTS. The API performs encryption inline
--   at INSERT time via pgp_sym_encrypt($plaintext, $key), where
--   $key is sourced from the server-side env (Vercel /
--   Supabase secrets). The decrypt path comes in a later
--   migration with logging built in.
--
-- =====================================================================
-- Encryption model (for API integration reference)
-- =====================================================================
--   - content_encrypted BYTEA NOT NULL — output of pgp_sym_encrypt.
--     CHECK (octet_length > 0) ONLY catches empty / placeholder
--     bytea. It DOES NOT verify the bytes are PGP-encrypted —
--     any plaintext stuffed into a BYTEA passes the check. The
--     real encryption guarantee is the API layer + integration
--     tests + key-management discipline, NOT this CHECK. Don't
--     build a false security contract on it (Codex Sprint 4
--     review #1 — High).
--   - topic + content_preview are deliberately UNENCRYPTED:
--       topic = brief categorical label, used by search index.
--       content_preview = optional ≤160-char snippet, surfaced
--                         in lists without decryption. Counselor
--                         enters it manually; the UI surface
--                         must warn that it's not encrypted.
--   - duration_minutes / session_date / session_type are
--     metadata. Visible to anyone who passes the SELECT policy.
--
-- FK behavior:
--   case_id           → student_cases ON DELETE CASCADE.
--                       Sessions are subsidiary to the case; a
--                       super_admin case purge takes its sessions
--                       with it. (No archive concern — closed
--                       cases stay around; only explicit purge
--                       triggers this path.)
--   student_id        → students ON DELETE RESTRICT.
--                       Historical record preservation. Like
--                       plans, this column is denormalised from
--                       case.student_id and kept consistent by
--                       the sync trigger below.
--   counselor_user_id → auth.users NOT NULL + NO ACTION.
--                       Every session has a counselor; counselor
--                       deletion is rare (deactivate is the
--                       normal path).
--
-- RLS: ENABLE ROW LEVEL SECURITY (fail-closed). NO policies in
-- this migration — м4.7 batch lands them along with the
-- decrypt_session_content access-log policies. Until then, only
-- service-role / table owner can SELECT.

CREATE TABLE IF NOT EXISTS counseling_sessions (
  id                BIGSERIAL PRIMARY KEY,

  case_id           BIGINT  NOT NULL REFERENCES student_cases(id) ON DELETE CASCADE,
  -- Denormalised from case.student_id for fast Sprint 5 risk
  -- queries. Kept consistent by the sync trigger below
  -- (same pattern as student_followup_plans — Codex Sprint 4
  -- review #2).
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,

  counselor_user_id UUID    NOT NULL REFERENCES auth.users(id),

  session_date      DATE NOT NULL,

  session_type      VARCHAR(30) NOT NULL
                    CONSTRAINT counseling_sessions_type_check
                    CHECK (session_type IN (
                      'individual',  -- جلسة فردية
                      'group',       -- جلسة جماعية
                      'family',      -- جلسة عائلية
                      'parent',      -- لقاء ولي أمر
                      'assessment',  -- تقييم
                      'follow_up',   -- متابعة
                      'emergency'    -- طارئة
                    )),

  -- Plaintext, searchable. See encryption-model section in header
  -- for why this is intentionally not encrypted.
  topic             VARCHAR(200) NOT NULL,

  -- pgp_sym_encrypt output. The CHECK below only blocks empty /
  -- placeholder bytea — it CANNOT distinguish ciphertext from
  -- plaintext shoved into BYTEA. Real encryption guarantee is
  -- API + tests + key-management (see header). Named so future
  -- ALTER operations are explicit.
  content_encrypted BYTEA NOT NULL
                    CONSTRAINT counseling_sessions_content_nonempty_check
                    CHECK (octet_length(content_encrypted) > 0),

  -- Optional plaintext snippet. Counselor sets manually; UI
  -- surface MUST warn that this column is not encrypted. Length
  -- capped at 160 to make accidental verbatim-content paste
  -- obvious in code review.
  content_preview   VARCHAR(160),

  -- 1..240 = 1 min .. 4 hours. Without the upper bound a stray
  -- 32767 would poison reports + Sprint 5 risk aggregates (Codex
  -- Sprint 4 review #2). Named constraint for explicit ALTER later.
  duration_minutes  SMALLINT
                    CONSTRAINT counseling_sessions_duration_check
                    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 240),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============== Comments ==============
COMMENT ON TABLE counseling_sessions IS
  'Counselor session records. content_encrypted is the only column carrying verbatim session content — encrypted via pgp_sym_encrypt at the API layer. topic + content_preview are plaintext metadata. RLS enabled fail-closed; policies + decrypt helper land in م4.7 / follow-up migrations after key-management review.';

COMMENT ON COLUMN counseling_sessions.content_encrypted IS
  'pgp_sym_encrypt output. The CHECK constraint counseling_sessions_content_nonempty_check guards against empty / placeholder BYTEA only — it CANNOT verify ciphertext (any non-empty bytea passes). Encryption guarantee lives at the API + integration tests + key management discipline. Decrypt path = deferred decrypt_session_content helper.';

COMMENT ON COLUMN counseling_sessions.content_preview IS
  'Optional plaintext snippet (≤ 160 chars), counselor-authored, surfaces in lists without decryption. MUST NOT contain verbatim sensitive detail — that belongs in content_encrypted.';

COMMENT ON COLUMN counseling_sessions.topic IS
  'Plaintext label for search/filter. Brief categorical content — the verbatim narrative goes in content_encrypted.';

COMMENT ON COLUMN counseling_sessions.student_id IS
  'Denormalised from case.student_id. Kept consistent by the counseling_sessions_sync_student_id trigger — any caller-provided value is overwritten with case.student_id on INSERT or any UPDATE touching case_id/student_id.';

-- ============== Indexes ==============

-- 1. Per-case timeline (case detail page).
CREATE INDEX IF NOT EXISTS idx_sessions_case
  ON counseling_sessions (case_id, session_date DESC);

-- 2. Per-student history (Sprint 5 risk + multi-case students).
CREATE INDEX IF NOT EXISTS idx_sessions_student
  ON counseling_sessions (student_id, session_date DESC);

-- 3. Counselor's sessions ("my sessions" calendar view).
CREATE INDEX IF NOT EXISTS idx_sessions_counselor_date
  ON counseling_sessions (counselor_user_id, session_date DESC);

-- 4. Global date filter (admin reports, school-wide calendar).
CREATE INDEX IF NOT EXISTS idx_sessions_date
  ON counseling_sessions (session_date DESC);

-- ============== student_id sync trigger ==============
-- Mirrors student_followup_plans: forces student_id to match
-- case.student_id on every INSERT and on any UPDATE touching
-- case_id OR student_id. Same rationale + same listen-list
-- (Codex Sprint 4 review on م4.5 — the BEFORE OF case_id, student_id
-- variant prevents drift even via direct student_id overwrite).
CREATE OR REPLACE FUNCTION counseling_sessions_sync_student_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT student_id INTO NEW.student_id
    FROM student_cases
    WHERE id = NEW.case_id;

  IF NEW.student_id IS NULL THEN
    RAISE EXCEPTION 'counseling_sessions.case_id=% does not reference an existing case', NEW.case_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION counseling_sessions_sync_student_id() IS
  'BEFORE INSERT / UPDATE OF (case_id, student_id) trigger — overrides NEW.student_id with case.student_id so the denormalised copy never drifts. Raises a clean 23503 if case_id is invalid.';

DROP TRIGGER IF EXISTS counseling_sessions_sync_student_id_trigger ON counseling_sessions;
CREATE TRIGGER counseling_sessions_sync_student_id_trigger
  BEFORE INSERT OR UPDATE OF case_id, student_id ON counseling_sessions
  FOR EACH ROW
  EXECUTE FUNCTION counseling_sessions_sync_student_id();

-- ============== updated_at trigger ==============
CREATE OR REPLACE FUNCTION counseling_sessions_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION counseling_sessions_set_updated_at() IS
  'BEFORE UPDATE trigger function on counseling_sessions — bumps updated_at to NOW().';

DROP TRIGGER IF EXISTS counseling_sessions_updated_at_trigger ON counseling_sessions;
CREATE TRIGGER counseling_sessions_updated_at_trigger
  BEFORE UPDATE ON counseling_sessions
  FOR EACH ROW
  EXECUTE FUNCTION counseling_sessions_set_updated_at();

-- ============== Fail-closed RLS ==============
ALTER TABLE counseling_sessions ENABLE ROW LEVEL SECURITY;
