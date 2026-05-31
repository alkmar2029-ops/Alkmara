-- م4.5 — Follow-up plans attached to a case.
--
-- A plan is the counselor's actionable response to a case: a
-- structured set of milestones with target dates, lifecycle
-- (active → on_hold → completed | cancelled), and a free-text
-- progress_notes column.
--
-- Encryption note (CRITICAL):
--   progress_notes is **NOT** encrypted. It's deliberately
--   plain TEXT for fast filtering / search. Counselors must
--   record only topic-level summaries here — never specifics
--   that belong in a counseling session. The UI surface (م4.23
--   Kanban) carries an inline warning + the column COMMENT below
--   documents the rule. م4.20 risk-management watch-point is
--   exactly this: counselor accidentally writing secrets in
--   the wrong column.
--
-- Milestones format (JSONB array — shape enforced by API Zod,
-- not the DB):
--   [
--     {
--       "date": "2026-06-15",
--       "description": "first parent contact",
--       "status": "pending" | "completed" | "cancelled",
--       "completed_at": "2026-06-15T10:30:00Z"  // optional, set on completion
--     },
--     ...
--   ]
-- Storing as JSONB (not a separate milestones table) is a
-- deliberate trade-off: milestones are always read with their
-- parent plan and rarely queried in aggregate. JSONB keeps the
-- read path single-row and the parent → child write atomic.
--
-- FK behavior:
--   case_id    → student_cases(id) ON DELETE CASCADE.
--                Plans are subsidiary; super_admin purge of a
--                case takes its plans with it.
--   student_id → students(id) ON DELETE RESTRICT.
--                Same rule as cases: historical record preservation.
--                student_id is denormalised (always derivable from
--                case.student_id) for fast Sprint 5 risk queries
--                without joining cases.
--   created_by → auth.users(id) NOT NULL + NO ACTION.
--                Same as cases.created_by — every plan has an
--                opener; counselor deletion is rare.
--
-- RLS: ENABLE ROW LEVEL SECURITY (fail-closed) — NO policies in
-- this migration. م4.7 wires policies for all Sprint 4 tables.

CREATE TABLE IF NOT EXISTS student_followup_plans (
  id              BIGSERIAL PRIMARY KEY,

  case_id         BIGINT NOT NULL REFERENCES student_cases(id) ON DELETE CASCADE,
  -- Denormalised — case.student_id is authoritative, but a copy
  -- here lets Sprint 5 risk queries scan plans-by-student without
  -- joining cases. **Kept consistent by the
  -- student_followup_plans_sync_student_id trigger below** —
  -- DB enforces parity rather than trusting the API to send the
  -- right value. The API may even omit it; the trigger fills it
  -- from case.student_id on every INSERT or any UPDATE touching
  -- case_id/student_id
  -- (Codex Sprint 4 review — denormalisation without enforcement
  -- would let a caller insert plan(case_id=A's case, student_id=B)
  -- and silently break RLS + Sprint 5 risk attribution).
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,

  created_by      UUID NOT NULL REFERENCES auth.users(id),

  title           VARCHAR(200) NOT NULL CHECK (length(title) >= 10),
  description     TEXT         NOT NULL CHECK (length(description) >= 20),

  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'on_hold', 'completed', 'cancelled'
  )),

  -- See "Milestones format" in the header. Shape is enforced by
  -- the API (Zod); DB stores the JSONB raw. Default '[]' so a
  -- newly-created plan with no milestones yet doesn't need the
  -- API to send the empty array explicitly.
  milestones      JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- UNENCRYPTED. Max 2000 chars to discourage long entries that
  -- could be mistaken for session-detail content. See encryption
  -- note in the header.
  progress_notes  TEXT CHECK (progress_notes IS NULL OR length(progress_notes) <= 2000),

  target_date     DATE,
  completed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Status ↔ terminal-timestamps exclusivity (Codex Sprint 4
  -- review). Without this, a row could carry BOTH completed_at +
  -- cancelled_at (a mutually-exclusive event), confusing reports
  -- and Sprint 5 risk derivation. The single constraint encodes
  -- the full truth table:
  --   completed → completed_at NOT NULL, cancelled_at NULL
  --   cancelled → cancelled_at NOT NULL, completed_at NULL
  --   active/on_hold → both NULL
  -- The API maintains these on transition; the CHECK is
  -- defense-in-depth against direct DB writes.
  CONSTRAINT plans_terminal_timestamps_exclusive CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL)
    OR (status NOT IN ('completed', 'cancelled') AND completed_at IS NULL AND cancelled_at IS NULL)
  )
);

-- ============== Comments ==============
COMMENT ON TABLE student_followup_plans IS
  'Counselor-managed follow-up plans attached to a case. Lifecycle: active → on_hold → completed | cancelled. Milestones are JSONB; progress_notes is UNENCRYPTED — counselors must record only summary content here, never session-detail. RLS enabled fail-closed; policies in م4.7.';

COMMENT ON COLUMN student_followup_plans.progress_notes IS
  'NOT encrypted. Max 2000 chars. Topic-level summaries ONLY — sensitive specifics belong in counseling_sessions (encrypted). م4.20 risk watch-point.';

COMMENT ON COLUMN student_followup_plans.milestones IS
  'JSONB array. Each element: { date: YYYY-MM-DD, description: string, status: pending|completed|cancelled, completed_at?: ISO timestamp }. Shape enforced by API (Zod), not the DB.';

COMMENT ON COLUMN student_followup_plans.student_id IS
  'Denormalised from case.student_id for fast Sprint 5 risk queries. Kept consistent by the student_followup_plans_sync_student_id trigger — any caller-provided value is overwritten with case.student_id on INSERT or any UPDATE touching case_id/student_id.';

-- ============== Indexes ==============

-- 1. Per-case timeline (case detail page).
CREATE INDEX IF NOT EXISTS idx_plans_case
  ON student_followup_plans (case_id, created_at DESC);

-- 2. Per-student history (Sprint 5 risk score + multi-case students).
CREATE INDEX IF NOT EXISTS idx_plans_student
  ON student_followup_plans (student_id, created_at DESC);

-- 3. "My plans" view for the counselor.
CREATE INDEX IF NOT EXISTS idx_plans_created_by
  ON student_followup_plans (created_by, created_at DESC);

-- 4. Active-plan dashboard (Kanban view م4.23). Partial on the
--    non-terminal states keeps it small even as the table grows
--    with closed cases.
CREATE INDEX IF NOT EXISTS idx_plans_active
  ON student_followup_plans (status, updated_at DESC)
  WHERE status IN ('active', 'on_hold');

-- 5. Upcoming deadlines — partial on rows with a target.
CREATE INDEX IF NOT EXISTS idx_plans_target_date
  ON student_followup_plans (target_date)
  WHERE target_date IS NOT NULL;

-- ============== student_id sync trigger ==============
-- Forces student_id to match case.student_id on every INSERT and
-- on any UPDATE touching case_id OR student_id. Prevents the
-- denormalisation from drifting out of sync — the API can't
-- accidentally (or maliciously) submit a mismatched pair,
-- AND a direct UPDATE of student_id alone (without changing
-- case_id) still gets reset (Codex Sprint 4 review, second pass).
--
-- Listening on `UPDATE OF case_id, student_id` (not the full
-- `BEFORE UPDATE`) keeps unrelated edits — progress_notes,
-- status, milestones — out of this trigger's overhead path.
--
-- The function also surfaces a clean foreign_key_violation if
-- case_id doesn't exist — better than the misleading
-- "student_id violates NOT NULL" that would fire otherwise from
-- a NULL lookup result.
CREATE OR REPLACE FUNCTION student_followup_plans_sync_student_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT student_id INTO NEW.student_id
    FROM student_cases
    WHERE id = NEW.case_id;

  IF NEW.student_id IS NULL THEN
    RAISE EXCEPTION 'student_followup_plans.case_id=% does not reference an existing case', NEW.case_id
      USING ERRCODE = '23503'; -- foreign_key_violation
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION student_followup_plans_sync_student_id() IS
  'BEFORE INSERT / UPDATE OF (case_id, student_id) trigger — overrides NEW.student_id with case.student_id on every INSERT or any UPDATE touching case_id/student_id, so the denormalised copy never drifts (even via direct student_id overwrite). Raises a clean 23503 if case_id is invalid.';

DROP TRIGGER IF EXISTS student_followup_plans_sync_student_id_trigger ON student_followup_plans;
CREATE TRIGGER student_followup_plans_sync_student_id_trigger
  BEFORE INSERT OR UPDATE OF case_id, student_id ON student_followup_plans
  FOR EACH ROW
  EXECUTE FUNCTION student_followup_plans_sync_student_id();

-- ============== updated_at trigger ==============
-- Mirrors the student_cases pattern: idx_plans_active sorts by
-- updated_at DESC, which is only meaningful if the column
-- actually reflects the last write. BEFORE UPDATE trigger keeps
-- it honest regardless of which API path edits the row.
CREATE OR REPLACE FUNCTION student_followup_plans_set_updated_at()
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

COMMENT ON FUNCTION student_followup_plans_set_updated_at() IS
  'BEFORE UPDATE trigger function on student_followup_plans — bumps updated_at to NOW(). Keeps idx_plans_active sortable without relying on every API caller to set the column manually.';

DROP TRIGGER IF EXISTS student_followup_plans_updated_at_trigger ON student_followup_plans;
CREATE TRIGGER student_followup_plans_updated_at_trigger
  BEFORE UPDATE ON student_followup_plans
  FOR EACH ROW
  EXECUTE FUNCTION student_followup_plans_set_updated_at();

-- ============== Fail-closed RLS ==============
ALTER TABLE student_followup_plans ENABLE ROW LEVEL SECURITY;
