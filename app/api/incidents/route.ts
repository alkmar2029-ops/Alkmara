// POST /api/incidents — submit a new student incident.
//
// م3.4 — the teacher-facing entry point of the incidents workflow.
// Admins (VPs, counselors, principals) can also submit, but every
// caller must justify scope. The RLS INSERT policy gates by:
//   - super_admin: any student
//   - teacher_teaches_student: teacher in their assigned sections
//   - reviewer_can_see_student: review_teacher_incidents flag + vp_grade_scope
//   - counselor_can_see_student: counselor_assignments scope
// There is no blanket "any admin" pass — a general_admin without
// one of these scope qualifications is denied (Sprint 1 "role=admin
// is not authority" lesson, re-applied here after Codex Sprint 3
// second review).
//
// Pre-validation strategy (per Codex Sprint 3 third review):
//   - super_admin: admin-client pre-check returns precise 404 /
//     400 (inactive). Super sees every student anyway — precise
//     errors don't leak anything they couldn't observe directly.
//   - everyone else: NO pre-validation. The INSERT goes straight
//     through the user-bound client and lets RLS decide. Any
//     scope failure surfaces as 42501 → mapped to a single
//     opaque 403. This prevents a scoped counselor / VP /
//     teacher from probing student_id values to learn which
//     students exist (the previous draft leaked this via the
//     404 vs 400 vs 403 distinction in the admin-family branch).
//
// On error mapping:
//   - 42501 (RLS denial) → 403 generic
//   - 23503 (FK violation — student missing race) → 404 only for
//     super_admin (they passed pre-check; race means student was
//     deleted between the two queries); 403 for everyone else
//   - else → 500 with the original message
//
// studentName for the audit log is populated:
//   - for super_admin: from the pre-check
//   - for everyone else: from a post-INSERT admin-client lookup
//     (safe — RLS approval already proved scope, so the lookup
//     reveals nothing new)
//
// Auto-escalation for severity='critical' is intentionally NOT in
// this handler. It belongs in م3.15 (lib/incidents/escalation.ts +
// the Sprint 4 case table). For now, every incident lands at
// status='submitted' regardless of severity, and the reviewer queue
// picks it up.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { ksaDateSchema } from '@/lib/dates/ksa';
import {
  INCIDENT_TYPES,
  INCIDENT_SEVERITIES,
} from '@/lib/incidents/types';

export const dynamic = 'force-dynamic';

// description min 20 — mirrors the DB CHECK. Caught client-side too,
// but the schema guard means a direct PostgREST POST can't sneak a
// shorter one through.
const createIncidentSchema = z
  .object({
    student_id: z.number().int().positive(),
    // Optional → falls through to the DB default
    // ((NOW() AT TIME ZONE 'Asia/Riyadh')::date). Server doesn't
    // re-compute today; the column default is the single source of
    // truth for the "no date supplied = today in Riyadh" case.
    incident_date: ksaDateSchema.optional(),
    incident_type: z.enum(INCIDENT_TYPES),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    description: z.string().min(20).max(2000),
  })
  .strict();

export async function POST(request: NextRequest) {
  // Gate: any signed-in role that the RLS INSERT policy might
  // accept. Finer scope (teacher's sections) is enforced by RLS.
  const auth = await requireRole(['teacher', 'admin', 'super_admin']);
  if (!auth.ok) return auth.res;

  // ============== Parse + validate body ==============
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'صيغة البيانات المرسلة غير صالحة' },
      { status: 400 },
    );
  }
  const parsed = createIncidentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // ============== Pre-validation (super_admin only) ==============
  // Precise 404 / 400 is restricted to super_admin to avoid leaking
  // student existence to scoped admins (counselor, VP-reviewer,
  // principal). Everyone else skips pre-validation entirely and
  // lets RLS decide at INSERT time, where scope failure → 42501 →
  // single opaque 403 below (Codex Sprint 3 third review).
  const admin = createAdminSupabaseClient();
  const isSuper = auth.ctx.role === 'super_admin';
  let studentName: string | null = null;

  if (isSuper) {
    const studentRes = await admin
      .from('students')
      .select('id, is_active, first_name, last_name')
      .eq('id', body.student_id)
      .maybeSingle();

    if (studentRes.error) {
      return NextResponse.json(
        { error: 'فشل التحقق من الطالب: ' + studentRes.error.message },
        { status: 500 },
      );
    }
    if (!studentRes.data) {
      return NextResponse.json({ error: 'الطالب غير موجود' }, { status: 404 });
    }
    if (!studentRes.data.is_active) {
      return NextResponse.json(
        { error: 'الطالب غير نشط — لا يمكن تقديم مخالفة' },
        { status: 400 },
      );
    }
    studentName = `${studentRes.data.first_name ?? ''} ${studentRes.data.last_name ?? ''}`.trim() || null;
  }
  // else: no pre-validation. RLS + FK constraints decide at INSERT.

  // ============== INSERT via user-bound (RLS-enforcing) client ==============
  // The RLS incidents_insert policy verifies (Codex Sprint 3 second
  // review — no blanket admin pass):
  //   - submitted_by = auth.uid()  (no impersonation)
  //   - super_admin OR teacher_teaches_student OR
  //     reviewer_can_see_student OR counselor_can_see_student
  // Any caller without a matching scope path (e.g. counselor outside
  // their counselor_assignments, VP outside vp_grade_scope, plain
  // admin without any flag) gets rejected at the DB layer with code
  // 42501 — mapped to a generic 403 below.
  const supabase = await createServerSupabaseClient();
  const insertRes = await supabase
    .from('student_incidents')
    .insert({
      student_id: body.student_id,
      // Conditional spread so DB defaults fire when the caller omits
      // a field. Keeps the audit log honest: it records exactly what
      // the API sent, not what the DB filled in.
      ...(body.incident_date ? { incident_date: body.incident_date } : {}),
      incident_type: body.incident_type,
      ...(body.severity ? { severity: body.severity } : {}),
      description: body.description,
      submitted_by: auth.ctx.userId,
      // status defaults to 'submitted' at the DB layer.
    })
    .select(
      'id, student_id, incident_date, incident_type, severity, description, status, submitted_by, submitted_at',
    )
    .single();

  if (insertRes.error) {
    const code = (insertRes.error as { code?: string }).code;
    // RLS denial — single opaque message regardless of which scope
    // path failed. Probing-safe: a teacher can't tell whether they
    // hit the wrong section, the student doesn't exist, or they
    // lack the right persona scope.
    if (code === '42501' || insertRes.error.message?.includes('row-level security')) {
      return NextResponse.json(
        {
          error:
            'لا تملك صلاحية تقديم مخالفة لهذا الطالب — يجب أن يكون ضمن صلاحيتك',
        },
        { status: 403 },
      );
    }
    // FK violation — student_id doesn't exist. For super_admin who
    // passed pre-check, this is a race (student deleted between
    // queries) and a precise 404 is honest. For non-super, leak
    // protection wins: same generic 403 as scope denial.
    if (code === '23503') {
      return isSuper
        ? NextResponse.json({ error: 'الطالب غير موجود' }, { status: 404 })
        : NextResponse.json(
            { error: 'لا تملك صلاحية تقديم مخالفة لهذا الطالب' },
            { status: 403 },
          );
    }
    return NextResponse.json(
      { error: 'فشل تقديم المخالفة: ' + insertRes.error.message },
      { status: 500 },
    );
  }

  // ============== Audit ==============
  // For non-super, fetch the student name now that RLS approval
  // has proven the caller had scope. Admin client is safe here —
  // we are not leaking new information.
  if (!studentName) {
    const nameRes = await admin
      .from('students')
      .select('first_name, last_name')
      .eq('id', body.student_id)
      .maybeSingle();
    if (nameRes.data) {
      studentName = `${nameRes.data.first_name ?? ''} ${nameRes.data.last_name ?? ''}`.trim() || null;
    }
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'incident.submit',
    targetType: 'incident',
    targetId: insertRes.data.id,
    details: {
      student_id: body.student_id,
      student_name: studentName,
      incident_type: insertRes.data.incident_type,
      severity: insertRes.data.severity,
      incident_date: insertRes.data.incident_date,
      // description_length rather than the full text — the API audit
      // channel shouldn't duplicate freeform content (it's already on
      // the incident row + visible via the history trigger).
      description_length: insertRes.data.description.length,
    },
    request,
  });

  // TODO م3.15 — auto-escalation hook lands here once
  // lib/incidents/escalation.ts and the Sprint 4 case table exist.
  // Today: severity='critical' rows stay at status='submitted' and
  // surface in the reviewer queue like any other incident.

  return NextResponse.json({ data: insertRes.data }, { status: 201 });
}
