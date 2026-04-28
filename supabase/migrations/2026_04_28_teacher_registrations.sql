-- Public teacher self-registration. Teachers fill in their details on a
-- public page; admins review and approve to create the actual auth account.

CREATE TABLE IF NOT EXISTS teacher_registrations (
  id          BIGSERIAL PRIMARY KEY,
  full_name   VARCHAR(200) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  phone       VARCHAR(20) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  notes       TEXT,
  -- Set once admin approves and the auth account is created.
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Treat email as unique only across pending registrations so a previously
-- rejected email can re-apply.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_registrations_email_pending
  ON teacher_registrations (LOWER(email))
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS teacher_registrations_status_idx
  ON teacher_registrations (status, created_at DESC);

ALTER TABLE teacher_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "registrations public insert" ON teacher_registrations;
DROP POLICY IF EXISTS "registrations admin read"    ON teacher_registrations;
DROP POLICY IF EXISTS "registrations admin update"  ON teacher_registrations;
DROP POLICY IF EXISTS "registrations admin delete"  ON teacher_registrations;

-- Public submission — `anon` and `authenticated` can insert pending rows only.
CREATE POLICY "registrations public insert"
  ON teacher_registrations FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'pending');

-- Read: admin/staff only.
CREATE POLICY "registrations admin read"
  ON teacher_registrations FOR SELECT TO authenticated
  USING (is_staff_or_admin());

-- Update: admin only (approve/reject).
CREATE POLICY "registrations admin update"
  ON teacher_registrations FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Delete: admin only.
CREATE POLICY "registrations admin delete"
  ON teacher_registrations FOR DELETE TO authenticated
  USING (is_admin());
