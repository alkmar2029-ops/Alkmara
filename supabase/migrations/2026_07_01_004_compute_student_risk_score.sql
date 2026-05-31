-- м5.4 — compute_student_risk_score(p_student_id) RPC.
--
-- The compute layer. Reads signals from 6 upstream tables, calculates
-- 4 sub-scores + a weighted total, and UPSERTs the result into
-- student_risk_scores. Returns the computed row so a caller (sweep
-- cron / on-demand admin) can use the values immediately without a
-- second SELECT.
--
-- =====================================================================
-- SECURITY MODEL
-- =====================================================================
-- SECURITY DEFINER + search_path locked. The function bypasses RLS
-- on all upstream tables AND on student_risk_scores — that's
-- intentional: only this RPC and m5.3's mark_student_risk_stale
-- helper are allowed write paths.
--
-- EXECUTE permission is REVOKED from PUBLIC / authenticated / anon
-- and GRANTed to service_role ONLY (same pattern as
-- create_counseling_session in m4.21.3). The m5.5 sweep cron calls
-- it via the admin client; counselors NEVER trigger compute directly
-- from the browser.
--
-- =====================================================================
-- SIGNAL SOURCES (decided in the m5.4 plan)
-- =====================================================================
--   student_incidents:    incident_date filter, status NOT IN
--                          ('dismissed','withdrawn'), severity-weighted
--   student_cases:        status / reopen_count
--   student_followup_plans: status / target_date
--   counseling_sessions:  session_date / counts
--   student_notes:        is_confidential + recorded_at (note recorded_at
--                          is fine here because notes have no
--                          equivalent of a "session date" — the note
--                          IS the event, and recorded_at is when it
--                          happened)
--   period_absences →     JOIN period_sessions ON id = session_id and
--                          filter on ps.attendance_date (NOT
--                          pa.recorded_at — recorded_at is the entry
--                          timestamp, attendance_date is the real event
--                          date. Reviewer caught the difference; this
--                          is the load-bearing accuracy decision in
--                          the migration)
--
-- =====================================================================
-- SCORE FORMULAS (all clamped 0-100)
-- =====================================================================
--   behavior = LEAST(100,
--     5*incidents_low + 10*incidents_medium + 20*incidents_high
--                                            + 35*incidents_critical
--     + 15*active_cases + 10*reopen_count_sum)
--   engagement = LEAST(100,
--     15*active_plans + 5*conf_notes_30d
--     + GREATEST(0, 40 - 10*sessions_30d))     -- more sessions reduce risk
--   attendance = LEAST(100,
--     12*absences_30d + 4*late_30d)
--   velocity = LEAST(100,
--     (no_session_30d ? 25 : 0)
--     + (plan_overdue ? 30 : 0)
--     + (recent_incident_7d ? 25 : 0))
--   total = ROUND(0.35*behavior + 0.25*engagement + 0.25*attendance
--                 + 0.15*velocity)
--
-- =====================================================================
-- INACTIVE / MISSING STUDENT SHORT-CIRCUIT
-- =====================================================================
--   - students.id missing      → the function returns 0 rows (RETURN
--                                 with no QUERY) AND does not UPSERT.
--                                 **Callers MUST treat 0-rows as
--                                 "student not found", not as a
--                                 compute failure** — the sweep cron's
--                                 pattern is to log + skip, never
--                                 retry on this signal.
--   - students.is_active=FALSE → UPSERT with total=0, sub-scores=0,
--                                 signals={"inactive":true},
--                                 computed_at=NOW, is_stale=FALSE.
--                                 Watchlist queries that sort by
--                                 total_score DESC then filter
--                                 min_score>0 won't surface them.
--   - is_active IS NULL        → treated as active (same defensive
--                                 rule as m5.3 backfill).
--
-- =====================================================================
-- TIMEZONE ANCHOR
-- =====================================================================
-- `v_today` is computed once as `(NOW() AT TIME ZONE 'Asia/Riyadh')::date`
-- and reused for ALL window calculations. Plain `CURRENT_DATE` depends
-- on the session's TimeZone setting, which is undefined for service-
-- role calls from the Vercel runtime (UTC by default). Anchoring to
-- Riyadh here matches lib/dates/ksa.ts on the app side, so a score
-- computed at 11pm Riyadh isn't dated to the next day on the server.

CREATE OR REPLACE FUNCTION compute_student_risk_score(p_student_id INTEGER)
RETURNS TABLE (
  student_id        INTEGER,
  total_score       SMALLINT,
  behavior_score    SMALLINT,
  engagement_score  SMALLINT,
  attendance_score  SMALLINT,
  velocity_score    SMALLINT,
  signals           JSONB,
  computed_at       TIMESTAMPTZ,
  is_stale          BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- Anchor all window math to Riyadh (UTC+3) so server timezone drift
  -- doesn't shift the 7/30/90-day windows by a day. See header.
  v_today      DATE := (NOW() AT TIME ZONE 'Asia/Riyadh')::date;
  v_section_id INTEGER;
  v_active     BOOLEAN;

  -- Incidents signals
  v_inc_low      INT := 0;
  v_inc_med      INT := 0;
  v_inc_high     INT := 0;
  v_inc_crit     INT := 0;
  v_inc_weighted INT := 0;
  v_recent_inc_7d BOOLEAN := FALSE;

  -- Cases signals
  v_active_cases INT := 0;
  v_reopen_sum   INT := 0;

  -- Plans signals
  v_active_plans INT := 0;
  v_plan_overdue BOOLEAN := FALSE;

  -- Session signals
  v_sessions_30d        INT := 0;
  v_last_session_days   INT;   -- nullable — NULL = no session ever

  -- Note signals
  v_conf_notes_30d INT := 0;

  -- Attendance signals (period_absences JOIN period_sessions)
  v_absences_30d INT := 0;
  v_late_30d     INT := 0;

  -- Computed
  v_behavior   SMALLINT;
  v_engagement SMALLINT;
  v_attendance SMALLINT;
  v_velocity   SMALLINT;
  v_total      SMALLINT;
  v_signals    JSONB;
  v_now        TIMESTAMPTZ := NOW();

  -- For RETURN
  v_out_signals  JSONB;
BEGIN
  -- ============== 1. Load student ==============
  SELECT s.section_id, (s.is_active IS NOT FALSE)
    INTO v_section_id, v_active
    FROM students s WHERE s.id = p_student_id;

  -- Missing student: defensive no-op. m5.3 helper also handles this.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Inactive student: short-circuit with zeros + signals={"inactive":true}.
  IF v_active = FALSE THEN
    v_out_signals := jsonb_build_object('inactive', TRUE);
    INSERT INTO student_risk_scores (
      student_id, total_score, behavior_score, engagement_score,
      attendance_score, velocity_score, signals, computed_at,
      is_stale, section_id
    )
    VALUES (
      p_student_id, 0, 0, 0, 0, 0, v_out_signals, v_now, FALSE, v_section_id
    )
    -- Use the PK constraint name (not column list) — plpgsql treats
    -- `student_id` in `ON CONFLICT (student_id)` as ambiguous against
    -- the RETURNS TABLE output column of the same name.
    ON CONFLICT ON CONSTRAINT student_risk_scores_pkey DO UPDATE SET
      total_score      = 0,
      behavior_score   = 0,
      engagement_score = 0,
      attendance_score = 0,
      velocity_score   = 0,
      signals          = EXCLUDED.signals,
      computed_at      = EXCLUDED.computed_at,
      is_stale         = FALSE,
      section_id       = EXCLUDED.section_id;

    RETURN QUERY SELECT
      p_student_id, 0::SMALLINT, 0::SMALLINT, 0::SMALLINT,
      0::SMALLINT, 0::SMALLINT, v_out_signals, v_now, FALSE;
    RETURN;
  END IF;

  -- ============== 2. Signal queries ==============
  -- Incidents in 90 days (severity counts + recent_7d boolean).
  -- status filter: 'dismissed' (reviewer rejected) and 'withdrawn'
  -- (submitter retracted) DO NOT contribute to risk.
  -- Note: RETURNS TABLE declares `student_id` as an output column,
  -- which plpgsql treats as a name in scope inside the function body.
  -- That collides with `student_id` columns on the upstream tables.
  -- Every SELECT below aliases its source table so the column
  -- reference is unambiguous (e.g., `si.student_id`).
  SELECT
    COALESCE(count(*) FILTER (WHERE si.severity = 'low'),      0),
    COALESCE(count(*) FILTER (WHERE si.severity = 'medium'),   0),
    COALESCE(count(*) FILTER (WHERE si.severity = 'high'),     0),
    COALESCE(count(*) FILTER (WHERE si.severity = 'critical'), 0)
  INTO v_inc_low, v_inc_med, v_inc_high, v_inc_crit
  FROM student_incidents si
  WHERE si.student_id  = p_student_id
    AND si.incident_date >= v_today - INTERVAL '90 days'
    AND si.status NOT IN ('dismissed', 'withdrawn');

  v_inc_weighted := v_inc_low * 5 + v_inc_med * 10 + v_inc_high * 20 + v_inc_crit * 35;

  SELECT EXISTS (
    SELECT 1 FROM student_incidents si
    WHERE si.student_id  = p_student_id
      AND si.incident_date >= v_today - INTERVAL '7 days'
      AND si.status NOT IN ('dismissed', 'withdrawn')
  ) INTO v_recent_inc_7d;

  -- Cases: active count + total reopen sum (across all rows, not 90-day).
  SELECT
    COALESCE(count(*) FILTER (WHERE sc.status IN ('open', 'in_progress')), 0),
    COALESCE(SUM(sc.reopen_count), 0)
  INTO v_active_cases, v_reopen_sum
  FROM student_cases sc
  WHERE sc.student_id = p_student_id;

  -- Plans: active count + overdue boolean.
  SELECT
    COALESCE(count(*) FILTER (WHERE sp.status = 'active'), 0),
    COALESCE(bool_or(sp.status = 'active' AND sp.target_date IS NOT NULL AND sp.target_date < v_today), FALSE)
  INTO v_active_plans, v_plan_overdue
  FROM student_followup_plans sp
  WHERE sp.student_id = p_student_id;

  -- Sessions: 30-day count + days-since-last (NULL = never).
  SELECT
    COALESCE(count(*) FILTER (WHERE cs.session_date >= v_today - INTERVAL '30 days'), 0),
    CASE WHEN MAX(cs.session_date) IS NULL THEN NULL
         ELSE (v_today - MAX(cs.session_date))::INT END
  INTO v_sessions_30d, v_last_session_days
  FROM counseling_sessions cs
  WHERE cs.student_id = p_student_id;

  -- Confidential notes in 30 days.
  SELECT COALESCE(count(*), 0)
  INTO v_conf_notes_30d
  FROM student_notes sn
  WHERE sn.student_id = p_student_id
    AND sn.is_confidential = TRUE
    AND sn.recorded_at >= (v_today - INTERVAL '30 days')::timestamptz;

  -- Attendance — JOIN period_sessions for the REAL event date.
  -- recorded_at would lie when a teacher backfills late.
  SELECT
    COALESCE(count(*) FILTER (WHERE pa.status = 'absent'), 0),
    COALESCE(count(*) FILTER (WHERE pa.status = 'late'),   0)
  INTO v_absences_30d, v_late_30d
  FROM period_absences pa
  JOIN period_sessions ps ON ps.id = pa.session_id
  WHERE pa.student_id = p_student_id
    AND ps.attendance_date >= v_today - INTERVAL '30 days';

  -- ============== 3. Sub-scores ==============
  v_behavior := LEAST(100,
    v_inc_weighted
    + v_active_cases * 15
    + v_reopen_sum * 10
  )::SMALLINT;

  v_engagement := LEAST(100,
    v_active_plans * 15
    + v_conf_notes_30d * 5
    + GREATEST(0, 40 - v_sessions_30d * 10)
  )::SMALLINT;

  v_attendance := LEAST(100,
    v_absences_30d * 12
    + v_late_30d * 4
  )::SMALLINT;

  v_velocity := LEAST(100,
    (CASE WHEN v_last_session_days IS NULL OR v_last_session_days > 30 THEN 25 ELSE 0 END)
    + (CASE WHEN v_plan_overdue   THEN 30 ELSE 0 END)
    + (CASE WHEN v_recent_inc_7d  THEN 25 ELSE 0 END)
  )::SMALLINT;

  v_total := ROUND(
    0.35 * v_behavior
    + 0.25 * v_engagement
    + 0.25 * v_attendance
    + 0.15 * v_velocity
  )::SMALLINT;

  -- ============== 4. Build signals JSONB ==============
  v_signals := jsonb_build_object(
    'incidents_90d_low',      v_inc_low,
    'incidents_90d_medium',   v_inc_med,
    'incidents_90d_high',     v_inc_high,
    'incidents_90d_critical', v_inc_crit,
    'incidents_90d_weighted', v_inc_weighted,
    'recent_incident_7d',     v_recent_inc_7d,
    'active_cases',           v_active_cases,
    'reopen_count_sum',       v_reopen_sum,
    'active_plans',           v_active_plans,
    'plan_overdue',           v_plan_overdue,
    'sessions_30d',           v_sessions_30d,
    'last_session_days_ago',  v_last_session_days,
    'conf_notes_30d',         v_conf_notes_30d,
    'absences_30d',           v_absences_30d,
    'late_count_30d',         v_late_30d
  );

  -- ============== 5. UPSERT + return ==============
  INSERT INTO student_risk_scores (
    student_id, total_score, behavior_score, engagement_score,
    attendance_score, velocity_score, signals, computed_at,
    is_stale, section_id
  )
  VALUES (
    p_student_id, v_total, v_behavior, v_engagement, v_attendance,
    v_velocity, v_signals, v_now, FALSE, v_section_id
  )
  -- ON CONFLICT by constraint name (not column list) — plpgsql treats
  -- `student_id` in `(student_id)` as ambiguous against the
  -- RETURNS TABLE output column of the same name.
  ON CONFLICT ON CONSTRAINT student_risk_scores_pkey DO UPDATE SET
    total_score      = EXCLUDED.total_score,
    behavior_score   = EXCLUDED.behavior_score,
    engagement_score = EXCLUDED.engagement_score,
    attendance_score = EXCLUDED.attendance_score,
    velocity_score   = EXCLUDED.velocity_score,
    signals          = EXCLUDED.signals,
    computed_at      = EXCLUDED.computed_at,
    is_stale         = FALSE,
    section_id       = EXCLUDED.section_id;

  RETURN QUERY SELECT
    p_student_id, v_total, v_behavior, v_engagement, v_attendance,
    v_velocity, v_signals, v_now, FALSE;
END;
$$;

COMMENT ON FUNCTION compute_student_risk_score(INTEGER) IS
  'Reads 6 upstream tables (incidents/cases/plans/sessions/notes/period_absences+period_sessions JOIN) and computes 4 sub-scores + weighted total. SECURITY DEFINER + service-role-only EXECUTE — never granted to authenticated. Inactive students short-circuit to all-zero + signals={"inactive":true}. Missing students are a defensive no-op (RETURN empty). Sets is_stale=FALSE on every successful run. The m5.5 sweep cron is the canonical caller; on-demand admin invocation is the documented escape hatch.';

-- =====================================================================
-- PERMISSIONS — STRICTLY service_role
-- =====================================================================
REVOKE ALL ON FUNCTION compute_student_risk_score(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION compute_student_risk_score(integer) FROM authenticated;
REVOKE ALL ON FUNCTION compute_student_risk_score(integer) FROM anon;
GRANT EXECUTE ON FUNCTION compute_student_risk_score(integer) TO service_role;
