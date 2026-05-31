-- teacher_leaves — leave request workflow.
--
-- Distinct from daily_teacher_absences:
--   - daily_teacher_absences = "X was absent on date Y" (final, retro-active)
--   - teacher_leaves         = "X requested days A..B for reason R" (workflow)
--
-- The teacher submits a pending request; an admin with the
-- approve_teacher_leave flag (typically VP-administrative) decides.
-- On approval, the API layer (م2.10) creates the corresponding
-- daily_teacher_absences rows for each day in the leave range. We
-- deliberately keep this DB-side migration free of triggers — the
-- conversion is API logic so it can be conditional (e.g., don't
-- duplicate an absence already recorded manually for that date).

CREATE TABLE IF NOT EXISTS teacher_leaves (
  id                BIGSERIAL PRIMARY KEY,
  teacher_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,

  leave_type        VARCHAR(30) NOT NULL CHECK (leave_type IN (
    'sick',         -- إجازة مرضية
    'personal',     -- اضطرارية
    'official',     -- رسمية / مأمورية
    'maternity',    -- وضع
    'pilgrimage',   -- حج
    'other'
  )),
  reason            TEXT,

  status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'cancelled'
  )),

  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  decision_note     TEXT,

  -- Sanity: end_date >= start_date. Caught at insert time with a
  -- clear constraint error.
  CHECK (end_date >= start_date)
);

-- "Pending requests" — VP's review queue. Most-urgent first.
CREATE INDEX IF NOT EXISTS teacher_leaves_pending_idx
  ON teacher_leaves (requested_at DESC)
  WHERE status = 'pending';

-- "This teacher's leave history" — surfaced on the teacher's profile.
CREATE INDEX IF NOT EXISTS teacher_leaves_teacher_idx
  ON teacher_leaves (teacher_user_id, start_date DESC);

-- ============= RLS =============
ALTER TABLE teacher_leaves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teacher_leaves_read   ON teacher_leaves;
DROP POLICY IF EXISTS teacher_leaves_insert ON teacher_leaves;
DROP POLICY IF EXISTS teacher_leaves_update ON teacher_leaves;
DROP POLICY IF EXISTS teacher_leaves_delete ON teacher_leaves;

-- Read: admin family + staff + the teacher themselves.
CREATE POLICY teacher_leaves_read
  ON teacher_leaves
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR current_user_role() = 'staff'
    OR teacher_user_id = auth.uid()
  );

-- Insert: a teacher submitting their own request, OR an admin with
-- approve_teacher_leave (admin-side bulk entry / proxy submission).
-- super_admin always passes via the OR.
CREATE POLICY teacher_leaves_insert
  ON teacher_leaves
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_user_id = auth.uid()
    OR current_user_role() = 'super_admin'
    OR current_user_has_flag('approve_teacher_leave')
  );

-- Update: split into two cases.
--   - Approver (super_admin OR has approve_teacher_leave flag): any
--     row, any status transition. The API enforces sane transitions.
--   - Teacher: only their own pending row, only to set status =
--     cancelled. The WITH CHECK constrains the new state.
CREATE POLICY teacher_leaves_update
  ON teacher_leaves
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = 'super_admin'
    OR current_user_has_flag('approve_teacher_leave')
    OR (teacher_user_id = auth.uid() AND status = 'pending')
  )
  WITH CHECK (
    current_user_role() = 'super_admin'
    OR current_user_has_flag('approve_teacher_leave')
    OR (teacher_user_id = auth.uid() AND status IN ('pending', 'cancelled'))
  );

-- Delete: super_admin only. Leave records are audit data — admins/
-- teachers cancel rather than delete.
CREATE POLICY teacher_leaves_delete
  ON teacher_leaves
  FOR DELETE TO authenticated
  USING (current_user_role() = 'super_admin');

COMMENT ON TABLE teacher_leaves IS
  'Leave request workflow (teacher submits, approver decides). On approval, API layer creates daily_teacher_absences rows for each day in the range. RLS: teacher can submit + cancel own pending; approve_teacher_leave flag holders can decide.';

COMMENT ON COLUMN teacher_leaves.leave_type IS
  'Saudi-context categories: sick / personal (اضطرارية) / official (رسمية) / maternity / pilgrimage / other. Update the CHECK constraint if a new category is needed.';
