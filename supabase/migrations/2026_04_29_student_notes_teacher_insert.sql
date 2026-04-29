-- Allow teachers to record their own student notes.
--
-- The original policy (`student_notes ins staff`) blocked the role
-- entirely. Now the teacher portal lets teachers add positive/negative
-- observations through the wizard, so we need to let them INSERT — but
-- only rows where `recorded_by = auth.uid()`. That way a teacher can't
-- file a note pretending to be another teacher.
--
-- We keep the staff/admin policy (still useful for the dashboard form
-- which records on behalf of admin) and add a new teacher-scoped one
-- alongside it. Postgres OR-combines policies of the same command, so
-- either being satisfied admits the row.

-- Drop and recreate the broad staff/admin policy unchanged so the file
-- is idempotent and can be re-run safely.
DROP POLICY IF EXISTS "student_notes ins staff"   ON student_notes;
DROP POLICY IF EXISTS "student_notes ins teacher" ON student_notes;

CREATE POLICY "student_notes ins staff"
  ON student_notes FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());

CREATE POLICY "student_notes ins teacher"
  ON student_notes FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = 'teacher'
    AND recorded_by = auth.uid()
  );

-- Same idea for UPDATE — a teacher should be able to mark their own
-- note as printed/whatsapp_sent (used by the teacher portal's send
-- flow) but not touch other teachers' rows.
DROP POLICY IF EXISTS "student_notes upd teacher" ON student_notes;

CREATE POLICY "student_notes upd teacher"
  ON student_notes FOR UPDATE TO authenticated
  USING (
    current_user_role() = 'teacher'
    AND recorded_by = auth.uid()
  )
  WITH CHECK (
    current_user_role() = 'teacher'
    AND recorded_by = auth.uid()
  );
