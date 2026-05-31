# Sprint 6 v1 manual QA — operational + school aggregate reports

Run after Sprint 6 v1 lands cleanly (м6.1 counselor API → м6.2 counselor
UI → м6.3a flag + types → м6.3b helper → м6.3c school API → м6.3d
school UI + sidebar).

This checklist proves the privacy boundary holds end-to-end across two
distinct report surfaces (counselor "my work" + school aggregates) and
that no content/names/top-N/section/average bleeds out at any layer.
Target time: ~12 min on a fresh laptop.

If a step fails, log it with the section number + steps to repro +
expected vs actual + any Console / Network error.

---

## 0. Pre-flight

### Env

- [ ] `.env.local` carries the usual set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. (Sprint 6 doesn't add a new env.)
- [ ] Both main and worktree copies of `.env.local` are in sync if dev runs from the worktree cwd.

### Files in place (no DB migration to verify on staging — see Section 9)

- [ ] `supabase/migrations/2026_07_05_001_school_reports_flag.sql` exists (comment-only).
- [ ] `lib/personas/types.ts` exports `PRINCIPAL_FLAG_KEYS` with `'view_school_reports'`, and `NEW_PERSONA_FLAG_LABELS.view_school_reports = { label: 'تقارير المدرسة الإجمالية', emoji: '📊' }`.
- [ ] `lib/personas/auth-gate.ts` exports `requireSchoolReports()`.
- [ ] `app/api/counselor/reports/operational/route.ts` exists.
- [ ] `app/api/admin/reports/school/route.ts` exists.
- [ ] `app/dashboard/counselor/reports/operational/page.tsx` exists.
- [ ] `app/dashboard/admin/reports/school/page.tsx` exists.

### Seeded fixtures

- [ ] `node --env-file=.env.local scripts/sprint4-ui-preview-setup.mjs` — Sprint 4 harness reused. Creates:
  - `smoke.super.4ui@test.local` (super_admin)
  - `smoke.counselor.4ui@test.local` (persona=counselor)
  - 4 in-scope cases + 1 out-of-scope case + 1 session + 1 confidential note + 1 plan

### Optional — for testing the `view_school_reports` non-super path

The Sprint 4 harness doesn't seed a "principal" smoke user. To exercise
the plain-flag path (admin with `view_school_reports=true` but not
super_admin), run this one-time SQL after the harness:

```sql
-- Promote the counselor smoke user to also hold view_school_reports
-- (overrides persona='counselor' — counselor gates also check persona,
-- they won't conflict because this flag is on a different surface).
UPDATE user_profiles
SET    permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb),
                               '{view_school_reports}', 'true'::jsonb)
WHERE  user_id = (SELECT id FROM auth.users WHERE email = 'smoke.counselor.4ui@test.local');
```

Remember to undo (set back to false / strip the key) before cleanup.

### Browser

- [ ] DevTools open on Console + Network tabs.

---

## 1. Counselor operational API — `GET /api/counselor/reports/operational` (м6.1)

Sign in as **smoke.counselor.4ui** → `/dashboard/counselor/reports/operational`.

### Gate

- [ ] super_admin and persona=counselor pass.
- [ ] teacher → middleware redirect or 403 (counterpart to the watchlist gate).
- [ ] `view_confidential_notes` flag holder without counselor persona → 403 (privacy decision inherited from м5.2).

### Date validation (identical to м6.3 — verify once here)

- [ ] `?from=not-a-date` → 400 "تاريخ غير صالح (يجب YYYY-MM-DD)".
- [ ] `?from=2026-05-21&to=2026-05-01` → 400 "from يجب أن يكون قبل أو يساوي to".
- [ ] `?from=2024-01-01&to=2026-05-21` (>365 days) → 400 "المدى الزمني يتجاوز 365 يومًا".
- [ ] `?from=2026-05-01&to=2027-01-01` (future to) → 200 silently capped to today.
- [ ] No `from`/`to` → defaults to last 30 days (rolling).

### Scope

- [ ] counselor: `scope.mode='counselor'`, `students_in_scope` reflects their counselor_assignments scope (≈ 33 with sprint4 seed).
- [ ] super_admin: `scope.mode='super_admin'`, `students_in_scope` = school-wide (≈ 984).

### Notes filter — "my work" semantics

- [ ] `notes.recorded_in_range` for **super_admin** is 0 in the default range (they didn't record the seeded notes — counselor did). Confirms the `recorded_by = caller.userId` filter.

### Risk landscape

- [ ] `risk_landscape.average_score` is `null` when `students_scored < 20` (sample size guard). With 33 scored counselor-scope students, average is computed (integer).
- [ ] `risk_landscape.top_5` returns 5 items sorted by score DESC, tie-break student_id ASC.
- [ ] Each top_5 item has `is_stale` flag.

### Content-leak audit (API)

Run from the browser console while signed in:

```js
const r = await fetch('/api/counselor/reports/operational', { credentials: 'include' });
const body = await r.json();
const FORBIDDEN = ['title','description','text','topic','content_encrypted',
                   'content_preview','resolution','close_reason','reopen_reason',
                   'milestones','progress_notes'];
const leaks = [];
(function walk(obj, path) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN.includes(k)) leaks.push(`${path}.${k}`);
    walk(obj[k], `${path}.${k}`);
  }
})(body, '');
console.log({ status: r.status, leaks });
```

- [ ] `leaks` is empty.

---

## 2. Counselor operational UI — `/dashboard/counselor/reports/operational` (м6.2)

Sign in as **smoke.counselor.4ui**.

### Surface

- [ ] Header "تقرير العمليات" + 5 cards rendered in order: الحالات / خطط المتابعة / جلسات الإرشاد / **ملاحظاتك المسجلة** / صورة المخاطر.
- [ ] Notes card subtitle reads "الملاحظات التي سجَّلتها أنت في هذه الفترة على طلاب نطاقك." (NOT "كل ملاحظات النطاق").
- [ ] Date controls: from/to inputs default last 30 days. 3 quick-range pills (٧/٣٠/٩٠).
- [ ] Invalid range (from > to via dev-tools change) → inline chip "«من» يجب أن يكون قبل أو يساوي «إلى»." + body shows "عدِّل الفترة لتحميل التقرير.". **No fetch fired** (verify on Network).

### Top-5 fallback name

- [ ] Each top_5 row renders `طالب #<id>` when `student_name === null` (the defensive RLS fallback — NOT "غير معروف"). Optional "بدون اسم" small badge distinguishes from real names.
- [ ] `is_stale=true` rows carry a "مؤجَّل" badge.
- [ ] As **super_admin**: top_5 names are real (e.g. "حماده حسن") — confirms user-bound enrichment works when RLS allows.

### Scope chip

- [ ] counselor: "نطاق المرشد • N طالب يُحسَب".
- [ ] super_admin: "كل المدرسة • N طالب يُحسَب".

### Content-leak audit (DOM)

```js
const txt = document.body.innerText;
const markers = ['M4.18 PREVIEW SMOKE','TRUE_SECRET_PLAINTEXT',
                 'content_encrypted','content_preview','progress_notes'];
console.log(markers.filter(m => txt.includes(m)));
```

- [ ] Returns `[]`.

---

## 3. `view_school_reports` flag declaration (м6.3a)

Static (no DB needed):

- [ ] `lib/personas/types.ts` — `NEW_PERSONA_FLAG_KEYS` contains `'view_school_reports'`. Total count is now 14 = 4 (VP) + 7 (counselor) + 2 (shared) + 1 (principal).
- [ ] `NEW_PERSONA_FLAG_LABELS['view_school_reports']` = `{ label: 'تقارير المدرسة الإجمالية', emoji: '📊' }`.
- [ ] Migration file `2026_07_05_001_school_reports_flag.sql` is COMMENT-only — no `GRANT`, no `INSERT`, no active `UPDATE user_profiles` statement (the only `UPDATE user_profiles` is a commented operator template).

DB (optional — runtime is unaffected because the flag lives in JSONB):

- [ ] If migration applied on staging: `SELECT obj_description('user_profiles.permissions'::regclass::text::regclass::text, 'pg_class')` (or via `\d+ user_profiles` in psql) contains `view_school_reports`.

---

## 4. School aggregate API — `GET /api/admin/reports/school` (м6.3c)

### Gate

- [ ] Sign in as **smoke.counselor.4ui** (no flag, persona=counselor) → `fetch('/api/admin/reports/school')` returns **403** with `error: "لا تملك صلاحية تقارير المدرسة الإجمالية (يلزم view_school_reports)"`.
- [ ] Sign in as **smoke.super.4ui** → 200.
- [ ] (Optional — if you ran the SQL to grant the flag to the counselor) re-fetch → 200, `scope.mode === 'principal'` (NOT super_admin).

### Date validation (same rules as Section 1)

- [ ] `?from=not-a-date` → 400.
- [ ] `?from=21&to=01` → 400.
- [ ] >365 days → 400.
- [ ] future `to` → 200 silently capped.

### Response shape

- [ ] Top-level keys: `range, scope, cases, plans, sessions, notes, risk_landscape, by_grade`.
- [ ] `scope`: `mode`, `k_threshold=5`, `total_students`, `suppressed_grade_count`.
- [ ] `cases` (school totals): includes `opened_in_range, resolved_in_range, closed_in_range, reopened_in_range, by_type, by_severity`. **NO `currently_active`**.
- [ ] `plans`: 4 lifecycle counts incl `currently_overdue`.
- [ ] `sessions`: `held_in_range, total_duration_minutes, by_type`.
- [ ] `notes`: `recorded_in_range, confidential, non_confidential`. **NO `by_type`** (positive/negative).
- [ ] `risk_landscape`: `students_scored, stale_count, buckets={0-29,30-49,50-69,70+}`. **NO `average_score`, NO `above_50`, NO `above_70`, NO `top_5`**.

### K-anonymity branch — temporarily prove suppression

To verify the suppression branch end-to-end (no grade in the current
dataset has <5 students, so we synthesize it by raising K):

1. Edit `app/api/admin/reports/school/route.ts` and change `K_THRESHOLD = 5` to `K_THRESHOLD = 300` (or any value above the smallest grade's `student_count`).
2. Re-fetch as super_admin.

- [ ] The grade with `student_count < 300` returns with `suppressed: true` AND `cases/plans/sessions/notes/risk_buckets` ALL `null`.
- [ ] `grade_id, grade_name, student_count` remain populated (row identity, not metrics).
- [ ] `scope.suppressed_grade_count` reflects the count of suppressed rows.

3. **Revert** `K_THRESHOLD` back to `5`. Verify no rows suppressed in normal data.

### Content-leak audit (API)

```js
const r = await fetch('/api/admin/reports/school', { credentials: 'include' });
const body = await r.json();
const FORBIDDEN = ['title','description','text','topic','content_encrypted',
                   'content_preview','resolution','close_reason','reopen_reason',
                   'milestones','progress_notes',
                   'student_id','student_name','first_name','last_name',
                   'recorded_by','counselor_id','counselor_name',
                   'top_5','top_10','average_score','currently_active',
                   'above_50','above_70'];
const leaks = [];
(function walk(obj, path) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN.includes(k)) leaks.push(`${path}.${k}`);
    walk(obj[k], `${path}.${k}`);
  }
})(body, '');
console.log(leaks);
```

- [ ] Returns `[]`. (24 forbidden keys checked. `student_id` is the strict one — used internally for joins, must never reach the response.)

---

## 5. School aggregate UI — `/dashboard/admin/reports/school` (м6.3d)

### Sidebar gate

- [ ] As **counselor**: sidebar does NOT show the "تقارير المدرسة" group nor the "تقرير المدرسة الإجمالي" link (`requiresPermission: 'view_school_reports'` filter).
- [ ] As **super_admin**: sidebar shows the group + link.

### Page gate (client)

- [ ] As **counselor** navigating directly to `/dashboard/admin/reports/school`: page renders the forbidden card with message "تقرير المدرسة الإجمالي متاح لمن لديه صلاحية view_school_reports أو super_admin فقط.". **No API fetch fired** (verify on Network).

### Render — super_admin

- [ ] Header "تقرير المدرسة الإجمالي" + 5 totals cards (cases/plans/sessions/notes/risk) + by_grade table card.
- [ ] Scope chips: "المدرسة كاملة • N طالب نشط" + "k≥5".
- [ ] Date controls: from/to + 3 quick-range pills + invalid-range guard (same UX as م6.2).

### By-grade table

- [ ] 7 columns: الصف / طلاب / الحالات / الخطط / الجلسات / الملاحظات / درجات المخاطر.
- [ ] One row per grade. Each metric cell shows compact slash-separated counts (e.g. `5/0/0/0`).
- [ ] **NO by_type / by_severity columns** inside the table (those live at school level only).

### Suppression UI — temporarily prove

(After raising K_THRESHOLD as in Section 4)

- [ ] The suppressed grade row gets `bg-amber-50` tint.
- [ ] Badge "محجوب (n<5)" appears next to the grade name.
- [ ] All 5 metric cells render `—` (em-dash). `student_count` still visible.
- [ ] Scope chip updates to include "X صف محجوب".

(Revert K_THRESHOLD before continuing.)

### Content-leak audit (DOM)

```js
const txt = document.body.innerText;
const markers = [
  'M4.18 PREVIEW SMOKE','TRUE_SECRET_PLAINTEXT',
  // real seeded student names (Sprint 4 fixtures vary — adjust to your DB):
  'حماده','فارس فقيه','تركي السهلي',
  // raw column names that must never reach the DOM:
  'student_id','content_encrypted','content_preview','recorded_by',
  'first_name','last_name',
  // forbidden surfaces:
  'top_5','average_score','currently_active'
];
console.log(markers.filter(m => txt.includes(m)));
```

- [ ] Returns `[]`.

---

## 6. Network / no-leak audit (cross-cutting)

For both counselor + school reports, on the Network tab:

- [ ] No request body or response carries `content_encrypted`, `content_preview`, or `text` columns.
- [ ] No `decrypt_session_content` RPC call.
- [ ] No call to a `/students/<id>` or `/cases/<id>` endpoint while a report page is the active route — reports must not silently drill down.
- [ ] All 2xx responses for the report endpoints carry `Cache-Control: no-store`.

---

## 7. Cleanup

- [ ] If you ran the optional SQL to grant `view_school_reports` to the counselor smoke user, REVERSE it:

```sql
UPDATE user_profiles
SET    permissions = permissions - 'view_school_reports'
WHERE  user_id = (SELECT id FROM auth.users WHERE email = 'smoke.counselor.4ui@test.local');
```

- [ ] `node --env-file=.env.local scripts/sprint4-ui-preview-cleanup.mjs` — removes both smoke users + seeded data.
- [ ] Verify on staging:

```sql
SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE 'smoke.%.4ui@test.local') AS users_left,
  (SELECT count(*) FROM student_cases WHERE created_at > NOW() - INTERVAL '1 day') AS recent_cases;
```

- [ ] All counts = 0 (or pre-existing baseline).

---

## 8. Known intentional behaviors (not bugs)

- **`top_5` returns `student_name: null` for some counselor-scope rows.** The API uses a user-bound `students` lookup; if students RLS doesn't cover the counselor's full risk-score scope, name comes back null and the UI shows `طالب #<id>` as a fallback. This is by design — chose null+fallback over service-role enrichment (per м6.1 user spec).
- **Notes on the counselor report are `recorded_by = caller.userId`**. They are the counselor's own log entries, NOT every note visible in their scope. UI labels this clearly with "ملاحظاتك المسجلة".
- **`average_score` is `null` when `students_scored < 20`** (counselor report). Sample-size guard against misleading averages on tiny scopes.
- **No `currently_active` for cases at school level.** Only events-in-range counts. Point-in-time correlation risk for principal-level surface.
- **No `by_type` / `by_severity` inside grade rows** in the school report — those live at school totals only. Even with k>=5, type breakdowns within a grade can shrink to 1-2 events.
- **No `notes by_type` (positive/negative) at any level in the school report.** Per м6.3 user spec.
- **k-threshold = 5 is hardcoded.** Any change requires a privacy review per the migration header. The metric-drift policy applies to ANY new metric (even mathematically aggregate); no quiet additions.
- **Suppressed grade rows keep `grade_id`/`grade_name`/`student_count`**. UI shows "—" for metrics + a clear "محجوب (n<5)" badge so the principal understands the privacy decision rather than guessing "no data".
- **`view_school_reports` does NOT chain with `view_confidential_notes`**. They gate categorically different surfaces (aggregates vs content). Granting one does not grant the other.
- **School report uses service-role**; counselor reports use user-bound. The flag check + k-anonymity in JS form the privacy boundary for the school surface (RLS doesn't add narrowing because scope = "school"). Counselor surfaces stay user-bound because RLS auto-narrows to counselor_assignments.

---

## 9. Tech debt (deferred from Sprint 6 v1)

- **Migration `2026_07_05_001_school_reports_flag.sql` pending manual apply on staging.** Comment-only — runtime is unaffected because permission flag enforcement is app-layer (helper + API gate) + JSONB free-shape storage. Apply on next fresh deploy or via the Supabase Dashboard SQL editor.
- **м6.4 — Snapshot table + trend lines.** Needs: schema migration for `student_risk_score_history` (or similar), cron decision (Vercel cron vs pg_cron), retention policy. Out of scope for v1 — current school report is point-in-time only.
- **м6.5 — PDF/CSV export.** Adds artifact + storage surface (where do exports live? Supabase Storage? signed URLs? expiry?). Privacy implication: a PDF on a principal's laptop has a different threat model than a live web view. Out of scope for v1.
- **м6.6/м6.7 — Parent-facing summary surfaces.** Requires separate privacy review: parents see ONE student (theirs), so k-anonymity is irrelevant but the content gate must be tightened (no signals, no internal notes, only behavior/attendance summaries). Auth path also different (parent portal, not admin). Out of scope for v1 — its own planning round.
- **`view_school_reports` for non-super_admin user not yet provisioned in any seed/setup script.** Sprint 4 harness only creates super + counselor + teacher. To exercise the principal-flag-only path manually, use the SQL snippet in Section 0 above. A future setup script can codify this.
- **By-section breakdown deferred to v2.** Per м6.3 user spec — sections are often <5 students in small schools, and the privacy/utility trade-off needs more thought. The grade-level breakdown with k>=5 is the v1 ceiling.
- **`view_confidential_notes` oversight surface for risk scores** is still on hold pending a privacy review (carried over from Sprint 5 tech debt).
- **`decrypt_session_content` RPC + decrypt audit** is the last deferred surface from Sprint 4 — still its own mini-sprint with a security review.

---

## 10. Sign-off

When complete, log to `00-المراقبة.md`:

```
| YYYY-MM-DD | Sprint 6 v1 manual QA passed on staging — counselor + school reports | (sign-off) |
```

| # | Section | Result | Notes |
|---|---|---|---|
| 0 | Pre-flight | _PASS / FAIL_ |  |
| 1 | Counselor operational API (м6.1) | _PASS / FAIL_ |  |
| 2 | Counselor operational UI (м6.2) | _PASS / FAIL_ |  |
| 3 | `view_school_reports` flag (м6.3a) | _PASS / FAIL_ |  |
| 4 | School aggregate API (м6.3c) | _PASS / FAIL_ |  |
| 5 | School aggregate UI (м6.3d) | _PASS / FAIL_ |  |
| 6 | Network / no-leak audit | _PASS / FAIL_ |  |
| 7 | Cleanup | _PASS / FAIL_ |  |

**Sprint 6 v1 closed-ready when 0-7 = PASS and Sections 8-9 read intentionally.**
