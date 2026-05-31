// Sprint 4 UI preview — setup test users + seed data.
//
// Creates 3 temporary accounts the user can sign in with to exercise
// م4.18 (counselor workspace shell) in the browser:
//
//   1. smoke.super.4ui@test.local       — role=super_admin
//   2. smoke.counselor.4ui@test.local   — role=admin + persona=counselor +
//                                         counselor_assignments to an existing section
//   3. smoke.teacher.4ui@test.local     — role=teacher (used as the "non-counselor,
//                                         non-super" probe — should be blocked)
//
// Also seeds 1 case + 1 session + 1 confidential note for the
// counselor's section's student, so the dashboard isn't empty.
//
// Passwords are echoed back at the end so the operator can paste them
// into the browser. Cleanup is a separate script (sprint4-ui-preview-cleanup.mjs).
//
// Required env (via --env-file=.env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Idempotent: if a user already exists from a prior run, we re-use it
// (re-set role/persona/permissions). Same for seed data — looked up by
// the marker title 'M4.18 SMOKE'.

import { createClient } from '@supabase/supabase-js';

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run via: node --env-file=.env.local scripts/sprint4-ui-preview-setup.mjs');
  process.exit(2);
}

const admin = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Deterministic test passwords. Echoed back at the end.
const USERS = {
  super: {
    email: 'smoke.super.4ui@test.local',
    password: 'M4UiSmoke!Super2026',
    role: 'super_admin',
    permissions: {},
    full_name: 'مشرف اختبار م4.18',
  },
  counselor: {
    email: 'smoke.counselor.4ui@test.local',
    password: 'M4UiSmoke!Counselor2026',
    role: 'admin',
    permissions: { persona: 'counselor' },
    full_name: 'مرشد اختبار م4.18',
  },
  teacher: {
    email: 'smoke.teacher.4ui@test.local',
    password: 'M4UiSmoke!Teacher2026',
    role: 'teacher',
    permissions: {},
    full_name: 'معلم اختبار م4.18',
  },
};

const SMOKE_MARKER = 'M4.18 PREVIEW SMOKE';

async function findOrCreateUser(key) {
  const cfg = USERS[key];

  // List & find by email (admin.listUsers paginates but in our small
  // staging the first page is enough).
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1, perPage: 200,
  });
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
  const existing = list?.users?.find((u) => u.email === cfg.email);

  let userId;
  if (existing) {
    userId = existing.id;
    // Reset password in case a prior run left a different one.
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: cfg.password,
      email_confirm: true,
    });
    if (error) throw new Error(`updateUser ${cfg.email}: ${error.message}`);
    console.log(`  [reused] ${cfg.email} (${userId})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: cfg.email,
      password: cfg.password,
      email_confirm: true,
    });
    if (error || !data?.user) throw new Error(`createUser ${cfg.email}: ${error?.message}`);
    userId = data.user.id;
    console.log(`  [created] ${cfg.email} (${userId})`);
  }

  // The auth.users insert trigger usually creates a user_profiles row.
  // Upsert with our desired role/persona/permissions/full_name so a
  // freshly-created row OR a stale one from a prior run both end up
  // with the right shape.
  const { error: upErr } = await admin
    .from('user_profiles')
    .upsert(
      {
        user_id: userId,
        role: cfg.role,
        full_name: cfg.full_name,
        permissions: cfg.permissions,
      },
      { onConflict: 'user_id' },
    );
  if (upErr) throw new Error(`upsert profile ${cfg.email}: ${upErr.message}`);

  return userId;
}

async function main() {
  console.log('\n=== Sprint 4 UI preview setup ===\n');
  console.log('Provisioning test users…');
  const superId    = await findOrCreateUser('super');
  const counselorId = await findOrCreateUser('counselor');
  const teacherId   = await findOrCreateUser('teacher');

  // ---- Pick a target student + section ----
  // We want a real student in an active section so the seeded case is
  // realistic. Take the lowest active student id (deterministic).
  console.log('\nResolving target student + section…');
  const { data: target, error: tgtErr } = await admin
    .from('students')
    .select('id, section_id, first_name, last_name')
    .not('section_id', 'is', null)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (tgtErr || !target) throw new Error(`student fetch: ${tgtErr?.message || 'none'}`);
  console.log(`  target student: ${target.first_name} ${target.last_name} (id=${target.id}, section=${target.section_id})`);

  // A different section so the teacher's assignment doesn't accidentally
  // overlap the counselor's scope.
  const { data: otherSec, error: oErr } = await admin
    .from('sections')
    .select('id')
    .neq('id', target.section_id)
    .limit(1)
    .maybeSingle();
  if (oErr || !otherSec) throw new Error(`other section: ${oErr?.message || 'none'}`);

  // ---- Counselor assignment ----
  // ON CONFLICT (counselor_user_id, section_id) where grade_id IS NULL.
  console.log('\nWiring counselor_assignments…');
  await admin.from('counselor_assignments').delete().eq('counselor_user_id', counselorId);
  const { error: caErr } = await admin
    .from('counselor_assignments')
    .insert({ counselor_user_id: counselorId, section_id: target.section_id });
  if (caErr) throw new Error(`counselor_assignments: ${caErr.message}`);

  // ---- Teacher assignment (different section) ----
  console.log('Wiring teacher_section_assignments…');
  await admin.from('teacher_section_assignments').delete().eq('teacher_user_id', teacherId);
  const { error: taErr } = await admin
    .from('teacher_section_assignments')
    .insert({ teacher_user_id: teacherId, section_id: otherSec.id });
  if (taErr) throw new Error(`teacher_section_assignments: ${taErr.message}`);

  // ---- Seed 4 cases (one per status) + session + confidential note ----
  // 4 cases cover the م4.19 Kanban's status columns (open / in_progress /
  // resolved / closed) — and the case linked to the session/note is the
  // 'open' one so the م4.18 workspace still has an active case to display.
  //
  // Severities chosen so each Kanban column shows a different badge color
  // (low / medium / high / critical), exercising the severity dropdown
  // filter too.
  //
  // status='resolved' requires resolution NOT NULL + length >= 20.
  // status='closed' requires close_reason NOT NULL + length >= 5.
  // Both come from the cases_resolved_needs_resolution /
  // cases_closed_needs_close_reason CHECK constraints (م4.2).
  console.log('\nClearing prior seeded smoke rows (idempotent)…');
  await admin.from('student_cases').delete().like('title', SMOKE_MARKER + '%');

  console.log('Seeding 4 cases (one per status)…');
  const CASE_SEEDS = [
    { status: 'open',        severity: 'medium',   suffix: 'open',        extras: {} },
    { status: 'in_progress', severity: 'high',     suffix: 'in_progress', extras: {} },
    { status: 'resolved',    severity: 'low',      suffix: 'resolved',    extras: {
      resolution: 'تم حل الحالة بعد جلستين فرديتين ومتابعة قصيرة. لا حاجة لمزيد من التدخل.',
      // updated_at is auto-set by trigger; we let it stay = NOW().
    } },
    { status: 'closed',      severity: 'critical', suffix: 'closed',      extras: {
      close_reason: 'تم إقفال الحالة بعد إحالتها لمختص خارجي.',
    } },
  ];

  const caseRows = [];
  for (const seed of CASE_SEEDS) {
    const { data, error } = await admin
      .from('student_cases')
      .insert({
        student_id: target.id,
        created_by: counselorId,
        title: `${SMOKE_MARKER} — case (${seed.suffix})`,
        description: `حالة اختبار م4.19 — ${seed.suffix}. ستُمسح بعد القفل.`,
        case_type: 'behavioral',
        severity: seed.severity,
        status: seed.status,
        ...seed.extras,
      })
      .select('id, status')
      .single();
    if (error) throw new Error(`seed case (${seed.suffix}): ${error.message}`);
    caseRows.push(data);
  }
  const openCase = caseRows.find((c) => c.status === 'open');
  if (!openCase) throw new Error('seed: open case missing — cannot attach session/note');

  // ----- Generate ONE case_history row by transitioning the in_progress case -----
  // The case_history trigger only fires AFTER UPDATE OF status — INSERT
  // alone doesn't populate the audit. To get a real history row for the
  // м4.20 timeline-merger test, we toggle the in_progress case's status
  // to 'open' and back. End state matches the original INSERT
  // (status='in_progress') so the Kanban column placement isn't affected.
  const inProgressCase = caseRows.find((c) => c.status === 'in_progress');
  if (inProgressCase) {
    console.log('Generating 1 case_history row (in_progress→open→in_progress)…');
    const { error: t1 } = await admin
      .from('student_cases')
      .update({ status: 'open' })
      .eq('id', inProgressCase.id);
    if (t1) throw new Error(`history transition 1: ${t1.message}`);
    const { error: t2 } = await admin
      .from('student_cases')
      .update({ status: 'in_progress' })
      .eq('id', inProgressCase.id);
    if (t2) throw new Error(`history transition 2: ${t2.message}`);
  }

  // ----- Seed ONE plan attached to the open case (м4.20 timeline needs plans) -----
  console.log('Seeding 1 followup plan (attached to open case)…');
  const { error: planErr } = await admin
    .from('student_followup_plans')
    .insert({
      case_id: openCase.id,
      created_by: counselorId,
      title: SMOKE_MARKER + ' — plan title',
      description: 'خطة متابعة اختبارية لـ م4.20 — تتضمن وصفًا يتجاوز عشرين حرفًا.',
      status: 'active',
      milestones: [
        { date: '2026-06-01', description: 'لقاء أولي', status: 'pending' },
        { date: '2026-06-15', description: 'متابعة', status: 'pending' },
      ],
      progress_notes: 'ملاحظات تقدم اختبارية. لا أسرار هنا.',
      target_date: '2026-07-01',
    });
  if (planErr) throw new Error(`seed plan: ${planErr.message}`);

  // ----- Seed an OUT-OF-SCOPE case for the 404 test -----
  // Different student in a section the counselor is NOT assigned to.
  // The case stays under the same SMOKE_MARKER prefix so cleanup picks
  // it up via the LIKE filter.
  console.log('Seeding 1 out-of-scope case (for 404 test)…');
  const { data: otherStudent, error: osErr } = await admin
    .from('students')
    .select('id, section_id')
    .eq('section_id', otherSec.id)
    .not('section_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (osErr) throw new Error(`out-of-scope student: ${osErr.message}`);
  let oosCaseId = null;
  if (otherStudent) {
    const { data: oosCase, error: oosErr } = await admin
      .from('student_cases')
      .insert({
        student_id: otherStudent.id,
        created_by: superId,
        title: SMOKE_MARKER + ' — out-of-scope case',
        description: 'حالة خارج نطاق المرشد لاختبار 404 — تبقى مخفية عنه.',
        case_type: 'academic',
        severity: 'low',
        status: 'open',
      })
      .select('id')
      .single();
    if (oosErr) throw new Error(`seed oos case: ${oosErr.message}`);
    oosCaseId = oosCase.id;
  } else {
    console.log('  (no student found in other section — out-of-scope test skipped)');
  }

  console.log('Seeding 1 counseling session (attached to open case)…');
  const today = new Date().toISOString().slice(0, 10);
  const { error: sesErr } = await admin
    .from('counseling_sessions')
    .insert({
      case_id: openCase.id,
      student_id: target.id,
      counselor_user_id: counselorId,
      session_date: today,
      session_type: 'individual',
      topic: SMOKE_MARKER + ' — session topic',
      content_encrypted: Buffer.from('PLACEHOLDER-NOT-A-REAL-PGP-CIPHERTEXT'),
      content_preview: 'ملخص الجلسة الاختبارية — لا أسرار. يُعرض في لوحة المرشد كـ preview.',
      duration_minutes: 30,
    });
  if (sesErr) throw new Error(`seed session: ${sesErr.message}`);

  console.log('Seeding 1 confidential note (attached to open case)…');
  const { error: noteErr } = await admin
    .from('student_notes')
    .insert({
      student_id: target.id,
      recorded_by: counselorId,
      is_confidential: true,
      case_id: openCase.id,
      text: SMOKE_MARKER + ' — note text',
      type: 'negative',
      source: 'text',
    });
  if (noteErr) throw new Error(`seed note: ${noteErr.message}`);

  // ---- Done ----
  console.log('\n=== SETUP COMPLETE ===\n');
  console.log('Sign in with these test users:');
  for (const k of Object.keys(USERS)) {
    const u = USERS[k];
    console.log(`  ${k.padEnd(10)}  email: ${u.email}`);
    console.log(`  ${''.padEnd(10)}  pass:  ${u.password}\n`);
  }
  console.log(`Seeded student id ${target.id} (section ${target.section_id})`);
  console.log(`Seeded ${caseRows.length} in-scope cases (statuses: ${caseRows.map((c) => c.status).join(', ')})`);
  console.log(`Seeded session + confidential note + 1 plan + 1+ history row(s) attached to open case id ${openCase.id}`);
  if (oosCaseId) {
    console.log(`Seeded 1 OUT-OF-SCOPE case id ${oosCaseId} (for the 404 probe — counselor must NOT see it)`);
  }
  console.log('\nWhen done testing run:');
  console.log('  node --env-file=.env.local scripts/sprint4-ui-preview-cleanup.mjs\n');
}

main().catch((err) => {
  console.error('\n[setup:FATAL]', err.message);
  process.exit(1);
});
