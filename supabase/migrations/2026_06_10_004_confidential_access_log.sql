-- م4.6 — High-volume audit log of access to confidential data.
--
-- Every read/write/decrypt of counseling_sessions, encrypted note
-- content, or any other confidential table writes one row here.
-- The single denormalised log makes admin-side queries simple:
--   - "every access by user X this month"
--   - "every access to student Y's confidential records"
--   - "every access to counseling_sessions across the school"
-- without joining four separate per-table audit tables.
--
-- Volume expectation: high. A counselor reading a single session
-- view triggers 2-3 rows (session content, outcome, related notes).
-- Archival policy (delete or move-to-cold-table rows > 1 year old)
-- is tech debt — handled by a future cron / Edge Function, not in
-- this migration. The idx_access_log_recent index supports that
-- cron's eventual SCAN.
--
-- Distinct from audit_logs (Sprint 0):
--   audit_logs                 = API-action audit (write actions,
--                                with payload, IP, user-agent).
--                                Lower volume, richer context.
--   confidential_access_log    = data-access audit (READs +
--                                decrypts mostly). Higher volume,
--                                narrower per-row content.
--
-- The two channels are intentionally separate so the high-volume
-- table doesn't drown out forensic queries on audit_logs.
--
-- FK behavior:
--   accessed_by → auth.users(id) NOT NULL + NO ACTION.
--     Every access has a user. If a hard user-delete is ever
--     attempted while logs reference them, it fails loudly. The
--     normal path is deactivation, which doesn't touch this FK.
--   student_id → students(id) ON DELETE SET NULL.
--     Student deletion is rare (deactivate instead), but if it
--     happens we keep the log row with student_id=NULL — the
--     accessed_by + table_name + record_id are still meaningful.
--
-- RLS: ENABLE ROW LEVEL SECURITY (fail-closed) — NO policies in
-- this migration. م4.7 wires policies for all Sprint 4 tables in
-- one consistent batch (per user's "لا policies جزئية" guidance).
-- Until م4.7 ships, only service-role / table owner can read.

CREATE TABLE IF NOT EXISTS confidential_access_log (
  id            BIGSERIAL PRIMARY KEY,

  -- WHO accessed
  accessed_by   UUID NOT NULL REFERENCES auth.users(id),
  accessed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- WHAT was accessed
  -- table_name = the entity table (e.g. 'counseling_sessions',
  -- 'student_notes'). VARCHAR(64) is comfortably above any
  -- realistic Postgres identifier length.
  table_name    VARCHAR(64) NOT NULL,
  -- record_id as TEXT to accommodate BIGINT, UUID, or composite
  -- keys uniformly. Caller stringifies before insert.
  record_id     TEXT NOT NULL,
  -- Denormalised student reference. The accessed row almost
  -- always concerns a single student (sessions, plans, notes);
  -- carrying the FK here makes "by-student" reports a single-
  -- index scan instead of a JOIN through the parent table.
  -- Nullable for accesses that don't have a student (e.g. a
  -- cases list view, which spans many students).
  student_id    INTEGER REFERENCES students(id) ON DELETE SET NULL,

  -- WHAT they did
  -- 'decrypt' is intentionally distinct from 'read': PDPL +
  -- forensics need to tell metadata reads (session list, topic,
  -- timestamps) apart from actual confidential-content access
  -- (pgp_sym_decrypt fired). decrypt_session_content (م4.4)
  -- logs 'decrypt'; the API GET handlers log 'read' for the
  -- non-encrypted columns. (Codex Sprint 4 review.)
  --
  -- Constraint is named explicitly so future ALTER ... DROP /
  -- ADD CONSTRAINT operations don't depend on auto-generated
  -- identifiers (Codex Sprint 4 review).
  action        VARCHAR(20) NOT NULL
                CONSTRAINT confidential_access_log_action_check
                CHECK (action IN (
                  'read', 'decrypt', 'write', 'update', 'delete'
                )),

  -- HOW (request context, populated by the API layer via
  -- writeAuditLog-style helper). Optional — the trigger-based
  -- writes (decrypt_session_content) won't have these.
  ip_address    TEXT,
  user_agent    TEXT
);

-- ============== Comments ==============
COMMENT ON TABLE confidential_access_log IS
  'High-volume audit of access to confidential data (counseling sessions, encrypted notes). Distinct from audit_logs (API-action audit). RLS enabled fail-closed; policies land in م4.7. Archival policy (rows > 1 year) is tech debt — future cron via idx_access_log_recent.';

COMMENT ON COLUMN confidential_access_log.record_id IS
  'TEXT so it can hold BIGINT IDs (counseling_sessions), UUIDs (auth.users), or composite keys uniformly. Caller stringifies before insert.';

COMMENT ON COLUMN confidential_access_log.student_id IS
  'Denormalised reference for fast by-student reports. SET NULL on student delete so a (rare) student purge leaves the access record intact — accessed_by + table + record_id are still meaningful.';

-- ============== Indexes ==============
-- Each filter the m4.17 admin audit-log page supports gets one
-- index, all with `accessed_at DESC` as the secondary key so
-- "latest first" results come from a forward index scan.

-- 1. By user (per-user audit, the most common admin query).
CREATE INDEX IF NOT EXISTS idx_access_log_user
  ON confidential_access_log (accessed_by, accessed_at DESC);

-- 2. By student (per-student exposure report). Partial — many
--    access rows have no student (e.g. cases-list views).
CREATE INDEX IF NOT EXISTS idx_access_log_student
  ON confidential_access_log (student_id, accessed_at DESC)
  WHERE student_id IS NOT NULL;

-- 3. By table (which entity gets accessed most — capacity planning).
CREATE INDEX IF NOT EXISTS idx_access_log_table
  ON confidential_access_log (table_name, accessed_at DESC);

-- 4. Recent-first cross-cut (latest accesses anywhere) +
--    supports the future archival cron's "WHERE accessed_at <
--    NOW() - INTERVAL '1 year'" scan.
CREATE INDEX IF NOT EXISTS idx_access_log_recent
  ON confidential_access_log (accessed_at DESC);

-- 5. Per-record lookup — "who opened THIS session/note?". Without
--    this, the admin UI would full-scan the table_name partition
--    to find a specific record_id. (Codex Sprint 4 review.)
CREATE INDEX IF NOT EXISTS idx_access_log_record
  ON confidential_access_log (table_name, record_id, accessed_at DESC);

-- ============== Fail-closed RLS ==============
-- Same fail-closed default as other Sprint 4 tables. Trigger /
-- API writes flow via service-role (admin client) or
-- SECURITY DEFINER functions (e.g. decrypt_session_content) — both
-- bypass RLS by design. Regular `authenticated` reads return zero
-- rows until м4.7 wires the super_admin + reviewer policies.
ALTER TABLE confidential_access_log ENABLE ROW LEVEL SECURITY;
