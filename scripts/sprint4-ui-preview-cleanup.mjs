// Sprint 4 UI preview — cleanup.
//
// Reverses sprint4-ui-preview-setup.mjs:
//   1. Delete seeded case (CASCADE removes session + case_history rows;
//      student_notes.case_id is SET NULL but the note row is hit below).
//   2. Delete seeded student_notes (marker-based).
//   3. Delete confidential_access_log rows attributed to test users.
//   4. Delete user_profiles + auth.users for the 3 test accounts (CASCADE
//      sweeps counselor_assignments + teacher_section_assignments via the
//      FK ON DELETE CASCADE).
//
// Safe to run multiple times — every step uses marker / known-uuid filters.

import { createClient } from '@supabase/supabase-js';

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const admin = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAILS = [
  'smoke.super.4ui@test.local',
  'smoke.counselor.4ui@test.local',
  'smoke.teacher.4ui@test.local',
];

const SMOKE_MARKER = 'M4.18 PREVIEW SMOKE';

async function main() {
  console.log('\n=== Sprint 4 UI preview cleanup ===\n');

  // Resolve user ids first.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1, perPage: 200,
  });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);
  const testUsers = (list?.users || []).filter((u) => EMAILS.includes(u.email));
  const testIds = testUsers.map((u) => u.id);
  console.log(`Found ${testUsers.length}/${EMAILS.length} test users.`);

  // 1. Delete seeded cases — LIKE match covers every case the setup
  //    seeds under the SMOKE_MARKER prefix: the м4.18 single case, the
  //    four м4.19 status variants, and the м4.20 out-of-scope case.
  //    CASCADE on student_cases sweeps sessions / case_history / plans.
  console.log('Deleting seeded cases…');
  const { error: cErr, count: cCnt } = await admin
    .from('student_cases')
    .delete({ count: 'exact' })
    .like('title', SMOKE_MARKER + '%');
  if (cErr) console.error(`  case delete: ${cErr.message}`);
  else console.log(`  removed ${cCnt ?? 0} case(s)`);

  // 2. Delete seeded notes (marker-based — case-id was SET NULL on cascade above).
  // ALSO catches QA-added notes that the manual checklist creates with
  // their own prefix (`QA_SECTION%`) plus any earlier "M4.21.1 PREVIEW%"
  // sample — we match by recorded_by being a test user to be robust
  // even if the prefix conventions drift.
  console.log('Deleting seeded notes…');
  let noteFilters = admin
    .from('student_notes')
    .delete({ count: 'exact' });
  if (testIds.length > 0) {
    noteFilters = noteFilters.in('recorded_by', testIds);
  } else {
    // fall back to text-prefix when we couldn't resolve user ids
    noteFilters = noteFilters.or(`text.like.${SMOKE_MARKER}%,text.like.QA_SECTION%,text.like.M4.21.1 PREVIEW%`);
  }
  const { error: nErr, count: nCnt } = await noteFilters;
  if (nErr) console.error(`  note delete: ${nErr.message}`);
  else console.log(`  removed ${nCnt ?? 0} note(s)`);

  // 3. Delete confidential_access_log rows by test users.
  if (testIds.length > 0) {
    console.log('Deleting confidential_access_log rows…');
    const { error: lErr, count: lCnt } = await admin
      .from('confidential_access_log')
      .delete({ count: 'exact' })
      .in('accessed_by', testIds);
    if (lErr) console.error(`  access_log delete: ${lErr.message}`);
    else console.log(`  removed ${lCnt ?? 0} log row(s)`);
  }

  // 4. Delete auth.users (cascade hits user_profiles + counselor/teacher
  //    assignments via their FK ON DELETE CASCADE).
  for (const u of testUsers) {
    console.log(`Deleting ${u.email}…`);
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) console.error(`  ${u.email}: ${error.message}`);
    else console.log(`  removed`);
  }

  console.log('\n=== CLEANUP COMPLETE ===\n');
}

main().catch((err) => {
  console.error('\n[cleanup:FATAL]', err.message);
  process.exit(1);
});
