#!/usr/bin/env node

/**
 * Load test: simulates N teachers saving period-attendance simultaneously.
 *
 * Usage:
 *   node scripts/load-test-attendance.js
 *
 * Configurable via env (.env.local is read automatically):
 *   BASE_URL                — e.g. https://alkmara.vercel.app (default)
 *   ADMIN_EMAIL             — sign-in account (defaults to load test admin)
 *   ADMIN_PASSWORD          — password for that account
 *   CONCURRENCY             — how many parallel saves (default 28)
 *   DRY_RUN                 — "true" → don't actually POST, just print the plan
 *
 * What it does:
 *   1. Signs in once → gets a JWT cookie
 *   2. Fetches all sections (RLS lets admin see all of them)
 *   3. Picks N sections (or duplicates if there are fewer)
 *   4. Fires N parallel POSTs to /api/period-attendance with random absences
 *   5. Prints per-request latency, success/failure, and summary stats:
 *      total time, p50/p95/p99, error rate.
 *
 * Why this matters:
 *   The save path does ~6 DB queries per request. Running them concurrently
 *   stresses Postgres connection pool, RLS evaluation, and the upsert path.
 *   This catches issues you wouldn't find with sequential testing.
 */

// Read .env.local manually so we don't need a dotenv dep just for this script.
// Lines like  KEY="value with spaces"  or  KEY=value  are supported.
(function loadEnvLocal() {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
})();

const BASE_URL = (process.env.BASE_URL || 'https://alkmara.vercel.app').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.LOAD_TEST_EMAIL || process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.LOAD_TEST_PASSWORD || process.env.ADMIN_PASSWORD;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '28', 10);
const DRY_RUN = process.env.DRY_RUN === 'true';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ Set ADMIN_EMAIL and ADMIN_PASSWORD (or LOAD_TEST_EMAIL/PASSWORD) in .env.local');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY required');
  process.exit(1);
}

// ---------- Helpers ----------

function fmt(n) { return n.toFixed(0).padStart(4); }
function pct(p, sorted) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function signIn() {
  // Sign in directly with Supabase to get an access token. The /api routes
  // honor the Authorization: Bearer header via @supabase/ssr.
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!r.ok) {
    const e = await r.text();
    throw new Error(`Sign-in failed (HTTP ${r.status}): ${e}`);
  }
  const d = await r.json();
  return { accessToken: d.access_token, refreshToken: d.refresh_token };
}

async function authedFetch(path, opts = {}, accessToken) {
  // Inject the Supabase session cookies that @supabase/ssr expects.
  // Format: sb-<project-ref>-auth-token = base64-(JSON of session)
  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
  const sessionJson = JSON.stringify({
    access_token: accessToken,
    refresh_token: '',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
  });
  const cookieValue = 'base64-' + Buffer.from(sessionJson).toString('base64');
  const cookie = `sb-${projectRef}-auth-token=${cookieValue}`;

  return fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      cookie,
      Authorization: `Bearer ${accessToken}`,
      ...(opts.headers || {}),
    },
  });
}

async function listSections(accessToken) {
  const r = await authedFetch('/api/sections', {}, accessToken);
  if (!r.ok) throw new Error(`Sections fetch failed: HTTP ${r.status}`);
  const d = await r.json();
  return d.data || [];
}

async function listPeriods(accessToken) {
  const r = await authedFetch('/api/periods', {}, accessToken);
  if (!r.ok) throw new Error(`Periods fetch failed: HTTP ${r.status}`);
  const d = await r.json();
  return d.data || [];
}

async function listStudentsInSection(accessToken, sectionId) {
  const r = await authedFetch(`/api/students?section_id=${sectionId}&limit=500`, {}, accessToken);
  if (!r.ok) return [];
  const d = await r.json();
  return d.data || [];
}

// One simulated save. Returns { ok, ms, error?, status? }.
async function simulateSave(accessToken, sectionId, periodId, attendanceDate, studentIds) {
  // Random absences (~10-25% of the section). Keeps the test realistic.
  const absentRate = 0.10 + Math.random() * 0.15;
  const absences = studentIds
    .filter(() => Math.random() < absentRate)
    .map((sid) => {
      const r = Math.random();
      const status = r < 0.6 ? 'absent' : r < 0.85 ? 'late' : 'excused';
      return { student_id: sid, status };
    });

  const t0 = Date.now();
  try {
    const res = await authedFetch('/api/period-attendance', {
      method: 'POST',
      body: JSON.stringify({
        section_id: sectionId,
        period_id: periodId,
        attendance_date: attendanceDate,
        absences,
      }),
    }, accessToken);
    const ms = Date.now() - t0;
    if (!res.ok) {
      let msg;
      try { msg = (await res.json()).error; } catch { msg = await res.text(); }
      return { ok: false, ms, status: res.status, error: msg };
    }
    const d = await res.json();
    return { ok: true, ms, data: d.data, absentCount: absences.length };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.message };
  }
}

// ---------- Main ----------

(async () => {
  console.log(`\n🧪 Load test — ${CONCURRENCY} simultaneous attendance saves`);
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Admin:  ${ADMIN_EMAIL}`);
  console.log(`   Date:   ${new Date().toISOString().slice(0, 10)} (today)\n`);

  console.log('🔑 Signing in...');
  const { accessToken } = await signIn();
  console.log('   ✓ Got access token\n');

  console.log('📋 Fetching sections + periods...');
  const [sections, periods] = await Promise.all([
    listSections(accessToken),
    listPeriods(accessToken),
  ]);
  console.log(`   ✓ ${sections.length} section(s), ${periods.length} period(s)\n`);

  if (sections.length === 0 || periods.length === 0) {
    console.error('❌ Need at least 1 section and 1 period to run the test.');
    process.exit(1);
  }

  // Pick CONCURRENCY sections (cycle if fewer than CONCURRENCY exist).
  const targetSections = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    targetSections.push(sections[i % sections.length]);
  }
  const periodId = periods[0].id;
  const attendanceDate = new Date().toISOString().slice(0, 10);

  // Prefetch student lists per section so the actual save call is tight.
  console.log('👥 Loading students per section (sequential warm-up)...');
  const studentsBySection = new Map();
  const uniqueSectionIds = [...new Set(targetSections.map((s) => s.id))];
  for (const sid of uniqueSectionIds) {
    const list = await listStudentsInSection(accessToken, sid);
    studentsBySection.set(sid, list.map((s) => s.id));
  }
  const totalStudents = [...studentsBySection.values()].reduce((acc, arr) => acc + arr.length, 0);
  console.log(`   ✓ ${totalStudents} student(s) loaded across ${uniqueSectionIds.length} section(s)\n`);

  if (DRY_RUN) {
    console.log('✋ DRY_RUN=true — exiting before firing requests.');
    return;
  }

  // ---------- The actual concurrent burst ----------
  console.log(`🚀 Firing ${CONCURRENCY} parallel POSTs to /api/period-attendance ...`);
  const tStart = Date.now();
  const results = await Promise.all(
    targetSections.map((sec) =>
      simulateSave(accessToken, sec.id, periodId, attendanceDate, studentsBySection.get(sec.id) || []),
    ),
  );
  const totalMs = Date.now() - tStart;
  console.log(`   ✓ Done in ${totalMs} ms\n`);

  // ---------- Stats ----------
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const totalAbsences = ok.reduce((acc, r) => acc + (r.absentCount || 0), 0);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 RESULTS\n');
  console.log(`   Concurrency       : ${CONCURRENCY}`);
  console.log(`   Successful saves  : ${ok.length} / ${results.length}  (${((ok.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`   Failed saves      : ${fail.length}`);
  console.log(`   Total absences    : ${totalAbsences} (across all saves)`);
  console.log('');
  console.log('   Wall-clock total  : ' + fmt(totalMs) + ' ms');
  console.log('   Latency min       : ' + fmt(latencies[0] || 0) + ' ms');
  console.log('   Latency p50       : ' + fmt(pct(50, latencies)) + ' ms');
  console.log('   Latency p95       : ' + fmt(pct(95, latencies)) + ' ms');
  console.log('   Latency p99       : ' + fmt(pct(99, latencies)) + ' ms');
  console.log('   Latency max       : ' + fmt(latencies[latencies.length - 1] || 0) + ' ms');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (fail.length > 0) {
    console.log('❌ Failures:');
    fail.slice(0, 10).forEach((f, i) => {
      console.log(`   ${i + 1}. HTTP ${f.status || '?'} after ${f.ms}ms — ${f.error}`);
    });
    if (fail.length > 10) console.log(`   ... and ${fail.length - 10} more`);
    process.exit(1);
  }

  // Quick verdict
  const p95 = pct(95, latencies);
  if (p95 < 1000) {
    console.log('✅ EXCELLENT — p95 under 1s, system handles the burst comfortably.');
  } else if (p95 < 2500) {
    console.log('🟡 ACCEPTABLE — p95 between 1-2.5s. Consider Supabase Pro for headroom.');
  } else {
    console.log('🟠 SLOW — p95 over 2.5s. Investigate connection pool or scaling.');
  }
})().catch((e) => {
  console.error('\n💥 Test crashed:', e.message);
  process.exit(1);
});
