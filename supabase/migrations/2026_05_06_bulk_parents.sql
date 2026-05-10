-- Extends the existing bulk-send infrastructure to support
-- announcements to PARENTS (via student.phone), in addition to the
-- existing teacher-bulk-reminder flow.
--
-- Design: one set of tables for both audiences. The `audience` column
-- on bulk_send_jobs tells the worker which lookup path to use, and the
-- recipient row stores either user_id (teachers) or student_id (parents).
--
-- Also adds:
--   • scheduled_for — for "send at 3pm" support
--   • pacing knobs on the job (pacing_ms, jitter_ms, batch_size,
--     batch_cooldown_ms) so parent campaigns can run safer/slower than
--     the teacher flow without affecting it.
--   • target_filter JSONB for audit + display in the progress UI.
--   • consecutive_failures counter — worker auto-pauses if too many
--     same-error sends fail in a row (e.g. credentials revoked).

-- 1) Extend bulk_send_jobs.
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS audience          VARCHAR(20) NOT NULL DEFAULT 'teachers'
    CHECK (audience IN ('teachers','parents'));
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS scheduled_for     TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS pacing_ms         INTEGER NOT NULL DEFAULT 5500;
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS jitter_ms         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS batch_size        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS batch_cooldown_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS target_filter     JSONB DEFAULT NULL;
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bulk_send_jobs
  ADD COLUMN IF NOT EXISTS last_error_kind   VARCHAR(50) DEFAULT NULL;

-- New status: 'scheduled' (waiting for scheduled_for) and 'paused'
-- (worker hit too many consecutive failures, needs admin attention).
ALTER TABLE bulk_send_jobs
  DROP CONSTRAINT IF EXISTS bulk_send_jobs_status_check;
ALTER TABLE bulk_send_jobs
  ADD CONSTRAINT bulk_send_jobs_status_check
  CHECK (status IN ('pending','processing','completed','failed','cancelled','scheduled','paused'));

-- Index to find due-scheduled jobs efficiently.
CREATE INDEX IF NOT EXISTS bulk_send_jobs_scheduled_idx
  ON bulk_send_jobs (scheduled_for)
  WHERE status = 'scheduled';

-- 2) Extend bulk_send_recipients to allow parent rows.
-- user_id was NOT NULL for teacher campaigns. Make it nullable so
-- parent rows (which have student_id instead) can sit in the same table.
ALTER TABLE bulk_send_recipients
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE bulk_send_recipients
  ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES students(id) ON DELETE SET NULL;

-- Helpful index for parent-flow lookups.
CREATE INDEX IF NOT EXISTS bulk_send_recipients_student_idx
  ON bulk_send_recipients (student_id)
  WHERE student_id IS NOT NULL;

COMMENT ON COLUMN bulk_send_jobs.audience IS
  'Which audience this job targets — drives worker lookup path (teachers via user_id, parents via student_id).';
COMMENT ON COLUMN bulk_send_jobs.scheduled_for IS
  'NULL = run immediately; otherwise the sweep endpoint promotes scheduled→pending when NOW() >= scheduled_for.';
COMMENT ON COLUMN bulk_send_jobs.pacing_ms IS
  'Wait between sends. 5500 (default) for teachers; recommend 6000 for parents.';
COMMENT ON COLUMN bulk_send_jobs.jitter_ms IS
  'Random ± jitter added to each pacing wait — breaks the constant-rate pattern that triggers Wasender ban detection.';
COMMENT ON COLUMN bulk_send_jobs.batch_size IS
  '0 = no batching. >0 = pause for batch_cooldown_ms after every N successful sends.';
