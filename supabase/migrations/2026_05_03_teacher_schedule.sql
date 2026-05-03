-- Smart teacher schedule import target.
--
-- Each row represents one slot in the weekly schedule:
--   (teacher × day_of_week × period_number) → either a class assignment,
--   a monitoring duty (منتظر), or an explicit "free" period.
--
-- The school uploads an Excel sheet that lists every teacher's full week
-- (5 days × 7 periods = 35 cells per teacher); the parser fans out into
-- one row per cell here. Re-uploading replaces the whole table — there's
-- no incremental merge so the canonical view always matches the latest
-- Excel.
--
-- Linkage to attendance:
--   • Used by /api/teacher-schedule/lookup to answer "who SHOULD be
--     teaching section X at period Y on day Z?"
--   • Surfaces the answer in the period-attendance detail modal and on
--     all printed reports as "المعلم المتوقَّع".
--   • Powers the "skip pattern by teacher" analytic that joins escape
--     detection with this table.

CREATE TABLE IF NOT EXISTS teacher_schedule (
  id                BIGSERIAL PRIMARY KEY,
  -- The matched user. NULL if the teacher name in Excel didn't match any
  -- existing user_profiles row (admin can resolve later from the import
  -- review screen).
  teacher_user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The teacher name as it appeared in the Excel — kept verbatim so the
  -- import is auditable even if user records get renamed/deleted later.
  teacher_name      VARCHAR(200) NOT NULL,
  -- Saudi school week: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4
  day_of_week       SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
  period_number     SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 8),
  section_id        INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  subject           VARCHAR(80),
  duty_type         VARCHAR(20) NOT NULL DEFAULT 'class'
                    CHECK (duty_type IN ('class', 'monitoring', 'free')),
  -- For 'monitoring' rows: the section number the teacher is supervising.
  -- E.g., the cell "منتظر 4" means watching section #4 of that grade
  -- during a free hour. Stored as SMALLINT so we don't lose information
  -- if the section row goes away.
  monitoring_target SMALLINT,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- A given teacher can hold only one slot per (day, period). Even
  -- monitoring + free are distinct slot types — never two rows for the
  -- same exact teacher×day×period.
  UNIQUE (teacher_user_id, day_of_week, period_number)
);

CREATE INDEX IF NOT EXISTS teacher_schedule_section_lookup_idx
  ON teacher_schedule (section_id, day_of_week, period_number)
  WHERE section_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teacher_schedule_teacher_lookup_idx
  ON teacher_schedule (teacher_user_id, day_of_week, period_number)
  WHERE teacher_user_id IS NOT NULL;

ALTER TABLE teacher_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ts_read   ON teacher_schedule;
DROP POLICY IF EXISTS ts_insert ON teacher_schedule;
DROP POLICY IF EXISTS ts_update ON teacher_schedule;
DROP POLICY IF EXISTS ts_delete ON teacher_schedule;

-- Read: super_admin/admin/staff/viewer see everything; teachers see their
-- own rows and rows that match sections in the periods they teach (so
-- they can answer "who else is teaching this section right now?").
-- Simplified for now to: own rows + admin/staff/viewer.
CREATE POLICY ts_read ON teacher_schedule FOR SELECT TO authenticated
  USING (
    is_admin()
    OR current_user_role() IN ('staff', 'viewer')
    OR teacher_user_id = auth.uid()
  );

-- Write: admin only (super_admin auto-passes via is_admin).
CREATE POLICY ts_insert ON teacher_schedule FOR INSERT TO authenticated
  WITH CHECK (is_admin());
CREATE POLICY ts_update ON teacher_schedule FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY ts_delete ON teacher_schedule FOR DELETE TO authenticated
  USING (is_admin());
