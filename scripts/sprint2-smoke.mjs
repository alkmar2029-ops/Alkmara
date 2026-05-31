// Sprint 2 backend E2E smoke test.
//
// Runs 10 HTTP probes against the running Next.js app (default
// http://localhost:3000) covering every VP endpoint shipped in Sprint 2:
//
//   Phase A — read-only (4 GETs, no preconditions):
//     1. GET  /api/vp/morning-summary
//     2. GET  /api/vp/absences/today
//     3. GET  /api/vp/teacher-leaves
//     4. GET  /api/vp/operations-report/{today}
//
//   Phase B — absence write + suggest (needs SMOKE_TEACHER_ID):
//     5. POST /api/vp/absences (idempotent upsert on teacher+date)
//     6. GET  /api/vp/absences/today (re-fetched to find a class period)
//     7. GET  /api/vp/substitutions/suggest
//
//   Phase C — substitution writes (needs SMOKE_SUBSTITUTE_ID + a class
//   period from phase B):
//     8. POST /api/vp/substitutions/assign
//     9. POST /api/vp/substitutions/bulk-assign (re-upserts the same slot
//        idempotently, exercising the bulk handler)
//
//   Phase D — leave workflow (needs SMOKE_TEACHER_ID):
//    10. POST  /api/vp/teacher-leaves
//    11. PATCH /api/vp/teacher-leaves/{id}/decision (rejected — keeps
//        the side effects minimal vs. approve which spawns absences)
//
// Authentication:
//   The Next.js handlers read the Supabase session from cookies via
//   @supabase/ssr (cookieEncoding: base64url). We mimic that by:
//     - POST {SUPABASE_URL}/auth/v1/token?grant_type=password → session
//     - Set cookie `sb-{ref}-auth-token = base64-{base64url(JSON(session))}`
//   The cookie format is locked to @supabase/ssr 0.6.x (the version
//   installed). If a future bump changes encoding, this loader will need
//   updating.
//
// State left after a successful run (no cleanup endpoint exists in
// Sprint 2 — provide manual SQL in sprint2-smoke.README.md):
//   - 1 row in daily_teacher_absences (upsert — does not grow on re-run)
//   - 1 row in substitution_assignments (upsert — does not grow on re-run)
//   - 1 NEW row in teacher_leaves PER RUN (status='rejected' — accumulates)
//
// Required env (loaded via `node --env-file=.env.local`):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SMOKE_ADMIN_EMAIL              admin user with all VP flags + super_admin
//                                  OR with view_morning_dashboard,
//                                  manage_substitutions, approve_teacher_leave
//   SMOKE_ADMIN_PASSWORD
//
// Optional env:
//   SMOKE_BASE_URL                 default http://localhost:3000
//   SMOKE_TEACHER_ID               UUID of an active role='teacher' with at
//                                  least one class period today. Phase B-D
//                                  skipped if missing.
//   SMOKE_SUBSTITUTE_ID            UUID of another active role='teacher'.
//                                  Phase C skipped if missing.
//
// Smoke always runs against TODAY in Asia/Riyadh. /api/vp/absences/today
// uses the server's todayInRiyadh() with no date override, so picking a
// different probe date would create an absence the /today endpoint can't
// see — the absence-locate step would fail and Phase C would skip
// (Codex Sprint 2 smoke review). If the run lands on Fri/Sat the
// teacher will likely have no class periods → Phase C skips cleanly;
// re-run on a school day.

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SMOKE_ADMIN_EMAIL',
  'SMOKE_ADMIN_PASSWORD',
];

// ---------- config ----------------------------------------------------------

function loadConfig() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k] || !process.env[k].trim());
  if (missing.length > 0) {
    fail(
      'Missing required env: ' + missing.join(', ') + '\n' +
      'Run via:  node --env-file=.env.local scripts/sprint2-smoke.mjs\n' +
      '(or export the vars manually before running.)',
    );
  }
  const baseUrl = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').trim().replace(/\/$/, '');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.trim().replace(/\/$/, '');
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  return {
    baseUrl,
    supabaseUrl,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim(),
    cookieName: `sb-${ref}-auth-token`,
    adminEmail: process.env.SMOKE_ADMIN_EMAIL.trim(),
    adminPassword: process.env.SMOKE_ADMIN_PASSWORD,
    teacherId: (process.env.SMOKE_TEACHER_ID || '').trim() || null,
    substituteId: (process.env.SMOKE_SUBSTITUTE_ID || '').trim() || null,
  };
}

function fail(msg) {
  console.error('\n[smoke:FATAL] ' + msg + '\n');
  process.exit(2);
}

// ---------- auth ------------------------------------------------------------

async function signIn(cfg) {
  const res = await fetch(
    `${cfg.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.anonKey,
      },
      body: JSON.stringify({ email: cfg.adminEmail, password: cfg.adminPassword }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    fail(`Sign-in failed (HTTP ${res.status}): ${text || '(no body)'}`);
  }
  return await res.json();
}

// Build the cookie header that @supabase/ssr 0.6.x's createServerClient
// expects to read. Single-cookie form: works as long as the encoded
// payload is <= 3180 chars (chunker.js MAX_CHUNK_SIZE). Typical session
// JSON is ~1.5 KB → ~2.0 KB base64 + 7-char prefix; well under.
function buildCookieHeader(cfg, session) {
  const json = JSON.stringify(session);
  const encoded = Buffer.from(json, 'utf-8').toString('base64url');
  const value = `base64-${encoded}`;
  if (value.length > 3180) {
    fail(
      `Session cookie value is ${value.length} chars (> 3180 chunk limit). ` +
      'This smoke script does not chunk. Trim user_metadata on the admin user ' +
      'or extend the script to write chunked cookies.',
    );
  }
  return `${cfg.cookieName}=${encodeURIComponent(value)}`;
}

// ---------- HTTP helpers ----------------------------------------------------

async function request(cfg, cookie, method, path, body) {
  const url = `${cfg.baseUrl}${path}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  let json = null;
  let text = null;
  const raw = await res.text();
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    text = raw;
  }
  return { status: res.status, ms, json, text };
}

// ---------- date helpers (mirrors lib/dates/ksa.ts) -------------------------

function todayInRiyadh() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dayOfWeekKsa(date) {
  return new Date(`${date}T12:00:00+03:00`).getUTCDay();
}

// ---------- test step runner ------------------------------------------------

const results = [];

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const res = await fn();
    const ms = Date.now() - t0;
    if (res === 'skip') {
      results.push({ name, status: 'SKIP', http: '-', ms, detail: '' });
      return null;
    }
    if (res && typeof res === 'object' && res.skip) {
      results.push({ name, status: 'SKIP', http: '-', ms, detail: res.skip });
      return null;
    }
    if (res && typeof res === 'object' && res.fail) {
      results.push({ name, status: 'FAIL', http: res.http ?? '-', ms, detail: res.fail });
      return null;
    }
    results.push({
      name,
      status: 'PASS',
      http: (res && res.http) ?? '-',
      ms,
      detail: (res && res.detail) ?? '',
    });
    return res && res.value !== undefined ? res.value : res;
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ name, status: 'FAIL', http: '-', ms, detail: String(err.message || err) });
    return null;
  }
}

// ---------- shape validators -----------------------------------------------

function isObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function hasKeys(obj, keys) {
  return isObject(obj) && keys.every((k) => k in obj);
}

// ---------- main ------------------------------------------------------------

async function main() {
  const cfg = loadConfig();
  console.log('\n[smoke] Sprint 2 backend E2E');
  console.log(`[smoke] base=${cfg.baseUrl}  supabase=${cfg.supabaseUrl}`);
  console.log(`[smoke] admin=${cfg.adminEmail}  teacher=${cfg.teacherId ?? '(unset)'}  sub=${cfg.substituteId ?? '(unset)'}\n`);

  const session = await signIn(cfg);
  if (!session.access_token) {
    fail('Sign-in returned no access_token: ' + JSON.stringify(session));
  }
  const cookie = buildCookieHeader(cfg, session);
  // Always run against today (Asia/Riyadh). /api/vp/absences/today does
  // not accept a date override, so any divergence here would break the
  // absence-locate step in Phase B.
  const today = todayInRiyadh();
  const dow = dayOfWeekKsa(today);

  // ===== Phase A: read-only =================================================

  await step('GET  morning-summary', async () => {
    const r = await request(cfg, cookie, 'GET', '/api/vp/morning-summary');
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    const d = r.json?.data;
    if (!hasKeys(d, ['date', 'day_of_week', 'teachers', 'substitutions', 'leaves', 'dismissals', 'supervision'])) {
      return { fail: 'missing keys in data', http: r.status };
    }
    return { http: r.status, detail: `absent=${d.teachers.absent_today} leaves=${d.leaves.pending_requests}` };
  });

  await step('GET  absences/today', async () => {
    const r = await request(cfg, cookie, 'GET', '/api/vp/absences/today');
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    const d = r.json?.data;
    if (!hasKeys(d, ['date', 'day_of_week', 'absences'])) return { fail: 'missing keys in data', http: r.status };
    if (!Array.isArray(d.absences)) return { fail: 'data.absences not array', http: r.status };
    return { http: r.status, detail: `${d.absences.length} absences listed` };
  });

  await step('GET  teacher-leaves', async () => {
    const r = await request(cfg, cookie, 'GET', '/api/vp/teacher-leaves');
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    if (!Array.isArray(r.json?.data)) return { fail: 'data not array', http: r.status };
    return { http: r.status, detail: `${r.json.data.length} leaves listed` };
  });

  await step('GET  operations-report/{today}', async () => {
    const r = await request(cfg, cookie, 'GET', `/api/vp/operations-report/${today}`);
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    if (!isObject(r.json?.data)) return { fail: 'no data object', http: r.status };
    return { http: r.status };
  });

  // ===== Phase B: absence write + suggest ===================================

  let absenceId = null;
  let chosenPeriod = null; // for phase C

  await step('POST absences (mark teacher absent)', async () => {
    if (!cfg.teacherId) return { skip: 'SMOKE_TEACHER_ID not set' };
    const r = await request(cfg, cookie, 'POST', '/api/vp/absences', {
      teacher_user_id: cfg.teacherId,
      absence_date: today,
      reason: 'sprint2-smoke',
      notes: 'sprint2-smoke (idempotent upsert)',
    });
    if (r.status !== 201) return { fail: 'expected 201, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    absenceId = r.json?.data?.id ?? null;
    if (!absenceId) return { fail: 'no absence id returned', http: r.status };
    return { http: r.status, detail: `absence_id=${absenceId}` };
  });

  await step('GET  absences/today (locate class period)', async () => {
    if (!absenceId) return { skip: 'no absence created' };
    const r = await request(cfg, cookie, 'GET', '/api/vp/absences/today');
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    const ours = (r.json?.data?.absences ?? []).find((a) => a.absence_id === absenceId);
    if (!ours) return { fail: `created absence ${absenceId} not present in /today (server date=${r.json?.data?.date})`, http: r.status };
    const openClass = ours.periods.find((p) => p.duty_type === 'class' && p.slot_assignable && p.substitute === null);
    if (!openClass) {
      // Either teacher has no class today or all periods already covered.
      // Either way Phase C can't run cleanly. Record info but don't fail.
      return { http: r.status, detail: `no open class periods for teacher today (class_periods=${ours.stats.class_periods}, assigned=${ours.stats.assigned})` };
    }
    chosenPeriod = openClass.period_number;
    return { http: r.status, detail: `chose period ${chosenPeriod} (${openClass.subject ?? 'no-subject'})` };
  });

  await step('GET  substitutions/suggest', async () => {
    if (!cfg.teacherId) return { skip: 'SMOKE_TEACHER_ID not set' };
    if (!chosenPeriod) return { skip: 'no class period available' };
    const qs = new URLSearchParams({
      day_of_week: String(dow),
      period_number: String(chosenPeriod),
      original_teacher_id: cfg.teacherId,
      limit: '3',
    });
    const r = await request(cfg, cookie, 'GET', `/api/vp/substitutions/suggest?${qs}`);
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    const d = r.json?.data;
    if (!Array.isArray(d?.candidates)) return { fail: 'data.candidates not array', http: r.status };
    return { http: r.status, detail: `${d.candidates.length} candidates` };
  });

  // ===== Phase C: substitution writes =======================================

  await step('POST substitutions/assign', async () => {
    if (!cfg.teacherId) return { skip: 'SMOKE_TEACHER_ID not set' };
    if (!cfg.substituteId) return { skip: 'SMOKE_SUBSTITUTE_ID not set' };
    if (!absenceId) return { skip: 'no absence created' };
    if (!chosenPeriod) return { skip: 'no class period available' };
    const r = await request(cfg, cookie, 'POST', '/api/vp/substitutions/assign', {
      absence_id: absenceId,
      substitute_user_id: cfg.substituteId,
      period_number: chosenPeriod,
    });
    if (r.status !== 201) return { fail: 'expected 201, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    const a = r.json?.data;
    if (!a?.id || a.absence_id !== absenceId) return { fail: 'unexpected response shape', http: r.status };
    return { http: r.status, detail: `assignment_id=${a.id}` };
  });

  await step('POST substitutions/bulk-assign (re-upsert same slot)', async () => {
    if (!cfg.teacherId) return { skip: 'SMOKE_TEACHER_ID not set' };
    if (!cfg.substituteId) return { skip: 'SMOKE_SUBSTITUTE_ID not set' };
    if (!absenceId) return { skip: 'no absence created' };
    if (!chosenPeriod) return { skip: 'no class period available' };
    const r = await request(cfg, cookie, 'POST', '/api/vp/substitutions/bulk-assign', {
      assignments: [
        {
          absence_id: absenceId,
          substitute_user_id: cfg.substituteId,
          period_number: chosenPeriod,
        },
      ],
    });
    // 201 if all succeeded, 207 if partial.
    if (r.status !== 201 && r.status !== 207) return { fail: 'expected 201/207, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    const d = r.json?.data;
    if (!d || d.total !== 1) return { fail: 'unexpected response shape', http: r.status };
    return { http: r.status, detail: `succeeded=${d.succeeded} failed=${d.failed}` };
  });

  // ===== Phase D: leave workflow ============================================

  let leaveId = null;

  await step('POST teacher-leaves (admin entry)', async () => {
    if (!cfg.teacherId) return { skip: 'SMOKE_TEACHER_ID not set' };
    const r = await request(cfg, cookie, 'POST', '/api/vp/teacher-leaves', {
      teacher_user_id: cfg.teacherId,
      start_date: today,
      end_date: today,
      leave_type: 'sick',
      reason: 'sprint2-smoke',
    });
    if (r.status !== 201) return { fail: 'expected 201, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    leaveId = r.json?.data?.id ?? null;
    if (!leaveId) return { fail: 'no leave id returned', http: r.status };
    return { http: r.status, detail: `leave_id=${leaveId}` };
  });

  await step('PATCH teacher-leaves/{id}/decision (reject)', async () => {
    if (!leaveId) return { skip: 'no leave created' };
    const r = await request(cfg, cookie, 'PATCH', `/api/vp/teacher-leaves/${leaveId}/decision`, {
      decision: 'rejected',
      decision_note: 'sprint2-smoke (auto-rejected)',
    });
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    const d = r.json?.data;
    if (d?.status !== 'rejected') return { fail: 'status not rejected: ' + d?.status, http: r.status };
    return { http: r.status, detail: `status=rejected` };
  });

  // ===== Summary ============================================================

  printSummary();
  const failed = results.filter((r) => r.status === 'FAIL').length;
  process.exit(failed === 0 ? 0 : 1);
}

function printSummary() {
  console.log('');
  console.log('┌' + '─'.repeat(78) + '┐');
  console.log('│ ' + 'Sprint 2 backend smoke — results'.padEnd(76) + ' │');
  console.log('├' + '─'.repeat(78) + '┤');
  for (const r of results) {
    const status =
      r.status === 'PASS' ? 'PASS' :
      r.status === 'FAIL' ? 'FAIL' :
      'SKIP';
    const line =
      ' ' + r.name.padEnd(46) +
      ' ' + status.padEnd(4) +
      ' ' + String(r.http).padStart(3) +
      ' ' + (String(r.ms) + 'ms').padStart(7) +
      (r.detail ? '  ' + r.detail : '');
    // Truncate to fit 78-char inner width.
    const truncated = line.length > 76 ? line.slice(0, 73) + '...' : line.padEnd(76);
    console.log('│' + truncated + ' │');
  }
  console.log('├' + '─'.repeat(78) + '┤');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const summary = ` total=${results.length}  passed=${passed}  failed=${failed}  skipped=${skipped}`;
  console.log('│' + summary.padEnd(76) + '  │');
  console.log('└' + '─'.repeat(78) + '┘');
  console.log('');
}

main().catch((err) => {
  console.error('\n[smoke:CRASH] ' + (err.stack || err.message || err) + '\n');
  process.exit(3);
});
