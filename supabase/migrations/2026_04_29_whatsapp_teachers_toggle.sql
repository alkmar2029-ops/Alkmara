-- Master toggle for teacher-bound WhatsApp messages.
--
-- When the school wants to silence teacher notifications (e.g. holidays,
-- testing weeks, or after Wasender outages), this single switch is read
-- by every code path that sends a WhatsApp to a teacher:
--   • Credentials on registration approval
--   • Registration-confirmation thank-you
--   • Missing-session reminders (single + bulk)
--
-- Defaults to TRUE so existing installations keep working unchanged.
-- Admin-only via existing whatsapp_settings RLS — no new policy needed.

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS teachers_enabled BOOLEAN NOT NULL DEFAULT TRUE;
