// READ-ONLY diagnostic — migration ordering / forward-reference check.
//
// Does NOT touch any database. It only reads supabase/migrations/*.sql and
// reports cases where a function is USED before it is available. This
// repository has an explicit supabase/schema.sql baseline; functions defined
// there are treated as available before the first chronological migration.
// That is the DB-02 class.
//
// Usage:  node scripts/migration-order-check.mjs
// Exit:   0 = no forward references found · 1 = at least one risk found.
//
// Heuristic notes (kept honest — this is a static scan, not a SQL parser):
//   - Comments (-- and /* */) are stripped before matching.
//   - A "use" = the function name followed by "(" anywhere in a LATER-or-
//     equal... no: in an EARLIER file than its first definition. GRANT /
//     COMMENT / REVOKE mention the name too, but those almost always sit in
//     the SAME file as the definition, so they don't produce cross-file
//     false positives. Treat a flag as "investigate", not "proven broken".

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const BASELINE = join(process.cwd(), 'supabase', 'schema.sql');

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort(); // ascending filename = supabase CLI apply order

function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')        // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' '); // block comments
}

// Lower-cased, comment-stripped text per file (SQL folds unquoted idents).
const text = files.map((f) =>
  stripComments(readFileSync(join(DIR, f), 'utf8')).toLowerCase(),
);
const baselineText = stripComments(readFileSync(BASELINE, 'utf8')).toLowerCase();

// 1) First-definition index per function name.
const firstDef = new Map(); // name -> { idx, file }
const defRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?\s*\(/g;

let baselineMatch;
while ((baselineMatch = defRe.exec(baselineText))) {
  firstDef.set(baselineMatch[1], { idx: -1, file: 'supabase/schema.sql (baseline)' });
}

text.forEach((sql, i) => {
  defRe.lastIndex = 0;
  let m;
  while ((m = defRe.exec(sql))) {
    const name = m[1];
    const prev = firstDef.get(name);
    if (!prev || i < prev.idx) firstDef.set(name, { idx: i, file: files[i] });
  }
});

// 2) For each defined function, find the earliest file that USES it
//    (excluding the CREATE FUNCTION definition sites themselves).
const findings = [];
for (const [name, def] of firstDef) {
  const callRe = new RegExp(`\\b${name}\\s*\\(`); // non-global: boolean test
  const stripDefRe = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?["']?${name}["']?\\s*\\(`,
    'g',
  );
  let firstUseIdx = Infinity;
  let firstUseFile = null;
  text.forEach((sql, i) => {
    const withoutDefs = sql.replace(stripDefRe, ' ');
    if (callRe.test(withoutDefs) && i < firstUseIdx) {
      firstUseIdx = i;
      firstUseFile = files[i];
    }
  });
  if (firstUseIdx < def.idx) {
    findings.push({ name, def, useIdx: firstUseIdx, useFile: firstUseFile });
  }
}

// 3) Report.
console.log('=== Baseline + apply order (ascending filename = migration order) ===');
console.log('  base supabase/schema.sql');
files.forEach((f, i) => console.log(`  ${String(i).padStart(3, '0')}  ${f}`));
console.log(
  `\n${files.length} migrations · ${firstDef.size} function definitions.\n`,
);

if (findings.length === 0) {
  console.log(
    'OK — no forward function references found.\n' +
      'A baseline + migrations restore should pass check_function_bodies=on (no DB-02 ordering break detected).',
  );
} else {
  console.log(
    `RISK — ${findings.length} forward reference(s). On a clean restore these may fail\n` +
      'under check_function_bodies=on (used before defined):\n',
  );
  for (const f of findings) {
    console.log(`  x  ${f.name}()`);
    console.log(`        used    in [${String(f.useIdx).padStart(3, '0')}] ${f.useFile}`);
    console.log(`        defined in [${String(f.def.idx).padStart(3, '0')}] ${f.def.file}  <- LATER`);
  }
  console.log(
    '\nFix (DB-02 / Wave B B1): renumber the defining migration to sort BEFORE\n' +
      'its first use, or move the function definition earlier. Re-run this check.',
  );
  process.exitCode = 1;
}
