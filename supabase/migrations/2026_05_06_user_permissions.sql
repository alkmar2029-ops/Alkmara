-- Per-user granular permissions for admins.
--
-- The role column on user_profiles still controls top-level access
-- (teacher / admin / staff / viewer / super_admin). For admins we also
-- want fine-grained capabilities so the principal can grant a deputy
-- "attendance + dismissals" without giving them user-management or
-- school-settings access.
--
-- permissions JSONB shape (all booleans, default false):
--   {
--     take_attendance:   bool,    -- daily + period attendance entry
--     manage_dismissals: bool,    -- create / cancel dismissals
--     write_notes:       bool,    -- admin-written student notes
--     send_whatsapp:     bool,    -- manual + bulk WhatsApp sends
--     view_reports:      bool,    -- access to /dashboard/reports/*
--     manage_students:   bool,    -- add / edit / delete students
--     manage_users:      bool,    -- add / edit other admins + teachers
--     override_pickup:   bool,    -- bypass social_info pickup blocks
--     manage_schedule:   bool,    -- smart schedule + teacher assignments
--     manage_settings:   bool,    -- school settings, WhatsApp config, devices
--   }
--
-- Enforcement is initially "soft" — sidebar + buttons hide based on
-- this column, but the existing role-based RLS policies still apply.
-- A follow-up PR will tighten server-side checks.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL;

COMMENT ON COLUMN user_profiles.permissions IS
  'JSONB capability flags for admins. NULL for teachers/super_admin (full or implicit perms).';
