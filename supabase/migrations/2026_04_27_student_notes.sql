-- Notes/observations recorded against individual students.
-- A "batch" is one save operation that may cover several students with the
-- same or different notes — useful for grouping the print sheets.

CREATE TABLE IF NOT EXISTS student_notes (
  id           BIGSERIAL PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  template_id  INTEGER REFERENCES note_templates(id) ON DELETE SET NULL,
  text         TEXT NOT NULL,
  type         VARCHAR(10) NOT NULL CHECK (type IN ('positive', 'negative')),
  category     VARCHAR(20) DEFAULT 'general'
               CHECK (category IN ('academic', 'behavior', 'attendance', 'participation', 'general')),
  source       VARCHAR(10) NOT NULL DEFAULT 'text'
               CHECK (source IN ('template', 'text', 'voice')),
  recorded_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  batch_id     UUID,
  whatsapp_sent_at TIMESTAMPTZ,
  printed_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_notes_student_idx ON student_notes (student_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS student_notes_batch_idx   ON student_notes (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS student_notes_date_idx    ON student_notes (recorded_at DESC);

ALTER TABLE student_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_notes read"      ON student_notes;
DROP POLICY IF EXISTS "student_notes ins staff" ON student_notes;
DROP POLICY IF EXISTS "student_notes upd staff" ON student_notes;
DROP POLICY IF EXISTS "student_notes del admin" ON student_notes;

-- Read: any authenticated user.
CREATE POLICY "student_notes read"
  ON student_notes FOR SELECT TO authenticated USING (true);

-- Insert: staff or admin.
CREATE POLICY "student_notes ins staff"
  ON student_notes FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());

-- Update: staff/admin can mark printed/whatsapp; otherwise admin only.
CREATE POLICY "student_notes upd staff"
  ON student_notes FOR UPDATE TO authenticated
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());

-- Delete: admin only — keeps an honest audit trail.
CREATE POLICY "student_notes del admin"
  ON student_notes FOR DELETE TO authenticated
  USING (is_admin());
