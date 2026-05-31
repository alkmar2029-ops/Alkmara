-- م4.21.3-prep — RPC for encrypting + inserting a counseling session.
--
-- This is the FIRST production write of content_encrypted (counseling
-- session bodies). It is also the FIRST production write to
-- confidential_access_log — we record `action='write'` inside the same
-- function so the audit channel is honest from session #1.
--
-- =====================================================================
-- WHY service-role ONLY (the load-bearing decision)
-- =====================================================================
-- An RPC that accepts a `p_key` parameter is vulnerable to a caller-
-- supplied-key attack. If GRANT EXECUTE were given to `authenticated`,
-- any counselor-in-scope could POST this RPC directly from the
-- browser with an arbitrary `p_key`, producing a row that:
--   - Passes RLS (correct counselor_user_id + case_id)
--   - Survives the scope check inside the function
--   - Writes the audit log line (action='write' SUCCESS)
--   - BUT content_encrypted is unreadable by the canonical key
--
-- That row would survive every read query AND every audit until
-- decrypt_session_content() finally fired against it, at which point
-- the failure surfaces too late and without a clear culprit. This is
-- a data-integrity incident, not a leak — but it's a serious one.
--
-- Mitigation:
--   - REVOKE EXECUTE FROM PUBLIC, authenticated, anon
--   - GRANT EXECUTE only TO service_role
--   - The API gates with requireCounselorWorkspace() in app code
--   - Then calls via createAdminSupabaseClient (service_role)
--   - The key NEVER travels through the browser
--
-- =====================================================================
-- WHY p_actor_user_id INSTEAD OF auth.uid()
-- =====================================================================
-- Under service-role the function has no JWT context, so auth.uid()
-- returns NULL. The API resolves the validated caller's ID via
-- requireCounselorWorkspace() and passes it explicitly. The function
-- then re-validates scope using p_actor_user_id against
-- counselor_assignments + sections/students. Two-layer authorization:
-- API gate FIRST, DB scope re-check SECOND.
--
-- The validated UUID also becomes counseling_sessions.counselor_user_id
-- and confidential_access_log.accessed_by — both audit attributions
-- match the API-validated caller, not a caller-supplied UUID.
--
-- =====================================================================
-- KEY ROTATION POLICY (binding decision, documented for the future)
-- =====================================================================
-- The COUNSELING_SESSION_KEY env is generated ONCE and treated as
-- immutable for the life of the existing ciphertext. Any rotation
-- REQUIRES a dedicated migration that:
--   1. Decrypts every counseling_sessions.content_encrypted with the
--      OLD key (this is the ONLY context where decrypt outside the
--      API is permitted — the migration runs as superuser).
--   2. Re-encrypts each row with the NEW key.
--   3. Atomically swaps the env at the same deploy as the migration.
--
-- Hot rotation IS NOT SUPPORTED. Mixing keys would leave half the
-- rows unreadable forever. Treat key rotation like a major
-- maintenance window; plan ≥1 month ahead.
--
-- =====================================================================
-- WHAT IS NEVER LOGGED
-- =====================================================================
--   - p_content (plaintext) — used only as pgp_sym_encrypt's input,
--     never referenced again.
--   - p_key — used only inside pgp_sym_encrypt, never echoed.
--   - The error path uses ERRCODE '42501' (insufficient_privilege)
--     for scope failures — no message body that leaks why.
--   - p_content_preview IS preserved verbatim because it's
--     plaintext-by-design (м4.4 schema decision).
--
-- =====================================================================
-- WHAT IS LOGGED to confidential_access_log
-- =====================================================================
--   - accessed_by:  the API-validated p_actor_user_id (never the
--                   caller-supplied UUID).
--   - action:       'write' (distinct from the future 'decrypt' rows
--                   that will appear when decrypt_session_content fires).
--   - student_id:   resolved canonically from the case (NOT trusted
--                   from the caller).
--   - ip_address:   best-effort from API headers (NULL if unavailable).
--                   The API passes this without failing the request
--                   when the source header is absent.
--   - user_agent:   best-effort from API headers (NULL if unavailable).
--                   Same fallback discipline as ip_address.
-- The audit scope is INTENTIONALLY narrow — this RPC logs ONLY
-- counseling_sessions writes. student_notes and student_followup_plans
-- write paths do NOT extend the audit channel yet; that requires a
-- separate policy review so the log doesn't become noisy with non-
-- encrypted content writes.

-- =====================================================================
-- FUNCTION
-- =====================================================================
CREATE OR REPLACE FUNCTION create_counseling_session(
  p_actor_user_id    UUID,
  p_case_id          BIGINT,
  p_session_date     DATE,
  p_session_type     VARCHAR(30),
  p_topic            VARCHAR(200),
  p_content          TEXT,
  p_content_preview  VARCHAR(160),
  p_duration_minutes SMALLINT,
  p_key              TEXT,
  -- best-effort audit metadata, both NULL if the API can't source them
  p_ip_address       TEXT DEFAULT NULL,
  p_user_agent       TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
-- pgcrypto lives in `extensions` schema on managed Supabase; we add it
-- to the locked search_path so pgp_sym_encrypt resolves without needing
-- a fully-qualified name inline. `public` stays first so all relation
-- lookups in this function (counseling_sessions, student_cases, etc.)
-- resolve as expected; `extensions` only contributes pgcrypto.
SET search_path = public, extensions
AS $$
DECLARE
  v_id         BIGINT;
  v_student_id INTEGER;
BEGIN
  -- ----- 1. Resolve canonical student_id from case -----
  -- Doubles as a "does case exist" check. NULL → fail-closed.
  -- We intentionally use the same 42501 errcode as scope-fail so the
  -- caller can't distinguish "non-existent" from "out of scope".
  SELECT student_id INTO v_student_id
    FROM student_cases
    WHERE id = p_case_id;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'insufficient_privilege';
  END IF;

  -- ----- 2. Scope check on p_actor_user_id (DB-side defense-in-depth) -----
  -- super_admin: full pass.
  -- counselor: role IN admin/super_admin AND persona='counselor' AND
  --   has a counselor_assignment matching the case's student
  --   (section direct OR grade-wide).
  IF NOT (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = p_actor_user_id
        AND up.role = 'super_admin'
    )
    OR EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = p_actor_user_id
        AND up.role IN ('admin', 'super_admin')
        AND up.permissions ->> 'persona' = 'counselor'
        AND (
          EXISTS (
            SELECT 1
            FROM counselor_assignments ca
            JOIN students s ON s.section_id = ca.section_id
            WHERE ca.counselor_user_id = p_actor_user_id
              AND s.id = v_student_id
          )
          OR EXISTS (
            SELECT 1
            FROM counselor_assignments ca
            JOIN students s   ON s.id = v_student_id
            JOIN sections sec ON sec.id = s.section_id
            WHERE ca.counselor_user_id = p_actor_user_id
              AND ca.grade_id = sec.grade_id
          )
        )
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'insufficient_privilege';
  END IF;

  -- ----- 3. INSERT counseling_sessions with inline encrypt -----
  -- pgp_sym_encrypt(p_content, p_key) → bytea ciphertext.
  -- counselor_user_id is the API-validated p_actor_user_id (not a
  -- caller-supplied UUID) so audit attribution stays honest.
  INSERT INTO counseling_sessions (
    case_id, counselor_user_id, session_date, session_type, topic,
    content_encrypted, content_preview, duration_minutes
  )
  VALUES (
    p_case_id,
    p_actor_user_id,
    p_session_date,
    p_session_type,
    p_topic,
    pgp_sym_encrypt(p_content, p_key),
    p_content_preview,
    p_duration_minutes
  )
  RETURNING id INTO v_id;

  -- ----- 4. First production write to the audit channel -----
  -- action='write' distinguishes this from the future 'decrypt'
  -- rows (deferred to a separate decrypt_session_content function).
  -- ip_address / user_agent are best-effort — NULL when the API
  -- couldn't source them from the request headers. The DB column
  -- types tolerate NULL, so there's no failure path here.
  INSERT INTO confidential_access_log (
    accessed_by, table_name, record_id, student_id, action,
    ip_address, user_agent
  )
  VALUES (
    p_actor_user_id, 'counseling_sessions', v_id::text, v_student_id, 'write',
    p_ip_address, p_user_agent
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION create_counseling_session(uuid, bigint, date, varchar, varchar, text, varchar, smallint, text, text, text) IS
  'Encrypts + INSERTs a counseling session row and writes the confidential_access_log entry. Service-role only — never grant to authenticated, because that would let a counselor submit their own p_key and produce undecryptable rows. p_actor_user_id is validated by the API (requireCounselorWorkspace) before this call; the function re-checks scope via counselor_assignments. p_ip_address / p_user_agent are best-effort audit metadata (default NULL). Key rotation requires a re-encrypt migration — no hot rotation.';

-- =====================================================================
-- PERMISSIONS — STRICTLY service-role
-- =====================================================================
-- The signature uses lowercase canonical type names (varchar/text/uuid
-- etc.) because Postgres normalises types in pg_proc — VARCHAR(30) and
-- VARCHAR(200) both appear as `character varying` in the catalog, so
-- a length-modified GRANT/REVOKE would fail to find the function.

REVOKE ALL ON FUNCTION create_counseling_session(uuid, bigint, date, varchar, varchar, text, varchar, smallint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_counseling_session(uuid, bigint, date, varchar, varchar, text, varchar, smallint, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION create_counseling_session(uuid, bigint, date, varchar, varchar, text, varchar, smallint, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION create_counseling_session(uuid, bigint, date, varchar, varchar, text, varchar, smallint, text, text, text) TO service_role;
