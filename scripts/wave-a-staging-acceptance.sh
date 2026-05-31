#!/usr/bin/env bash
# Wave A — staging acceptance (HTTP / negative + positive).
#
# Fill the placeholders below, then:  bash scripts/wave-a-staging-acceptance.sh
#
# Tokens are Supabase access-tokens (JWT) for users with the stated
# role/persona. Get one per user e.g. from the browser devtools (the
# `sb-<ref>-auth-token` cookie/localStorage `access_token`) after signing in,
# or via the Supabase auth API.
#
# Status-only checks print [PASS]/[FAIL]. The two ABSENCE checks (A5,
# teacher-search) can't be asserted by HTTP status alone, so the body is
# printed for a 5-second manual eyeball — what to look for is stated inline.
#
# Mutating tests (A1 in-scope escalate CREATES a case) are gated behind
# RUN_MUTATING=1 so a default run is non-destructive.
set -u

# ----- config: fill these -----
STAGING_URL="https://your-staging.example.com"
COUNSELOR_TOKEN="PASTE"            # role=admin, persona=counselor, HAS counselor_assignments
NOASSIGN_COUNSELOR_TOKEN="PASTE"   # role=admin, persona=counselor, NO assignments (optional)
ADMIN_TOKEN="PASTE"                # super_admin OR review_teacher_incidents holder
TEACHER_TOKEN="PASTE"              # role=teacher

# ----- IDs: pick real rows on staging -----
IN_SCOPE_STUDENT_NAME="فهد"        # a name that matches a student INSIDE the counselor's scope
OUT_SCOPE_STUDENT_NAME="نورة"      # a name that matches a student OUTSIDE the counselor's scope
CASE_ID=0                          # case id used in the decrypt path
IN_SCOPE_SESSION_ID=0              # counseling_sessions.id whose case student is IN scope
OUT_SCOPE_SESSION_ID=0             # session whose student is OUT of the counselor's scope
OWN_INCIDENT_ID=0                  # incident submitted_by the ADMIN_TOKEN user (status submitted/under_review)
INSCOPE_INCIDENT_ID=0              # incident in ADMIN_TOKEN scope, NOT submitted by them (for the mutating escalate)

RUN_MUTATING="${RUN_MUTATING:-0}"  # set 1 to run the in-scope escalate (creates a case)

pass=0; fail=0
# check NAME EXPECTED METHOD PATH TOKEN [JSON_BODY] [EXTRA_HEADER]
check() {
  local name="$1" exp="$2" method="$3" path="$4" token="$5" body="${6:-}" xtra="${7:-}"
  local args=(-s -o /dev/null -w "%{http_code}" -X "$method" "$STAGING_URL$path")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$xtra" ] && args+=(-H "$xtra")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" -d "$body")
  local code; code=$(curl "${args[@]}")
  if [ "$code" = "$exp" ]; then echo "[PASS] $name (got=$code)"; pass=$((pass+1))
  else echo "[FAIL] $name (got=$code expected=$exp)"; fail=$((fail+1)); fi
}
show() { # print a body for manual inspection
  local name="$1" path="$2" token="$3"
  echo "-- $name"
  curl -s "$STAGING_URL$path" -H "Authorization: Bearer $token" | head -c 900; echo; echo
}

echo "================ A4 — counseling decrypt scope ================"
check "A4 in-scope decrypt = 200"  200 GET "/api/counselor/cases/$CASE_ID/sessions/$IN_SCOPE_SESSION_ID"  "$COUNSELOR_TOKEN"
check "A4 out-scope decrypt = 403" 403 GET "/api/counselor/cases/$CASE_ID/sessions/$OUT_SCOPE_SESSION_ID" "$COUNSELOR_TOKEN"
echo "   (then confirm in SQL: a NEW confidential_access_log row action='decrypt' for the in-scope read, and NONE for the 403.)"

echo
echo "================ A5 — counselor search scope ================"
echo "EXPECT: in-scope name PRESENT in results.students; out-scope name ABSENT."
show "counselor search IN-scope  (expect the student PRESENT)" "/api/search?types=students&q=$IN_SCOPE_STUDENT_NAME"  "$COUNSELOR_TOKEN"
show "counselor search OUT-scope (expect results.students = [])" "/api/search?types=students&q=$OUT_SCOPE_STUDENT_NAME" "$COUNSELOR_TOKEN"
if [ "$NOASSIGN_COUNSELOR_TOKEN" != "PASTE" ]; then
  show "no-assignments counselor (expect results.students = [])" "/api/search?types=students&q=$IN_SCOPE_STUDENT_NAME" "$NOASSIGN_COUNSELOR_TOKEN"
fi

echo "================ A1 — incident escalate ================"
check "A1 escalate OWN incident = 403" 403 PATCH "/api/incidents/$OWN_INCIDENT_ID/escalate" "$ADMIN_TOKEN" '{}'
if [ "$RUN_MUTATING" = "1" ]; then
  check "A1 escalate in-scope = 200 (MUTATING: creates a case)" 200 PATCH "/api/incidents/$INSCOPE_INCIDENT_ID/escalate" "$ADMIN_TOKEN" '{}'
  echo "   (then confirm: a new student_cases row + that incident now status='escalated' with case_id set.)"
else
  echo "[skip] A1 in-scope escalate — set RUN_MUTATING=1 to run (it creates a case)."
fi

echo
echo "================ P1/P2 regressions ================"
check "P1 counselor -> POST /api/admins = 403" 403 POST "/api/admins" "$COUNSELOR_TOKEN" '{}'
check "P1 worker x-vercel-cron ALONE = 401"    401 GET  "/api/whatsapp/bulk-jobs/sweep-scheduled" "" "" "x-vercel-cron: 1"
echo "-- teacher search teachers (expect results.teachers = []):"
show "teacher search teachers" "/api/search?types=teachers&q=أ" "$TEACHER_TOKEN"

echo
echo "================ summary ================"
echo "status-asserted: PASS=$pass FAIL=$fail  (plus the printed bodies above need a manual eyeball)"
[ "$fail" -eq 0 ] || exit 1
