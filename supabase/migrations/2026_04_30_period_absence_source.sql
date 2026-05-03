-- Track WHY each period_absences row exists. The teacher UI now offers a
-- one-click "apply absences from period 1" button (cascade); we want to
-- know which rows came from that auto-apply versus which the teacher
-- typed in manually, and which the teacher overrode (e.g., "Ahmed was
-- auto-absent from P1, but I see him here in P3 — change to present").
--
--   manual         — teacher tapped the student themselves
--   auto_cascade   — system suggested + teacher accepted the cascade
--   overridden     — teacher changed the suggested value (currently a
--                    UI-only state; no DB row is created when the teacher
--                    flips a cascade student to "present", but reserved
--                    here for future "kept absent but flagged as edited")
--
-- Reports use this to surface "this absence is automatically inherited
-- from an earlier period" so admins can distinguish first-hand
-- observations from cascaded data.

ALTER TABLE period_absences
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';

-- Drop and re-add the constraint so re-running the migration after a
-- schema tweak doesn't fail with "constraint already exists".
ALTER TABLE period_absences
  DROP CONSTRAINT IF EXISTS period_absences_source_check;
ALTER TABLE period_absences
  ADD  CONSTRAINT period_absences_source_check
  CHECK (source IN ('manual', 'auto_cascade', 'overridden'));

CREATE INDEX IF NOT EXISTS period_absences_source_idx
  ON period_absences (source) WHERE source <> 'manual';

-- ============================================================
-- save_period_attendance: now persists the per-row source.
-- ============================================================
-- Same shape as before plus an optional "source" key on each absence
-- entry. Defaults to 'manual' if the client doesn't send it, so legacy
-- callers continue to work.
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
BEGIN
  IF current_user_role() NOT IN ('super_admin', 'admin', 'staff', 'teacher') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
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
