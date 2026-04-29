-- Background-job queue for the bulk-message-to-teachers flow.
--
-- The synchronous POST endpoint was forcing the admin to keep the browser
-- open for 2-3 minutes per send. Splitting into a queue:
--   • POST creates a `bulk_send_jobs` row + N `bulk_send_recipients` rows,
--     then returns immediately with the job id.
--   • A separate worker invocation drains the queue at the Wasender
--     pacing (5.5s per send) for up to maxDuration. Self-resumes via
--     internal trigger if the budget runs out before the queue empties.
--   • A live-progress page polls the job row to show the user what's
--     happening — they can navigate away and come back.

CREATE TABLE IF NOT EXISTS bulk_send_jobs (
  id              BIGSERIAL PRIMARY KEY,
  template        TEXT NOT NULL,
  also_internal   BOOLEAN NOT NULL DEFAULT FALSE,
  internal_subject TEXT,
  -- Lifecycle: pending → processing → (completed | failed | cancelled).
  -- 'failed' is reserved for catastrophic failures (e.g. Wasender
  -- credentials missing); per-recipient failures live on the recipient
  -- row and don't block the job.
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  total           INTEGER NOT NULL DEFAULT 0,
  sent            INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bulk_send_jobs_created_idx
  ON bulk_send_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS bulk_send_jobs_status_idx
  ON bulk_send_jobs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS bulk_send_recipients (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT NOT NULL REFERENCES bulk_send_jobs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,           -- the teacher (auth.users.id)
  teacher_name  VARCHAR(200),
  phone         VARCHAR(20),
  -- 'queued' → ready to send, 'sending' → in-flight (claim marker so two
  -- workers don't double-fire), 'sent' / 'failed' → terminal.
  status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sending','sent','failed','skipped')),
  error         TEXT,
  sent_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bulk_send_recipients_job_status_idx
  ON bulk_send_recipients (job_id, status);

-- RLS — admin/staff can see and create their own jobs.
ALTER TABLE bulk_send_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_send_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bulk_jobs read"  ON bulk_send_jobs;
DROP POLICY IF EXISTS "bulk_jobs ins"   ON bulk_send_jobs;
DROP POLICY IF EXISTS "bulk_jobs upd"   ON bulk_send_jobs;
DROP POLICY IF EXISTS "bulk_recipients read" ON bulk_send_recipients;
DROP POLICY IF EXISTS "bulk_recipients ins"  ON bulk_send_recipients;
DROP POLICY IF EXISTS "bulk_recipients upd"  ON bulk_send_recipients;

CREATE POLICY "bulk_jobs read"
  ON bulk_send_jobs FOR SELECT TO authenticated
  USING (is_staff_or_admin());

CREATE POLICY "bulk_jobs ins"
  ON bulk_send_jobs FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());

CREATE POLICY "bulk_jobs upd"
  ON bulk_send_jobs FOR UPDATE TO authenticated
  USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());

CREATE POLICY "bulk_recipients read"
  ON bulk_send_recipients FOR SELECT TO authenticated
  USING (is_staff_or_admin());

CREATE POLICY "bulk_recipients ins"
  ON bulk_send_recipients FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());

CREATE POLICY "bulk_recipients upd"
  ON bulk_send_recipients FOR UPDATE TO authenticated
  USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
