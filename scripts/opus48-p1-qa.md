# Opus 4.8 P1 QA Notes

Date: 2026-05-30

## P1.1 - manage-users gate

Changed routes:

- `app/api/admins/route.ts`
- `app/api/teachers/route.ts`
- `app/api/teachers/bulk/route.ts`
- `app/api/teachers/[id]/route.ts`
- `app/api/teachers/[id]/reset-password/route.ts`
- `app/api/teacher-registrations/[id]/route.ts`

Acceptance checks:

- Counselor / VP persona with `role='admin'` but without `permissions.manage_users=true` must receive 403 from:
  - `GET /api/admins`
  - `POST /api/admins`
  - `GET /api/teachers`
  - `POST /api/teachers`
  - `POST /api/teachers/bulk`
  - `PATCH /api/teachers/:id`
  - `DELETE /api/teachers/:id`
  - `POST /api/teachers/:id/reset-password`
  - `PATCH /api/teacher-registrations/:id`
  - `DELETE /api/teacher-registrations/:id`
- `super_admin` passes all routes.
- Plain `admin` passes only when `permissions.manage_users === true`.
- `POST /api/teachers/:id/reset-password` is additionally limited to 5 calls per caller per 60 seconds and returns 429 with `Retry-After` after the limit.

## P1.2 - period attendance scope

Migration:

- `supabase/migrations/2026_07_06_001_fix_period_attendance_scope.sql`

Acceptance checks after applying the migration:

- A teacher calling `save_period_attendance` for a section not present in `teacher_section_assignments` receives SQLSTATE `42501`.
- A plain admin calling `save_period_attendance` for a section not present in `admin_section_assignments` receives SQLSTATE `42501`.
- A non-super caller passing a `p_recorded_by` value different from `auth.uid()` receives SQLSTATE `42501`.
- Successful RPC writes store `period_sessions.recorded_by = auth.uid()`.
- Direct REST `INSERT` / `UPDATE` / `DELETE` on `period_sessions` is scoped by `teacher_section_assignments` or `admin_section_assignments`.
- Direct REST `INSERT` / `UPDATE` / `DELETE` on `period_absences` is scoped through the parent `period_sessions.section_id`.
- The `source` column behavior from `2026_04_30_period_absence_source.sql` is preserved: missing/empty source defaults to `manual`, while `auto_cascade` and `overridden` remain valid.

Positive-path staging checks:

- A teacher assigned to the target section can call `save_period_attendance` successfully.
- A plain admin assigned to the target section through `admin_section_assignments` can call `save_period_attendance` successfully.
- `staff` can call `save_period_attendance` for any section successfully.
- `super_admin` can call `save_period_attendance` for any section successfully.
- For every successful call above, `period_sessions.recorded_by` equals the authenticated caller, and the counts/return shape match the original 2026_04_30 RPC behavior.

Staging behavior note:

- This migration intentionally makes plain `admin` attendance recording section-scoped. Confirm operational admins who record attendance are either `super_admin`, `staff`, or have the required `admin_section_assignments` rows before rollout.

## P1.3 - phone normalization for WhatsApp

Changed files:

- `lib/phone/normalize.ts`
- `lib/teachers/credentials.ts`
- `lib/whatsapp/wasender-client.ts`
- `app/api/students/import/route.ts`

Acceptance checks:

- `toJid('05XXXXXXXX')` returns `9665XXXXXXXX@s.whatsapp.net`.
- `toJid('5XXXXXXXX')` returns `9665XXXXXXXX@s.whatsapp.net`.
- `toJid('9665XXXXXXXX')` returns `9665XXXXXXXX@s.whatsapp.net`.
- `toJid('٠٥XXXXXXXX')` and Eastern Arabic-Indic variants normalize to `9665XXXXXXXX@s.whatsapp.net`.
- `sendText()` returns `{ ok:false, error:'رقم الجوال غير صالح' }` for incomplete/non-Saudi-mobile numbers before calling Wasender.
- Student import stores valid parent phones as `9665XXXXXXXX`.
- Student import converts Arabic-Indic / Eastern Arabic-Indic digits before storing.
- Student import keeps importing the student when a phone is invalid, stores `phone=null`, and records an error line for the invalid phone.

## Verification run

- `npx tsc --noEmit`: PASS
- `npx eslint app/api/admins/route.ts app/api/teachers/route.ts "app/api/teachers/[id]/route.ts" "app/api/teachers/[id]/reset-password/route.ts" app/api/teachers/bulk/route.ts "app/api/teacher-registrations/[id]/route.ts"`: PASS
- `npx eslint lib/phone/normalize.ts lib/teachers/credentials.ts lib/whatsapp/wasender-client.ts app/api/students/import/route.ts`: PASS
- `npx eslint app/api/search/route.ts`: PASS
- `npx eslint lib/security/worker-secret.ts app/api/whatsapp/bulk-jobs/[id]/process/route.ts app/api/whatsapp/bulk-jobs/sweep-scheduled/route.ts app/api/daily-attendance/campaigns/[id]/process/route.ts app/api/daily-attendance/campaigns/sweep/route.ts app/api/daily-attendance/campaigns/route.ts app/api/daily-attendance/campaigns/[id]/resume/route.ts app/api/daily-attendance/campaigns/[id]/retry-failed/route.ts app/api/supervision/reminder/run/route.ts app/api/admin/risk-scores/sweep/route.ts app/api/daily-attendance/send-whatsapp/route.ts app/api/devices/sync-bulk/route.ts app/api/whatsapp/bulk-parents/route.ts app/api/whatsapp/bulk-remind-teachers/route.ts`: PASS
- `npm run lint`: FAIL, due to pre-existing lint errors outside this P1 change set, mostly `react/no-unescaped-entities` across dashboard/components pages plus existing unused-variable warnings.
- `supabase db lint --local`: BLOCKED, local Postgres is not running on `127.0.0.1:54322`; run again after `supabase start` or against staging.

Note: all existing `save_period_attendance` migration files already carry numeric prefixes; the new corrective migration is ordered after the current migration tail to prevent the 2026_04_30 regression from winning on clean restore.

## P1.4 - global search teacher leak

Changed file:

- `app/api/search/route.ts`

Acceptance checks:

- Signed in as `teacher`, `GET /api/search?types=teachers&q=أ` returns `results.teachers = []`.
- Signed in as `teacher`, `GET /api/search?types=sections&q=أ` returns `results.sections = []`.
- Signed in as `teacher`, default `GET /api/search?q=أ` still returns allowed `results.students` via the caller-bound Supabase client/RLS, while `teachers` and `sections` stay empty.
- Signed in as `admin` / `staff` / `viewer` / `super_admin`, `teachers` and `sections` search behavior is unchanged.

## P1.5 - production automation

Changed files:

- `lib/security/worker-secret.ts`
- `app/api/whatsapp/bulk-jobs/[id]/process/route.ts`
- `app/api/whatsapp/bulk-jobs/sweep-scheduled/route.ts`
- `app/api/daily-attendance/campaigns/[id]/process/route.ts`
- `app/api/daily-attendance/campaigns/sweep/route.ts`
- `app/api/daily-attendance/campaigns/route.ts`
- `app/api/daily-attendance/campaigns/[id]/resume/route.ts`
- `app/api/daily-attendance/campaigns/[id]/retry-failed/route.ts`
- `app/api/supervision/reminder/run/route.ts`
- `app/api/admin/risk-scores/sweep/route.ts`
- `app/api/daily-attendance/send-whatsapp/route.ts`
- `app/api/devices/sync-bulk/route.ts`
- `supabase/migrations/2026_07_06_002_pg_cron_worker_jobs.sql`
- `.env.production.example`

Operator setup before staging:

- Set `WORKER_SECRET` in Vercel.
- Store the same value in Supabase Vault as `worker_secret`.
- Store the public app base URL in Supabase Vault as `app_base_url`.
- Apply the pg_cron migration after enabling any required Supabase extensions.

Acceptance checks:

- Requests with only `x-vercel-cron` to `bulk-jobs/sweep-scheduled` return 401.
- Requests with correct `x-worker-secret` pass worker endpoints.
- `bulk-jobs/sweep-scheduled` promotes only `scheduled` jobs whose `scheduled_for <= now()`.
- `daily-attendance/campaigns/sweep` starts `pending` campaigns and resumes only stale `processing` campaigns with queued recipients.
- `supervision/reminder/run` can be called every minute safely: it sends only during Riyadh 06:00-10:00 on school weekdays and only once per date.
- `admin/risk-scores/sweep` accepts worker calls for stale-batch sweeps but rejects worker `student_id` force requests.
- `risk-scores` cron is daily, not every minute.
- `cron.job` does not contain the literal worker secret; it queries `vault.decrypted_secrets`.
- Inspect `net._http_response` when debugging pg_net delivery failures because pg_net is asynchronous.

## P1.6 - bulk WhatsApp abuse limits

Changed files:

- `lib/security/bulk-send-limit.ts`
- `supabase/migrations/2026_07_06_003_whatsapp_bulk_quota.sql`
- `app/api/whatsapp/bulk-parents/route.ts`
- `app/api/whatsapp/bulk-remind-teachers/route.ts`
- `app/api/daily-attendance/campaigns/route.ts`
- `app/api/daily-attendance/send-whatsapp/route.ts`
- `app/api/whatsapp/send-notes/route.ts`

Implemented limits:

- Campaign creation: max 3 bulk WhatsApp attempts per sender per 10 minutes.
- Recipient volume: max 1,500 requested recipients per sender per Riyadh day, reserved through Postgres (`whatsapp_bulk_usage`) so it survives Vercel multi-instance fanout and cold starts.
- Limits run before job creation or first Wasender send.
- Existing role/toggle gates are preserved; permission-flag tightening for `send_whatsapp` should be handled as a separate auth-surface change if required.

Acceptance checks:

- Creating 4 parent bulk jobs from the same user inside 10 minutes returns 429 with `BULK_SEND_RATE_LIMIT`.
- Two concurrent requests that would jointly exceed 1,500 recipients cannot both pass; `reserve_whatsapp_bulk_quota` serializes on `(user_id, usage_date)`.
- Sending daily-attendance WhatsApp after the same user has exhausted the daily recipient cap returns 429 with `BULK_SEND_DAILY_RECIPIENT_LIMIT`.
- Sending notes after the same user has exhausted the daily recipient cap returns 429 before any note is sent.
- If the quota RPC/migration is unavailable, bulk entry points fail closed with 503 `BULK_SEND_QUOTA_UNAVAILABLE`.
- A normal single campaign below both limits still creates the job/sends as before.
