-- Teacher → section assignments and the RLS that makes them mean something.
--
-- BEFORE: every authenticated user could read every student, note, period
-- session, and attendance record. Teachers logged in and could browse the
-- whole school's data — fine for trust-based small schools, a privacy risk
-- as the system grows.
--
-- AFTER: a teacher sees only:
--   • students in sections they're assigned to
--   • notes about those students (or notes they personally recorded)
--   • period sessions and absences for their sections
--   • attendance records for their sections
-- Admin / staff / viewer roles keep their full read access — the new
-- policies branch on `current_user_role()`.
--
-- Onboarding: a freshly-approved teacher has zero assignments → empty UI.
-- Admin must visit /dashboard/teacher-assignments and tick the sections
-- the teacher actually teaches. One-time setup per term.

-- ============= 1. Assignment table =============
CREATE TABLE IF NOT EXISTS teacher_section_assignments (
  id              BIGSERIAL PRIMARY KEY,
  teacher_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  assigned_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One assignment per (teacher, section) pair — admins toggle, never duplicate.
  UNIQUE (teacher_user_id, section_id)
);

CREATE INDEX IF NOT EXISTS teacher_section_assignments_teacher_idx
  ON teacher_section_assignments (teacher_user_id);
CREATE INDEX IF NOT EXISTS teacher_section_assignments_section_idx
  ON teacher_section_assignments (section_id);

ALTER TABLE teacher_section_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_assignments admin all"  ON teacher_section_assignments;
DROP POLICY IF EXISTS "teacher_assignments self read"  ON teacher_section_assignments;

-- Admin manages everyone's assignments.
CREATE POLICY "teacher_assignments admin all"
  ON teacher_section_assignments FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- A teacher can read their own assignments (so the portal can highlight
-- "your sections"). They cannot insert/update/delete — admin-only.
CREATE POLICY "teacher_assignments self read"
  ON teacher_section_assignments FOR SELECT TO authenticated
  USING (teacher_user_id = auth.uid() OR is_staff_or_admin());

-- ============= 2. Tighten reads on student-facing tables =============
-- Pattern for each: allow admin/staff/viewer fully; for teacher role, gate
-- by assignment. Other roles should never reach these tables anyway.

-- students
DROP POLICY IF EXISTS "students read" ON students;
CREATE POLICY "students read" ON students FOR SELECT TO authenticated USING (
  current_user_role() IN ('admin', 'staff', 'viewer')
  OR (
    current_user_role() = 'teacher'
    AND section_id IN (
      SELECT section_id FROM teacher_section_assignments
      WHERE teacher_user_id = auth.uid()
    )
  )
);

-- attendance_records (fingerprint-based; legacy but still gated)
DROP POLICY IF EXISTS "attendance read" ON attendance_records;
CREATE POLICY "attendance read" ON attendance_records FOR SELECT TO authenticated USING (
  current_user_role() IN ('admin', 'staff', 'viewer')
  OR (
    current_user_role() = 'teacher'
    AND section_id IN (
      SELECT section_id FROM teacher_section_assignments
      WHERE teacher_user_id = auth.uid()
    )
  )
);

-- period_sessions (per-period attendance — sessions teachers record)
DROP POLICY IF EXISTS "period_sessions read" ON period_sessions;
CREATE POLICY "period_sessions read" ON period_sessions FOR SELECT TO authenticated USING (
  current_user_role() IN ('admin', 'staff', 'viewer')
  OR (
    current_user_role() = 'teacher'
    AND section_id IN (
      SELECT section_id FROM teacher_section_assignments
      WHERE teacher_user_id = auth.uid()
    )
  )
);

-- period_absences — joined through period_sessions.section_id.
DROP POLICY IF EXISTS "period_absences read" ON period_absences;
CREATE POLICY "period_absences read" ON period_absences FOR SELECT TO authenticated USING (
  current_user_role() IN ('admin', 'staff', 'viewer')
  OR (
    current_user_role() = 'teacher'
    AND session_id IN (
      SELECT id FROM period_sessions
      WHERE section_id IN (
        SELECT section_id FROM teacher_section_assignments
        WHERE teacher_user_id = auth.uid()
      )
    )
  )
);

-- student_notes — teacher sees a note when EITHER they recorded it (own
-- history across reassignments) OR the student is currently in one of
-- their assigned sections (so collaborating teachers see the same student's
-- timeline, but only for their own classroom).
DROP POLICY IF EXISTS "student_notes read" ON student_notes;
CREATE POLICY "student_notes read" ON student_notes FOR SELECT TO authenticated USING (
  current_user_role() IN ('admin', 'staff', 'viewer')
  OR (
    current_user_role() = 'teacher'
    AND (
      recorded_by = auth.uid()
      OR student_id IN (
        SELECT s.id FROM students s
        WHERE s.section_id IN (
          SELECT section_id FROM teacher_section_assignments
          WHERE teacher_user_id = auth.uid()
        )
      )
    )
  )
);

-- ============= 3. Tighten writes for teacher role =============
-- The student_notes INSERT policy added in 2026_04_29 already enforces
-- recorded_by = auth.uid(); we now also require the target student to be
-- in one of the teacher's assigned sections.
DROP POLICY IF EXISTS "student_notes ins teacher" ON student_notes;
CREATE POLICY "student_notes ins teacher"
  ON student_notes FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = 'teacher'
    AND recorded_by = auth.uid()
    AND student_id IN (
      SELECT s.id FROM students s
      WHERE s.section_id IN (
        SELECT section_id FROM teacher_section_assignments
        WHERE teacher_user_id = auth.uid()
      )
    )
  );

-- The save_period_attendance RPC bypasses RLS (SECURITY DEFINER), so we
-- enforce assignment inside the function itself. Patch it to check the
-- teacher is assigned to the target section before writing.
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
BEGIN
  v_role := current_user_role();
  IF v_role NOT IN ('admin', 'staff', 'teacher') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  -- Teachers can only record attendance for sections they're assigned to.
  IF v_role = 'teacher' AND NOT EXISTS (
    SELECT 1 FROM teacher_section_assignments
    WHERE teacher_user_id = auth.uid()
      AND section_id = p_section_id
  ) THEN
    RAISE EXCEPTION 'لست مُعيَّناً على هذه الشعبة'
      USING ERRCODE = '42501';
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
    p_recorded_by, NOW(),
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
    INSERT INTO period_absences (session_id, student_id, status, notes)
    SELECT
        v_session_id,
        (x->>'student_id')::int,
        x->>'status',
        NULLIF(x->>'notes', '')
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
