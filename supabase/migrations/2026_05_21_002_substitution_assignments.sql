-- substitution_assignments — pairing of "absent teacher's scheduled
-- period" with the substitute the VP picked to cover it.
--
-- Workflow:
--   1. VP marks teacher absent → daily_teacher_absences row.
--   2. UI shows that teacher's scheduled periods (from teacher_schedule).
--   3. For each period, VP picks a substitute → one row here.
--   4. WhatsApp notifies the substitute (writes whatsapp_sent_at).
--   5. Substitute acknowledges via portal (writes acknowledged_at).
--
-- Dependencies:
--   - daily_teacher_absences (FK absence_id, CASCADE delete)
--   - auth.users (FK substitute_user_id, CASCADE delete)
--   - sections (FK section_id, SET NULL on delete to preserve history)
--   - current_user_has_flag, current_user_role (from extend_permissions)

CREATE TABLE IF NOT EXISTS substitution_assignments (
  id                  BIGSERIAL PRIMARY KEY,
  absence_id          BIGINT NOT NULL REFERENCES daily_teacher_absences(id) ON DELETE CASCADE,
  substitute_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The specific slot in the absent teacher's day this fills.
  -- Constraints match teacher_schedule (Saudi week, periods 1..8).
  day_of_week         SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
  period_number       SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 8),

  -- Section being covered. Nullable because a free-period sub (hall
  -- duty, surveillance) may have no section. SET NULL on delete so
  -- historic substitution rows survive section reshuffles.
  section_id          INTEGER REFERENCES sections(id) ON DELETE SET NULL,

  -- Who made the call. SET NULL preserves the assignment row even if
  -- the assigner's account is removed.
  assigned_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Async notification + acknowledgement timestamps. Both NULL until
  -- the respective event fires.
  whatsapp_sent_at    TIMESTAMPTZ,
  acknowledged_at     TIMESTAMPTZ,

  -- One assignment per slot. Swapping a substitute = DELETE + INSERT
  -- in the API layer, OR an ON CONFLICT upsert.
  UNIQUE (absence_id, day_of_week, period_number)
);

-- Hot path #1: "show me this absence's assignments" — VP screen lists
-- subs per slot. Covered by the FK index Postgres auto-creates for
-- absence_id (via the FK), but a dedicated index helps the assignment
-- list query when the FK index isn't selective enough.
CREATE INDEX IF NOT EXISTS substitution_assignments_absence_idx
  ON substitution_assignments (absence_id, day_of_week, period_number);

-- Hot path #2: "show me this substitute's recent assignments" — used by
-- the substitute's portal + smart alerts ("you covered 5 periods this
-- week").
CREATE INDEX IF NOT EXISTS substitution_assignments_substitute_idx
  ON substitution_assignments (substitute_user_id, assigned_at DESC);

-- ============= RLS =============
ALTER TABLE substitution_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS substitution_assignments_read  ON substitution_assignments;
DROP POLICY IF EXISTS substitution_assignments_write ON substitution_assignments;

-- Read: admin family + staff + the substitute themselves. is_admin()
-- is fine here despite covering counselor — substitution data isn't
-- counselor-sensitive (no student PII).
CREATE POLICY substitution_assignments_read
  ON substitution_assignments
  FOR SELECT TO authenticated
  USING (
    is_admin()
    OR current_user_role() = 'staff'
    OR substitute_user_id = auth.uid()
  );

-- Write: super_admin OR manage_substitutions flag (same gate as
-- daily_teacher_absences). Counselor does NOT pass — they carry
-- role=admin but lack the flag.
CREATE POLICY substitution_assignments_write
  ON substitution_assignments
  FOR ALL TO authenticated
  USING (
    current_user_role() = 'super_admin'
    OR current_user_has_flag('manage_substitutions')
  )
  WITH CHECK (
    current_user_role() = 'super_admin'
    OR current_user_has_flag('manage_substitutions')
  );

COMMENT ON TABLE substitution_assignments IS
  'VP-side substitution picks: which substitute covers which period of an absent teacher''s day. Updated by the substitutions workflow (م2.7-2.9). RLS write-gated on manage_substitutions to exclude counselors (who carry role=admin).';
