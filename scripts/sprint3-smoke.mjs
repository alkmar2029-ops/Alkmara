// Sprint 3 backend E2E smoke test.
//
// 8 HTTP probes against the running Next.js app covering the
// incidents workflow:
//
//   Phase A — read-only (no preconditions):
//     1. GET /api/incidents/mine
//     2. GET /api/incidents/pending-review
//     3. GET /api/incidents/students/search?q=...
//
//   Phase B — submit + verify (needs SMOKE_STUDENT_ID):
//     4. POST /api/incidents
//     5. GET /api/incidents/mine (re-fetched; must contain new id)
//
//   Phase C — self-review guard (one-account limitation):
//     6. PATCH /api/incidents/{id}/dismiss → expect 403 (caller is
//        the submitter; the guard MUST block this)
//
//   Phase D — withdraw:
//     7. DELETE /api/incidents/{id}/withdraw → expect 200
//     8. GET /api/incidents/mine → must NOT contain withdrawn id
//
// LIMITATIONS:
//   This smoke uses a single ADMIN account. Sprint 3's
//   dismiss/action SUCCESS path requires a reviewer who is NOT
//   the submitter (self-review guard). With one account, we can
//   only verify the guard blocks. Action SUCCESS path is covered
//   by sprint3-qa.md manual flow with a second account.
//
//   Counselor read-only is also a manual-only check (needs a
//   counselor account).
//
// State left after a successful run:
//   - Zero rows. The incident submitted is withdrawn in the same
//     run. (Unlike sprint2 leaves which accumulate.)
//
// Required env (in .env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SMOKE_ADMIN_EMAIL              admin or super_admin
//   SMOKE_ADMIN_PASSWORD
//   SMOKE_STUDENT_ID               UUID of an active student in
//                                  caller's scope (for super_admin
//                                  any active student works)
//
// Optional:
//   SMOKE_BASE_URL                 default http://localhost:3000
//   SMOKE_STUDENT_SEARCH_Q         default 'محمد' (must be ≥ 2 chars,
//                                  matches a student in scope)

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
      'Run via:  node --env-file=.env.local scripts/sprint3-smoke.mjs',
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
    studentId: (process.env.SMOKE_STUDENT_ID || '').trim() || null,
    studentSearchQ: (process.env.SMOKE_STUDENT_SEARCH_Q || 'محمد').trim(),
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

function buildCookieHeader(cfg, session) {
  const json = JSON.stringify(session);
  const encoded = Buffer.from(json, 'utf-8').toString('base64url');
  const value = `base64-${encoded}`;
  if (value.length > 3180) {
    fail(`Session cookie ${value.length} chars (> 3180). Trim user_metadata or extend script to chunk.`);
  }
  return `${cfg.cookieName}=${encodeURIComponent(value)}`;
}

// ---------- HTTP helpers ----------------------------------------------------

async function request(cfg, cookie, method, path, body) {
  const url = `${cfg.baseUrl}${path}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  let json = null, text = null;
  const raw = await res.text();
  try { json = raw ? JSON.parse(raw) : null; } catch { text = raw; }
  return { status: res.status, ms, json, text };
}

// ---------- step runner -----------------------------------------------------

const results = [];

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const res = await fn();
    const ms = Date.now() - t0;
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

function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

// ---------- main ------------------------------------------------------------

async function main() {
  const cfg = loadConfig();
  console.log('\n[smoke] Sprint 3 incidents E2E');
  console.log(`[smoke] base=${cfg.baseUrl}  supabase=${cfg.supabaseUrl}`);
  console.log(`[smoke] admin=${cfg.adminEmail}  student=${cfg.studentId ?? '(unset)'}\n`);

  const session = await signIn(cfg);
  if (!session.access_token) fail('Sign-in returned no access_token');
  const cookie = buildCookieHeader(cfg, session);

  // ===== Phase A: read-only =================================================

  await step('GET  incidents/mine', async () => {
    const r = await request(cfg, cookie, 'GET', '/api/incidents/mine');
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    if (!Array.isArray(r.json?.data)) return { fail: 'data not array', http: r.status };
    return { http: r.status, detail: `${r.json.data.length} own incidents` };
  });

  await step('GET  incidents/pending-review', async () => {
    const r = await request(cfg, cookie, 'GET', '/api/incidents/pending-review');
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    if (!Array.isArray(r.json?.data)) return { fail: 'data not array', http: r.status };
    return { http: r.status, detail: `${r.json.data.length} in queue` };
  });

  await step('GET  incidents/students/search', async () => {
    const qs = new URLSearchParams({ q: cfg.studentSearchQ, limit: '5' });
    const r = await request(cfg, cookie, 'GET', `/api/incidents/students/search?${qs}`);
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    if (!Array.isArray(r.json?.data)) return { fail: 'data not array', http: r.status };
    return { http: r.status, detail: `${r.json.data.length} matches for "${cfg.studentSearchQ}"` };
  });

  // ===== Phase B: submit + recheck mine =====================================

  let incidentId = null;

  await step('POST incidents (submit)', async () => {
    if (!cfg.studentId) return { skip: 'SMOKE_STUDENT_ID not set' };
    const r = await request(cfg, cookie, 'POST', '/api/incidents', {
      student_id: Number(cfg.studentId.match(/^\d+$/) ? cfg.studentId : NaN) || cfg.studentId,
      incident_type: 'other',
      severity: 'low',
      description: 'sprint3-smoke — تجربة آلية للتدفّق. ستُسحَب فورًا في نفس الجلسة.',
    });
    if (r.status !== 201) return { fail: 'expected 201, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    incidentId = r.json?.data?.id ?? null;
    if (!incidentId) return { fail: 'no incident id returned', http: r.status };
    return { http: r.status, detail: `incident_id=${incidentId}` };
  });

  await step('GET  incidents/mine (re-fetch — must contain new)', async () => {
    if (!incidentId) return { skip: 'no incident created' };
    const r = await request(cfg, cookie, 'GET', '/api/incidents/mine');
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status, http: r.status };
    const found = (r.json?.data ?? []).some((i) => i.id === incidentId);
    if (!found) return { fail: `incident ${incidentId} missing from mine list`, http: r.status };
    return { http: r.status, detail: `incident ${incidentId} present` };
  });

  // ===== Phase C: self-review guard =========================================

  await step('PATCH dismiss (self-review must be blocked)', async () => {
    if (!incidentId) return { skip: 'no incident created' };
    const r = await request(cfg, cookie, 'PATCH', `/api/incidents/${incidentId}/dismiss`, {
      review_notes: 'sprint3-smoke self-review guard probe',
    });
    if (r.status !== 403) return { fail: 'expected 403 self-review block, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    return { http: r.status, detail: 'self-review correctly blocked' };
  });

  // ===== Phase D: withdraw + post-withdraw mine =============================

  await step('DELETE incidents/{id}/withdraw', async () => {
    if (!incidentId) return { skip: 'no incident created' };
    const r = await request(cfg, cookie, 'DELETE', `/api/incidents/${incidentId}/withdraw`);
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status + ': ' + (r.json?.error || r.text), http: r.status };
    if (r.json?.data?.withdrawn !== true) return { fail: 'response shape unexpected', http: r.status };
    return { http: r.status, detail: 'withdrawn ok' };
  });

  await step('GET  incidents/mine (post-withdraw — must NOT contain)', async () => {
    if (!incidentId) return { skip: 'no incident created' };
    const r = await request(cfg, cookie, 'GET', '/api/incidents/mine');
    if (r.status !== 200) return { fail: 'expected 200, got ' + r.status, http: r.status };
    const stillThere = (r.json?.data ?? []).some((i) => i.id === incidentId);
    if (stillThere) return { fail: `withdrawn incident ${incidentId} still in mine list`, http: r.status };
    return { http: r.status, detail: 'incident removed' };
  });

  // ===== Summary ============================================================

  printSummary();
  const failed = results.filter((r) => r.status === 'FAIL').length;
  process.exit(failed === 0 ? 0 : 1);
}

function printSummary() {
  console.log('');
  console.log('┌' + '─'.repeat(78) + '┐');
  console.log('│ ' + 'Sprint 3 incidents smoke — results'.padEnd(76) + ' │');
  console.log('├' + '─'.repeat(78) + '┤');
  for (const r of results) {
    const line =
      ' ' + r.name.padEnd(46) +
      ' ' + r.status.padEnd(4) +
      ' ' + String(r.http).padStart(3) +
      ' ' + (String(r.ms) + 'ms').padStart(7) +
      (r.detail ? '  ' + r.detail : '');
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

  // Print full FAIL details below the table (truncation-safe — added
  // because sprint2 hid useful diagnostic text inside truncated rows).
  const failedRows = results.filter((r) => r.status === 'FAIL');
  if (failedRows.length > 0) {
    console.log('');
    console.log('Failure details:');
    for (const r of failedRows) {
      console.log(`  - ${r.name}: [${r.http}] ${r.detail}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n[smoke:CRASH] ' + (err.stack || err.message || err) + '\n');
  process.exit(3);
});
