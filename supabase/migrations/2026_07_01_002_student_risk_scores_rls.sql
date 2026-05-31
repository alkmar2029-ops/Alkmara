-- м5.2 — RLS policies on student_risk_scores (SELECT-only).
--
-- =====================================================================
-- DELIBERATELY NARROW: SELECT only, super_admin + counselor only
-- =====================================================================
-- Two layered decisions in this migration:
--
-- 1. ONLY SELECT — no INSERT / UPDATE / DELETE policies.
--    The compute RPC (m5.4) runs SECURITY DEFINER under service-role,
--    bypassing RLS for the write path. The m5.3 backfill + staleness
--    triggers likewise run via SECURITY DEFINER. There is no
--    user-facing write surface on this table, by design — every score
--    is derived from upstream signals; counselors cannot hand-edit
--    a row. Leaving INSERT/UPDATE/DELETE without policies means RLS
--    fail-closes them for `authenticated`, which is the correct
--    behaviour.
--
-- 2. NO `view_confidential_notes` branch (vs м4.7 student_cases /
--    counseling_sessions where flag holders get oversight read).
--    The risk score is an AGGREGATE derived from confidential
--    signals (counseling_sessions count + content_preview existence
--    + confidential note count). Even though the score itself is a
--    number 0-100, surfacing it to oversight reveals the inferred
--    confidential pattern: "this student's score jumped 30 points
--    in two weeks" tells you a counseling intervention happened
--    even without showing the content.
--
--    That trade-off requires a separate privacy decision (do we
--    want principals to use risk scores for triage? what's the
--    audit story for them?). Until that's reviewed, the safest
--    posture is: oversight flag holders see CASES and notes
--    through their existing м4.7 surfaces, but NOT the derived
--    risk score. A future migration can add the policy branch
--    once the decision is made.
--
-- The COMMENT on the policy makes this exclusion explicit so a
-- future reviewer doesn't "fix" the asymmetry without going through
-- the privacy review.

-- =====================================================================
-- ACCESS MODEL
-- =====================================================================
--   super_admin                           → all rows
--   counselor (persona) IN scope          → only rows where
--                                           counselor_can_see_student
--                                           returns TRUE
--   service-role / table owner            → bypass RLS (used by the
--                                           compute RPC + triggers
--                                           in m5.3/m5.4)
--   everyone else (admin without persona, → 0 rows
--    teacher, staff, viewer, anon,
--    view_confidential_notes flag holder)

-- ============== Cleanup (idempotent re-run) ==============
DROP POLICY IF EXISTS student_risk_scores_select ON student_risk_scores;

-- ============== SELECT policy ==============
CREATE POLICY student_risk_scores_select ON student_risk_scores
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR counselor_can_see_student(student_id)
  );

COMMENT ON POLICY student_risk_scores_select ON student_risk_scores IS
  'Read access: super_admin / counselor-in-scope. view_confidential_notes flag holders are DELIBERATELY EXCLUDED — the score is derived from confidential signals (sessions, confidential notes) and surfacing the aggregate to oversight reveals the inferred confidential pattern (e.g., a 30-point jump implies a counseling intervention). Adding flag-holder access requires a separate privacy review; do not "fix" this asymmetry without that review.';
