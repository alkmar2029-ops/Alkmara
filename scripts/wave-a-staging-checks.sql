-- Wave A — DB-layer guarantees (READ-ONLY).
-- Run in the Supabase SQL editor on staging AFTER `supabase db push`.
-- Every statement RETURNS a check/result row; nothing is mutated.
-- The role running the editor is `postgres` (can read all catalogs).
--
-- Expected: every `core` check below = PASS. The optional P1.5 block
-- (cron/vault) PRESENT/has-rows; skip it if those extensions aren't
-- exposed to the editor role (it will error — that's fine, run the rest).

-- =====================================================================
-- CORE (always — A1 / A4 / privacy)
-- =====================================================================

-- 1) Functions exist (by name — robust to signature spelling).
SELECT 'fn:decrypt_session_content (A4)' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'decrypt_session_content')
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'fn:create_counseling_session',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_counseling_session')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'fn:counselor_can_see_student (A5)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'counselor_can_see_student')
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'fn:reviewer_can_see_student (A1)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reviewer_can_see_student')
            THEN 'PASS' ELSE 'FAIL' END;

-- 2) A4 load-bearing grant: decrypt_session_content is service_role ONLY.
--    A counselor (authenticated) must NOT be able to call it directly with
--    their own key. Uses the proc oid by name so the signature spelling
--    doesn't matter; a missing function collapses to FAIL.
WITH f AS (SELECT oid FROM pg_proc WHERE proname = 'decrypt_session_content' LIMIT 1)
SELECT 'grant:decrypt = service_role only' AS check,
       CASE
         WHEN (SELECT has_function_privilege('service_role', oid, 'EXECUTE') FROM f)
          AND NOT COALESCE((SELECT has_function_privilege('authenticated', oid, 'EXECUTE') FROM f), TRUE)
          AND NOT COALESCE((SELECT has_function_privilege('anon', oid, 'EXECUTE') FROM f), TRUE)
         THEN 'PASS' ELSE 'FAIL' END AS result;

-- Same guarantee for create_counseling_session (it also takes p_key).
WITH f AS (SELECT oid FROM pg_proc WHERE proname = 'create_counseling_session' LIMIT 1)
SELECT 'grant:create_session = service_role only' AS check,
       CASE
         WHEN (SELECT has_function_privilege('service_role', oid, 'EXECUTE') FROM f)
          AND NOT COALESCE((SELECT has_function_privilege('authenticated', oid, 'EXECUTE') FROM f), TRUE)
          AND NOT COALESCE((SELECT has_function_privilege('anon', oid, 'EXECUTE') FROM f), TRUE)
         THEN 'PASS' ELSE 'FAIL' END AS result;

-- 3) confidential_access_log.action CHECK allows 'decrypt' (A4 audit row).
SELECT 'check:action allows decrypt (A4)' AS check,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'confidential_access_log_action_check'
           AND pg_get_constraintdef(oid) ILIKE '%decrypt%'
       ) THEN 'PASS' ELSE 'FAIL' END AS result;

-- 4) incidents.case_id FK is wired (A1 escalate links the incident here).
SELECT 'fk:incidents_case_id_fk (A1)' AS check,
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_case_id_fk')
            THEN 'PASS' ELSE 'FAIL' END AS result;

-- 5) RLS enabled (fail-closed) on the confidential / workflow tables.
SELECT 'rls:' || c.relname AS check,
       CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END AS result
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'counseling_sessions', 'confidential_access_log',
    'student_cases', 'case_history', 'student_incidents'
  )
ORDER BY c.relname;

-- 6) [DISABLED on this project] CLI migration-history check.
--    This project has NO supabase_migrations.schema_migrations table —
--    migrations were applied OUTSIDE Supabase CLI tracking (the
--    YYYY_MM_DD_ naming breaks the CLI version parser → all "2026").
--    Querying it errors with 42P01. The object-existence checks (1-5)
--    above ARE the real verification here. Left commented as a record.
-- SELECT 'migration:' || version AS check, 'APPLIED' AS result
-- FROM supabase_migrations.schema_migrations
-- WHERE version LIKE '2026_07_10_001%' OR version LIKE '2026_07_06_%'
-- ORDER BY version;

-- =====================================================================
-- OPTIONAL — P1.5 automation (run separately; skip if it errors because
-- pg_cron / vault aren't exposed to the editor role).
-- =====================================================================
-- SELECT 'cron:jobs' AS check, COALESCE(string_agg(jobname, ', '), '(none)') AS result FROM cron.job;
-- SELECT 'vault:worker_secret' AS check,
--        CASE WHEN EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'worker_secret') THEN 'PRESENT' ELSE 'MISSING' END;
-- SELECT 'vault:app_base_url' AS check,
--        CASE WHEN EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'app_base_url') THEN 'PRESENT' ELSE 'MISSING' END;
-- SELECT 'cron:net_responses (debug delivery)' AS check, count(*)::text AS result FROM net._http_response;
