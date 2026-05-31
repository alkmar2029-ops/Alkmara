-- Add `view_school_reports` permission flag for principal aggregate
-- surfaces (Sprint 6 — م6.3).
--
-- =====================================================================
-- WHAT THIS FLAG IS / IS NOT
-- =====================================================================
-- IS:    access to school-wide AGGREGATED metrics — case/plan/session
--        counts، risk distribution BUCKETS، notes counts (confidential/
--        non-confidential at school level only). All views go through
--        a k-anonymity threshold of n>=5 per grade row before any
--        per-grade field is exposed.
--
-- IS NOT: a license to drill down. SPECIFICALLY:
--           - No student names, no top-N students
--           - No per-section breakdown (only per-grade in v1)
--           - No note content / session topic / case title
--           - No average risk score (only buckets)
--           - No counselor-attributed activity (deanonymization risk)
--
-- ANY future expansion of those NOT items requires a SEPARATE privacy
-- review and likely a SEPARATE flag — not a quiet widening of this one.
-- This commitment is anchored here (DB-level COMMENT) so a code reader
-- six months from now sees the boundary on first encounter, not in a
-- separate doc.
--
-- =====================================================================
-- RELATIONSHIP TO view_confidential_notes
-- =====================================================================
-- `view_confidential_notes` (Sprint 1) = read CONTENT of confidential
-- notes (PII). Still gated behind a deferred privacy review.
-- `view_school_reports`     (Sprint 6) = read DERIVED AGGREGATES of
-- confidential-related counts (e.g. "Grade 7 has 8 active cases"),
-- protected by n>=5 k-anonymity. These are categorically different
-- surfaces and intentionally NOT chained — granting one does not
-- grant the other.
--
-- =====================================================================
-- STORAGE
-- =====================================================================
-- The flag lives in `user_profiles.permissions` JSONB. No new column,
-- no schema migration. This file's job is to:
--   1. Update the COMMENT on the permissions column to enumerate the
--      new key (single source of truth for DBA / new engineers).
--   2. Provide a one-time grant query template (commented out).

COMMENT ON COLUMN user_profiles.permissions IS
  'JSONB capability flags + persona identifier for admins.

Persona keys (string):
  persona:  "principal" | "vice_principal" | "counselor" | "general_admin"
  vp_scope: "academic" | "administrative" | "student_affairs" | "general"

Existing flags (10, all bool):
  take_attendance, manage_dismissals, write_notes, send_whatsapp,
  view_reports, manage_students, manage_users, override_pickup,
  manage_schedule, manage_settings

VP flags (4, all bool):
  manage_substitutions, manage_incidents, approve_teacher_leave,
  view_morning_dashboard

Counselor flags (7, all bool):
  manage_counseling_sessions, manage_cases, manage_followup_plans,
  view_confidential_notes, view_health_info, view_social_info,
  view_risk_watchlist

Shared flags (2, all bool):
  review_teacher_incidents, escalate_to_case

Principal flags (1, all bool):           -- ADDED 2026-07-05 (Sprint 6 / م6.3)
  view_school_reports — access to school-wide AGGREGATED reports
                        (k-anonymity n>=5 applied per grade). Does NOT
                        grant drill-down, names, or content access.
                        See migration 2026_07_05_001_school_reports_flag.sql
                        for the full privacy boundary.

Persona/vp_scope values are protected by CHECK constraints (see
2026_05_20_extend_permissions.sql).';

-- Template (commented out) — operators run manually per principal:
--   UPDATE user_profiles
--   SET    permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb),
--                                  '{view_school_reports}', 'true'::jsonb)
--   WHERE  user_id = '<principal-user-uuid>';
