-- Admin role hierarchy + section-scoped admins + admin self-registration.
--
-- Before: every 'admin' user had unrestricted access to every section,
-- every student, every note. After this migration:
--   • super_admin → unrestricted (the principal + deputy)
--   • admin      → scoped to admin_section_assignments rows (like teachers)
--   • staff      → unchanged (helper/secretary, full read access)
--   • viewer     → unchanged (read-only school-wide)
--   • teacher    → unchanged (still scoped via teacher_section_assignments)
--
-- The migration auto-promotes the founding account (basem902@gmail.com)
-- to super_admin so its access doesn't break the moment RLS tightens.
-- Other existing admins keep their 'admin' role and start with zero
-- assignments — they'll see empty pages until the principal assigns them.

-- ============= 1. Role enum =============
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'staff', 'viewer', 'teacher'));

-- ============= 2. Auto-promote founding account =============
-- Looks up the email and flips its role. Idempotent — re-running is safe.
UPDATE user_profiles
   SET role = 'super_admin'
 WHERE user_id IN (
   SELECT id FROM auth.users WHERE LOWER(email) = 'basem902@gmail.com'
 );

-- ============= 3. Helper functions =============
-- Replaces the bare role check with a function so RLS policies stay
-- short and one-line. SECURITY DEFINER + STABLE so they're cheap.
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$$;

-- Updates the existing is_admin() to match super_admin too — anything
-- super_admin is also admin for legacy code paths.
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

-- Updates is_staff_or_admin() similarly.
CREATE OR REPLACE FUNCTION is_staff_or_admin() RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin', 'staff')
  );
$$;

-- ============= 4. Admin section assignments =============
CREATE TABLE IF NOT EXISTS admin_section_assignments (
  id              BIGSERIAL PRIMARY KEY,
  admin_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  assigned_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (admin_user_id, section_id)
);

CREATE INDEX IF NOT EXISTS admin_section_assignments_admin_idx
  ON admin_section_assignments (admin_user_id);

ALTER TABLE admin_section_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_assignments super_admin all" ON admin_section_assignments;
DROP POLICY IF EXISTS "admin_assignments self read"      ON admin_section_assignments;

CREATE POLICY "admin_assignments super_admin all"
  ON admin_section_assignments FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY "admin_assignments self read"
  ON admin_section_assignments FOR SELECT TO authenticated
  USING (admin_user_id = auth.uid() OR is_super_admin());

-- ============= 5. Admin invite codes =============
CREATE TABLE IF NOT EXISTS admin_invite_codes (
  id              BIGSERIAL PRIMARY KEY,
  -- Random 8-char token like ABCD-1234. App generates and inserts.
  code            VARCHAR(20) NOT NULL UNIQUE,
  -- Pre-filled context the invitee will see; helps them confirm they
  -- got the right code from the right person.
  invitee_name    VARCHAR(200),
  invitee_phone   VARCHAR(20),
  -- Pre-suggested sections the principal wants this admin to cover —
  -- shown on the registration page as a hint, super_admin confirms on approval.
  suggested_section_ids INTEGER[],
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 48-hour default window. App stores the absolute expiry on insert.
  expires_at      TIMESTAMPTZ NOT NULL,
  -- Set when the code is consumed by a successful registration submission.
  used_at         TIMESTAMPTZ,
  used_by_registration_id BIGINT,
  -- Soft revoke — super_admin can mark a code dead without deleting it.
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS admin_invite_codes_code_idx
  ON admin_invite_codes (code);
CREATE INDEX IF NOT EXISTS admin_invite_codes_active_idx
  ON admin_invite_codes (expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE admin_invite_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invite_codes super_admin all" ON admin_invite_codes;
CREATE POLICY "invite_codes super_admin all"
  ON admin_invite_codes FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============= 6. Admin registrations =============
CREATE TABLE IF NOT EXISTS admin_registrations (
  id            BIGSERIAL PRIMARY KEY,
  full_name     VARCHAR(200) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  phone         VARCHAR(20) NOT NULL,
  invite_code_id BIGINT REFERENCES admin_invite_codes(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  notes         TEXT,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ,
  rejected_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_registrations_email_pending
  ON admin_registrations (LOWER(email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS admin_registrations_status_idx
  ON admin_registrations (status, created_at DESC);

ALTER TABLE admin_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_regs public insert" ON admin_registrations;
DROP POLICY IF EXISTS "admin_regs super_admin"   ON admin_registrations;

-- Public inserts — anonymous registration form. The route still
-- gates on a valid invite code, so this just allows the bare INSERT.
CREATE POLICY "admin_regs public insert"
  ON admin_registrations FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'pending');

CREATE POLICY "admin_regs super_admin"
  ON admin_registrations FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============= 7. Tighten RLS on the data tables for admin scoping =============
-- Pattern for each: super_admin/staff/viewer keep full read; admin role
-- gets fenced to its assigned sections; teacher already fenced earlier.

-- students
DROP POLICY IF EXISTS "students read" ON students;
CREATE POLICY "students read" ON students FOR SELECT TO authenticated USING (
  is_super_admin()
  OR current_user_role() IN ('staff', 'viewer')
  OR (
    current_user_role() = 'admin'
    AND section_id IN (
      SELECT section_id FROM admin_section_assignments WHERE admin_user_id = auth.uid()
    )
  )
  OR (
    current_user_role() = 'teacher'
    AND section_id IN (
      SELECT section_id FROM teacher_section_assignments WHERE teacher_user_id = auth.uid()
    )
  )
);

-- attendance_records
DROP POLICY IF EXISTS "attendance read" ON attendance_records;
CREATE POLICY "attendance read" ON attendance_records FOR SELECT TO authenticated USING (
  is_super_admin()
  OR current_user_role() IN ('staff', 'viewer')
  OR (
    current_user_role() = 'admin'
    AND section_id IN (
      SELECT section_id FROM admin_section_assignments WHERE admin_user_id = auth.uid()
    )
  )
  OR (
    current_user_role() = 'teacher'
    AND section_id IN (
      SELECT section_id FROM teacher_section_assignments WHERE teacher_user_id = auth.uid()
    )
  )
);

-- period_sessions
DROP POLICY IF EXISTS "period_sessions read" ON period_sessions;
CREATE POLICY "period_sessions read" ON period_sessions FOR SELECT TO authenticated USING (
  is_super_admin()
  OR current_user_role() IN ('staff', 'viewer')
  OR (
    current_user_role() = 'admin'
    AND section_id IN (
      SELECT section_id FROM admin_section_assignments WHERE admin_user_id = auth.uid()
    )
  )
  OR (
    current_user_role() = 'teacher'
    AND section_id IN (
      SELECT section_id FROM teacher_section_assignments WHERE teacher_user_id = auth.uid()
    )
  )
);

-- period_absences (joined through period_sessions)
DROP POLICY IF EXISTS "period_absences read" ON period_absences;
CREATE POLICY "period_absences read" ON period_absences FOR SELECT TO authenticated USING (
  is_super_admin()
  OR current_user_role() IN ('staff', 'viewer')
  OR (
    current_user_role() = 'admin'
    AND session_id IN (
      SELECT id FROM period_sessions WHERE section_id IN (
        SELECT section_id FROM admin_section_assignments WHERE admin_user_id = auth.uid()
      )
    )
  )
  OR (
    current_user_role() = 'teacher'
    AND session_id IN (
      SELECT id FROM period_sessions WHERE section_id IN (
        SELECT section_id FROM teacher_section_assignments WHERE teacher_user_id = auth.uid()
      )
    )
  )
);

-- student_notes (joined through students.section_id; teachers also keep own-recordings access)
DROP POLICY IF EXISTS "student_notes read" ON student_notes;
CREATE POLICY "student_notes read" ON student_notes FOR SELECT TO authenticated USING (
  is_super_admin()
  OR current_user_role() IN ('staff', 'viewer')
  OR (
    current_user_role() = 'admin'
    AND student_id IN (
      SELECT s.id FROM students s WHERE s.section_id IN (
        SELECT section_id FROM admin_section_assignments WHERE admin_user_id = auth.uid()
      )
    )
  )
  OR (
    current_user_role() = 'teacher'
    AND (
      recorded_by = auth.uid()
      OR student_id IN (
        SELECT s.id FROM students s WHERE s.section_id IN (
          SELECT section_id FROM teacher_section_assignments WHERE teacher_user_id = auth.uid()
        )
      )
    )
  )
);

-- student_dismissals — same pattern; teachers keep their assignment-based read.
DROP POLICY IF EXISTS "dismissals admin all"     ON student_dismissals;
DROP POLICY IF EXISTS "dismissals teacher read"  ON student_dismissals;

-- super_admin + staff: full access; admin: scoped read + write within scope.
CREATE POLICY "dismissals super_admin all"
  ON student_dismissals FOR ALL TO authenticated
  USING (is_super_admin() OR current_user_role() = 'staff')
  WITH CHECK (is_super_admin() OR current_user_role() = 'staff');

CREATE POLICY "dismissals admin scoped"
  ON student_dismissals FOR ALL TO authenticated
  USING (
    current_user_role() = 'admin'
    AND student_id IN (
      SELECT s.id FROM students s WHERE s.section_id IN (
        SELECT section_id FROM admin_section_assignments WHERE admin_user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    current_user_role() = 'admin'
    AND student_id IN (
      SELECT s.id FROM students s WHERE s.section_id IN (
        SELECT section_id FROM admin_section_assignments WHERE admin_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "dismissals teacher read"
  ON student_dismissals FOR SELECT TO authenticated
  USING (
    current_user_role() = 'teacher'
    AND student_id IN (
      SELECT s.id FROM students s WHERE s.section_id IN (
        SELECT section_id FROM teacher_section_assignments WHERE teacher_user_id = auth.uid()
      )
    )
  );
