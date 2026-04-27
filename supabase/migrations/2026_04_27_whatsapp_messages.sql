-- WhatsApp message log — every outgoing message the system tries to send
-- is recorded here so admins can audit, debug failures, and see history.
-- (Wasender free tier doesn't expose incoming messages, so this is outbound-only.)

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id              BIGSERIAL PRIMARY KEY,
  -- Recipient (denormalized for fast log reads even after the entity is deleted)
  recipient_phone VARCHAR(20) NOT NULL,
  recipient_name  VARCHAR(200),
  recipient_type  VARCHAR(20) NOT NULL DEFAULT 'unknown'
                  CHECK (recipient_type IN ('parent', 'teacher', 'admin', 'unknown')),
  -- Context: which feature triggered this send
  template_name   VARCHAR(50),       -- e.g. 'note_positive', 'late_notification', 'teacher_credentials'
  context_type    VARCHAR(50),       -- 'note', 'late', 'teacher_credentials', 'manual'
  context_id      TEXT,              -- FK-ish (uuid for users, bigint for notes — use TEXT for both)
  message_body    TEXT NOT NULL,
  -- Outcome
  status          VARCHAR(10) NOT NULL CHECK (status IN ('success', 'failed')),
  http_status     INTEGER,
  error_message   TEXT,
  msg_id          BIGINT,            -- WasenderAPI message id (if success)
  -- Audit
  sent_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_sent_at_idx ON whatsapp_messages (sent_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_idx   ON whatsapp_messages (recipient_phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_context_idx ON whatsapp_messages (context_type, context_id);
CREATE INDEX IF NOT EXISTS whatsapp_messages_status_idx  ON whatsapp_messages (status, sent_at DESC) WHERE status = 'failed';

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_messages read"  ON whatsapp_messages;
DROP POLICY IF EXISTS "wa_messages ins"   ON whatsapp_messages;
DROP POLICY IF EXISTS "wa_messages del"   ON whatsapp_messages;

-- Read: admin or staff (privacy — message bodies may contain student names).
CREATE POLICY "wa_messages read"
  ON whatsapp_messages FOR SELECT TO authenticated
  USING (is_staff_or_admin());

-- Insert: admin or staff (server inserts on behalf via service role too,
-- which bypasses RLS — this policy covers signed-in clients if ever needed).
CREATE POLICY "wa_messages ins"
  ON whatsapp_messages FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());

-- Delete: admin only (e.g., GDPR-style cleanup).
CREATE POLICY "wa_messages del"
  ON whatsapp_messages FOR DELETE TO authenticated
  USING (is_admin());
