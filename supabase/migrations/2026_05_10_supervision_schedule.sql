-- Break-time supervision schedule (إشراف الفسحة).
--
-- 4 tables:
--   1. supervision_locations  — admin-managed list of supervision posts
--      (الساحة الأمامية، الباب الكبير ١، إلخ).
--   2. supervision_assignments — the weekly grid. ONE teacher per
--      (location × day-of-week). Repeats every week until edited.
--   3. supervision_swap_requests — teacher-initiated request to swap
--      one of their assigned days with another teacher.
--   4. supervision_reminder_log — global dedup flag for the daily
--      morning WhatsApp reminder (one row per date = sent today).
--
-- RLS: SELECT open to all authenticated users (every teacher can view
-- the schedule). INSERT/UPDATE/DELETE on locations + assignments gated
-- by super_admin OR user_profiles.permissions->>'manage_schedule' = 'true'.
-- (Soft enforcement matches the rest of the codebase.)

-- ===========================================================================
-- 1) Locations
-- ===========================================================================
CREATE TABLE IF NOT EXISTS supervision_locations (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS supervision_locations_active_idx
  ON supervision_locations (is_active, sort_order);

-- Seed the locations the user already uses on paper (form #8).
-- ON CONFLICT DO NOTHING so re-running this migration is safe.
INSERT INTO supervision_locations (name, sort_order) VALUES
  ('الساحة الأمامية',           10),
  ('الساحة الأمامية - المقصف',  20),
  ('وسط الساحة',                30),
  ('الساحة الوسطى',             40),
  ('الساحة خلف المبنى ١',       50),
  ('الساحة خلف المبنى ٢',       60),
  ('المقصف - الشباك ١',         70),
  ('المقصف - الشباك ٢',         80),
  ('الباب الكبير ١',            90),
  ('الباب الخارجي الوسط',      100),
  ('مشرف عام',                 110)
ON CONFLICT (name) DO NOTHING;

-- ===========================================================================
-- 2) Assignments — the weekly grid
-- ===========================================================================
-- day_of_week: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday.
-- Friday/Saturday are weekend in Saudi Arabia → not allowed in the grid.
CREATE TABLE IF NOT EXISTS supervision_assignments (
  id           BIGSERIAL PRIMARY KEY,
  location_id  BIGINT NOT NULL REFERENCES supervision_locations(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 4),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notes        TEXT,
  updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One supervisor per location per day. Admin replaces by upsert.
  UNIQUE (location_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS supervision_assignments_day_idx
  ON supervision_assignments (day_of_week);
CREATE INDEX IF NOT EXISTS supervision_assignments_user_idx
  ON supervision_assignments (user_id);

-- ===========================================================================
-- 3) Swap requests
-- ===========================================================================
CREATE TABLE IF NOT EXISTS supervision_swap_requests (
  id                       BIGSERIAL PRIMARY KEY,
  requester_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The two assignments being swapped. On approval, their user_ids
  -- are exchanged in a single transaction.
  requester_assignment_id  BIGINT NOT NULL REFERENCES supervision_assignments(id) ON DELETE CASCADE,
  target_assignment_id     BIGINT NOT NULL REFERENCES supervision_assignments(id) ON DELETE CASCADE,
  reason                   TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at               TIMESTAMPTZ,
  decision_note            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS supervision_swap_requests_status_idx
  ON supervision_swap_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS supervision_swap_requests_requester_idx
  ON supervision_swap_requests (requester_id, status);

-- ===========================================================================
-- 4) Reminder log — global dedup so multiple page loads don't all send.
-- ===========================================================================
-- One row per school day: PK conflict means "already sent today, skip".
CREATE TABLE IF NOT EXISTS supervision_reminder_log (
  date           DATE PRIMARY KEY,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_count     INTEGER NOT NULL DEFAULT 0,
  failed_count   INTEGER NOT NULL DEFAULT 0,
  triggered_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ===========================================================================
-- RLS — view open to all, edit gated by role + permission flag
-- ===========================================================================
ALTER TABLE supervision_locations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_swap_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_reminder_log    ENABLE ROW LEVEL SECURITY;

-- Helper: returns true if the current user is super_admin OR has the
-- 'manage_schedule' permission flag set in user_profiles.permissions.
CREATE OR REPLACE FUNCTION can_manage_supervision()
RETURNS BOOLEAN LANGUAGE SQL STABLE
AS $$
  SELECT
    current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid()
        AND (permissions ->> 'manage_schedule')::boolean = TRUE
    );
$$;

-- Locations
DROP POLICY IF EXISTS "supervision_locations read"   ON supervision_locations;
DROP POLICY IF EXISTS "supervision_locations write"  ON supervision_locations;
CREATE POLICY "supervision_locations read"
  ON supervision_locations FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "supervision_locations write"
  ON supervision_locations FOR ALL TO authenticated
  USING (can_manage_supervision()) WITH CHECK (can_manage_supervision());

-- Assignments
DROP POLICY IF EXISTS "supervision_assignments read"   ON supervision_assignments;
DROP POLICY IF EXISTS "supervision_assignments write"  ON supervision_assignments;
CREATE POLICY "supervision_assignments read"
  ON supervision_assignments FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "supervision_assignments write"
  ON supervision_assignments FOR ALL TO authenticated
  USING (can_manage_supervision()) WITH CHECK (can_manage_supervision());

-- Swap requests: requester sees + creates own, admin sees + decides all.
DROP POLICY IF EXISTS "swap_requests read"     ON supervision_swap_requests;
DROP POLICY IF EXISTS "swap_requests insert"   ON supervision_swap_requests;
DROP POLICY IF EXISTS "swap_requests update"   ON supervision_swap_requests;
CREATE POLICY "swap_requests read"
  ON supervision_swap_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR can_manage_supervision());
CREATE POLICY "swap_requests insert"
  ON supervision_swap_requests FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());
CREATE POLICY "swap_requests update"
  ON supervision_swap_requests FOR UPDATE TO authenticated
  USING (
    -- requester can withdraw their own pending request
    (requester_id = auth.uid() AND status = 'pending')
    OR can_manage_supervision()
  );

-- Reminder log: read-all (admins watch the dedup), write via service role.
DROP POLICY IF EXISTS "reminder_log read"   ON supervision_reminder_log;
CREATE POLICY "reminder_log read"
  ON supervision_reminder_log FOR SELECT TO authenticated USING (TRUE);
-- No INSERT/UPDATE policy on purpose — only the service-role admin client
-- writes here (from lib/supervision/reminder.ts). RLS blocks accidental
-- writes from regular sessions.

COMMENT ON TABLE supervision_locations IS
  'Named supervision posts (الساحة الأمامية، الباب الكبير، إلخ). Seeded with the locations from the school paper form #8.';
COMMENT ON TABLE supervision_assignments IS
  'Weekly schedule grid (location × day_of_week → user). Repeats every week until edited.';
COMMENT ON TABLE supervision_swap_requests IS
  'Teacher requests to swap their day. On approve, the two assignments user_ids are exchanged transactionally.';
COMMENT ON TABLE supervision_reminder_log IS
  'Dedup flag for the morning WhatsApp reminder. PK = date so only one sender wins per day even if multiple admins open the dashboard.';
