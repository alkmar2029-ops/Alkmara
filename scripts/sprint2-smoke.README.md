# Sprint 2 backend smoke test

End-to-end probe over every VP endpoint shipped in Sprint 2. One command,
re-runnable after every fix.

## What it covers

10 HTTP probes (one auth + 10 endpoint calls) against a running Next.js
server, in this order:

| #  | Method | Endpoint                                       | Phase            | Side effects                       |
|----|--------|------------------------------------------------|------------------|------------------------------------|
| 1  | GET    | `/api/vp/morning-summary`                      | A — read         | none                               |
| 2  | GET    | `/api/vp/absences/today`                       | A — read         | none                               |
| 3  | GET    | `/api/vp/teacher-leaves`                       | A — read         | none                               |
| 4  | GET    | `/api/vp/operations-report/{today}`            | A — read         | none                               |
| 5  | POST   | `/api/vp/absences`                             | B — absence      | upserts 1 row (idempotent)         |
| 6  | GET    | `/api/vp/absences/today` (re-probe)            | B — locate slot  | none                               |
| 7  | GET    | `/api/vp/substitutions/suggest`                | B — suggest      | none                               |
| 8  | POST   | `/api/vp/substitutions/assign`                 | C — sub write    | upserts 1 row (idempotent)         |
| 9  | POST   | `/api/vp/substitutions/bulk-assign`            | C — sub bulk     | re-upserts the same row            |
| 10 | POST   | `/api/vp/teacher-leaves`                       | D — leave entry  | **inserts 1 NEW row per run**      |
| 11 | PATCH  | `/api/vp/teacher-leaves/{id}/decision`         | D — reject       | transitions the new row → rejected |

Phases B, C, D each skip cleanly (with a clear reason in the output) when
their preconditions are missing — e.g., no `SMOKE_TEACHER_ID`, or the
teacher has no open class period today.

## Setup

### 1. Required env in `.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SMOKE_ADMIN_EMAIL=admin@example.com
SMOKE_ADMIN_PASSWORD=...
```

The admin user must hold **either** `role='super_admin'` **or**
`role='admin'` + all three flags:
`view_morning_dashboard`, `manage_substitutions`, `approve_teacher_leave`.

### 2. Optional env (gates the write phases)

```bash
SMOKE_BASE_URL=http://localhost:3000        # default; staging URL otherwise
SMOKE_TEACHER_ID=<uuid>                      # active role='teacher' with class today
SMOKE_SUBSTITUTE_ID=<uuid>                   # active role='teacher', different person
```

If `SMOKE_TEACHER_ID` is missing → phases B/D are skipped.
If `SMOKE_SUBSTITUTE_ID` is missing → phase C is skipped.

The smoke always runs against today in Asia/Riyadh — there is no probe-date
override because `/api/vp/absences/today` doesn't accept one and a divergent
write date would silently miss the absence-locate step. If today is Fri/Sat,
the picked teacher will likely have no class period → phase C skips cleanly;
re-run on a school day (Sun-Thu) to exercise the substitution writes.

### 3. Picking test users

The script does **not** create test users — that would dirty staging
permanently. Pick two existing teachers that:
- Both have `role='teacher'` and `is_active=true`.
- The "teacher" one has at least one `duty_type='class'` row in
  `teacher_schedule` for today's day_of_week (Sun=0..Thu=4).
- Neither is the admin running the smoke.

Quick picker SQL (run in Supabase Studio):
```sql
-- Pick a teacher who has a class today (Sun=0..Thu=4 = school days)
SELECT
  up.user_id, up.full_name,
  COUNT(*) FILTER (WHERE ts.duty_type = 'class') AS classes_today
FROM user_profiles up
JOIN teacher_schedule ts ON ts.teacher_user_id = up.user_id
WHERE up.role = 'teacher'
  AND up.is_active = true
  AND ts.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Riyadh')::date)
GROUP BY up.user_id, up.full_name
HAVING COUNT(*) FILTER (WHERE ts.duty_type = 'class') > 0
ORDER BY classes_today DESC
LIMIT 5;
```

## Run

```powershell
# From the project root (D:\Zkt_ECO):
npm run dev                                  # in one terminal
node --env-file=.env.local scripts/sprint2-smoke.mjs   # in another
```

For staging, set `SMOKE_BASE_URL` to the deployed URL.

The script exits with:
- `0` — all tests passed (or skipped cleanly)
- `1` — one or more tests failed
- `2` — env config error (fix before re-running)
- `3` — unhandled crash

## Reading the output

Each row shows `name`, `status` (PASS/FAIL/SKIP), HTTP code, latency,
and a short detail. A typical clean run on a school day with full env:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Sprint 2 backend smoke — results                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ GET  morning-summary                          PASS 200    312ms  absent=1 ... │
│ GET  absences/today                           PASS 200    187ms  1 absences   │
│ GET  teacher-leaves                           PASS 200    142ms  3 leaves ... │
│ GET  operations-report/{today}                PASS 200    298ms                │
│ POST absences (mark teacher absent)           PASS 201    156ms  absence_id=42 │
│ GET  absences/today (locate class period)     PASS 200    178ms  chose perio... │
│ GET  substitutions/suggest                    PASS 200    421ms  3 candidates  │
│ POST substitutions/assign                     PASS 201    234ms  assignment... │
│ POST substitutions/bulk-assign (re-upsert...) PASS 201    198ms  succeeded=1   │
│ POST teacher-leaves (admin entry)             PASS 201    176ms  leave_id=88   │
│ PATCH teacher-leaves/{id}/decision (reject)   PASS 200    142ms  status=reje... │
├──────────────────────────────────────────────────────────────────────────────┤
│ total=11  passed=11  failed=0  skipped=0                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

## SQL verification (manual, optional)

After running the smoke, these queries confirm the side-effects landed
the way they should. Useful as a one-time sanity check; the script
itself validates response shapes so it's not strictly required.

### Did the absence get written + idempotent?

```sql
SELECT id, teacher_user_id, absence_date, reason, notes,
       reported_at, reported_by
FROM daily_teacher_absences
WHERE reason = 'sprint2-smoke'
ORDER BY reported_at DESC
LIMIT 5;
```

Expect: exactly 1 row per (teacher_user_id, absence_date). Re-running
the smoke must **not** grow this count.

### Did the assignment land at the right slot?

```sql
SELECT sa.id, sa.absence_id, sa.substitute_user_id,
       sa.day_of_week, sa.period_number, sa.assignment_date,
       sa.whatsapp_sent_at, sa.acknowledged_at
FROM substitution_assignments sa
JOIN daily_teacher_absences a ON a.id = sa.absence_id
WHERE a.reason = 'sprint2-smoke'
ORDER BY sa.id DESC
LIMIT 5;
```

Expect: 1 row per absence (idempotent on re-run). Verify
`assignment_date` matches the absence's `absence_date` and that
`whatsapp_sent_at`/`acknowledged_at` reset on substitute change (not
expected to fire in smoke unless you change `SMOKE_SUBSTITUTE_ID`
between runs).

### Did the no-double-book constraint hold?

```sql
SELECT substitute_user_id, assignment_date, period_number, COUNT(*)
FROM substitution_assignments
GROUP BY substitute_user_id, assignment_date, period_number
HAVING COUNT(*) > 1;
```

Expect: 0 rows. Any result here means migration 004's UNIQUE is broken.

### Did the rejected leave keep status terminal?

```sql
SELECT id, teacher_user_id, start_date, end_date, status,
       decided_by, decided_at, decision_note
FROM teacher_leaves
WHERE reason = 'sprint2-smoke'
ORDER BY id DESC
LIMIT 10;
```

Expect: 1 NEW row per smoke run, all with `status='rejected'` and
`decision_note='sprint2-smoke (auto-rejected)'`. **These accumulate** —
the smoke creates a fresh leave each time. Clean periodically:

```sql
DELETE FROM teacher_leaves
WHERE reason = 'sprint2-smoke'
  AND status = 'rejected';
```

### Migration sanity (run once, after a fresh `db push`)

```sql
-- 1. All 5 Sprint 2 migrations present?
SELECT version FROM supabase_migrations.schema_migrations
WHERE version LIKE '2026_05_21%'
ORDER BY version;
-- Expect: 001, 002, 003, 004, 005

-- 2. RLS enabled on all 3 tables?
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('daily_teacher_absences', 'substitution_assignments', 'teacher_leaves');
-- Expect: all rowsecurity = true

-- 3. UNIQUE constraints in place?
SELECT conname FROM pg_constraint
WHERE conrelid = 'substitution_assignments'::regclass AND contype = 'u';
-- Expect: includes "substitution_assignments_no_double_book"

-- 4. teacher_leaves UPDATE policy tightened?
SELECT polname, polcmd FROM pg_policy
WHERE polrelid = 'teacher_leaves'::regclass;
-- Expect: teacher_leaves_update USING super_admin OR approve_teacher_leave only
```

## Limitations

- **Cookie format is locked to `@supabase/ssr@0.6.x`** — if the package
  bumps to a major that changes encoding (e.g., away from
  `cookieEncoding: 'base64url'`), `buildCookieHeader` needs updating.
- **No chunked-cookie support** — the script aborts if the session
  exceeds 3180 chars. Typical sessions are ~2 KB; only triggers if the
  admin user has a very large `user_metadata`.
- **Approval path is not exercised.** The smoke rejects the leave to
  keep side-effects minimal. To verify the approval-creates-absences
  fan-out, run a focused manual test or extend phase D.
- **No assertion on suggester quality.** Phase B validates the response
  is well-shaped; it doesn't check whether the candidates are sensible.
  Suggester quality is a separate test concern.
