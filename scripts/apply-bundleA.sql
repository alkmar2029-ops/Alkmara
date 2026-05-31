-- ===========================================================
-- apply-bundleA.sql  (Wave A staging apply — Bundle A, safe set)
-- Concatenation of the 6 MISSING idempotent migrations, in apply order.
-- EXCLUDES 2026_07_06_002_pg_cron_worker_jobs — apply that one SEPARATELY
-- (it needs pg_cron/pg_net/supabase_vault extensions + Vault secrets and
-- starts per-minute cron traffic).
--
-- HOW TO USE: paste this whole file into the Supabase SQL Editor on the
-- linked project and Run once. It executes as a single transaction
-- (all-or-nothing). Safe to re-run: every statement is CREATE OR REPLACE
-- / IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- AFTER applying: A4 decrypt also needs COUNSELING_SESSION_KEY set in the
-- app env (same key used to create the sessions), else the endpoint 503s.
-- ===========================================================


-- ============================ >>> supabase/migrations/2026_07_05_001_school_reports_flag.sql

-- Add `view_school_reports` permission flag for principal aggregate
-- surfaces (Sprint 6 — م6.3).
--
-- =====================================================================
-- WHAT THIS FLAG IS / IS NOT
-- =====================================================================
-- IS:    access to school-wide AGGREGATED metrics — case/plan/session
--        counts، risk distribution BUCKETS، notes counts (confidential/
--        non-confidential at school level only). All views go through
--        a k-anonymity threshold of n>=5 per grade row before any
--        per-grade field is exposed.
--
-- IS NOT: a license to drill down. SPECIFICALLY:
--           - No student names, no top-N students
--           - No per-section breakdown (only per-grade in v1)
--           - No note content / session topic / case title
--           - No average risk score (only buckets)
--           - No counselor-attributed activity (deanonymization risk)
--
-- ANY future expansion of those NOT items requires a SEPARATE privacy
-- review and likely a SEPARATE flag — not a quiet widening of this one.
-- This commitment is anchored here (DB-level COMMENT) so a code reader
-- six months from now sees the boundary on first encounter, not in a
-- separate doc.
--
-- =====================================================================
-- RELATIONSHIP TO view_confidential_notes
-- =====================================================================
-- `view_confidential_notes` (Sprint 1) = read CONTENT of confidential
-- notes (PII). Still gated behind a deferred privacy review.
-- `view_school_reports`     (Sprint 6) = read DERIVED AGGREGATES of
-- confidential-related counts (e.g. "Grade 7 has 8 active cases"),
-- protected by n>=5 k-anonymity. These are categorically different
-- surfaces and intentionally NOT chained — granting one does not
-- grant the other.
--
-- =====================================================================
-- STORAGE
-- =====================================================================
-- The flag lives in `user_profiles.permissions` JSONB. No new column,
-- no schema migration. This file's job is to:
--   1. Update the COMMENT on the permissions column to enumerate the
--      new key (single source of truth for DBA / new engineers).
--   2. Provide a one-time grant query template (commented out).

COMMENT ON COLUMN user_profiles.permissions IS
  'JSONB capability flags + persona identifier for admins.

Persona keys (string):
  persona:  "principal" | "vice_principal" | "counselor" | "general_admin"
  vp_scope: "academic" | "administrative" | "student_affairs" | "general"

Existing flags (10, all bool):
  take_attendance, manage_dismissals, write_notes, send_whatsapp,
  view_reports, manage_students, manage_users, override_pickup,
  manage_schedule, manage_settings

VP flags (4, all bool):
  manage_substitutions, manage_incidents, approve_teacher_leave,
  view_morning_dashboard

Counselor flags (7, all bool):
  manage_counseling_sessions, manage_cases, manage_followup_plans,
  view_confidential_notes, view_health_info, view_social_info,
  view_risk_watchlist

Shared flags (2, all bool):
  review_teacher_incidents, escalate_to_case

Principal flags (1, all bool):           -- ADDED 2026-07-05 (Sprint 6 / م6.3)
  view_school_reports — access to school-wide AGGREGATED reports
                        (k-anonymity n>=5 applied per grade). Does NOT
                        grant drill-down, names, or content access.
                        See migration 2026_07_05_001_school_reports_flag.sql
                        for the full privacy boundary.

Persona/vp_scope values are protected by CHECK constraints (see
2026_05_20_extend_permissions.sql).';

-- Template (commented out) — operators run manually per principal:
--   UPDATE user_profiles
--   SET    permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb),
--                                  '{view_school_reports}', 'true'::jsonb)
--   WHERE  user_id = '<principal-user-uuid>';


-- ============================ >>> supabase/migrations/2026_07_06_001_fix_period_attendance_scope.sql

-- P1.2: restore scoped writes for period attendance after the 2026_04_30
-- source-column patch accidentally replaced the tighter 2026_04_29 RPC body.
--
-- Fixes:
--   1. save_period_attendance re-checks section scope for teacher/admin callers.
--   2. recorded_by is derived from auth.uid(), not trusted from the client.
--   3. direct PostgREST INSERT/UPDATE/DELETE policies for period_sessions and
--      period_absences are scoped to the caller's assigned sections.

CREATE OR REPLACE FUNCTION save_period_attendance(
  p_section_id      INTEGER,
  p_period_id       INTEGER,
  p_attendance_date DATE,
  p_recorded_by     UUID,
  p_notes           TEXT,
  p_absences        JSONB
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id    BIGINT;
  v_total         INT;
  v_absent_count  INT;
  v_late_count    INT;
  v_excused_count INT;
  v_role          TEXT;
  v_actor         UUID;
BEGIN
  v_role := current_user_role();
  v_actor := auth.uid();

  IF v_role NOT IN ('super_admin', 'admin', 'staff', 'teacher') OR v_actor IS NULL THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_recorded_by IS NOT NULL AND p_recorded_by <> v_actor AND v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'recorded_by must match the authenticated user' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'teacher' AND NOT EXISTS (
    SELECT 1
      FROM teacher_section_assignments
     WHERE teacher_user_id = v_actor
       AND section_id = p_section_id
  ) THEN
    RAISE EXCEPTION 'teacher is not assigned to this section' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'admin' AND NOT EXISTS (
    SELECT 1
      FROM admin_section_assignments
     WHERE admin_user_id = v_actor
       AND section_id = p_section_id
  ) THEN
    RAISE EXCEPTION 'admin is not assigned to this section' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)
    INTO v_total
    FROM students
   WHERE section_id = p_section_id
     AND is_active = true;

  SELECT
      COUNT(*) FILTER (WHERE x->>'status' = 'absent'),
      COUNT(*) FILTER (WHERE x->>'status' = 'late'),
      COUNT(*) FILTER (WHERE x->>'status' = 'excused')
    INTO v_absent_count, v_late_count, v_excused_count
    FROM jsonb_array_elements(COALESCE(p_absences, '[]'::jsonb)) AS x;

  INSERT INTO period_sessions (
    section_id, period_id, attendance_date,
    recorded_by, recorded_at,
    absent_count, late_count, excused_count, total_count,
    notes
  ) VALUES (
    p_section_id, p_period_id, p_attendance_date,
    v_actor, NOW(),
    v_absent_count, v_late_count, v_excused_count, v_total,
    NULLIF(p_notes, '')
  )
  ON CONFLICT (section_id, period_id, attendance_date) DO UPDATE
    SET recorded_by   = EXCLUDED.recorded_by,
        recorded_at   = EXCLUDED.recorded_at,
        absent_count  = EXCLUDED.absent_count,
        late_count    = EXCLUDED.late_count,
        excused_count = EXCLUDED.excused_count,
        total_count   = EXCLUDED.total_count,
        notes         = EXCLUDED.notes
  RETURNING id INTO v_session_id;

  DELETE FROM period_absences WHERE session_id = v_session_id;

  IF COALESCE(jsonb_array_length(p_absences), 0) > 0 THEN
    INSERT INTO period_absences (session_id, student_id, status, notes, source)
    SELECT
        v_session_id,
        (x->>'student_id')::int,
        x->>'status',
        NULLIF(x->>'notes', ''),
        COALESCE(NULLIF(x->>'source', ''), 'manual')
      FROM jsonb_array_elements(p_absences) AS x;
  END IF;

  RETURN json_build_object(
    'session_id', v_session_id,
    'absent',     v_absent_count,
    'late',       v_late_count,
    'excused',    v_excused_count,
    'total',      v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION save_period_attendance(INTEGER, INTEGER, DATE, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_period_attendance(INTEGER, INTEGER, DATE, UUID, TEXT, JSONB) TO authenticated;

DROP POLICY IF EXISTS "period_sessions ins" ON period_sessions;
CREATE POLICY "period_sessions ins"
  ON period_sessions FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR current_user_role() = 'staff'
    OR (
      current_user_role() = 'admin'
      AND section_id IN (
        SELECT section_id FROM admin_section_assignments
        WHERE admin_user_id = auth.uid()
      )
    )
    OR (
      current_user_role() = 'teacher'
      AND section_id IN (
        SELECT section_id FROM teacher_section_assignments
        WHERE teacher_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "period_sessions upd" ON period_sessions;
CREATE POLICY "period_sessions upd"
  ON period_sessions FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR current_user_role() = 'staff'
    OR (
      current_user_role() = 'admin'
      AND section_id IN (
        SELECT section_id FROM admin_section_assignments
        WHERE admin_user_id = auth.uid()
      )
    )
    OR (
      current_user_role() = 'teacher'
      AND section_id IN (
        SELECT section_id FROM teacher_section_assignments
        WHERE teacher_user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    is_super_admin()
    OR current_user_role() = 'staff'
    OR (
      current_user_role() = 'admin'
      AND section_id IN (
        SELECT section_id FROM admin_section_assignments
        WHERE admin_user_id = auth.uid()
      )
    )
    OR (
      current_user_role() = 'teacher'
      AND section_id IN (
        SELECT section_id FROM teacher_section_assignments
        WHERE teacher_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "period_sessions del admin" ON period_sessions;
CREATE POLICY "period_sessions del admin"
  ON period_sessions FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      current_user_role() = 'admin'
      AND section_id IN (
        SELECT section_id FROM admin_section_assignments
        WHERE admin_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "period_absences ins" ON period_absences;
CREATE POLICY "period_absences ins"
  ON period_absences FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR current_user_role() = 'staff'
    OR EXISTS (
      SELECT 1
        FROM period_sessions ps
       WHERE ps.id = period_absences.session_id
         AND (
           (
             current_user_role() = 'admin'
             AND ps.section_id IN (
               SELECT section_id FROM admin_section_assignments
               WHERE admin_user_id = auth.uid()
             )
           )
           OR (
             current_user_role() = 'teacher'
             AND ps.section_id IN (
               SELECT section_id FROM teacher_section_assignments
               WHERE teacher_user_id = auth.uid()
             )
           )
         )
    )
  );

DROP POLICY IF EXISTS "period_absences upd" ON period_absences;
CREATE POLICY "period_absences upd"
  ON period_absences FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR current_user_role() = 'staff'
    OR EXISTS (
      SELECT 1
        FROM period_sessions ps
       WHERE ps.id = period_absences.session_id
         AND (
           (
             current_user_role() = 'admin'
             AND ps.section_id IN (
               SELECT section_id FROM admin_section_assignments
               WHERE admin_user_id = auth.uid()
             )
           )
           OR (
             current_user_role() = 'teacher'
             AND ps.section_id IN (
               SELECT section_id FROM teacher_section_assignments
               WHERE teacher_user_id = auth.uid()
             )
           )
         )
    )
  )
  WITH CHECK (
    is_super_admin()
    OR current_user_role() = 'staff'
    OR EXISTS (
      SELECT 1
        FROM period_sessions ps
       WHERE ps.id = period_absences.session_id
         AND (
           (
             current_user_role() = 'admin'
             AND ps.section_id IN (
               SELECT section_id FROM admin_section_assignments
               WHERE admin_user_id = auth.uid()
             )
           )
           OR (
             current_user_role() = 'teacher'
             AND ps.section_id IN (
               SELECT section_id FROM teacher_section_assignments
               WHERE teacher_user_id = auth.uid()
             )
           )
         )
    )
  );

DROP POLICY IF EXISTS "period_absences del admin" ON period_absences;
CREATE POLICY "period_absences del admin"
  ON period_absences FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1
        FROM period_sessions ps
       WHERE ps.id = period_absences.session_id
         AND current_user_role() = 'admin'
         AND ps.section_id IN (
           SELECT section_id FROM admin_section_assignments
           WHERE admin_user_id = auth.uid()
         )
    )
  );


-- ============================ >>> supabase/migrations/2026_07_06_003_whatsapp_bulk_quota.sql

-- Durable daily quota for bulk WhatsApp recipient volume.
--
-- The short-window request limiter is intentionally in-process, but the
-- daily recipient cap protects real Wasender cost and must survive Vercel
-- multi-instance fanout and cold starts. This table stores one counter per
-- sender per school-local date. The API passes the Riyadh date explicitly.

CREATE TABLE IF NOT EXISTS whatsapp_bulk_usage (
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date       DATE NOT NULL,
  recipients_used  INTEGER NOT NULL DEFAULT 0 CHECK (recipients_used >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE whatsapp_bulk_usage ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON whatsapp_bulk_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE ON whatsapp_bulk_usage TO service_role;

DROP POLICY IF EXISTS "whatsapp_bulk_usage read own" ON whatsapp_bulk_usage;
CREATE POLICY "whatsapp_bulk_usage read own"
  ON whatsapp_bulk_usage FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

CREATE OR REPLACE FUNCTION reserve_whatsapp_bulk_quota(
  p_user_id UUID,
  p_usage_date DATE,
  p_recipient_count INTEGER,
  p_daily_limit INTEGER DEFAULT 1500
)
RETURNS TABLE (
  ok BOOLEAN,
  used_before INTEGER,
  used_after INTEGER,
  remaining INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_current INTEGER;
  v_after INTEGER;
BEGIN
  IF p_user_id IS NULL
     OR p_usage_date IS NULL
     OR p_recipient_count IS NULL
     OR p_recipient_count < 0
     OR p_daily_limit <= 0 THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0;
    RETURN;
  END IF;

  INSERT INTO whatsapp_bulk_usage (user_id, usage_date, recipients_used)
  VALUES (p_user_id, p_usage_date, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT recipients_used
    INTO v_current
    FROM whatsapp_bulk_usage
   WHERE user_id = p_user_id
     AND usage_date = p_usage_date
   FOR UPDATE;

  v_after := v_current + p_recipient_count;

  IF v_after > p_daily_limit THEN
    RETURN QUERY SELECT FALSE, v_current, v_current, GREATEST(0, p_daily_limit - v_current);
    RETURN;
  END IF;

  UPDATE whatsapp_bulk_usage
     SET recipients_used = v_after,
         updated_at = NOW()
   WHERE user_id = p_user_id
     AND usage_date = p_usage_date;

  RETURN QUERY SELECT TRUE, v_current, v_after, GREATEST(0, p_daily_limit - v_after);
END;
$$;

REVOKE ALL ON FUNCTION reserve_whatsapp_bulk_quota(UUID, DATE, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_whatsapp_bulk_quota(UUID, DATE, INTEGER, INTEGER) TO service_role;


-- ============================ >>> supabase/migrations/2026_07_06_004_email_is_registered.sql

-- AUTH-12: replace the fragile `listUsers({ perPage: 1000 })` email scan
-- (which silently misses duplicates once the auth directory exceeds one page)
-- with a direct, indexed existence check against auth.users.
--
-- Used by the public teacher/admin registration submission and the
-- admin-registration approval to avoid registering an email that already
-- belongs to a real account. SECURITY DEFINER so it can read auth.users;
-- granted to service_role only (the API uses the admin client).

CREATE OR REPLACE FUNCTION public.email_is_registered(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = lower(p_email)
  );
$$;

REVOKE ALL ON FUNCTION public.email_is_registered(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_is_registered(TEXT) TO service_role;


-- ============================ >>> supabase/migrations/2026_07_06_005_harden_search_text_functions.sql

-- DB-08: `students_update_search_text()` and `user_profiles_update_search_text()`
-- were the only trigger functions in the schema without `SET search_path` /
-- `SECURITY DEFINER`, and they called `normalize_search_text()` unqualified.
-- A poisoned `search_path` could in principle resolve that helper (or the
-- LOWER/TRANSLATE calls inside it) to a planted function. Re-create both to
-- match the hardened pattern every other trigger already uses: SECURITY DEFINER
-- + pinned search_path + schema-qualified helper.
--
-- `CREATE OR REPLACE` keeps the same function name/signature, so the existing
-- `students_search_text_trg` / `user_profiles_search_text_trg` triggers keep
-- working unchanged. Bodies are otherwise identical to 2026_05_04.

CREATE OR REPLACE FUNCTION students_update_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.search_text := public.normalize_search_text(
    COALESCE(NEW.first_name, '') || ' ' ||
    COALESCE(NEW.father_name, '') || ' ' ||
    COALESCE(NEW.last_name, '') || ' ' ||
    COALESCE(NEW.student_id, '') || ' ' ||
    COALESCE(NEW.phone, '')
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION user_profiles_update_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.search_text := public.normalize_search_text(
    COALESCE(NEW.full_name, '') || ' ' ||
    COALESCE(NEW.phone, '')
  );
  RETURN NEW;
END;
$$;


-- ============================ >>> supabase/migrations/2026_07_10_001_decrypt_session_content.sql

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
