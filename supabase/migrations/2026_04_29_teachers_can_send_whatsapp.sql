-- Precautionary toggle: "Allow teachers to send WhatsApp to parents
-- after recording notes."
--
-- Defaults to FALSE so today's behavior is preserved exactly: teachers
-- record/save notes, but only admin/staff can send the parent WhatsApp
-- from the dashboard. When the admin flips this to TRUE, the teacher
-- portal exposes a "Send WhatsApp to parents" button on the notes-print
-- page, and the /api/whatsapp/send-notes endpoint admits the teacher
-- role.
--
-- Lives on whatsapp_settings (singleton row id=1) — admin-only via the
-- existing RLS on that table.
ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS teachers_can_send_whatsapp BOOLEAN NOT NULL DEFAULT FALSE;
