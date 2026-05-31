-- م5.1 — student_risk_scores table + indexes + RLS enable (fail-closed).
--
-- First migration of Sprint 5. SCHEMA ONLY:
--   - one row per student
--   - total_score 0-100 + 4 sub-scores (behavior / engagement /
--     attendance / velocity)
--   - signals JSONB for explainability (free shape — documented here,
--     not enforced via CHECK; compute layer owns the schema)
--   - is_stale flag for the async compute pipeline
--   - section_id denormalised from students.section_id for fast
--     watchlist filtering without a join
--
-- =====================================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- =====================================================================
--   - NO RLS policies (м5.2 wires them — super_admin + counselor
--     ONLY; view_confidential_notes flag holders are intentionally
--     EXCLUDED from this surface because the score is derived from
--     confidential content. Letting oversight read aggregated
--     confidential signals is a separate privacy decision; we do
--     not blur it into Sprint 5's first migration).
--   - NO backfill (м5.3 inserts placeholder rows for all active
--     students alongside the staleness triggers).
--   - NO compute function (м5.4 — the weights live there and need
--     review before the API + watchlist hit them).
--   - NO upsert triggers (м5.3 again).
--
-- =====================================================================
-- WHY a row-per-student table (not a view)
-- =====================================================================
-- The watchlist's primary use case is `ORDER BY total_score DESC
-- LIMIT 100` filtered by section / min_score on thousands of students.
-- A view recomputes per query, defeats indexed pagination, and ties
-- the read latency to the slowest signal table's scan cost. A cached
-- row + index serves the read in ~ms. The async compute pipeline
-- (m5.3-m5.5) keeps the row fresh.
--
-- =====================================================================
-- WHY signals JSONB (free shape)
-- =====================================================================
-- Counselor explainability: total=72 means nothing without "incidents
-- _90d=3, reopen_count=2, absences_30d=4, last_session_days_ago=7".
-- The compute RPC (m5.4) populates signals AT THE SAME TIME as the
-- scores, so the UI can render "why this score" without a second
-- round-trip.
--
-- Free shape (no CHECK) so the model can evolve without a migration
-- each iteration. The compute layer is the only writer; we add a
-- CHECK later if the shape stabilises.
--
-- =====================================================================
-- signals JSONB documented shape (compute layer guarantees, not DB)
-- =====================================================================
-- {
--   "incidents_90d":          number,         // count from student_incidents
--   "active_cases":           number,         // status IN (open, in_progress)
--   "reopen_count_total":     number,         // SUM(reopen_count) across cases
--   "sessions_30d":           number,         // counseling_sessions in 30 days
--   "active_plans":           number,         // followup_plans status='active'
--   "conf_notes_30d":         number,         // confidential notes in 30 days
--   "absences_30d":           number,         // student absences in 30 days
--   "last_session_days_ago":  number | null,  // null if no session ever
--   "plan_overdue":           boolean         // any active plan target_date < today
-- }
--
-- =====================================================================
-- is_stale lifecycle
-- =====================================================================
--   TRUE  → row needs recompute (signals are out of date OR row is
--           a brand-new placeholder that was never computed).
--   FALSE → freshly computed by the m5.4 RPC.
--
-- Default TRUE: every new row (whether from m5.3 backfill or an
-- m5.3 upsert trigger reacting to an upstream write) starts as
-- "uncomputed". The cron sweep (m5.5) picks them up on the next pass.
-- This is the safest default — we'd rather over-compute than serve
-- stale-as-fresh.
--
-- =====================================================================
-- computed_at — NULLABLE on purpose
-- =====================================================================
-- A row that's never been computed should not lie about freshness.
-- NULL = "not computed yet"; the compute RPC SETs it on every run.
-- The watchlist endpoint can use NULL to display "—" or "بانتظار
-- الحساب" in the UI for unscored students.
--
-- =====================================================================
-- section_id denormalised
-- =====================================================================
-- Sourced from students.section_id by the compute RPC. Allows
-- `WHERE section_id = ?` filtering on the watchlist without a join.
-- ON DELETE SET NULL: if a section is deleted, the score row stays
-- (the student row stays too) — the column just nulls out. Partial
-- index below skips the orphaned rows.

CREATE TABLE IF NOT EXISTS student_risk_scores (
  student_id        INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,

  total_score       SMALLINT NOT NULL DEFAULT 0
                    CONSTRAINT student_risk_scores_total_check
                    CHECK (total_score BETWEEN 0 AND 100),

  behavior_score    SMALLINT NOT NULL DEFAULT 0
                    CONSTRAINT student_risk_scores_behavior_check
                    CHECK (behavior_score BETWEEN 0 AND 100),

  engagement_score  SMALLINT NOT NULL DEFAULT 0
                    CONSTRAINT student_risk_scores_engagement_check
                    CHECK (engagement_score BETWEEN 0 AND 100),

  attendance_score  SMALLINT NOT NULL DEFAULT 0
                    CONSTRAINT student_risk_scores_attendance_check
                    CHECK (attendance_score BETWEEN 0 AND 100),

  velocity_score    SMALLINT NOT NULL DEFAULT 0
                    CONSTRAINT student_risk_scores_velocity_check
                    CHECK (velocity_score BETWEEN 0 AND 100),

  -- Free-shape JSONB; compute layer guarantees keys (see header).
  signals           JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- NULL = never computed. m5.4 RPC SETs it on every run.
  computed_at       TIMESTAMPTZ,

  -- Default TRUE — placeholder rows start uncomputed.
  is_stale          BOOLEAN NOT NULL DEFAULT TRUE,

  -- Denormalised for fast watchlist section filter.
  section_id        INTEGER REFERENCES sections(id) ON DELETE SET NULL,

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============== Comments ==============
COMMENT ON TABLE student_risk_scores IS
  'One row per student. Cached composite + 4 sub-scores (behavior / engagement / attendance / velocity) derived from incidents, cases, plans, sessions, notes, and absences. signals JSONB carries the raw input counts for explainability. is_stale=TRUE means recompute pending; the compute RPC (м5.4) flips it to FALSE. RLS enabled fail-closed; policies in м5.2 grant super_admin + counselor only (view_confidential_notes deliberately excluded — see م5.2 header).';

COMMENT ON COLUMN student_risk_scores.signals IS
  'Free-shape JSONB documented in the م5.1 migration header. The m5.4 compute RPC owns the keys; no DB CHECK so the model can evolve without migrations. UI should defensively coalesce missing keys.';

COMMENT ON COLUMN student_risk_scores.is_stale IS
  'TRUE = recompute pending. Default TRUE so every new row (placeholder backfill OR upsert from an m5.3 trigger) is recomputed on the next cron sweep. The m5.4 compute RPC sets FALSE after a successful run.';

COMMENT ON COLUMN student_risk_scores.computed_at IS
  'NULL means never computed; updated_at only means row mutation/staleness change, not score freshness. computed_at is set ONLY by the m5.4 compute RPC after a successful score calculation. The two timestamps disagree by design — use computed_at for "how fresh is the score", updated_at for "when was the row last touched".';

COMMENT ON COLUMN student_risk_scores.section_id IS
  'Denormalised from students.section_id at compute time. Used by the watchlist endpoint to filter without a join. ON DELETE SET NULL — section removal does not orphan the score row.';

-- ============== Indexes ==============

-- 1. Watchlist primary sort — global "top risk students" descending.
CREATE INDEX IF NOT EXISTS idx_risk_score_total
  ON student_risk_scores (total_score DESC, student_id);

-- 2. Watchlist filtered by section (counselor's typical view).
--    Partial on non-null so orphan rows don't bloat the index.
CREATE INDEX IF NOT EXISTS idx_risk_score_section
  ON student_risk_scores (section_id, total_score DESC)
  WHERE section_id IS NOT NULL;

-- 3. Stale-only — m5.5 cron sweep (and any future lazy fallback)
--    iterate this. Partial keeps the index tiny after the sweep:
--    most rows will be fresh on steady state.
CREATE INDEX IF NOT EXISTS idx_risk_score_stale
  ON student_risk_scores (student_id)
  WHERE is_stale = TRUE;

-- ============== updated_at trigger ==============
-- Standard pattern (same as м4.5/м4.4). When the m5.3 triggers flip
-- is_stale to TRUE, updated_at also bumps so oncall can see the
-- last write activity, separately from computed_at.
CREATE OR REPLACE FUNCTION student_risk_scores_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION student_risk_scores_set_updated_at() IS
  'BEFORE UPDATE trigger on student_risk_scores — bumps updated_at to NOW(). The m5.4 compute RPC overrides computed_at separately; updated_at tracks ANY mutation (including stale-flag flips by m5.3 triggers).';

DROP TRIGGER IF EXISTS student_risk_scores_updated_at_trigger ON student_risk_scores;
CREATE TRIGGER student_risk_scores_updated_at_trigger
  BEFORE UPDATE ON student_risk_scores
  FOR EACH ROW
  EXECUTE FUNCTION student_risk_scores_set_updated_at();

-- ============== Fail-closed RLS ==============
ALTER TABLE student_risk_scores ENABLE ROW LEVEL SECURITY;
-- NO policies — м5.2 wires them as one consistent batch.
