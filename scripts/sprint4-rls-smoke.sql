-- Sprint 4 RLS smoke probes — runs inside one transaction with final ROLLBACK.
-- Verifies the م4.7 access model without polluting staging.
--
-- Probes (8 total):
--   P1   teacher cannot INSERT is_confidential=TRUE                       → RESTRICTIVE gate
--   P2   counselor-in-scope CAN INSERT is_confidential=TRUE                → "ins counselor" policy
--   P3a  counselor-in-scope CAN SELECT case + session + confidential note  → counselor_can_see_student
--   P3b  counselor-out-of-scope sees ZERO rows                              → counselor_can_see_student false
--   P4a  view_confidential_notes flag holder CAN SELECT case + conf note   → flag + admin_section_assignments
--   P4b  flag holder CANNOT INSERT/UPDATE case                              → no write paths in policies
--   P5   counselor-in-scope CANNOT move session.case_id to out-of-scope    → counseling_sessions_update WITH CHECK
--   P6   only super_admin SELECTs confidential_access_log                   → access_log_super_only
--
-- Result capture: RAISE NOTICE (immediate client output, survives ROLLBACK).
-- State isolation: SAVEPOINT before each DML probe + ROLLBACK TO SAVEPOINT after.

\set ON_ERROR_STOP 0
\set QUIET 1

BEGIN;

-- =====================================================================
-- SETUP — runs as postgres (bypasses RLS). All writes reverted at final ROLLBACK.
-- =====================================================================

-- Pick a student with a section + another student in a DIFFERENT section
CREATE TEMP TABLE _smoke (
  s_in        INTEGER,
  sec_in      INTEGER,
  s_out       INTEGER,
  sec_out     INTEGER,
  case_in_id  BIGINT,
  case_out_id BIGINT,
  session_id  BIGINT,
  note_id     BIGINT
);

-- Temp table is created by postgres role; authenticated DO blocks need read access.
GRANT SELECT ON _smoke TO authenticated;

INSERT INTO _smoke (s_in, sec_in)
SELECT id, section_id
FROM students
WHERE section_id IS NOT NULL AND is_active IS NOT FALSE
ORDER BY id
LIMIT 1;

UPDATE _smoke SET
  s_out   = sub.id,
  sec_out = sub.section_id
FROM (
  SELECT s.id, s.section_id
  FROM students s, _smoke t
  WHERE s.section_id IS NOT NULL
    AND s.is_active IS NOT FALSE
    AND s.section_id <> t.sec_in
  ORDER BY s.id
  LIMIT 1
) sub;

SELECT 'fixture students' AS note, s_in, sec_in, s_out, sec_out FROM _smoke;

-- Test auth.users + user_profiles
INSERT INTO auth.users (id, instance_id, email, aud, role, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'cinsmoke@test',  'authenticated', 'authenticated', NOW(), NOW()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'coutsmoke@test', 'authenticated', 'authenticated', NOW(), NOW()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000000', 'tchsmoke@test',  'authenticated', 'authenticated', NOW(), NOW()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000000', 'flagsmoke@test', 'authenticated', 'authenticated', NOW(), NOW()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000', 'supersmoke@test','authenticated', 'authenticated', NOW(), NOW());

-- ON CONFLICT DO UPDATE — there's a trigger on auth.users that auto-creates
-- user_profiles, so we have to overwrite the defaults to set our test
-- role/persona/flags.
INSERT INTO user_profiles (user_id, role, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin',       'Smoke Counselor In',  '{"persona":"counselor"}'::jsonb),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin',       'Smoke Counselor Out', '{"persona":"counselor"}'::jsonb),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'teacher',     'Smoke Teacher',       '{}'::jsonb),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin',       'Smoke Flag Admin',    '{"view_confidential_notes":true}'::jsonb),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'super_admin', 'Smoke Super',         '{}'::jsonb)
ON CONFLICT (user_id) DO UPDATE SET
  role        = EXCLUDED.role,
  full_name   = EXCLUDED.full_name,
  permissions = EXCLUDED.permissions;

-- Counselor assignments
INSERT INTO counselor_assignments (counselor_user_id, section_id)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', sec_in  FROM _smoke;
INSERT INTO counselor_assignments (counselor_user_id, section_id)
SELECT 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', sec_out FROM _smoke;

-- Flag holder gets admin_section_assignment to the IN-scope section
INSERT INTO admin_section_assignments (admin_user_id, section_id)
SELECT 'dddddddd-dddd-dddd-dddd-dddddddddddd', sec_in FROM _smoke;

-- Teacher assignment (in same section)
INSERT INTO teacher_section_assignments (teacher_user_id, section_id)
SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc', sec_in FROM _smoke;

-- Seed a case for the IN-scope student (counselor_in is creator)
INSERT INTO student_cases (student_id, created_by, title, description, case_type, severity)
SELECT s_in,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'Smoke test case in-scope',
       'Smoke test case description meeting 20-char minimum requirement',
       'behavioral',
       'medium'
FROM _smoke
RETURNING id, student_id;

UPDATE _smoke SET case_in_id = (
  SELECT id FROM student_cases
  WHERE title = 'Smoke test case in-scope'
  ORDER BY id DESC LIMIT 1
);

-- Seed a case for the OUT-of-scope student (counselor_out is creator)
INSERT INTO student_cases (student_id, created_by, title, description, case_type, severity)
SELECT s_out,
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
       'Smoke test case out-of-scope',
       'Smoke test case description meeting 20-char minimum requirement',
       'behavioral',
       'medium'
FROM _smoke
RETURNING id, student_id;

UPDATE _smoke SET case_out_id = (
  SELECT id FROM student_cases
  WHERE title = 'Smoke test case out-of-scope'
  ORDER BY id DESC LIMIT 1
);

-- Seed a session for the IN-scope case
INSERT INTO counseling_sessions (case_id, student_id, counselor_user_id, session_date, session_type, topic, content_encrypted)
SELECT case_in_id,
       s_in,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       CURRENT_DATE,
       'individual',
       'Smoke session topic',
       pgp_sym_encrypt('smoke encrypted body', 'smoke_key_not_real')
FROM _smoke
RETURNING id;

UPDATE _smoke SET session_id = (
  SELECT id FROM counseling_sessions
  WHERE topic = 'Smoke session topic'
  ORDER BY id DESC LIMIT 1
);

-- Seed a CONFIDENTIAL note for the in-scope student (counselor authored)
INSERT INTO student_notes (student_id, text, type, source, recorded_by, is_confidential, case_id)
SELECT s_in,
       'Smoke confidential note seed',
       'negative',
       'text',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       TRUE,
       case_in_id
FROM _smoke
RETURNING id;

UPDATE _smoke SET note_id = (
  SELECT id FROM student_notes
  WHERE text = 'Smoke confidential note seed'
  ORDER BY id DESC LIMIT 1
);

-- Seed a confidential_access_log row
INSERT INTO confidential_access_log (accessed_by, table_name, record_id, action, student_id)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'counseling_sessions', session_id::text, 'decrypt', s_in
FROM _smoke;

SELECT 'fixtures seeded' AS note, * FROM _smoke;

-- =====================================================================
-- PROBES
-- =====================================================================

-- ============ P1: teacher cannot INSERT is_confidential=TRUE ============
SAVEPOINT before_p1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
DO $$
DECLARE _s int;
BEGIN
  SELECT s_in INTO _s FROM _smoke;
  BEGIN
    INSERT INTO student_notes (student_id, text, type, source, recorded_by, is_confidential)
    VALUES (_s, 'Teacher probe conf', 'negative', 'text', 'cccccccc-cccc-cccc-cccc-cccccccccccc', TRUE);
    RAISE NOTICE 'P1 FAIL — teacher INSERT confidential succeeded';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'P1 PASS — blocked (%): %', SQLSTATE, SQLERRM;
  END;
END $$;
ROLLBACK TO SAVEPOINT before_p1;

-- ============ P2: counselor-in-scope CAN INSERT is_confidential=TRUE ============
SAVEPOINT before_p2;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
DO $$
DECLARE _s int; _new_id bigint;
BEGIN
  SELECT s_in INTO _s FROM _smoke;
  BEGIN
    INSERT INTO student_notes (student_id, text, type, source, recorded_by, is_confidential)
    VALUES (_s, 'Counselor probe conf', 'negative', 'text', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TRUE)
    RETURNING id INTO _new_id;
    RAISE NOTICE 'P2 PASS — counselor INSERT confidential succeeded (id=%)', _new_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'P2 FAIL — blocked (%): %', SQLSTATE, SQLERRM;
  END;
END $$;
ROLLBACK TO SAVEPOINT before_p2;

-- ============ P3a: counselor-in-scope CAN SELECT case + session + note ============
SAVEPOINT before_p3a;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
DO $$
DECLARE _c bigint; _ses bigint; _n bigint;
DECLARE _vc int; _vs int; _vn int;
BEGIN
  SELECT case_in_id, session_id, note_id INTO _c, _ses, _n FROM _smoke;
  SELECT count(*) INTO _vc FROM student_cases WHERE id = _c;
  SELECT count(*) INTO _vs FROM counseling_sessions WHERE id = _ses;
  SELECT count(*) INTO _vn FROM student_notes WHERE id = _n;
  IF _vc = 1 AND _vs = 1 AND _vn = 1 THEN
    RAISE NOTICE 'P3a PASS — counselor-in-scope sees case=% session=% note=%', _vc, _vs, _vn;
  ELSE
    RAISE NOTICE 'P3a FAIL — visibility case=% session=% note=% (expected 1/1/1)', _vc, _vs, _vn;
  END IF;
END $$;
ROLLBACK TO SAVEPOINT before_p3a;

-- ============ P3b: counselor-out-of-scope sees ZERO rows ============
SAVEPOINT before_p3b;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
DO $$
DECLARE _c bigint; _ses bigint; _n bigint;
DECLARE _vc int; _vs int; _vn int;
BEGIN
  SELECT case_in_id, session_id, note_id INTO _c, _ses, _n FROM _smoke;
  SELECT count(*) INTO _vc FROM student_cases WHERE id = _c;
  SELECT count(*) INTO _vs FROM counseling_sessions WHERE id = _ses;
  SELECT count(*) INTO _vn FROM student_notes WHERE id = _n;
  IF _vc = 0 AND _vs = 0 AND _vn = 0 THEN
    RAISE NOTICE 'P3b PASS — counselor-out-of-scope sees nothing (case=%, session=%, note=%)', _vc, _vs, _vn;
  ELSE
    RAISE NOTICE 'P3b FAIL — leakage: case=% session=% note=% (expected 0/0/0)', _vc, _vs, _vn;
  END IF;
END $$;
ROLLBACK TO SAVEPOINT before_p3b;

-- ============ P4a: flag holder CAN SELECT (within admin_section_assignments) ============
SAVEPOINT before_p4a;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
DO $$
DECLARE _c bigint; _ses bigint; _n bigint;
DECLARE _vc int; _vs int; _vn int;
BEGIN
  SELECT case_in_id, session_id, note_id INTO _c, _ses, _n FROM _smoke;
  SELECT count(*) INTO _vc FROM student_cases       WHERE id = _c;
  SELECT count(*) INTO _vs FROM counseling_sessions WHERE id = _ses;
  SELECT count(*) INTO _vn FROM student_notes       WHERE id = _n;
  IF _vc = 1 AND _vs = 1 AND _vn = 1 THEN
    RAISE NOTICE 'P4a PASS — flag holder reads case=%, session=%, conf note=%', _vc, _vs, _vn;
  ELSE
    RAISE NOTICE 'P4a FAIL — flag holder visibility case=% session=% note=% (expected 1/1/1)', _vc, _vs, _vn;
  END IF;
END $$;
ROLLBACK TO SAVEPOINT before_p4a;

-- ============ P4b: flag holder CANNOT INSERT/UPDATE case ============
SAVEPOINT before_p4b;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
DO $$
DECLARE _s int; _c bigint;
DECLARE _ins_ok boolean := FALSE; _upd_ok boolean := FALSE;
BEGIN
  SELECT s_in, case_in_id INTO _s, _c FROM _smoke;
  -- INSERT attempt
  BEGIN
    INSERT INTO student_cases (student_id, created_by, title, description, case_type, severity)
    VALUES (_s, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Flag holder insert attempt', 'Description that exceeds 20 characters here', 'behavioral', 'medium');
    _ins_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  -- UPDATE attempt (try to bump severity)
  BEGIN
    UPDATE student_cases SET severity = 'high' WHERE id = _c;
    IF FOUND THEN _upd_ok := TRUE; END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF NOT _ins_ok AND NOT _upd_ok THEN
    RAISE NOTICE 'P4b PASS — flag holder INSERT blocked AND UPDATE blocked (read-only oversight confirmed)';
  ELSE
    RAISE NOTICE 'P4b FAIL — flag holder writes succeeded: insert=%, update=%', _ins_ok, _upd_ok;
  END IF;
END $$;
ROLLBACK TO SAVEPOINT before_p4b;

-- ============ P5: counselor-in-scope CANNOT move session.case_id outside scope ============
SAVEPOINT before_p5;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
DO $$
DECLARE _ses bigint; _c_out bigint;
DECLARE _moved boolean := FALSE;
BEGIN
  SELECT session_id, case_out_id INTO _ses, _c_out FROM _smoke;
  BEGIN
    UPDATE counseling_sessions SET case_id = _c_out WHERE id = _ses;
    IF FOUND THEN _moved := TRUE; END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF NOT _moved THEN
    RAISE NOTICE 'P5 PASS — counselor cannot move session.case_id to out-of-scope case';
  ELSE
    RAISE NOTICE 'P5 FAIL — session moved to out-of-scope case';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT before_p5;

-- ============ P6: only super_admin SELECTs confidential_access_log ============
SAVEPOINT before_p6;

-- 6a: counselor-in-scope should see nothing
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM confidential_access_log;
  IF _n = 0 THEN
    RAISE NOTICE 'P6a PASS — counselor sees % rows in confidential_access_log (expected 0)', _n;
  ELSE
    RAISE NOTICE 'P6a FAIL — counselor sees % rows', _n;
  END IF;
END $$;
ROLLBACK TO SAVEPOINT before_p6;

-- 6b: teacher should see nothing
SAVEPOINT before_p6b;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM confidential_access_log;
  IF _n = 0 THEN
    RAISE NOTICE 'P6b PASS — teacher sees % rows in confidential_access_log (expected 0)', _n;
  ELSE
    RAISE NOTICE 'P6b FAIL — teacher sees % rows', _n;
  END IF;
END $$;
ROLLBACK TO SAVEPOINT before_p6b;

-- 6c: super_admin should see >= 1 row (the seeded one)
SAVEPOINT before_p6c;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM confidential_access_log;
  IF _n >= 1 THEN
    RAISE NOTICE 'P6c PASS — super_admin sees % rows in confidential_access_log (expected >= 1)', _n;
  ELSE
    RAISE NOTICE 'P6c FAIL — super_admin sees % rows (expected >= 1)', _n;
  END IF;
END $$;
ROLLBACK TO SAVEPOINT before_p6c;

-- =====================================================================
-- Final ROLLBACK reverts ALL test fixtures (users, profiles, assignments,
-- cases, sessions, notes, access log row)
-- =====================================================================
ROLLBACK;
