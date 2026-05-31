# Opus 48 P2 QA

## P2.1 - confidential read logging

Changed files:

- `lib/audit/confidential-read.ts`
- `app/api/counselor/cases/route.ts`
- `app/api/counselor/cases/[id]/route.ts`
- `app/api/counselor/workspace-summary/route.ts`
- `app/api/counselor/watchlist/route.ts`
- `app/api/counselor/reports/operational/route.ts`
- `app/api/admin/reports/school/route.ts`

Implemented behavior:

- Confidential read surfaces write `action='read'` to `confidential_access_log` through service-role.
- Logging includes `accessed_by`, `table_name`, `record_id`, optional `student_id`, IP, and user-agent.
- Case detail logs one aggregate row per opened case (`student_case_detail`, `record_id = case_id`) to keep volume bounded.
- List, dashboard, watchlist, and aggregate report surfaces log one aggregate row per request.
- Logging is fail-closed: if the audit insert fails, the endpoint returns 500 before returning confidential/derived data.

Acceptance checks:

- Opening `/api/counselor/cases/:id` as an in-scope counselor creates a `confidential_access_log` row with `action='read'`, `table_name='student_case_detail'`, `record_id=<case_id>`, the correct `student_id`, and `accessed_by=<caller>`.
- Opening counselor workspace, cases list, watchlist, or operational report creates a `read` row with `student_id IS NULL`.
- Opening `/api/admin/reports/school` creates a `read` row with `table_name='school_aggregate_report'`.
- If inserting into `confidential_access_log` is made to fail, the endpoint fails closed with 500 and does not return the confidential response body.

## P2.8 batch 0 - global accessibility baseline

Changed files:

- `app/globals.css`
- `app/layout.tsx`
- `app/dashboard/layout.tsx`
- `app/teacher/layout.tsx`

Implemented behavior:

- Added a global skip link to `#main`.
- Added `id="main"` and `tabIndex={-1}` to dashboard and teacher main regions.
- Added a `prefers-reduced-motion: reduce` media query that disables long-running animations/transitions and smooth scrolling.

Acceptance checks:

- Pressing Tab from the top of dashboard or teacher pages reveals "تخطى إلى المحتوى الرئيسي".
- Activating the skip link moves to the page's main content region.
- With OS/browser reduced-motion enabled, CSS animations/transitions are effectively disabled.

## P2.8 batch 1a - semantic forms and input hints

Changed files:

- `app/login/page.tsx`
- `app/register/teacher/page.tsx`
- `app/register/admin/page.tsx`
- `app/dashboard/teacher/incidents/new/page.tsx`

Implemented behavior:

- Login/register standalone pages now expose `id="main"` targets for the global skip link.
- Teacher and admin registration use real `<form onSubmit>` flows with submit buttons.
- New incident creation uses a real `<form onSubmit>` to open the confirmation dialog.
- Email/name/password/phone inputs now include useful `name`, `id`, `autoComplete`, and `inputMode` hints.
- Password visibility toggle has an Arabic `aria-label`.

Acceptance checks:

- Pressing Enter in teacher/admin registration submits the request when valid.
- Pressing Enter in the new incident form opens the confirmation dialog when valid.
- Password managers/browser autofill recognize login email/password and registration name/email/phone fields.
- The global skip link has a `#main` target on login and registration pages.

## P2.8 batch 1b - dialogs and search keyboard semantics

Changed files:

- `lib/hooks/useFocusTrap.ts`
- `components/ui/Modal.tsx`
- `components/search/GlobalSearch.tsx`
- `app/teacher/page.tsx`
- `app/dashboard/teacher/incidents/new/page.tsx`
- `components/students/StudentForm.tsx`
- `components/students/ImportModal.tsx`
- `app/dashboard/devices/page.tsx`

Implemented behavior:

- Added a shared `useFocusTrap` hook that traps Tab/Shift+Tab, closes on Escape when provided, and returns focus to the launcher.
- Shared `Modal` now has `aria-labelledby`, initial focus, Escape support, focus restore, and optional backdrop dismissal.
- Student/device/import form modals disable backdrop dismissal to avoid losing in-progress input.
- Teacher health/custody detail dialogs and the incident confirmation dialog now trap focus and expose `aria-labelledby`.
- Global search is available on mobile, exposes a dialog title, and models results as a listbox with `role="option"`, `aria-selected`, and `aria-activedescendant`.
- Global search handles ArrowUp/ArrowDown/Enter from the input while keeping the existing click and mouse hover behavior.
- Decorative status icons in teacher health/custody dialogs are hidden from assistive tech where visible text already carries the meaning.

Acceptance checks:

- Opening a shared modal, teacher detail dialog, incident confirm dialog, or global search keeps Tab focus inside it.
- Escape closes those dialogs and returns focus to the element that opened them.
- Clicking the backdrop does not close student/device/import data-entry modals.
- Global search opens on mobile, ArrowUp/ArrowDown updates the active option, and Enter opens the selected result.
- Screen readers can announce dialog titles and the active search result without relying on color or emoji alone.

## P2.8 batch 2 - contrast and field errors

Changed files:

- `app/login/page.tsx`
- `app/dashboard/teacher/incidents/new/page.tsx`
- `app/dashboard/page.tsx`
- `components/ui/EmptyState.tsx`
- `components/students/StudentForm.tsx`
- `components/search/GlobalSearch.tsx`

Implemented behavior:

- Login credential failures now render a persistent field-level error with `role="alert"`.
- Login email/password inputs use `aria-invalid` and `aria-describedby` while the credential error is visible.
- New incident validation now surfaces field-level errors for missing student, missing date, and short/empty description.
- New incident inputs/textarea link to help/error text through `aria-describedby`, with `aria-invalid` on invalid fields.
- The incident submit button is no longer disabled by client validation, so invalid submissions can announce field errors.
- Raised meaningful `text-[10px]`/`text-[11px]` copy to `text-xs` on the dashboard, incident form, student form hints, and global search result metadata.
- Removed opacity from meaningful dashboard labels/actions and raised `EmptyState` title/description contrast.

Residual scope:

- This batch intentionally covers the highest-use surfaces first. Remaining app-wide `text-[10px]` occurrences are mostly badges, counters, keyboard hints, or lower-traffic modules and should be handled in a follow-up sweep rather than silently counted as complete.

Acceptance checks:

- Invalid login shows a stable error under the password field and screen readers receive it through `role="alert"`.
- Submitting an incomplete incident form announces the missing student/date/description errors without relying on toast alone.
- Informational copy in the touched high-use screens is at least `text-xs` and uses stronger contrast than `text-gray-400` on white.

## P2.8 batch 3 - confirm dialogs, loading skeletons, and RTL cleanup

Changed files:

- `components/ui/ConfirmDialog.tsx`
- `app/dashboard/layout.tsx`
- `app/teacher/layout.tsx`
- `app/dashboard/teachers/page.tsx`
- `app/dashboard/users/page.tsx`
- `app/dashboard/dismissals/page.tsx`
- `app/dashboard/admin-registrations/page.tsx`
- `app/dashboard/teacher-registrations/page.tsx`
- `app/dashboard/loading.tsx`
- `app/teacher/loading.tsx`
- `app/dashboard/students/loading.tsx`
- `app/dashboard/daily-attendance/loading.tsx`
- `app/dashboard/teacher/incidents/loading.tsx`

Implemented behavior:

- Dashboard and teacher logout now use the shared `ConfirmDialog` instead of native `confirm()`.
- Critical delete/approve paths now use `ConfirmDialog`: teacher deletion, unified user teacher deletion, dismissal deletion, admin registration deletion, teacher registration deletion, and teacher registration approval.
- `ConfirmDialog` action buttons are explicitly `type="button"` so it stays safe if rendered inside a form subtree.
- Added `loading.tsx` skeleton pages for dashboard, teacher, students, daily-attendance, and teacher incidents.
- Converted targeted high-use RTL physical utilities in touched files from `text-right`/`right-*` to logical `text-start`/`end-*`.

Residual scope:

- This batch removes `confirm()` from the critical logout/delete/approval paths above. Remaining lower-priority native confirms are still present in campaign panels, template editors, invite codes, personas, attendance send flows, period attendance, supervision, notes, and WhatsApp job pages. They should be handled in a follow-up UX-12 sweep rather than silently counted as complete.
- Keyboard-only authenticated smoke still needs a real session. Static ARIA/DOM checks, TypeScript, and targeted lint are the automated gate for this batch.

Acceptance checks:

- `window.confirm()`/`confirm()` has no matches in the critical files touched by this batch.
- Logout/delete/approval dialogs are keyboard reachable through the shared dialog path and do not rely on the browser-native modal.
- Heavy route transitions have skeleton loading states in the added route folders.
- The checked RTL files have no remaining `text-right`, `right-*`, `left-*`, `pr-*`, or `pl-*` physical utilities in the touched regions.

## P2.9-1 - date/time policy unification + print color

Changed files:

- `app/globals.css`
- `lib/utils/school-time.ts`
- `lib/utils/date-format.ts` (new)
- `lib/utils/helpers.ts`
- `lib/whatsapp/template.ts`

Policy decision (user-approved): Gregorian calendar + Latin digits + Asia/Riyadh timezone for all UI/report/message dates (`ar-SA-u-ca-gregory-nu-latn`). Official Hijri (Umm al-Qura) stays only where a form explicitly requires it.

Implemented behavior:

- New canonical `lib/utils/date-format.ts` exports `AR_DATE_LOCALE`, `SCHOOL_TZ` (re-exported from school-time), `formatDate`, `formatTime` (12h), `formatClockTime` (24h, HH:MM), `formatDateTime`. Every formatter pins `timeZone: 'Asia/Riyadh'`.
- `helpers.ts` `formatDate`/`formatTime` are now re-exports from `date-format` (backward compatible; all existing imports keep working).
- `template.ts` `formatPunchDateTime` routes through `formatDate` + `formatClockTime`. Punch time is now `HH:MM` (was `HH:MM:SS`).
- Global `@media print { *,::before,::after { print-color-adjust: exact } }` so report/table backgrounds and borders print as shown (COMPAT-05/14).

Acceptance checks:

- `tsc` EXIT 0.
- `2026-05-29T22:30:00Z` renders as `30/5/2026` / `01:30` (Riyadh), not `29/5` (UTC) and not Arabic-Indic numerals.
- Printing a report keeps header/highlight background colors.

## P2.9-2f - WhatsApp message-generator dates (parent-facing)

Changed files:

- `lib/daily-attendance/messages.ts`
- `lib/dismissals/whatsapp.ts`
- `app/api/daily-attendance/send-whatsapp/route.ts`
- `app/api/whatsapp/send-period-absences/route.ts`
- `app/api/whatsapp/send-notes/route.ts`
- `app/api/whatsapp/bulk-jobs/[id]/process/route.ts`
- `app/dashboard/reports/print/page.tsx` (representative full conversion + unused `useMemo` cleanup)

Implemented behavior:

- Long parent-facing dates keep their `weekday/year/month/day` options but switch to `AR_DATE_LOCALE` + `timeZone: SCHOOL_TZ` (Latin digits + correct Riyadh date near midnight).
- Plain dates route through `formatDate`.
- `messages.ts` keeps its local `formatDate` name and imports only the constants to avoid a name collision.

Acceptance checks:

- Parent absence/dismissal/notes messages show `السبت، 30 مايو 2026` (Latin, Riyadh), not `٣٠ مايو ٢٠٢٦` (Arabic-Indic, UTC-shifted).
- `tsc` EXIT 0.

Residual scope (tracked, not silently complete):

- The broad sweep of remaining direct `toLocaleDateString('ar-SA')` / `'ar-SA-u-ca-gregory'` calls in print pages (~11 files) and dashboard UI/components (~20 files) still needs converting to the canonical helper. Same mechanical pattern as `reports/print`.
- COMPAT-07: `getLocalToday()` in `helpers.ts` is still timezone-naive; remove/delegate to `todayInSchoolTz` after checking consumers.
- COMPAT-06 / PWA-01: iOS PNG icons not yet added.
- COMPAT-09: supervision print header still uses `ar-SA-u-ca-islamic` (should be `islamic-umalqura`); intentionally left as official Hijri.
- Number-only `Number.toLocaleString('ar-SA')` sites (2) left for a separate number-formatting decision.
- `en-CA`/`en-GB`/`en-US` Intl helpers left as-is (correct, timezone-explicit server-side computation).
