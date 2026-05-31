-- Remote-state probe (READ-ONLY). Run in the Supabase SQL editor on the
-- linked project. Supabase CLI migration tracking is unusable here because
-- every file is named `2026_MM_DD_...` and the CLI parses the version as the
-- leading digits before the first underscore → "2026" for ALL of them. So
-- we determine "what's applied" by probing one marker object per batch
-- instead of trusting supabase_migrations.schema_migrations.

-- A) Is there ANY CLI migration history at all?
SELECT
  EXISTS (SELECT 1 FROM information_schema.schemata
          WHERE schema_name = 'supabase_migrations')                      AS has_migrations_schema,
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'supabase_migrations'
            AND table_name = 'schema_migrations')                         AS has_history_table;

-- B) How far has the schema actually progressed? Each column = a marker
--    object created by that batch. Read left→right; the first FALSE is
--    roughly where the remote stops.
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin')                AS baseline_preApr27,
  to_regclass('public.note_templates')          IS NOT NULL               AS apr27_notes,
  to_regclass('public.period_sessions')         IS NOT NULL               AS apr_period_attendance,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_user_is_counselor') AS may20_personas,   -- DB-02 batch
  to_regclass('public.daily_teacher_absences')  IS NOT NULL               AS may21_substitution,
  to_regclass('public.student_incidents')       IS NOT NULL               AS jun03_incidents,
  to_regclass('public.student_cases')           IS NOT NULL               AS jun10_cases_sprint4,
  to_regclass('public.student_risk_scores')     IS NOT NULL               AS jul01_risk,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'email_is_registered')     AS jul06_opus48_P1,   -- 07_06_004
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'decrypt_session_content') AS jul10_waveA_A4;     -- 07_10_001 (NEW)

-- C) DB-02 specifics — are the two functions counselor_assignments depends
--    on actually present? (decides B1 if the may20 batch is the boundary.)
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_user_has_flag')     AS has_current_user_has_flag,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_user_is_counselor') AS has_current_user_is_counselor,
  to_regclass('public.counselor_assignments')   IS NOT NULL                 AS has_counselor_assignments;

-- D) ONLY if (A) has_history_table = true — see what the CLI actually recorded:
-- SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
