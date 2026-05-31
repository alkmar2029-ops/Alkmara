-- م3.1 — Student incidents workflow table.
--
-- Five-state lifecycle:
--   submitted → under_review → (dismissed | actioned | escalated)
-- (submitted may also revert to nothing if the teacher withdraws
-- within the 30-minute grace window — handled at the API layer,
-- which DELETEs the row.)
--
-- This migration creates ONLY the table + indexes. RLS lives in
-- 2026_06_03_002_incidents_rls.sql (م3.2). The status-change audit
-- trigger lives in 2026_06_03_003_incidents_audit.sql (م3.3). Keeping
-- the slices separate matches Sprint 2's m2.1/m2.2/m2.3 split — one
-- migration per concern.
--
-- Naming convention: `2026_06_03_NNN_*` mirrors Sprint 2's batch
-- ordering fix. Alphabetical sort places this batch after Sprint 2
-- (`2026_05_21_*`) and helpers (`2026_05_20_*`) as required.
--
-- FK behavior choices (deliberate, per Codex Sprint 2 review):
--   students(id)        → RESTRICT. Incidents are historical; we
--                         don't want a student deletion to wipe their
--                         record. Deactivate (is_active=false) instead.
--   auth.users(id) for submitted_by → NOT NULL + NO ACTION. An
--                         incident must have a submitter. Teacher
--                         deletions are very rare (deactivate is the
--                         normal path); if a hard delete is ever
--                         attempted while incidents reference the
--                         user, it'll fail loudly rather than silently
--                         orphan rows. Tech debt #8-style snapshot
--                         column can be added later if needed.
--   auth.users(id) for reviewed_by / escalated_to → SET NULL. These
--                         are nullable already, and a deleted
--                         reviewer just becomes "(unknown)" in the
--                         audit trail rather than blocking deletion.
--   case_id             → No FK yet. The student_cases table lives in
--                         Sprint 4 (م4.x). When that lands, a separate
--                         ALTER TABLE migration adds the FK with
--                         ON DELETE SET NULL (so a closed case can be
--                         purged without losing the incident).

CREATE TABLE IF NOT EXISTS student_incidents (
  id              BIGSERIAL PRIMARY KEY,

  -- Subject of the incident. RESTRICT so historical records survive
  -- student-record cleanups (deactivate, don't delete).
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,

  -- ============== Content ==============
  -- DEFAULT pinned to Riyadh date — Vercel/Supabase runtime tz is UTC,
  -- so a naked CURRENT_DATE between 21:00 and midnight Riyadh would
  -- record yesterday's date for an incident reported tonight. Server
  -- API also sends todayInRiyadh() explicitly; this default is the
  -- defence-in-depth layer (Codex Sprint 3 review).
  incident_date   DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'Asia/Riyadh')::date),
  incident_type   VARCHAR(40) NOT NULL CHECK (incident_type IN (
    'tardy',           -- تأخير
    'absence',         -- غياب غير مبرر
    'uniform',         -- مخالفة زي
    'behavior',        -- سلوك (شجار، إساءة)
    'academic',        -- أكاديمي (غش، عدم تحضير)
    'property_damage', -- إتلاف ممتلكات
    'other'            -- أخرى — يلزم description واضح
  )),
  severity        VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN (
    'low', 'medium', 'high', 'critical'
  )),
  -- Description min 20 chars: enough to force a real explanation,
  -- short enough that "تكرّر التأخير لمدة 3 أيام متتالية" passes.
  description     TEXT NOT NULL CHECK (length(description) >= 20),

  -- ============== Workflow state ==============
  -- Enforced by CHECK + trigger (added in م3.3). The API layer also
  -- enforces transitions (submitted → under_review → terminal), so
  -- this CHECK is defence-in-depth against direct DB writes.
  status          VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'under_review', 'dismissed', 'actioned', 'escalated'
  )),

  -- ============== Submission (always present) ==============
  submitted_by    UUID NOT NULL REFERENCES auth.users(id),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ============== Review (nullable until under_review or terminal) ==============
  reviewed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  review_notes    TEXT,

  -- ============== Action (filled when status='actioned') ==============
  action_taken    TEXT,
  parent_notified BOOLEAN NOT NULL DEFAULT FALSE,
  parent_notified_at TIMESTAMPTZ,

  -- ============== Escalation (filled when status='escalated') ==============
  -- case_id intentionally has no FK in this migration — student_cases
  -- table is built in Sprint 4. The FK is added by the Sprint 4
  -- migration once the parent table exists. Until then, this column
  -- is a free-form BIGINT that the escalate API endpoint (م3.9) will
  -- populate from the just-inserted case row.
  case_id         BIGINT,
  escalated_to    UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============== Comments ==============
COMMENT ON TABLE student_incidents IS
  'Student behavioral/academic incidents reported by teachers. Workflow: submitted → under_review → (dismissed | actioned | escalated). RLS in migration 002; status-change audit trigger in migration 003. case_id FK to student_cases is added in Sprint 4 once that table exists.';

COMMENT ON COLUMN student_incidents.case_id IS
  'FK to student_cases(id) — added in Sprint 4. Populated by the escalate API endpoint when status transitions to escalated.';

COMMENT ON COLUMN student_incidents.description IS
  'Minimum 20 chars to force a meaningful entry. The student-facing record relies on this text — vague entries are blocked at the DB layer regardless of UI validation.';

COMMENT ON COLUMN student_incidents.severity IS
  'Default medium (teachers tend to overestimate severity, per م3 watch-points). Critical incidents are auto-escalated by lib/incidents/escalation.ts.';

-- ============== Indexes ==============

-- 1. Pending review list — by far the hottest query for VPs/counselors.
--    Partial index on status='submitted' keeps it small and fast even
--    as terminal incidents accumulate over years. submitted_at ASC in
--    the index supports the م3.6 "oldest first" sort directly.
CREATE INDEX IF NOT EXISTS idx_incidents_pending
  ON student_incidents (status, submitted_at)
  WHERE status = 'submitted';

-- 2. Student history view (used by م3.14 to show prior incidents +
--    by the counselor case workspace in Sprint 4). DESC on date so
--    "latest first" is a forward index scan.
CREATE INDEX IF NOT EXISTS idx_incidents_student_history
  ON student_incidents (student_id, incident_date DESC);

-- 3. Teacher's own incidents (م3.5 "مخالفاتي"). Same DESC trick.
CREATE INDEX IF NOT EXISTS idx_incidents_submitted_by
  ON student_incidents (submitted_by, submitted_at DESC);

-- 4. Reviewer audit lookup (super_admin: "who reviewed what this
--    week"). NULL reviewed_by entries are excluded — they're the
--    pending rows already covered by idx_incidents_pending.
CREATE INDEX IF NOT EXISTS idx_incidents_reviewed_by
  ON student_incidents (reviewed_by, reviewed_at DESC)
  WHERE reviewed_by IS NOT NULL;

-- 5. Escalated incidents lookup (Sprint 4 case workspace will query
--    case_id; this index supports the reverse direction —
--    "what incidents fed into this case?"). Partial on the small
--    subset that's actually escalated.
CREATE INDEX IF NOT EXISTS idx_incidents_case_id
  ON student_incidents (case_id)
  WHERE case_id IS NOT NULL;

-- ============== Fail-closed RLS default ==============
-- Enable RLS now, WITHOUT any policies. If this migration is ever
-- applied in isolation (e.g. م3.2 lags behind in a hot deploy), the
-- table is locked down to super_admin only (the bypass-RLS role) —
-- not silently world-readable. Policies are added by م3.2
-- (incidents_rls.sql). Standard pattern across Sprint 1/2 migrations
-- (Codex Sprint 3 review).
ALTER TABLE student_incidents ENABLE ROW LEVEL SECURITY;
