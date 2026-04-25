// Migrate all data from the source Supabase project (in .env.local) to a new
// target project. Schema (tables, RLS, RPCs, triggers) must be applied to the
// target project FIRST via SQL Editor — this script only copies row data.
//
// Usage:
//   TARGET_SUPABASE_URL=https://NEW.supabase.co \
//   TARGET_SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node migrate-to-new-project.js
//
// What this DOES:
//   - Reads source from .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
//   - Writes target via TARGET_* env vars
//   - Copies tables in FK-safe order, deleting any seed rows in target first
//
// What this does NOT do:
//   - auth.users (passwords, emails) — those need to be re-created
//   - user_profiles / audit_logs that reference auth.users (FK would fail)
//   - DDL — schema.sql must already be applied to target
//   - Sequences — prints SQL at the end for you to run in SQL Editor

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvLocal() {
  const file = path.join(__dirname, '.env.local');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const SOURCE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SOURCE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_URL = process.env.TARGET_SUPABASE_URL;
const TARGET_KEY = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;

if (!SOURCE_URL || !SOURCE_KEY) {
  console.error('[!] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!TARGET_URL || !TARGET_KEY) {
  console.error('[!] Missing TARGET_SUPABASE_URL or TARGET_SUPABASE_SERVICE_ROLE_KEY (pass via env)');
  process.exit(1);
}
if (TARGET_URL === SOURCE_URL) {
  console.error('[!] Refusing to run: target URL equals source URL');
  process.exit(1);
}

const src = createClient(SOURCE_URL, SOURCE_KEY, { auth: { persistSession: false } });
const dst = createClient(TARGET_URL, TARGET_KEY, { auth: { persistSession: false } });

// FK-safe order. user_profiles & audit_logs are skipped (depend on auth.users).
const ORDER = [
  { table: 'departments' },
  { table: 'semesters' },
  { table: 'grades' },
  { table: 'school_settings' },
  { table: 'sections' },
  { table: 'devices' },
  { table: 'classes' },
  { table: 'students' },
  { table: 'class_schedules' },
  { table: 'class_enrollments' },
  { table: 'attendance_records' },
  { table: 'device_sync_logs' },
];

// Per-table sanitizers: drop columns that exist in source but not in target,
// and remap legacy values that violate target CHECK constraints.
const STAGE_MAP = { high: 'secondary', secondary: 'secondary', elementary: 'elementary', middle: 'middle' };

function sanitize(table, row) {
  const out = { ...row };
  switch (table) {
    case 'grades':
      delete out.created_at;
      if (out.stage && STAGE_MAP[out.stage]) out.stage = STAGE_MAP[out.stage];
      break;
    case 'sections':
      delete out.created_at;
      break;
    case 'school_settings':
      delete out.created_at;
      if (out.stage && STAGE_MAP[out.stage]) out.stage = STAGE_MAP[out.stage];
      break;
    case 'students':
      // No transformations expected; future-proof if columns drift.
      break;
    case 'devices':
    case 'attendance_records':
    case 'device_sync_logs':
    default:
      break;
  }
  return out;
}

const PAGE = 1000;

async function fetchAll(client, table) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await client.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function clearTarget(table) {
  // delete all rows; we use gt('id', -1) to satisfy PostgREST's "must have filter" rule
  const { error } = await dst.from(table).delete().gt('id', -1);
  if (error) {
    // school_settings has id=1 from schema seed; if id column missing, fall back
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

async function copyTable({ table }) {
  console.log(`\n[*] ${table}`);
  let rows;
  try {
    rows = await fetchAll(src, table);
  } catch (e) {
    console.log(`    [-] source error: ${e.message || e}`);
    return { table, copied: 0, error: e.message || String(e) };
  }
  console.log(`    fetched ${rows.length} rows from source`);
  if (rows.length === 0) {
    // still clear target to avoid leftover seed rows
    await clearTarget(table);
    return { table, copied: 0 };
  }

  const clear = await clearTarget(table);
  if (!clear.ok) console.log(`    [warn] clear target: ${clear.message}`);

  const sanitized = rows.map((r) => sanitize(table, r));

  const BATCH = 500;
  let copied = 0;
  let firstErr = null;
  for (let i = 0; i < sanitized.length; i += BATCH) {
    const slice = sanitized.slice(i, i + BATCH);
    const { error } = await dst.from(table).insert(slice);
    if (error) {
      if (!firstErr) firstErr = error.message;
      console.log(`    [!] batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
    } else {
      copied += slice.length;
    }
  }
  console.log(`    inserted ${copied}/${rows.length}`);
  return { table, copied, total: rows.length, error: firstErr };
}

(async () => {
  console.log('=== Migration ===');
  console.log('Source:', SOURCE_URL);
  console.log('Target:', TARGET_URL);
  console.log('');

  const results = [];
  for (const item of ORDER) {
    try {
      results.push(await copyTable(item));
    } catch (e) {
      console.error(`[!] ${item.table} fatal:`, e.message || e);
      results.push({ table: item.table, error: e.message || String(e) });
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    const total = r.total ?? r.copied ?? 0;
    if (r.error) console.log(`  X ${r.table}: ${r.error}`);
    else console.log(`  OK ${r.table}: ${r.copied}/${total}`);
  }

  const seqTables = ORDER.map((o) => o.table);
  console.log('\n=== Run this in target SQL Editor to fix sequences: ===');
  for (const t of seqTables) {
    console.log(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1), true);`);
  }
  console.log(`SELECT setval('students_device_uid_seq', GREATEST((SELECT COALESCE(MAX(device_uid), 0) FROM students), 1), true);`);

  console.log('\n=== NOT migrated (require manual setup): ===');
  console.log('  - auth.users (re-register users in target dashboard)');
  console.log('  - user_profiles (depends on auth.users; will be auto-created by trigger)');
  console.log('  - audit_logs (depends on auth.users)');
})().catch((e) => { console.error('[!] Fatal:', e); process.exit(1); });
