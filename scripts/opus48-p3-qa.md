# Opus 4.8 — Wave A (Phase 3 bridges) QA

Date: 2026-05-31. Scope: the five completeness bridges from
`opus48-remaining-to-100.md` Wave A. All work in the current (uncommitted)
tree — a fresh worktree from HEAD would lose the P1/P2 + sprint deps these
bridges build on.

Verification gate (this batch): `npx tsc --noEmit` = EXIT 0 ·
`npx eslint <touched files>` = EXIT 0. DB + auth-session acceptance checks
below require staging (local Postgres not running; same constraint noted in
P1 QA). No smoke run — `smoke:sprint2/3` need a live env.

---

## A1 — incident → case bridge (escalate)

New/changed files:

- `app/api/incidents/[id]/escalate/route.ts` (PATCH — new)
- `app/dashboard/vp/incidents/review/page.tsx` (enabled the "صعِّد" button + new `EscalateModal`; the button was previously disabled with a "يُفعَّل في المرحلة 4" tooltip)

Behavior:

- Same gate as dismiss/action: `requireAdminWithFlag('review_teacher_incidents')` (super_admin passes).
- Self-review guard + scope re-validation (`reviewer_can_see_student` via user-bound client) + state-machine guard (only `submitted`/`under_review`).
- Creates a `student_cases` row (status defaults `open`, `created_by` = actor), then race-safe `UPDATE` of the incident to `status='escalated'` + `case_id` + `escalated_to` (default actor). If the UPDATE matches zero rows (race lost) or errors (e.g. bad `escalated_to` FK), the just-created orphan case is deleted and 409/500 returned.
- Case fields derive from the incident (overridable via body): `case_type` mapped from `incident_type`, `severity` = incident severity, `title`/`description` templated from the incident (always satisfy the ≥10 / ≥20 CHECKs).
- `case_history` is NOT written on creation by design — its trigger fires on status *transitions*; creation is captured by `audit_logs` (`action='incident.escalate'`) + the incident's escalated transition.

Acceptance (staging):

- Escalating a `submitted` incident in scope → a new `open` case linked via `incident.case_id`; incident status `escalated`. ✔ audit row `incident.escalate` with `case_id`/`case_number`.
- A reviewer escalating an incident for a student **out of their scope** → 403. (negative)
- The submitter escalating **their own** incident → 403. (negative)
- Escalating an already `actioned`/`dismissed`/`escalated` incident → 409. (negative)
- Two reviewers racing → only one wins; the loser's orphan case is rolled back (no dangling case).
- UI: the review queue "صعِّد" button (flag-gated like dismiss/action) opens `EscalateModal` (optional case_type select + optional description ≥20-or-empty); on success a toast shows the new `CASE-YYYY-NNNN` and the row drops off the queue.

## A2 — guardian WhatsApp notification on action (م3.19)

Changed/new files:

- `lib/incidents/whatsapp.ts` (new — `notifyGuardianOfIncidentAction`)
- `lib/whatsapp/log.ts` (added `'incident'` to `WhatsappContextType`; `whatsapp_messages.context_type` is unconstrained `VARCHAR(50)`, so no migration)
- `app/api/incidents/[id]/action/route.ts` (expanded incident select; wired the send; returns `whatsapp` outcome)

Behavior:

- When the reviewer sets `parent_notified=true`, the action route sends a guardian WhatsApp **best-effort** (a send failure does NOT fail the request; the incident is already actioned).
- Guardian phone + student identity are read **server-side** from `students` (never trusted from the body). Phone normalized through the P1.3 `toJid` path.
- Idempotent: skips if a `whatsapp_messages` row with `context_type='incident'`, `context_id=<incidentId>`, `status='success'` already exists.
- Privacy: the message states a note was recorded + the incident TYPE + DATE + that action was taken. It does NOT include the verbatim internal `action_taken`/`description`.

Acceptance (staging):

- Action with `parent_notified=true` on a student with a phone → guardian receives the message; a `whatsapp_messages` row (`context_type='incident'`) is logged with `sent_by` = reviewer.
- A second action attempt is impossible (state machine 409), and even a re-entry short-circuits via idempotency (no double-send).
- Student with no phone → `whatsapp.ok=false` with a reason, incident still actioned.

## A3 — VP live counts (replaces hardcoded 0)

Changed files:

- `app/api/vp/morning-summary/route.ts` — `pending_incidents` = incidents `submitted|under_review`; `open_cases` = cases `open|in_progress` (school-wide, service-role, added to the existing Promise.all + error check).
- `app/api/vp/operations-report/[date]/route.ts` — `incidents_actioned` = incidents `actioned` with `reviewed_at` in `[date, date+1)`; `cases_opened` = cases `created_at` in `[date, date+1)` (Riyadh-bounded ISO range, tz-stable like the leave-decision query).

Acceptance (staging):

- VP morning dashboard cards show real counts; a query error surfaces 500 (not a silent 0) per the route's existing discipline.
- Operations report for a date reflects that day's actioned incidents + opened cases.

## A4 — counseling-session decryption (the deferred read path)

New/changed files:

- `supabase/migrations/2026_07_10_001_decrypt_session_content.sql` (new RPC)
- `app/api/counselor/cases/[id]/sessions/[sessionId]/route.ts` (new GET)
- `app/dashboard/counselor/cases/[id]/page.tsx` (enabled the reveal button + accountability notice; updated header doc)

Behavior:

- `decrypt_session_content(p_actor_user_id, p_session_id, p_key, p_ip, p_ua)` mirrors `create_counseling_session` (009): `SECURITY DEFINER`, `search_path = public, extensions`, **service_role only** (REVOKE from authenticated/anon — the key never reaches the browser), DB-side scope re-check via `counselor_assignments`, then `pgp_sym_decrypt`, then writes `confidential_access_log` `action='decrypt'` (allowed by the column CHECK). Returns the plaintext; never logs the key or the plaintext; a failed decrypt writes no audit row.
- API: `requireCounselorWorkspace` gate, `COUNSELING_SESSION_KEY` from env (fail-closed 503 if missing/short), RPC via admin client. 42501 → 403 (indistinguishable from not-found); other errors → 500. Response is `{ content }` only, `Cache-Control: no-store`.
- UI: per-session "عرض محتوى الجلسة المشفّر" button now fetches on demand (plain fetch, NOT react-query — plaintext is never cached), shows the content with a "سُجِّل وصولك" banner + "إخفاء" (drops it from memory). The page-level notice now states decryption is available and logged.

Operator setup before staging:

- `COUNSELING_SESSION_KEY` (≥32 chars, the SAME value used by the create path) present in the environment.
- Apply migration `2026_07_10_001` after the Sprint 4 migrations (pgcrypto in `extensions`).

Acceptance (staging):

- In-scope counselor clicks reveal → content shows; a `confidential_access_log` row `action='decrypt'`, `table_name='counseling_sessions'`, `record_id=<sessionId>`, `accessed_by`=caller, correct `student_id`.
- A counselor revealing a session **outside their scope** → 403, and NO decrypt audit row. (negative)
- Missing/short `COUNSELING_SESSION_KEY` → 503, no decrypt. (negative)
- The RPC is not executable by `authenticated` (only service_role) — a direct PostgREST RPC call as a counselor is denied. (negative)

## A5 — counselor search scoping (PRIV-02)

Changed file:

- `app/api/search/route.ts`

Behavior (revised after static review — see fixes below):

- Detects a scoped counselor via the **service-role** client reading `role` + `permissions.persona` (authoritative; no RLS ambiguity on the caller's own row). A read **error → 500** (fail-closed); a successful-but-null read authoritatively means "no profile → not a counselor".
- For a counselor, resolves the section set they may see — directly-assigned sections ∪ every section in their grade-wide assignments (mirrors `counselor_can_see_student`'s section-direct OR grade-wide logic) — and scopes **every** student query with `.in('section_id', <set>)` at the DB level. Any error resolving the set → 500.
- An empty set (counselor with no assignments) **short-circuits to `results.students=[]` before any query** — sidesteps the PostgREST empty-`IN` edge. The per-query guard stays `if (counselorSectionIds)` (NOT `length > 0`): with the short-circuit upstream, `.in` only ever sees a non-empty set, and removing the short-circuit later degrades to the safe `.in([])`-returns-zero behavior, never to an unscoped (leaking) query.
- Non-counselor admins / super_admin: `counselorSectionIds` stays null → unrestricted (unchanged). teacher already gets empty teachers/sections from P1.4.

Static-review fixes (two defects caught before sign-off):

1. **Fail-open blocker (privacy):** the first pass read persona via the *user-bound* client with **no error check**; a failed read left `isScopedCounselor=false`, and since a counselor's base role is `admin`, they got UNRESTRICTED student results — directly against PRIV-02. Fixed: service-role read + explicit error → 500.
2. **Hide-after-limit (acceptance):** the first pass filtered `results.students` *after* `.limit`, so if the first N global matches were all out-of-scope, a valid in-scope match beyond the limit was hidden (could return `[]`). Fixed: the scope condition is pushed into the query, so `.limit` applies to already-in-scope rows.

Acceptance (staging):

- A counselor searching a student **outside** their `counselor_assignments` scope → not in results. (negative)
- A counselor searching an **in-scope** student → present, even when many out-of-scope students would otherwise rank ahead of it (no hide-after-limit).
- A counselor with **no** assignments → empty student results (not unrestricted). (negative)
- A simulated `user_profiles` / `counselor_assignments` read failure → **500**, NOT a silent unrestricted result. (negative — the fail-open regression check)
- super_admin / non-counselor admin / staff / teacher search behavior unchanged.

---

## Verification run

- `npx tsc --noEmit`: PASS (EXIT 0).
- `npx eslint` on the touched files: PASS (EXIT 0). The review page shows 9 warnings (unused imports + prop-type param names) — all pre-existing style in that file (the dismiss/action prop signatures warn identically); 0 errors.
- Staging acceptance (DB + auth session): PENDING — requires applying `2026_07_10_001`, `COUNSELING_SESSION_KEY`, and counselor/VP/reviewer test sessions. Negative security tests above are the required sign-off before marking Wave A closed.

## Notes / residual

- Escalate is `PATCH` (consistent with the dismiss/action sibling family), not `POST` as the plan loosely phrased it. Response returns `{ incident, case }`.
- A2's teacher-notify-on-dismiss (internal_messages) from the original plan note is intentionally NOT in this batch — it's a different channel (internal messaging, not WhatsApp); tracked separately.
- `decrypt_session_content` key rotation is not hot — same constraint documented in migration 009 (re-encrypt migration + atomic env swap).
