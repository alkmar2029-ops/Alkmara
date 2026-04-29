-- Early-dismissal log for the deputy/vice principal (الوكيل).
--
-- A dismissal here means "student left school early today" — distinct
-- from an excused absence on a single class period. One dismissal row
-- represents the parent/guardian arriving, the deputy verifying ID,
-- and the student going home.
--
-- The system uses this row to:
--   1. Print an exit pass for the security guard.
--   2. WhatsApp the parent so they know exactly when and with whom.
--   3. Auto-mark the student as 'excused' on every period_session in
--      this section that's already recorded for today AFTER the
--      dismissal time — saves teachers from double-recording.

CREATE TABLE IF NOT EXISTS student_dismissals (
  id                          BIGSERIAL PRIMARY KEY,
  student_id                  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  dismissal_date              DATE NOT NULL DEFAULT CURRENT_DATE,
  dismissal_time              TIME NOT NULL DEFAULT (CURRENT_TIME)::TIME,
  -- Free-text rather than enum at the DB level so admins can add
  -- categories from the UI without a migration. App validates against
  -- a known set.
  reason                      VARCHAR(20) NOT NULL DEFAULT 'other',
  reason_details              TEXT,
  -- Pickup person info — the human who showed up at the gate.
  pickup_person_name          VARCHAR(200) NOT NULL,
  pickup_person_relationship  VARCHAR(50) NOT NULL,
  pickup_person_id_number     VARCHAR(20),
  pickup_person_phone         VARCHAR(20),
  -- Deputy/admin who recorded the dismissal.
  approved_by                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by_name            VARCHAR(200),
  notes                       TEXT,
  -- Tracking for the side-effects fired after insert.
  whatsapp_sent_at            TIMESTAMPTZ,
  whatsapp_error              TEXT,
  -- Count of period_absences rows we auto-inserted as 'excused' — useful
  -- for the receipt screen ("3 حصص تم استئذانها تلقائياً").
  auto_excused_periods        INTEGER NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot read paths — daily list, per-student timeline, frequency stats.
CREATE INDEX IF NOT EXISTS student_dismissals_date_idx
  ON student_dismissals (dismissal_date DESC, dismissal_time DESC);
CREATE INDEX IF NOT EXISTS student_dismissals_student_idx
  ON student_dismissals (student_id, dismissal_date DESC);

ALTER TABLE student_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dismissals admin all"   ON student_dismissals;
DROP POLICY IF EXISTS "dismissals teacher read" ON student_dismissals;

-- Admin/staff (the deputy uses one of these roles) manage dismissals
-- end to end.
CREATE POLICY "dismissals admin all"
  ON student_dismissals FOR ALL TO authenticated
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());

-- Teachers can READ dismissals for students in their assigned sections,
-- so the period-attendance flow can show "this student left at 11:30
-- today" instead of marking them absent unjustly.
CREATE POLICY "dismissals teacher read"
  ON student_dismissals FOR SELECT TO authenticated
  USING (
    current_user_role() = 'teacher'
    AND student_id IN (
      SELECT s.id FROM students s
      WHERE s.section_id IN (
        SELECT section_id FROM teacher_section_assignments
        WHERE teacher_user_id = auth.uid()
      )
    )
  );
