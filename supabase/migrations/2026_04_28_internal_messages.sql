-- Internal messaging between admin/staff ↔ teachers.
-- Each thread is identified by `thread_id` (UUID); replies share that id so
-- the inbox can group them. A message can optionally point at a student.

CREATE TABLE IF NOT EXISTS internal_messages (
  id              BIGSERIAL PRIMARY KEY,
  thread_id       UUID NOT NULL DEFAULT gen_random_uuid(),
  type            VARCHAR(20) NOT NULL DEFAULT 'general'
                  CHECK (type IN ('general', 'student_referral', 'student_notice', 'reply')),
  -- Sender always has an account
  sender_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Recipient: either a specific user OR a role broadcast (one must be non-null)
  recipient_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_role  VARCHAR(20)
                  CHECK (recipient_role IN ('admin', 'teacher', 'staff')),
  -- Optional context — which student this message refers to
  student_id      INTEGER REFERENCES students(id) ON DELETE SET NULL,
  subject         VARCHAR(200),
  body            TEXT NOT NULL,
  parent_message_id BIGINT REFERENCES internal_messages(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'read', 'archived', 'closed')),
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A message must have either a recipient_id or a recipient_role
  CONSTRAINT message_has_recipient CHECK (
    recipient_id IS NOT NULL OR recipient_role IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS internal_messages_recipient_idx
  ON internal_messages (recipient_id, status, created_at DESC)
  WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS internal_messages_role_idx
  ON internal_messages (recipient_role, status, created_at DESC)
  WHERE recipient_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS internal_messages_sender_idx
  ON internal_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS internal_messages_thread_idx
  ON internal_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS internal_messages_student_idx
  ON internal_messages (student_id, created_at DESC)
  WHERE student_id IS NOT NULL;

ALTER TABLE internal_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages read mine"      ON internal_messages;
DROP POLICY IF EXISTS "messages insert"         ON internal_messages;
DROP POLICY IF EXISTS "messages update mine"    ON internal_messages;
DROP POLICY IF EXISTS "messages delete admin"   ON internal_messages;

-- Read: I can see messages I sent, OR messages addressed to me directly,
-- OR messages broadcast to my role.
CREATE POLICY "messages read mine"
  ON internal_messages FOR SELECT TO authenticated
  USING (
    sender_id = auth.uid()
    OR recipient_id = auth.uid()
    OR (recipient_role IS NOT NULL AND recipient_role = current_user_role())
  );

-- Insert: any authenticated user (admin, staff, teacher) can send.
CREATE POLICY "messages insert"
  ON internal_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND current_user_role() IN ('admin', 'staff', 'teacher')
  );

-- Update: only the recipient can mark as read/archived.
CREATE POLICY "messages update mine"
  ON internal_messages FOR UPDATE TO authenticated
  USING (
    recipient_id = auth.uid()
    OR (recipient_role IS NOT NULL AND recipient_role = current_user_role())
  )
  WITH CHECK (
    recipient_id = auth.uid()
    OR (recipient_role IS NOT NULL AND recipient_role = current_user_role())
  );

-- Delete: admin only.
CREATE POLICY "messages delete admin"
  ON internal_messages FOR DELETE TO authenticated USING (is_admin());
