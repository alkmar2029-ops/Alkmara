-- Multi-phase background campaigns for sending daily-attendance
-- WhatsApp notifications. Same pattern as bulk_send_jobs but extended
-- for the four escape categories — admin clicks "send all", server
-- processes all 180+ recipients across 4 phases sequentially, and the
-- admin can close the page entirely while it runs.
--
-- Lifecycle:
--   pending → processing → completed/failed/cancelled
--   processing → paused (resumable) → processing
--
-- Workers self-trigger to drain the queue past Vercel's max function
-- duration (300s); each call processes recipients at the wasender 5.5s
-- pace until the budget runs out, then triggers the next worker
-- invocation and exits.

CREATE TABLE IF NOT EXISTS daily_send_campaigns (
  id                   BIGSERIAL PRIMARY KEY,
  attendance_date      DATE NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','processing','paused','completed','failed','cancelled')),
  total                INTEGER NOT NULL DEFAULT 0,
  sent                 INTEGER NOT NULL DEFAULT 0,
  failed               INTEGER NOT NULL DEFAULT 0,
  -- Per-phase progress snapshot kept on the parent row so the polling
  -- client gets everything in one query.
  -- Shape: { absence: {total, sent, failed, status}, escape_after_first: ..., ... }
  current_phase        VARCHAR(50),
  phases_state         JSONB NOT NULL DEFAULT '{}',
  -- Custom message override; falls back to per-phase default when null.
  custom_message       TEXT,
  -- Audit fields
  created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  paused_at            TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  -- Live status for the progress panel
  last_recipient_name  TEXT,
  last_sent_at         TIMESTAMPTZ,
  error_message        TEXT
);

CREATE INDEX IF NOT EXISTS daily_send_campaigns_status_idx
  ON daily_send_campaigns (status, created_at DESC);
CREATE INDEX IF NOT EXISTS daily_send_campaigns_creator_idx
  ON daily_send_campaigns (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_send_recipients (
  id                BIGSERIAL PRIMARY KEY,
  campaign_id       BIGINT NOT NULL REFERENCES daily_send_campaigns(id) ON DELETE CASCADE,
  -- Phase grouping — drives the sequential drain order.
  phase_key         VARCHAR(50) NOT NULL
                    CHECK (phase_key IN ('absence','escape_after_first','mid_day_departure','selective_skip')),
  phase_order       SMALLINT NOT NULL,        -- 1..4 (mirrors phase priority)
  recipient_order   INTEGER NOT NULL,         -- order WITHIN the phase
  -- Recipient details (denormalized so the worker doesn't need joins)
  student_id        INTEGER NOT NULL,
  student_name      TEXT NOT NULL,
  phone             VARCHAR(20),
  grade_name        VARCHAR(50),
  section_name      VARCHAR(50),
  -- Periods the student missed — only meaningful for escape categories.
  -- JSONB array of integers: [3, 5, 7].
  absent_periods    JSONB,
  -- Outcome
  status            VARCHAR(20) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sending','sent','failed','skipped')),
  error             TEXT,
  sent_at           TIMESTAMPTZ,
  UNIQUE (campaign_id, phase_order, recipient_order)
);

CREATE INDEX IF NOT EXISTS daily_send_recipients_campaign_status_idx
  ON daily_send_recipients (campaign_id, status, phase_order, recipient_order);

ALTER TABLE daily_send_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_send_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ds_campaigns read" ON daily_send_campaigns;
DROP POLICY IF EXISTS "ds_campaigns ins"  ON daily_send_campaigns;
DROP POLICY IF EXISTS "ds_campaigns upd"  ON daily_send_campaigns;
DROP POLICY IF EXISTS "ds_recipients read" ON daily_send_recipients;
DROP POLICY IF EXISTS "ds_recipients ins"  ON daily_send_recipients;
DROP POLICY IF EXISTS "ds_recipients upd"  ON daily_send_recipients;

CREATE POLICY "ds_campaigns read"
  ON daily_send_campaigns FOR SELECT TO authenticated
  USING (is_staff_or_admin());
CREATE POLICY "ds_campaigns ins"
  ON daily_send_campaigns FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());
CREATE POLICY "ds_campaigns upd"
  ON daily_send_campaigns FOR UPDATE TO authenticated
  USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());

CREATE POLICY "ds_recipients read"
  ON daily_send_recipients FOR SELECT TO authenticated
  USING (is_staff_or_admin());
CREATE POLICY "ds_recipients ins"
  ON daily_send_recipients FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());
CREATE POLICY "ds_recipients upd"
  ON daily_send_recipients FOR UPDATE TO authenticated
  USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
