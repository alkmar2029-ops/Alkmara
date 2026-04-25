// Pull all students from Supabase (using SERVICE_ROLE_KEY to bypass RLS)
// and save them as JSON + CSV under ./device-data/.
//
// Usage:  node pull-students-from-db.js
//
// Env (read from .env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[!] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const PAGE = 1000;

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

(async () => {
  console.log('[*] Connecting to Supabase...');
  console.log(`    URL: ${SUPABASE_URL}`);

  const all = [];
  let from = 0;

  while (true) {
    const { data, error } = await sb
      .from('students')
      .select('*, grades(name, stage), sections(name)')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      console.error('[!] ERROR:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    console.log(`    fetched ${all.length} so far...`);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`[+] Total students: ${all.length}`);
  if (all.length > 0) {
    const active = all.filter((s) => s.is_active).length;
    console.log(`    active: ${active} | inactive: ${all.length - active}`);
  }

  const outDir = path.join(__dirname, 'device-data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // JSON (raw with joined grade/section)
  const jsonPath = path.join(outDir, `students-db-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2), 'utf8');

  // CSV (flattened)
  const headers = [
    'id', 'student_id', 'device_uid',
    'first_name', 'father_name', 'last_name',
    'email', 'phone',
    'grade_id', 'grade_name', 'grade_stage',
    'section_id', 'section_name',
    'is_fingerprint_enrolled', 'enrolled_at',
    'is_active', 'notes',
    'created_at', 'updated_at',
  ];
  const lines = [headers.join(',')];
  for (const s of all) {
    lines.push([
      csvCell(s.id),
      csvCell(s.student_id),
      csvCell(s.device_uid),
      csvCell(s.first_name),
      csvCell(s.father_name),
      csvCell(s.last_name),
      csvCell(s.email),
      csvCell(s.phone),
      csvCell(s.grade_id),
      csvCell(s.grades && s.grades.name),
      csvCell(s.grades && s.grades.stage),
      csvCell(s.section_id),
      csvCell(s.sections && s.sections.name),
      csvCell(s.is_fingerprint_enrolled),
      csvCell(s.enrolled_at),
      csvCell(s.is_active),
      csvCell(s.notes),
      csvCell(s.created_at),
      csvCell(s.updated_at),
    ].join(','));
  }
  const csvPath = path.join(outDir, `students-db-${stamp}.csv`);
  fs.writeFileSync(csvPath, '﻿' + lines.join('\n'), 'utf8');

  console.log(`\n[✓] Saved to ./device-data/`);
  console.log(`    - students-db-${stamp}.json`);
  console.log(`    - students-db-${stamp}.csv`);
})().catch((e) => {
  console.error('[!] Fatal:', e.message);
  process.exit(1);
});
