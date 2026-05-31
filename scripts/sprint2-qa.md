# Sprint 2 manual QA — staging pass

Run this **after** `npm run smoke:sprint2` returns all-pass. The smoke
proves the HTTP surface; this checklist proves the UI flows on top of
it. Target time: 15-20 minutes.

If anything below fails, capture: URL, what you did, expected vs actual,
browser DevTools Network / Console snapshots. Don't fix in-session —
log findings, finish the pass, then triage.

---

## 0. Pre-flight

- [ ] Smoke passed: `npm run smoke:sprint2` → exit 0, all 11 probes PASS (skip is OK for write phases if test data is set up).
- [ ] Browser DevTools open on Console + Network tabs (catch silent failures).
- [ ] Test accounts available:
  - **VP-full** — `role='admin'`, `persona='vice_principal'`, flags: `view_morning_dashboard` + `manage_substitutions` + `approve_teacher_leave`. Exercises every write path.
  - **VP-view** *(optional, recommended)* — same role/persona but **without** `manage_substitutions` and `approve_teacher_leave`. Proves view-only mode renders correctly.
- [ ] At least one teacher with `is_active=true` and ≥1 `duty_type='class'` row in `teacher_schedule` for today (Sun-Thu in KSA). The substitution flow needs this.
- [ ] At least one *other* active teacher (for the substitute pick).

---

## 1. `/dashboard/vp/morning` — لوحة الصباح

Sign in as **VP-full**.

- [ ] Page loads under 1 second (no infinite skeleton).
- [ ] Header gradient renders (purple → indigo) with greeting + Arabic weekday + today's date.
- [ ] "تحديث" button spins (`animate-spin`) on click and stops when refetch settles.
- [ ] 6 pulse cards visible: غياب المعلمين، حصص متبقّية، حصص مُسنَدة، إجازات بانتظار البتّ، نقاط إشراف شاغرة، استئذان اليوم.
- [ ] Card tone changes to green when count = 0 (e.g. "لا غياب"), red/amber/etc. when > 0.
- [ ] Coverage bar appears **only** when `total_needed > 0` (skipped if no absences today).
- [ ] Absent-teacher ribbon appears **only** when `absent_today > 0`. Names + reason badges legible.
- [ ] Sprint 3/4 placeholder cards rendered dim (`opacity-60`) with "يُفعَّل مع المرحلة X".
- [ ] Sign out, sign in as **VP-view** → page still renders, no errors. (View-only is a valid mode here — no write actions on this screen.)

---

## 2. `/dashboard/vp/substitutions` — حصص الانتظار

Sign in as **VP-full**.

### Empty state
- [ ] If no absences today: big green CheckCircle + "لا يوجد معلمون غائبون اليوم" — no broken 3-column grid.

### Populated state (create an absence first via the morning page or SQL)
- [ ] Left column: absent teachers list. Each card shows name + reason (if any) + `assigned/class_periods` badge.
- [ ] Click an absent teacher → middle column populates with their periods for today, sorted by period_number.
- [ ] Period rows differentiate visually:
  - `duty_type='class'` → actionable, amber if no sub / green if has sub
  - `duty_type='monitoring'` → muted, not clickable
  - `duty_type='free'` → muted, not clickable
- [ ] Click a class period → right column shows suggestions (or "لا يوجد بدلاء متاحون").
- [ ] Each candidate card shows: rank #N, name, reasoning text, score badge, 3 stats badges (حصص اليوم / انتظار الأسبوع / إشراف).
- [ ] Click "اختر" on a candidate → toast "تم إسناد البديل" + right column closes + middle column shows the new substitute on that period (in green).
- [ ] **Re-pick test**: select the same period again. Right column now shows the amber warning box about resetting WhatsApp/ack state + the previously-picked candidate marked "البديل الحالي" with disabled "مُسنَد" button.
- [ ] Pick a different candidate → toast + period updates.

### View-only test (VP-view)
- [ ] Page still loads + can navigate columns + suggestions open.
- [ ] Yellow banner at top: "وضع العرض فقط — يتطلب الإسناد صلاحية manage_substitutions".
- [ ] Every "اختر" button on candidate cards is disabled with tooltip "يتطلب صلاحية manage_substitutions".

---

## 3. `/dashboard/vp/teacher-leaves` — إجازات المعلمين

Sign in as **VP-full**.

### Tabs + filters
- [ ] 3 tabs visible: قيد البتّ (default selected) / مُعتمَدة / آخر 200 طلب.
- [ ] Active tab shows count badge (e.g. "5") next to its label.
- [ ] Date range filters (from / to) update the table on change. Clear button (X) appears only when at least one filter is set.
- [ ] Footnote next to filters: "تداخل: الإجازات التي تتقاطع مع النطاق المحدد".

### Table
- [ ] 8 columns: المعلم / النوع / الفترة / الأيام / السبب / الحالة / تاريخ التقديم / إجراءات.
- [ ] Same-day leaves render as a single date (no `←`). Multi-day render as `start ← end`.
- [ ] Status badge has correct color: pending=amber, approved=green, rejected=red, cancelled=gray.
- [ ] On pending tab: each row shows "اعتمد" (green) and "ارفض" (red) buttons.
- [ ] On approved/rejected tabs: actions column shows `decision_note` (or `—`) and "بواسطة <name>" under the status.

### Create-leave modal (م2.16)
- [ ] Header button "تسجيل طلب جديد" visible.
- [ ] Click → modal opens with purple gradient header.
- [ ] Teacher dropdown loads with all active teachers, sorted Arabic.
- [ ] Pick a teacher + set start_date + end_date+2 days → "المدة: 3 أيام" preview appears.
- [ ] Set end_date < start_date → red inline error "تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية". Submit button disabled.
- [ ] Reason textarea: type some text, counter at bottom right updates `N / 2000`.
- [ ] Click "تسجيل الطلب" → toast "تم تسجيل طلب الإجازة" + modal closes + tab flips to "قيد البتّ" + new row appears at top.

### Approve flow (the destructive one)
- [ ] On a multi-day pending leave: click "اعتمد". Modal opens.
- [ ] Modal shows leave summary + amber warning box: "الاعتماد سيُنشئ **N** أيام غياب فعلية ويؤثّر على حصص الانتظار..." with the actual day count.
- [ ] Add optional decision_note. Click "اعتماد".
- [ ] Toast "تم اعتماد الطلب" + modal closes + row moves to "مُعتمَدة" tab.
- [ ] **Cross-screen check**: open `/dashboard/vp/morning` in a new tab → if the leave overlaps today, the absent_today count should now include this teacher (the approval just inserted `daily_teacher_absences` rows).
- [ ] Run the SQL from `scripts/sprint2-smoke.README.md` (idempotency section) to confirm only 1 absence per (teacher, date) was created — no duplicates.

### Reject flow
- [ ] On a pending leave: click "ارفض". Modal opens (red header, no warning box).
- [ ] Click "رفض" without note. Toast + row moves to "آخر 200 طلب" tab with status=rejected.

### View-only test (VP-view)
- [ ] Page renders + table visible + filters work.
- [ ] "تسجيل طلب جديد" button is gray/disabled with tooltip "يتطلب صلاحية approve_teacher_leave".
- [ ] On pending rows: "اعتمد" / "ارفض" buttons gray/disabled with same tooltip.

---

## 4. `/dashboard/vp/operations-report` — تقرير العمليات

Sign in as **VP-full**.

### Date control
- [ ] Defaults to today (KSA). Header date subtitle shows weekday + date.
- [ ] Quick buttons: "اليوم" / "أمس" / "بداية الأسبوع". Active button highlighted purple.
- [ ] Click "أمس" → date input updates + report refetches + body shows yesterday's data.
- [ ] Type a future date in the picker → report loads (future is allowed).
- [ ] Type a clearly-bad date (e.g. `2026-02-30`) — should NOT be possible via the picker, but if you bypass via URL: API returns 400 → page shows error card with retry button.

### Sections
- [ ] 5 overview pills row.
- [ ] **Absences** card: full list (NOT capped at 10 like morning). Each row: name + reason badge + "العودة المتوقعة" (if set).
- [ ] **Substitutions** card: coverage % + bar with correct color + 4 stat tiles.
- [ ] **Leaves** card: 4 stats (مُعتمَدة/مرفوضة في اليوم + نشطة/قيد البتّ overlapping).
- [ ] **Supervision** card: if `empty_count=0` → green "كلها مغطّاة"; if > 0 → named list of empty posts.
- [ ] **Dismissals** card: total + horizontal bars per reason, sorted descending.
- [ ] Sprint 3/4 placeholders dimmed.

### Print
- [ ] Click "طباعة" → browser print dialog opens.
- [ ] In print preview: sidebar / nav hidden. Cards render on white background. Print-only header (title + date) at top.

### View-only test
- [ ] Already view-only (read-only screen) — VP-view should have identical experience to VP-full. No "وضع العرض فقط" banner needed.

---

## 5. End-to-end flows (cross-screen)

Sign in as **VP-full**. Run flows in order — later flows depend on earlier state.

### Flow A: mark absence → see in morning + substitutions

1. On `/dashboard/vp/substitutions`: confirm no absence row for the test teacher today.
2. Use SQL or another admin screen to insert an absence for the test teacher today.
3. Refresh `/dashboard/vp/morning` → absent count incremented, ribbon shows the teacher.
4. Refresh `/dashboard/vp/substitutions` → teacher appears in left column.

### Flow B: assign substitute → see coverage update

1. On `/dashboard/vp/substitutions`: pick the teacher from Flow A.
2. Click a class period → suggestions appear.
3. Pick a candidate → toast + period now shows the substitute.
4. Refresh `/dashboard/vp/morning` → "حصص مُسنَدة" pill incremented, "حصص متبقّية" decremented, coverage bar moves toward 100%.
5. Refresh `/dashboard/vp/operations-report` (today) → Substitutions section: `assigned_count` and `unique_substitutes_count` reflect Flow B.

### Flow C: leave workflow end-to-end

1. On `/dashboard/vp/teacher-leaves`: open create modal, submit a leave for the test teacher starting **tomorrow**, 2 days long.
2. Confirm it appears on the "قيد البتّ" tab.
3. Approve it. Confirm move to "مُعتمَدة" tab.
4. Open `/dashboard/vp/operations-report`. Set the date picker to tomorrow.
5. Confirm: under "نشاط الإجازات" → `decisions_on_date.approved=1` AND `active_overlapping ≥ 1`. Under "المعلمون الغائبون" → the teacher is listed for tomorrow.

### Flow D: double-book prevention

1. On `/dashboard/vp/substitutions`: pick a teacher with at least 2 class periods today.
2. For period 1: assign substitute X.
3. For period 2 (different absence — needs a second absent teacher with class at the same period_number): try to assign the same substitute X for the same period_number.
4. Expected: API returns 400/409 (friendly Arabic error). Toast shows the message. No row inserted.
5. SQL check: `SELECT COUNT(*) FROM substitution_assignments WHERE substitute_user_id='X' AND assignment_date=today AND period_number=Y;` returns exactly 1.

### Flow E: re-pick resets notification state

1. On `/dashboard/vp/substitutions`: pick a teacher with an assigned substitute.
2. Manually set `whatsapp_sent_at = now()` on that row via SQL.
3. Re-pick a different substitute via the UI.
4. SQL check: `whatsapp_sent_at` and `acknowledged_at` are now NULL on the updated row.

### Flow F: VP-view negative path

1. Sign out, sign in as **VP-view**.
2. Confirm all 4 sidebar entries appear (they require `view_morning_dashboard` — VP-view has it).
3. Navigate to substitutions: yellow banner + disabled "اختر" buttons.
4. Navigate to teacher-leaves: disabled "تسجيل طلب جديد" + disabled action buttons.
5. Navigate to morning + operations-report: identical UX to VP-full (no writes on these).

---

## 6. Known intentional behaviors (not bugs)

- "آخر 200 طلب" tab is capped server-side at 200 — pagination is tech debt.
- Morning dashboard refreshes every 5 minutes automatically. Manual refresh is also available.
- Substitutions does NOT auto-refresh (transactional UI — user-triggered only).
- Operations report works for any past/future date — no date-range restriction.
- Approving a leave does NOT overwrite existing manual absence rows for the same (teacher, date). `ignoreDuplicates: true` in the fan-out.
- Re-picking a substitute resets `whatsapp_sent_at` and `acknowledged_at` (intentional — the new sub hasn't been notified yet).
- Sprint 3/4 placeholder cards return 0 — the underlying tables don't exist yet.
- The "تسجيل طلب جديد" form does NOT include a teacher self-service flow. Teachers can't submit their own leaves through this UI yet (no /dashboard/teacher/leaves screen).
- The smoke script accumulates one rejected leave row per run. Periodic cleanup SQL is in `sprint2-smoke.README.md`.

---

## 7. Sign-off

When complete, log to the tracker (`خطة-الوكلاء-والمرشدين/00-المراقبة.md`):

```
| YYYY-MM-DD | Sprint 2 manual QA passed on staging — all 4 screens + 6 flows | (sign-off) |
```

If anything failed, write up the finding here before logging to the tracker. Don't sign off on a partial pass.

| # | Section | Result | Notes |
|---|---------|--------|-------|
| 0 | Pre-flight | _PASS / FAIL_ |  |
| 1 | Morning dashboard | _PASS / FAIL_ |  |
| 2 | Substitutions screen | _PASS / FAIL_ |  |
| 3 | Teacher leaves screen | _PASS / FAIL_ |  |
| 4 | Operations report | _PASS / FAIL_ |  |
| 5A | Flow: mark absence | _PASS / FAIL_ |  |
| 5B | Flow: assign substitute | _PASS / FAIL_ |  |
| 5C | Flow: leave workflow | _PASS / FAIL_ |  |
| 5D | Flow: double-book prevention | _PASS / FAIL_ |  |
| 5E | Flow: re-pick reset | _PASS / FAIL_ |  |
| 5F | Flow: VP-view negative | _PASS / FAIL_ |  |
