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
