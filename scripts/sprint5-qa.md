# Sprint 5 manual QA — risk score + watchlist

Run after the 7 м5 migrations apply cleanly (m5.1 schema → m5.2 RLS
→ m5.3 backfill+triggers → m5.4 compute RPC → m5.5 sweep endpoint
→ m5.6 watchlist read API → m5.7 watchlist UI).

This checklist proves the staleness pipeline + RLS scope + compute
+ UI render are honest end-to-end. Target time: ~10 min on a fresh
laptop.

If a step fails, log it with the section number + steps to repro +
expected vs actual + any Console / Network error.

---

## 0. Pre-flight

### Env

- [ ] `.env.local` carries the usual Sprint 4 set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. (Sprint 5 doesn't add a new env.)
- [ ] Both main and worktree copies of `.env.local` are in sync if you run dev from the worktree cwd (see the Sprint 4 harness gotcha).

### Migrations

- [ ] All m5 migrations live on staging:

```sql
SELECT migration_name FROM (
  VALUES
    ('2026_07_01_001_student_risk_scores.sql'),
    ('2026_07_01_002_student_risk_scores_rls.sql'),
    ('2026_07_01_003_student_risk_scores_backfill_triggers.sql'),
    ('2026_07_01_004_compute_student_risk_score.sql')
) AS m(migration_name);
-- Confirm files exist in supabase/migrations/. The applied state is
-- visible via the static checks in sections 1-3 below.
```

### Seeded fixtures

- [ ] Run the existing Sprint 4 harness: `node --env-file=.env.local scripts/sprint4-ui-preview-setup.mjs`.
  - The counselor user it creates lands in section 29 (the open-case student's section).
  - Sprint 5 reuses these users — no separate seeding needed.

### Browser

- [ ] DevTools open on Console + Network tabs.

---

## 1. RLS scope on `student_risk_scores`

DB-only checks. Proves м5.2 policy enforces the right access matrix.

Run inside `BEGIN ... ROLLBACK`. Set role `authenticated` + jwt.claims sub.

- [ ] **super_admin** sees a seeded score row.
- [ ] **counselor-in-scope** (counselor_assignments matching the row's section) sees the row.
- [ ] **counselor-out-of-scope** sees 0 rows.
- [ ] **view_confidential_notes flag holder** with admin_section_assignments on the SAME section as the row → **0 rows**. This is the privacy decision: derived score does NOT inherit the m4.7 oversight branch.

If you don't want to write per-persona SQL, the API-level check in section 5 also exercises (super, counselor-in, counselor-out). The flag-holder branch is covered by the м5.2 PROBE 4 dynamic smoke.

---

## 2. Staleness triggers — every upstream write flips the row to TRUE

For each of the 6 source tables, INSERT (or UPDATE on the watched columns) and confirm `student_risk_scores.is_stale` flips to TRUE for the affected student.

```sql
-- Reset:
UPDATE student_risk_scores SET is_stale = FALSE WHERE student_id = <S>;
-- Then run the operation for each table and re-check:
SELECT is_stale FROM student_risk_scores WHERE student_id = <S>;
```

- [ ] `student_incidents` INSERT → stale.
- [ ] `student_incidents` UPDATE OF status, severity → stale.
- [ ] `student_cases` INSERT → stale.
- [ ] `student_cases` UPDATE OF status, severity, reopen_count → stale.
- [ ] `student_followup_plans` INSERT → stale.
- [ ] `student_followup_plans` UPDATE OF status, target_date → stale.
- [ ] `counseling_sessions` INSERT → stale.
- [ ] `student_notes` INSERT → stale.
- [ ] `student_notes` UPDATE OF type, is_confidential, case_id → stale.
- [ ] `students` UPDATE OF section_id → stale + `student_risk_scores.section_id` reflects the NEW section (watchlist filter must not drift).
- [ ] `students` UPDATE OF is_active → stale.

A NEW student inserted into `students` does NOT trigger a placeholder row (by design — they get one on first upstream signal write).

---

## 3. Sweep endpoint `POST /api/admin/risk-scores/sweep`

Super-admin only. Counselors must get 403 BEFORE the RPC is ever called.

### As counselor

- [ ] POST `/api/admin/risk-scores/sweep` → **403** "هذه العملية متاحة لـ super_admin فقط".

### As super_admin

- [ ] `POST {}` (empty body / defaults) → 200 with summary, `attempted` ≤ default 50, sweep picks stale rows oldest-first by `updated_at`.
- [ ] `POST { "limit": 5 }` → 200, `attempted` ≤ 5.
- [ ] `POST { "student_id": <S> }` → 200, `attempted=1`, `computed=1` (force-mode bypasses is_stale).
- [ ] `POST { "student_id": 99999999 }` (non-existent) → 200, `skipped_missing=1`, no row inserted in `student_risk_scores`.
- [ ] `POST { "limit": 999 }` → 400 "بيانات غير صالحة" (Zod max=200).
- [ ] After a successful sweep, the affected rows have `is_stale=FALSE` AND `computed_at IS NOT NULL`:

```sql
SELECT count(*) FILTER (WHERE is_stale=FALSE) AS fresh,
       count(*) FILTER (WHERE computed_at IS NOT NULL) AS computed
FROM student_risk_scores;
```

---

## 4. Compute RPC accuracy spot-check

Even though m5.4's verification batch passed at apply time, eyeball one student to make sure the math matches expectation.

- [ ] Pick a student with at least 1 incident + 1 case + 1 absence in the last 30 days.
- [ ] Force-compute them: `POST /api/admin/risk-scores/sweep { "student_id": <S> }` as super_admin.
- [ ] Verify the response sub-scores roughly match the formula (m5.4 header):

```
behavior   ≈ 5·inc_low + 10·inc_med + 20·inc_high + 35·inc_crit + 15·active_cases + 10·reopen_sum   (cap 100)
engagement ≈ 15·active_plans + 5·conf_notes_30d + max(0, 40 - 10·sessions_30d)                       (cap 100)
attendance ≈ 12·absences_30d + 4·late_30d                                                              (cap 100)
velocity   ≈ 25·(no_session_30d) + 30·(plan_overdue) + 25·(recent_incident_7d)                        (cap 100)
total      = round(0.35·b + 0.25·e + 0.25·a + 0.15·v)
```

- [ ] `signals` JSONB carries the raw counts that produced the scores.
- [ ] **Attendance uses `period_sessions.attendance_date`, NOT `period_absences.recorded_at`.** Confirm by inserting an old `attendance_date` row with a fresh `recorded_at` — `absences_30d` should stay 0 (covered by m5.4 v9/v10 dynamic verification).

---

## 5. Watchlist API `GET /api/counselor/watchlist`

### Counselor scope

- [ ] `GET /api/counselor/watchlist` (defaults: min_score=50, include_stale=false, limit=100) — returns `{ data: { total, items: [...] } }` with items respecting counselor's RLS scope.
- [ ] `GET ...?min_score=0&include_stale=true&limit=200` — `total` covers EVERY row in the counselor's scope (stale + fresh), but NOT rows for students outside their counselor_assignments.
- [ ] Each item carries: student_id, student_name (resolved via service-role lookup), grade_name, section_name, score, subscores (4 keys), signals (raw JSONB), computed_at (nullable), is_stale.
- [ ] No `content_encrypted` and no plaintext session body anywhere in the response (signals are counts only).

### Super_admin

- [ ] `GET /api/counselor/watchlist?min_score=0&include_stale=true&limit=200` — `total` reflects EVERY scored row in the database (~984 on staging after the m5.3 backfill).

### Teacher / unauthorised

- [ ] Teacher session POST/GET → **403** (middleware on `/dashboard/*` and `requireCounselorWorkspace` on the API both block).

### Bad params

- [ ] `?limit=999` → 400.
- [ ] `?min_score=200` → 400.

---

## 6. Watchlist UI `/dashboard/counselor/watchlist`

Sign in as **counselor** seeded by the harness.

- [ ] Header gradient + title "قائمة المتابعة — الطلاب الأعلى احتياجًا".
- [ ] Filters card: range slider (0-100 step=5) defaulting to 50, limit `<select>` with 50/100/200 defaulting to 100, checkbox "تضمين الصفوف المؤجَّلة".
- [ ] Default load: if no student in scope scores ≥ 50 → empty state "لا توجد حالات أعلى من العتبة الحالية".
- [ ] Drag slider to 0 → list refetches and renders cards. Each card shows:
  - Student name + grade / section line.
  - Score in a color-coded large badge (≥70 red, ≥40 amber, ≥1 green, 0 gray).
  - 4 subscore bars labeled السلوك / التفاعل / الحضور / الزخم with proportional fills.
  - Top signal chips (sorted by their weight in the score formula). Examples: "4 غياب آخر ٣٠ يوم", "2 حالة نشطة", "خطة متابعة متأخرة", "لا جلسات سابقة".
  - Footer: `آخر حساب: YYYY-MM-DD HH:MM` (or "لم تُحسب بعد" when computed_at is NULL).
  - Inline #student_id for cross-reference.
- [ ] Toggle "تضمين الصفوف المؤجَّلة" ON → list expands to include stale rows; each stale row carries the `مؤجَّل` badge.
- [ ] **NO compute / sweep / "recalculate" button anywhere on the counselor surface.** Trigger this manually only via section 3 as super_admin.

Sign in as **super_admin**:

- [ ] Same UI, same filters, but the counts cover the whole school. Counselor scope vs super_admin scope ratio is the primary visible difference (e.g., 33 vs 984 on a fresh sweep test).

Sign in as **teacher**:

- [ ] Direct hit on `/dashboard/counselor/watchlist` → middleware redirect to `/teacher`.
- [ ] Direct `fetch('/api/counselor/watchlist')` → 403.

---

## 7. Network / no-leak audit on the watchlist surface

- [ ] No request named `content_encrypted` or carrying session bodies appears on the Network tab.
- [ ] `signals` JSONB in the response only contains numeric counts + booleans + a `last_session_days_ago` integer / null. NO student notes text, NO incident descriptions.
- [ ] No `decrypt_session_content` RPC call. (It doesn't exist yet — confirm absence not by feature, but by Network log.)
- [ ] DOM search after a load: the watchlist page never renders raw plaintext from `student_notes.text`, `counseling_sessions.content_encrypted`, or `student_incidents.description`. Counts and labels only.

---

## 8. Cleanup

- [ ] `node --env-file=.env.local scripts/sprint4-ui-preview-cleanup.mjs` (the same harness — Sprint 5 doesn't create separate users).
- [ ] Verify on staging via psql that the smoke users + their data are gone:

```sql
SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE 'smoke.%.4ui@test.local') AS users_left,
  (SELECT count(*) FROM student_cases WHERE title LIKE 'M4.18 PREVIEW SMOKE%' OR title LIKE 'QA_SECTION%') AS cases_left;
```

- [ ] All counts = 0.

### Manual cleanup for the SQL-only flag-holder (if used in section 1)

If you created a `view_confidential_notes` user via raw SQL (the Sprint 4 setup script doesn't), clean them up directly:

```sql
DELETE FROM admin_section_assignments WHERE admin_user_id = '<uuid>';
DELETE FROM auth.users WHERE id = '<uuid>';
```

---

## 9. Known intentional behaviors (not bugs)

- **No `view_confidential_notes` access to risk scores.** The score is derived from confidential signals; surfacing aggregates to oversight reveals the underlying patterns. A future surface for principals will require a separate privacy review — do NOT "fix" the asymmetry without that review.
- **No compute button on the counselor UI.** Compute is super-admin only via the sweep endpoint. The counselor watchlist is read-only over precomputed rows.
- **Backfill is `is_stale=TRUE` by default.** Every row needs at least one compute pass before its scores are honest. `computed_at IS NULL` means "never computed".
- **New students get a row on first signal write, not at INSERT time.** A brand-new student with zero signals doesn't belong on the watchlist (it would just be 0 risk by default).
- **`students` UPDATE OF section_id refreshes `student_risk_scores.section_id` immediately** via the m5.3 trigger, so the watchlist section filter never drifts from the live source.
- **`attendance_date` (not `recorded_at`) is the time anchor for absence/late counts.** A teacher backfilling old absences today does NOT push them into the 30-day window.
- **Engagement risk is +40 for "no sessions in 30 days"** by formula — a brand-new student with zero signals starts at total ≈ 14, not 0. Intentional: lack of contact IS a signal.

---

## 10. Tech debt (deferred from Sprint 5)

- **Cron sweep is not configured yet.** All sweeps are manual via `POST /api/admin/risk-scores/sweep` triggered by super_admin. Once the manual operational pattern is validated for a day or two, add Vercel cron / pg_cron config — a small follow-up migration / config commit.
- **No history table** (`student_risk_score_history`). Sprint 6 (reporting) is where trend lines would live; current schema captures the latest snapshot only.
- **Lazy fallback in the watchlist endpoint is NOT wired.** If the cron is delayed, rows stay stale and the watchlist filters them out by default. Counselor sees the message but cannot force a compute themselves. Acceptable for v1 — by-design separation.
- **`view_confidential_notes` oversight surface for risk scores** is on hold pending a privacy review (see section 9).
- **`decrypt_session_content` RPC + decrypt audit** is the last deferred surface from Sprint 4 — a separate mini-sprint with its own security review.

---

## 11. Sign-off

When complete, log to `00-المراقبة.md`:

```
| YYYY-MM-DD | Sprint 5 manual QA passed on staging — risk score + watchlist | (sign-off) |
```

| # | Section | Result | Notes |
|---|---|---|---|
| 0 | Pre-flight | _PASS / FAIL_ |  |
| 1 | RLS scope | _PASS / FAIL_ |  |
| 2 | Staleness triggers (11 events) | _PASS / FAIL_ |  |
| 3 | Sweep endpoint | _PASS / FAIL_ |  |
| 4 | Compute RPC spot-check | _PASS / FAIL_ |  |
| 5 | Watchlist API | _PASS / FAIL_ |  |
| 6 | Watchlist UI | _PASS / FAIL_ |  |
| 7 | Network / no-leak audit | _PASS / FAIL_ |  |
| 8 | Cleanup | _PASS / FAIL_ |  |
