# Sprint 3 manual QA — incidents workflow

Run after `npm run smoke:sprint3` returns all-PASS. The smoke proves the
HTTP surface; this checklist proves the UI flows. Target time: ~10 min.

If a step fails, log it with the section number + steps to repro +
expected vs actual + any Console / Network error.

---

## 0. Pre-flight

- [ ] Smoke passed: `npm run smoke:sprint3` → exit 0, all PASS (or SKIP for unsupported one-account paths).
- [ ] Browser DevTools open on Console + Network tabs.
- [ ] Test accounts:
  - **VP-full / super_admin** (you submit + review) — `basem902@gmail.com` ✓
  - **VP-view** *(optional, recommended)* — admin with `review_teacher_incidents` flag but NOT super_admin. Exercises the flag-only review path.
  - **Counselor** *(optional)* — admin with `persona='counselor'`. Exercises read-only review queue.
  - **Teacher** — any active teacher account with `teacher_section_assignments`. Exercises the submitter path.
- [ ] At least one active student in caller's scope (use `SMOKE_STUDENT_ID` from smoke setup).

---

## 1. `/dashboard/teacher/incidents` — مخالفاتي (teacher list)

Sign in as **teacher** (or admin who can submit).

- [ ] Page loads under 1 second.
- [ ] Header gradient renders (blue → cyan) with "مخالفاتي" + count.
- [ ] 3 tabs visible: قيد المراجعة / تم البت / الكل.
- [ ] Active tab shows count badge.
- [ ] "تسجيل مخالفة جديدة" button visible top-right.
- [ ] "تحديث" button spins on click.
- [ ] Empty state messages render correctly for each tab when no rows.

If incidents exist:
- [ ] Each card shows: student name + status badge + severity badge + type + date + relative time + description.
- [ ] On a `submitted` incident < 30 min old: "سحب" button visible.
- [ ] On a `submitted` incident > 30 min old: no "سحب" button.
- [ ] On `dismissed` / `actioned` / `escalated`: shows reviewer name + decision note in a sub-card.

Sign in as **staff** or **viewer** (or any non-teacher/non-admin role) — if such account exists:
- [ ] Page renders the "لا تملك صلاحية" banner instead of the list.

---

## 2. `/dashboard/teacher/incidents/new` — submission form

Sign in as **teacher**.

### Empty form
- [ ] Header (blue → cyan) renders.
- [ ] Form shows 5 fields: student, date (defaults today), type (defaults behavior), severity (4 buttons — medium active), description (textarea).
- [ ] "تسجيل المخالفة" button disabled while student missing OR description < 20 chars.
- [ ] "رجوع" link goes to `/dashboard/teacher/incidents`.

### Student picker
- [ ] Type ≥ 2 chars in the search box → dropdown opens with up to 10 results.
- [ ] Results show student name + grade/section if available.
- [ ] Click a student → selection shown above the search input with "تغيير" link.
- [ ] "تغيير" → returns to search input.
- [ ] **Scope check**: as a teacher, you should ONLY see students from your assigned sections. If you see students you don't teach, REGRESSION (the dedicated endpoint should scope you).

### Validation
- [ ] Type < 20 chars in description → submit button stays disabled.
- [ ] Counter shows `N / 2000` and turns red when description too short.
- [ ] Choose future date → blocked by `max={today}` on the date input.

### Submit
- [ ] Pick a student, fill description (20+ chars), choose severity, click "تسجيل المخالفة".
- [ ] Confirmation modal opens with student name + 30-min withdraw notice.
- [ ] Click "تأكيد الإرسال" → toast "تم تسجيل المخالفة — ستُراجَع قريبًا" + redirect to `/dashboard/teacher/incidents`.
- [ ] New incident appears at top of "قيد المراجعة" tab.

### Server validation
- [ ] Try submitting for a student outside your scope (manual via Network tab: replace student_id with random number, replay POST). Expect **403** with generic "لا تملك صلاحية..." (NO 404 — that would leak existence to teachers).

---

## 3. `/dashboard/vp/incidents/review` — review queue

Sign in as **VP-full** (super_admin or admin + `review_teacher_incidents`).

### List
- [ ] Header (purple → indigo) renders.
- [ ] Severity filter row shows: الكل / منخفضة وأعلى / متوسطة وأعلى / عالية وأعلى / حرجة وأعلى.
- [ ] Cards sorted by severity DESC then submitted_at ASC (oldest critical first).
- [ ] Each card: student name + critical "عاجل" pill (if applicable) + severity badge + status badge + type + date + submitter name + relative time + full description.
- [ ] 3 action buttons: "سجّل إجراء" (green), "ارفض" (red), "صعِّد" (gray, disabled with tooltip "يُفعَّل في المرحلة 4").

### Severity filter
- [ ] Click "عالية وأعلى" → only `high` + `critical` rows remain.
- [ ] Click "الكل" → all rows return.

### Action flow
- [ ] Pick a row submitted by SOMEONE ELSE (you cannot review your own).
- [ ] Click "سجّل إجراء" → modal opens (green header).
- [ ] Modal shows leave summary + action_taken textarea + parent_notified checkbox.
- [ ] Submit blocked while action_taken < 10 chars.
- [ ] Check "إشعار ولي الأمر" + fill action_taken (10+ chars) + "تأكيد الإجراء" → toast "تم تسجيل الإجراء" + row disappears from queue.
- [ ] Switch to teacher account (submitter) → "مخالفاتي" → the incident is now in "تم البت" tab with status `actioned` + your action note visible + green "تم إشعار ولي الأمر" pill.

### Dismiss flow
- [ ] Pick another row not your own.
- [ ] Click "ارفض" → modal opens (red header, no parent_notified checkbox).
- [ ] Fill review_notes + "تأكيد الرفض" → row disappears from queue.
- [ ] Teacher view confirms status `dismissed` + your review notes.

### Self-review guard
- [ ] As VP-full, submit an incident yourself (use `/dashboard/teacher/incidents/new`).
- [ ] Return to `/dashboard/vp/incidents/review`. The incident you just submitted **should NOT appear** in the queue (server filters `submitted_by != auth.uid()`).
- [ ] If you bypass UI (curl PATCH dismiss against own incident_id) → expect **403** "لا يمكنك مراجعة مخالفة قدّمتها بنفسك".

### Escalate
- [ ] "صعِّد" button is disabled.
- [ ] Hover → tooltip "يُفعَّل في المرحلة 4 (الحالات والجلسات)".

---

## 4. Counselor read-only path *(optional — needs counselor account)*

Sign in as **counselor**.

- [ ] `/dashboard/vp/incidents/review` loads (counselor has view access).
- [ ] Banner "وضع العرض فقط — البتّ يتطلب صلاحية review_teacher_incidents" visible.
- [ ] "سجّل إجراء" + "ارفض" buttons disabled, tooltip "يتطلب صلاحية review_teacher_incidents".
- [ ] "صعِّد" still disabled with Sprint 4 tooltip.
- [ ] Cards show only students in counselor's `counselor_assignments` scope (verify by submitting an incident for an out-of-scope student via teacher account, then check counselor's queue does NOT include it).

If you don't have a counselor account: log as **SKIP: no counselor account**.

---

## 5. Withdraw flow

Sign in as **teacher**.

- [ ] Submit a new incident.
- [ ] Immediately go to "مخالفاتي" → "قيد المراجعة" → click "سحب" on the new row.
- [ ] Modal shows time-remaining countdown.
- [ ] Click "تأكيد السحب" → toast "تم سحب المخالفة" + row disappears.
- [ ] Refresh — confirms row gone from all tabs.

**30-min boundary** *(optional, manual time check)*:
- [ ] Submit an incident. Wait > 30 min (or manually update `submitted_at` in DB to 31 min ago).
- [ ] "سحب" button no longer visible (UI hides it).
- [ ] Force-DELETE via Network tab → expect **409** "انتهت مهلة السحب".

---

## 6. Cross-screen consistency

After all flows:
- [ ] Open `/dashboard/vp/morning` → "مخالفات بانتظار المراجعة" placeholder still shows 0 (Sprint 4 placeholder).
- [ ] Open `/dashboard/vp/operations-report` → "مخالفات تمت معالجتها" still 0 placeholder.
- [ ] No console errors during any of the above.
- [ ] No 500/503 in Network tab.

---

## 7. Known intentional behaviors (not bugs)

- Sprint 4 placeholders (incidents_actioned, cases_opened) return 0 — student_cases table doesn't exist yet.
- "صعِّد" button disabled — м3.9 endpoint deferred to Sprint 4.
- Reviewer queue excludes caller's own submissions (no self-review).
- Self-dismiss/self-action via direct PATCH → 403 even for super_admin.
- 30-min withdraw window — super_admin bypasses (admin override).
- Teacher CANNOT withdraw another teacher's incident (403).
- Status='submitted' is the only withdrawable state. Even super_admin cannot delete reviewed incidents via this endpoint.

---

## 8. Sign-off

When complete, log to the tracker:

```
| YYYY-MM-DD | Sprint 3 manual QA passed on staging — incidents workflow | (sign-off) |
```

| # | Section | Result | Notes |
|---|---------|--------|-------|
| 0 | Pre-flight | _PASS / FAIL_ |  |
| 1 | Teacher list | _PASS / FAIL_ |  |
| 2 | Submission form | _PASS / FAIL_ |  |
| 3 | VP review queue | _PASS / FAIL_ |  |
| 4 | Counselor read-only | _PASS / FAIL / SKIP_ |  |
| 5 | Withdraw flow | _PASS / FAIL_ |  |
| 6 | Cross-screen consistency | _PASS / FAIL_ |  |
