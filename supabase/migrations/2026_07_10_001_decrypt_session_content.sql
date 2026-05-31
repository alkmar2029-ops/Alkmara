-- م4.21.4 — decrypt_session_content RPC (the deferred read path).
--
-- Counterpart to create_counseling_session (migration 009): that one
-- ENCRYPTS + writes action='write'; this one DECRYPTS + writes
-- action='decrypt' to confidential_access_log. The session table
-- migration (007) explicitly deferred this helper "to a later migration
-- with logging built in, after a key-management review" — this is it.
--
-- =====================================================================
-- The load-bearing decisions are IDENTICAL to migration 009:
-- =====================================================================
--   * service_role ONLY. The function takes p_key as a parameter, so
--     GRANTing it to `authenticated` would let any in-scope counselor
--     POST an arbitrary key from the browser. The API gates with
--     requireCounselorWorkspace() then calls via the service-role admin
--     client, so the key NEVER travels through the browser.
--   * p_actor_user_id INSTEAD OF auth.uid(): under service-role the
--     function has no JWT context (auth.uid() is NULL). The API resolves
--     the validated caller via requireCounselorWorkspace() and passes it
--     explicitly; the function RE-VALIDATES scope against
--     counselor_assignments. Two-layer authz: API gate first, DB scope
--     re-check second.
--   * The audit row's accessed_by is the API-validated p_actor_user_id,
--     never a caller-supplied UUID. student_id is resolved canonically
--     from the session's case, never trusted from the caller.
--
-- WHY a READ needs an audit row: reading a minor's verbatim counseling
-- content is the single most sensitive operation in the system. PRIV-01
-- (confidential_access_log) had honest coverage for WRITES only until
-- now; this closes the loop so every DECRYPT is attributable — the
-- accountability guarantee the code comments promised.
--
-- WHAT IS NEVER LOGGED:
--   - p_key — used only inside pgp_sym_decrypt, never echoed.
--   - the decrypted plaintext — RETURNED to the caller over TLS, but
--     never written to the audit row. Only the FACT of access is logged.
--   - A failed decrypt (wrong / rotated key) writes NO row — only a
--     successful read is a real confidential-content access.

CREATE OR REPLACE FUNCTION decrypt_session_content(
  p_actor_user_id UUID,
  p_session_id    BIGINT,
  p_key           TEXT,
  -- best-effort audit metadata, both NULL if the API can't source them
  p_ip_address    TEXT DEFAULT NULL,
  p_user_agent    TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
-- pgcrypto lives in `extensions` on managed Supabase; we add it to the
-- locked search_path so pgp_sym_decrypt resolves without a fully-
-- qualified name. `public` stays first so all relation lookups
-- (counseling_sessions, counselor_assignments, ...) resolve as expected.
SET search_path = public, extensions
AS $$
DECLARE
  v_student_id INTEGER;
  v_cipher     BYTEA;
  v_plain      TEXT;
BEGIN
  -- ----- 1. Resolve session → student + ciphertext. NULL → fail-closed.
  -- Same 42501 errcode as scope-fail so the caller can't distinguish
  -- "non-existent session" from "out of scope".
  SELECT cs.student_id, cs.content_encrypted
    INTO v_student_id, v_cipher
    FROM counseling_sessions cs
    WHERE cs.id = p_session_id;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'insufficient_privilege';
  END IF;

  -- ----- 2. Scope check on p_actor_user_id (DB-side defense-in-depth).
  -- Identical predicate to create_counseling_session: super_admin full
  -- pass, else role IN admin/super_admin AND persona='counselor' AND a
  -- counselor_assignment matching the student (section-direct OR
  -- grade-wide).
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

  -- ----- 3. Decrypt. A wrong / rotated key raises inside pgp_sym_decrypt
  -- ('Wrong key or corrupt data'); we let it propagate so the API maps
  -- the non-42501 error to a generic 500. No audit row is written on a
  -- failed decrypt — only successful reads are attributable accesses.
  v_plain := pgp_sym_decrypt(v_cipher, p_key);

  -- ----- 4. Audit the successful read. action='decrypt' is distinct
  -- from the 'write' rows create_counseling_session emits and the 'read'
  -- rows the metadata GET handlers emit.
  INSERT INTO confidential_access_log (
    accessed_by, table_name, record_id, student_id, action,
    ip_address, user_agent
  )
  VALUES (
    p_actor_user_id, 'counseling_sessions', p_session_id::text, v_student_id, 'decrypt',
    p_ip_address, p_user_agent
  );

  RETURN v_plain;
END;
$$;

COMMENT ON FUNCTION decrypt_session_content(uuid, bigint, text, text, text) IS
  'Decrypts ONE counseling_sessions row and writes a confidential_access_log action=''decrypt'' entry. Service-role ONLY — never grant to authenticated (it takes p_key, which would let a counselor submit an arbitrary key from the browser). p_actor_user_id is validated by the API (requireCounselorWorkspace) before the call; the function re-checks scope via counselor_assignments. The decrypted plaintext is RETURNED but never logged; p_key is never echoed; a failed decrypt writes no audit row. Counterpart to create_counseling_session (migration 009).';

-- =====================================================================
-- PERMISSIONS — STRICTLY service-role (mirror migration 009).
-- =====================================================================
-- Lowercase canonical type names in the signature because Postgres
-- normalises types in pg_proc (TEXT/UUID/BIGINT stay as-is here).
REVOKE ALL ON FUNCTION decrypt_session_content(uuid, bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION decrypt_session_content(uuid, bigint, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION decrypt_session_content(uuid, bigint, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION decrypt_session_content(uuid, bigint, text, text, text) TO service_role;
