-- Allow super_admin to participate in internal messaging.
--
-- The original policies in 2026_04_28_internal_messages.sql were written
-- before super_admin existed as a role. Now the principal (super_admin)
-- gets denied when sending broadcasts ("new row violates row-level
-- security policy for table internal_messages") and can't see messages
-- addressed to recipient_role='admin' even though they are functionally
-- the head admin.
--
-- Fixes here:
--   1. INSERT — super_admin is allowed alongside admin/staff/teacher.
--   2. SELECT — super_admin sees role='admin' broadcasts (so the
--      principal isn't blind to admin-wide announcements).
--   3. UPDATE — super_admin can mark role='admin' messages they're
--      reading as read/archived.
--
-- We don't grant super_admin blanket read access — teacher-to-teacher
-- DMs stay private. Only role-broadcast messages addressed to admins
-- become visible.

DROP POLICY IF EXISTS "messages read mine" ON internal_messages;
CREATE POLICY "messages read mine"
  ON internal_messages FOR SELECT TO authenticated
  USING (
    sender_id = auth.uid()
    OR recipient_id = auth.uid()
    OR (recipient_role IS NOT NULL AND recipient_role = current_user_role())
    -- super_admin acts as head admin: sees admin-addressed broadcasts.
    OR (recipient_role = 'admin' AND current_user_role() = 'super_admin')
  );

DROP POLICY IF EXISTS "messages insert" ON internal_messages;
CREATE POLICY "messages insert"
  ON internal_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND current_user_role() IN ('super_admin', 'admin', 'staff', 'teacher')
  );

DROP POLICY IF EXISTS "messages update mine" ON internal_messages;
CREATE POLICY "messages update mine"
  ON internal_messages FOR UPDATE TO authenticated
  USING (
    recipient_id = auth.uid()
    OR (recipient_role IS NOT NULL AND recipient_role = current_user_role())
    OR (recipient_role = 'admin' AND current_user_role() = 'super_admin')
  )
  WITH CHECK (
    recipient_id = auth.uid()
    OR (recipient_role IS NOT NULL AND recipient_role = current_user_role())
    OR (recipient_role = 'admin' AND current_user_role() = 'super_admin')
  );

-- Delete policy ("messages delete admin") already calls is_admin(),
-- which we fixed earlier to include super_admin — no change needed there.
