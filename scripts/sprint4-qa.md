# Sprint 4 manual QA — counselor cases + encrypted sessions

Run after the harness scripts pass (`sprint4-rls-smoke.sql` + the
preview setup runs cleanly). Smoke proves DB & HTTP shape; this
checklist proves the UI flows + the encryption + audit invariants.
Target time: ~15 min on a fresh laptop.

If a step fails, log it with the section number + steps to repro +
expected vs actual + any Console / Network error.

---

## 0. Pre-flight

### Env (both main + worktree if you use the worktree dev server)

- [ ] `.env.local` carries: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, **`COUNSELING_SESSION_KEY` ≥ 32 chars**.
- [ ] Generate with `openssl rand -hex 32` (hex avoids `+ / =` parser ambiguity).
- [ ] **If running `npm run dev` from the worktree cwd**, copy `.env.local` there too — Next.js's `.env.local` auto-load reads the cwd file, not main's.
- [ ] DB connection string in shell or `~/.pgpass` for the staging psql tests.

### Seeded fixtures

- [ ] Run `node --env-file=.env.local scripts/sprint4-ui-preview-setup.mjs`.
  - Creates 3 users: `smoke.super.4ui@test.local`, `smoke.counselor.4ui@test.local`, `smoke.teacher.4ui@test.local` (passwords echoed in the run output).
  - Seeds 4 in-scope cases (one per status) + 1 out-of-scope + 1 plan + 1 session + 1 confidential note + 1 case_history row.
  - Output echoes the open case id (used in sections 4-7 below).

### Browser

- [ ] DevTools open on Console + Network tabs.

---

## 1. RLS smoke (DB only)

Proves the م4.7 access model end-to-end at the SQL layer.

- [ ] Run `psql -f scripts/sprint4-rls-smoke.sql` from main (or worktree — same file).
- [ ] All 10 probes PASS: P1 (teacher cannot ins conf), P2 (counselor-in-scope can ins conf), P3a/P3b (in-scope sees / out-of-scope blocked), P4a/P4b (flag-holder reads, no write), P5 (counselor cannot move session.case_id outside scope), P6a/P6b/P6c (only super_admin reads `confidential_access_log`).
- [ ] No leftover rows printed in the transaction summary — `ROLLBACK` cleaned up.

---

## 2. `/dashboard/counselor` — workspace shell (م4.18)

Sign in as **counselor**.

- [ ] `/dashboard` auto-redirects to `/dashboard/counselor`.
- [ ] Header: gradient teal/indigo + name + scope badge "تشرف على N شعبة + M صف" (1 شعبة on the seed).
- [ ] 5 KPI cards: حالات نشطة, خطط متابعة نشطة, جلسات آخر ٧ أيام, ملاحظات سرية آخر ٧ أيام, إجمالي الحالات.
- [ ] Recent cases card (top 5): severity badge, case_number, title line-clamped, student name, status.
- [ ] Recent sessions card: badge "بدون فك تشفير" visible; each row shows content_preview with the small label "ملخص غير مشفّر كتبه المرشد".
- [ ] Quick actions: "لوحة الحالات" is the **only** enabled action; جلسة جديدة / ملاحظة سرية جديدة / خطة متابعة جديدة are dashed-border disabled with tooltips.

Sign in as **super_admin**.

- [ ] `/dashboard/counselor` loads with scope badge "كل المدرسة"; counts cover the whole school.

Sign in as **teacher** (or any non-counselor non-super).

- [ ] Direct hit on `/dashboard/counselor` → middleware redirects to `/teacher`.
- [ ] Direct `fetch('/api/counselor/workspace-summary')` returns **403**.

---

## 3. `/dashboard/counselor/cases` — case board Kanban (م4.19)

Sign in as **counselor**.

- [ ] 4 columns visible: مفتوحة / قيد المعالجة / محلولة / مغلقة.
- [ ] Each seeded case shows in its correct column with the correct severity badge color.
- [ ] Cards ordered by `updated_at DESC` inside a column.
- [ ] Read-only notice: "تغيير الحالة + الإجراءات تأتي في م4.20" in the header.
- [ ] No drag-grip / cursor-grab. Cards are pure `<Link>`.
- [ ] Severity dropdown: set "حرجة" → Network shows new request `?severity=critical` → only 1 card visible.
- [ ] Search input: type a partial title or case number → **NO** network request; client-side filter only.
- [ ] Counter "X من Y" updates correctly with both filters.
- [ ] Click a card → navigates to `/dashboard/counselor/cases/[id]` with real data (not 404).

Sign in as **super_admin**.

- [ ] All 4 seeded in-scope cases visible. The 1 out-of-scope case (different section) is also visible (super sees everything).

Sign in as **teacher**.

- [ ] Direct hit blocked at middleware (302 → `/teacher`).
- [ ] Direct `fetch('/api/counselor/cases')` returns **403**.

---

## 4. `/dashboard/counselor/cases/[id]` — case detail timeline (م4.20)

Sign in as **counselor**. Open the seeded open case.

- [ ] Header: case_number + title + 3 badges (severity / status / case_type). `is_reopened` badge only if true.
- [ ] Description block renders below the header.
- [ ] If status='resolved' or 'closed': resolution / close_reason side-by-side block.
- [ ] Notice banner: "عرض قراءة فقط. الإجراءات … م4.21+. زر «عرض محتوى الجلسة المشفّر» مُعطَّل حتى تنتهي مراجعة إدارة المفاتيح".
- [ ] 4 summary chips (sessions / plans / notes / history) with correct counts from the seed.
- [ ] Merged timeline section: events sorted DESC by their respective timestamps.
- [ ] Each event card has its type-specific icon + color tone + author name.
- [ ] Session card: "ملخص غير مشفّر كتبه المرشد" label + **disabled** "عرض محتوى الجلسة المشفّر" button with tooltip "ينتظر key-management review".
- [ ] Confidential note: tone rose + ShieldAlert icon + badge "ملاحظة سرية".
- [ ] Status change history line uses RTL semantics: `<from> ← <to>` reads left-to-right as "from went to to" for Arabic readers.

Navigate to a NON-existent or out-of-scope case id (e.g. the seed's out-of-scope case id).

- [ ] Page shows "الحالة غير موجودة أو خارج نطاقك" + back link to `/dashboard/counselor/cases`.
- [ ] Network: API responded **404** with the same Arabic message.

---

## 5. Add note (م4.21.1)

On the case detail page:

- [ ] Inline "+ إضافة ملاحظة" button visible above the timeline.
- [ ] Click → form expands with textarea + 2 radios (إيجابية/سلبية) + checkbox "سرية (تُحجَب عن غير المرشدين)" **checked by default**.
- [ ] Type ≥ 1 char. "حفظ الملاحظة" enables.
- [ ] Submit:
  - Network: `POST /api/counselor/cases/[id]/notes` → **201**.
  - Toast "تمت إضافة الملاحظة".
  - Form closes + resets.
  - Timeline events count + notes chip both increment by 1.
  - The new note appears at the top with "ملاحظة سرية" + author name.

Defensive checks:

- [ ] Direct fetch from a teacher session → **403**.

---

## 6. Add plan (م4.21.2)

On the case detail page:

- [ ] Inline "+ إضافة خطة متابعة" button visible.
- [ ] Form fields: title (counter `/200`, min 10), description (counter `/2000`, min 20), target_date (optional), milestones rows.
- [ ] "إضافة معلَم" appends a row with [date | description | ×]. Empty rows are dropped client-side before POST.
- [ ] Submit button disabled while title < 10 OR description < 20.
- [ ] Submit:
  - `POST /api/counselor/cases/[id]/plans` → **201**.
  - Toast "تمت إضافة الخطة".
  - Timeline events + plans chip increment by 1.
  - New plan card shows: badge "خطة متابعة" + "نشطة" + N milestones + target_date if set + author.

Defensive checks:

- [ ] Direct fetch with `student_id` injected in body → server ignores; the sync trigger forces `case.student_id` (verify via psql by inspecting the inserted row).

---

## 7. Add session — encrypted (م4.21.3)

On the case detail page:

- [ ] Inline "+ تسجيل جلسة جديدة" button visible.
- [ ] Form fields:
  - session_type select + session_date input (defaults to today in Riyadh) + duration_minutes (1-240).
  - topic input (note: "(مرئي للجميع في نطاق الرؤية — لا تكتب أسرارًا)").
  - Content textarea with teal double-border + label "(يُشفَّر تلقائيًا قبل الحفظ — pgp_sym_encrypt)".
  - **Rose double-border warning block** above content_preview: "⚠ ملخص غير مشفّر — لا تكتب أسرارًا" with bold prescriptive guidance.
  - content_preview textarea (≤ 160 with counter inside the warning block).
- [ ] Submit button shows "جاري التشفير والحفظ…" while in flight.
- [ ] Submit:
  - `POST /api/counselor/cases/[id]/sessions` → **201**.
  - Response body is **exactly `{"data":{"id":<N>}}`** — nothing else.
  - Toast "تمت إضافة الجلسة".
  - Form closes; content state cleared.
  - Timeline events + sessions chip increment by 1.
  - The new session appears with topic + session_type + duration; content_preview shown with the same label as on the workspace shell.

Env-failure path:

- [ ] Temporarily comment out `COUNSELING_SESSION_KEY` in `.env.local`, restart dev, retry submit.
  - Response: **503** with "خدمة التشفير غير مهيأة — اتصل بمسؤول النظام".
  - Server log: "[counseling-session] COUNSELING_SESSION_KEY missing — refusing write". The value itself is NOT logged.
- [ ] Restore the env var + restart before continuing.

---

## 8. Network no-leak audit

Run a free-form session (or replay one of section 7) and inspect Network for every API touched. The following fields must NEVER appear in any client-visible response:

- [ ] `content_encrypted` (bytea) — verify on:
  - GET `/api/counselor/workspace-summary` → `recent_sessions[]` has no `content_encrypted`.
  - GET `/api/counselor/cases` → list view never returns encrypted content (it's not selected).
  - GET `/api/counselor/cases/[id]` → `sessions[]` rows have no `content_encrypted`.
  - POST `/api/counselor/cases/[id]/sessions` → 201 body is only `{data:{id}}`.
- [ ] No plaintext `content` echo on the POST response.
- [ ] No echo of `p_key` anywhere; not in network, not in console, not in error messages.
- [ ] 404 on out-of-scope case → message is generic ("غير موجودة أو خارج نطاقك"), no info about whether the case actually exists.

Search the page DOM after a session submit:

- [ ] The exact plaintext you typed (e.g. a unique marker) is NOT present in `document.body.innerText` after the form resets.

---

## 9. Audit log check

Sign in as **super_admin**. Run via psql (or build a quick read endpoint later):

```sql
SELECT id, accessed_by, table_name, record_id, action, ip_address,
       LEFT(user_agent, 30) AS ua_short, accessed_at
FROM confidential_access_log
ORDER BY accessed_at DESC
LIMIT 5;
```

- [ ] The session(s) you wrote in section 7 each have ONE row with:
  - `action='write'`
  - `accessed_by = <counselor uuid>`
  - `table_name='counseling_sessions'`
  - `record_id = <session id>` (text)
  - `ip_address` = your local IP (or `::1` for localhost; `null` is acceptable behind some proxies)
  - `user_agent` includes the browser string

Sign in as **counselor** (the same user).

- [ ] Hit any read endpoint that exposes `confidential_access_log` — there isn't one yet, but a direct `fetch('/rest/v1/confidential_access_log')` via the user-bound client returns **0 rows** (RLS SELECT policy = super only).
- [ ] psql SET LOCAL ROLE authenticated + JWT claim of the counselor → same: 0 rows.

---

## 10. Cleanup + sign-off

- [ ] Run `node --env-file=.env.local scripts/sprint4-ui-preview-cleanup.mjs`.
- [ ] Verify the cleanup output reports:
  - Removed all seeded cases (N >= 5, exact depends on what was added during QA).
  - Removed all seeded notes (N >= 1).
  - Removed audit log rows attributed to test users.
  - Removed 3 test users.

Verify on staging via psql:

```sql
SELECT 'cases' AS t, count(*)::text FROM student_cases WHERE title LIKE 'M4.18 PREVIEW SMOKE%'
UNION ALL SELECT 'notes', count(*)::text FROM student_notes WHERE text LIKE 'M4.18 PREVIEW SMOKE%'
UNION ALL SELECT 'users', count(*)::text FROM user_profiles WHERE user_id IN (
  SELECT id FROM auth.users WHERE email LIKE 'smoke.%.4ui@test.local')
UNION ALL SELECT 'access_log_orphans', count(*)::text FROM confidential_access_log
  WHERE accessed_by IN (SELECT id FROM auth.users WHERE email LIKE 'smoke.%.4ui@test.local');
```

- [ ] All counts = `0`.

---

## 11. Known intentional behaviors (not bugs)

- `confidential_access_log` writes ONLY happen on `counseling_sessions` creation. notes/plans do not emit audit rows — that's a deliberate scope decision (the log is for encrypted-content access, not generic writes).
- Hydration warning on the document element appears in dev — sourced from `themeInitScript` in `app/layout.tsx`. `suppressHydrationWarning` documents it as intentional. Not present in production builds.
- Session POST response is `{data:{id}}` only; no `created_at` / `session_date` echo. The UI invalidates and refetches the full case detail to get the new row's metadata.
- "تغيير الحالة" (state-machine transitions) is NOT implemented yet — deferred to a future micro-phase. The notice banner on case detail says so.
- `decrypt_session_content()` RPC is deferred pending the key-management review — there is currently NO way to read decrypted session content through the app.
- `view_confidential_notes` flag holders can read confidential notes (proved in the RLS smoke), but there's no dedicated UI surface for them yet — they reach rows only via direct case-detail URLs, which will be the case until the م5+ oversight surface lands.

---

## 12. Sign-off

When complete, log to `00-المراقبة.md`:

```
| YYYY-MM-DD | Sprint 4 manual QA passed on staging — counselor cases + encrypted sessions | (sign-off) |
```

| # | Section | Result | Notes |
|---|---|---|---|
| 0 | Pre-flight | _PASS / FAIL_ |  |
| 1 | RLS smoke | _PASS / FAIL_ |  |
| 2 | Workspace shell (م4.18) | _PASS / FAIL_ |  |
| 3 | Case board Kanban (م4.19) | _PASS / FAIL_ |  |
| 4 | Case detail timeline (م4.20) | _PASS / FAIL_ |  |
| 5 | Add note (م4.21.1) | _PASS / FAIL_ |  |
| 6 | Add plan (م4.21.2) | _PASS / FAIL_ |  |
| 7 | Add session — encrypted (م4.21.3) | _PASS / FAIL_ |  |
| 8 | Network no-leak | _PASS / FAIL_ |  |
| 9 | Audit log | _PASS / FAIL_ |  |
| 10 | Cleanup | _PASS / FAIL_ |  |
