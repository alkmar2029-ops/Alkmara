-- ============================================================
-- Period attendance — class-by-class attendance recorded by teachers.
-- Independent of the fingerprint system: a student may be present at
-- the gate (fingerprint) but absent from a specific period.
-- ============================================================

-- 1) Periods table — admin-configurable list of class periods.
CREATE TABLE IF NOT EXISTS periods (
  id          SERIAL PRIMARY KEY,
  number      INTEGER NOT NULL UNIQUE CHECK (number BETWEEN 1 AND 12),
  name        VARCHAR(50) NOT NULL,
  start_time  TIME,
  end_time    TIME,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed 7 default periods.
INSERT INTO periods (number, name, sort_order) VALUES
  (1, 'الحصة الأولى', 1),
  (2, 'الحصة الثانية', 2),
  (3, 'الحصة الثالثة', 3),
  (4, 'الحصة الرابعة', 4),
  (5, 'الحصة الخامسة', 5),
  (6, 'الحصة السادسة', 6),
  (7, 'الحصة السابعة', 7)
ON CONFLICT (number) DO NOTHING;

ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "periods read"      ON periods;
DROP POLICY IF EXISTS "periods admin write" ON periods;
CREATE POLICY "periods read"
  ON periods FOR SELECT TO authenticated USING (true);
CREATE POLICY "periods admin write"
  ON periods FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- 2) Session marker — "this (date, period, section) was recorded by X".
-- Lets reports distinguish "no row → not recorded yet" from "all present".
CREATE TABLE IF NOT EXISTS period_sessions (
  id              BIGSERIAL PRIMARY KEY,
  section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  period_id       INTEGER NOT NULL REFERENCES periods(id)  ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  recorded_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  absent_count    INTEGER NOT NULL DEFAULT 0,
  late_count      INTEGER NOT NULL DEFAULT 0,
  excused_count   INTEGER NOT NULL DEFAULT 0,
  total_count     INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  UNIQUE (section_id, period_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS period_sessions_date_idx
  ON period_sessions (attendance_date DESC, section_id, period_id);
CREATE INDEX IF NOT EXISTS period_sessions_recorded_by_idx
  ON period_sessions (recorded_by, recorded_at DESC);

ALTER TABLE period_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "period_sessions read"      ON period_sessions;
DROP POLICY IF EXISTS "period_sessions ins"       ON period_sessions;
DROP POLICY IF EXISTS "period_sessions upd"       ON period_sessions;
DROP POLICY IF EXISTS "period_sessions del admin" ON period_sessions;
CREATE POLICY "period_sessions read"
  ON period_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "period_sessions ins"
  ON period_sessions FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff','teacher'));
CREATE POLICY "period_sessions upd"
  ON period_sessions FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin','staff','teacher'))
  WITH CHECK (current_user_role() IN ('admin','staff','teacher'));
CREATE POLICY "period_sessions del admin"
  ON period_sessions FOR DELETE TO authenticated USING (is_admin());

-- 3) Per-student status rows — only stored when status != 'present'.
-- 'present' is the default; absence/late/excused get an explicit row.
CREATE TABLE IF NOT EXISTS period_absences (
  id              BIGSERIAL PRIMARY KEY,
  session_id      BIGINT NOT NULL REFERENCES period_sessions(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status          VARCHAR(10) NOT NULL DEFAULT 'absent'
                  CHECK (status IN ('absent', 'late', 'excused')),
  notes           TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS period_absences_student_idx
  ON period_absences (student_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS period_absences_session_idx
  ON period_absences (session_id);

ALTER TABLE period_absences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "period_absences read"      ON period_absences;
DROP POLICY IF EXISTS "period_absences ins"       ON period_absences;
DROP POLICY IF EXISTS "period_absences upd"       ON period_absences;
DROP POLICY IF EXISTS "period_absences del admin" ON period_absences;
CREATE POLICY "period_absences read"
  ON period_absences FOR SELECT TO authenticated USING (true);
CREATE POLICY "period_absences ins"
  ON period_absences FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('admin','staff','teacher'));
CREATE POLICY "period_absences upd"
  ON period_absences FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin','staff','teacher'))
  WITH CHECK (current_user_role() IN ('admin','staff','teacher'));
CREATE POLICY "period_absences del admin"
  ON period_absences FOR DELETE TO authenticated USING (is_admin());

-- 4) Extend user_profiles for teachers.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS full_name           VARCHAR(200),
  ADD COLUMN IF NOT EXISTS phone               VARCHAR(20),
  ADD COLUMN IF NOT EXISTS is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_login_at       TIMESTAMPTZ;

-- 5) Existing role check needs to recognise 'teacher'.
-- The is_staff_or_admin and current_user_role helpers already read user_profiles.role
-- so just need to make sure 'teacher' is a permitted value (no CHECK constraint
-- on the column today, so this is a no-op SQL — kept for documentation).

-- 6) Settings: number of periods is implicit (rows in `periods` table).
-- Nothing to add to school_settings.
