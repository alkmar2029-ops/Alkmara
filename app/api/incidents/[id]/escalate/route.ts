// PATCH /api/incidents/[id]/escalate — reviewer escalates an incident
// into a counselor case. This is م3.9 — the incident→case bridge that
// was deferred since Sprint 3 (the student_incidents.case_id column +
// 'escalated' status were built in م3.1 explicitly "to be populated by
// the escalate API endpoint once student_cases exists").
//
// Mirrors dismiss (م3.7) / action (م3.8) exactly:
//   - gate: review_teacher_incidents flag (or super_admin) — counselors
//     can VIEW the queue but cannot act
//   - self-review guard: the submitter can't escalate their own report
//   - scope re-validation: reviewer_can_see_student via the user-bound
//     client (admin client → auth.uid() is NULL → helper returns FALSE)
//   - race-safe terminal transition: UPDATE re-checks status IN
//     (submitted, under_review) in its WHERE clause
//
// What's DIFFERENT: escalation CREATES a student_cases row, then links
// the incident to it (case_id) and stamps status='escalated' +
// escalated_to. supabase-js has no multi-statement transaction, so we
// create the case first, then race-safe UPDATE the incident; if the
// UPDATE matches zero rows (another reviewer already decided, or the
// row vanished), we delete the just-created orphan case and return 409.
//
// case_history note: the case is created at status='open'. The م4.3
// trigger logs status TRANSITIONS (AFTER UPDATE OF status), so 'open'
// creation is captured by audit_logs + the incident's escalated
// transition — NOT case_history, which starts from the first post-open
// move. Intentional, matches the م4.3 design.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireAdminWithFlag } from '@/lib/personas/auth-gate';
import {
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPE_LABELS,
  type IncidentStatus,
  type IncidentType,
} from '@/lib/incidents/types';

export const dynamic = 'force-dynamic';

// student_cases.case_type enum (م4.2). Distinct from incident_type, so
// we map a sensible default and let the reviewer override via the body.
const CASE_TYPES = [
  'academic',
  'behavioral',
  'social',
  'health',
  'family',
  'attendance',
] as const;
const CASE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

// incident_type → default case_type. behavioral is the catch-all since
// most disciplinary incidents land there; attendance/academic map 1:1.
const INCIDENT_TO_CASE_TYPE: Record<IncidentType, (typeof CASE_TYPES)[number]> = {
  tardy: 'attendance',
  absence: 'attendance',
  uniform: 'behavioral',
  behavior: 'behavioral',
  academic: 'academic',
  property_damage: 'behavioral',
  other: 'behavioral',
};

const escalateSchema = z
  .object({
    // All optional — the endpoint derives sensible defaults from the
    // incident so a one-click "escalate" works, while a richer UI can
    // override any field. Mirrors the student_cases CHECK minimums
    // (title ≥ 10, description ≥ 20) so a bad override is rejected here
    // with 400 rather than as a 500 from the DB constraint.
    case_type: z.enum(CASE_TYPES).optional(),
    severity: z.enum(CASE_SEVERITIES).optional(),
    title: z.string().trim().min(10).max(200).optional(),
    description: z.string().trim().min(20).optional(),
    // Counselor the case is handed to. Defaults to the escalating
    // reviewer when omitted. FK to auth.users enforces validity; a bad
    // UUID surfaces as the UPDATE failing → orphan case rolled back.
    escalated_to: z.string().uuid().optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // Gate: flag-only (same as dismiss/action). Counselor read access does
  // NOT extend to action endpoints.
  const auth = await requireAdminWithFlag(
    'review_teacher_incidents',
    'لا تملك صلاحية البتّ في المخالفات (يلزم review_teacher_incidents)',
  );
  if (!auth.ok) return auth.res;

  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json(
      { error: 'معرّف المخالفة غير صالح' },
      { status: 400 },
    );
  }
  const incidentId = Number(params.id);

  // Body is optional — an empty POST means "escalate with defaults".
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const parsed = escalateSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Load incident (service-role; RLS irrelevant here — scope checked
  // explicitly below).
  const admin = createAdminSupabaseClient();
  const incidentRes = await admin
    .from('student_incidents')
    .select(
      'id, student_id, status, submitted_by, incident_type, incident_date, description, severity',
    )
    .eq('id', incidentId)
    .maybeSingle();

  if (incidentRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب المخالفة: ' + incidentRes.error.message },
      { status: 500 },
    );
  }
  if (!incidentRes.data) {
    return NextResponse.json({ error: 'المخالفة غير موجودة' }, { status: 404 });
  }
  const incident = incidentRes.data;

  // State machine — only an open (submitted / under_review) incident can
  // be escalated.
  if (incident.status !== 'submitted' && incident.status !== 'under_review') {
    const label =
      INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status;
    return NextResponse.json(
      { error: `لا يمكن تصعيد مخالفة بحالة "${label}"` },
      { status: 409 },
    );
  }

  // Self-review guard — conflict of interest.
  if (incident.submitted_by === auth.ctx.userId) {
    return NextResponse.json(
      { error: 'لا يمكنك مراجعة مخالفة قدّمتها بنفسك' },
      { status: 403 },
    );
  }

  // Scope re-validation. Admin client bypasses RLS, so verify the caller
  // can see this student. Super bypasses; flag holders pay the helper
  // round-trip through the user-bound client.
  if (auth.ctx.role !== 'super_admin') {
    const userSupabase = await createServerSupabaseClient();
    const scopeRes = await userSupabase.rpc('reviewer_can_see_student', {
      p_student_id: incident.student_id,
    });
    if (scopeRes.error) {
      return NextResponse.json(
        { error: 'فشل التحقق من النطاق: ' + scopeRes.error.message },
        { status: 500 },
      );
    }
    if (!scopeRes.data) {
      return NextResponse.json(
        { error: 'هذه المخالفة خارج نطاقك المسموح' },
        { status: 403 },
      );
    }
  }

  // ----- Derive case fields (body override → incident-derived default) -----
  const incidentType = incident.incident_type as IncidentType;
  const typeLabel = INCIDENT_TYPE_LABELS[incidentType] ?? incident.incident_type;
  const caseType =
    body.case_type ?? INCIDENT_TO_CASE_TYPE[incidentType] ?? 'behavioral';
  // incident severity enum == case severity enum (low/medium/high/critical).
  const severity = body.severity ?? (incident.severity as string);
  // Title default is always ≥ 10 chars (the prefix alone is 16+).
  const title =
    body.title ?? `مخالفة مُصعَّدة — ${typeLabel} (${incident.incident_date})`;
  // Description default reuses the incident narrative (already ≥ 20 by
  // the incident CHECK), prefixed with provenance.
  const description =
    body.description ??
    `صُعِّدت من المخالفة رقم ${incidentId}.\n\n${incident.description}`;
  const escalatedTo = body.escalated_to ?? auth.ctx.userId;

  // ----- 1. Create the case (status defaults to 'open' in the DB) -----
  const caseRes = await admin
    .from('student_cases')
    .insert({
      student_id: incident.student_id,
      created_by: auth.ctx.userId,
      title,
      description,
      case_type: caseType,
      severity,
    })
    .select('id, case_number, status')
    .single();

  if (caseRes.error || !caseRes.data) {
    return NextResponse.json(
      { error: 'فشل إنشاء الحالة: ' + (caseRes.error?.message ?? 'unknown') },
      { status: 500 },
    );
  }
  const newCase = caseRes.data;

  // ----- 2. Race-safe link: incident → escalated, carrying case_id -----
  const updateRes = await admin
    .from('student_incidents')
    .update({
      status: 'escalated',
      reviewed_by: auth.ctx.userId,
      reviewed_at: new Date().toISOString(),
      case_id: newCase.id,
      escalated_to: escalatedTo,
    })
    .eq('id', incidentId)
    .in('status', ['submitted', 'under_review'])
    .select(
      'id, student_id, status, case_id, escalated_to, reviewed_by, reviewed_at',
    )
    .maybeSingle();

  if (updateRes.error) {
    // The link failed (e.g. a bad escalated_to UUID violated the FK).
    // Roll back the orphan case so we don't leave a dangling case with
    // no incident pointing at it.
    await admin.from('student_cases').delete().eq('id', newCase.id);
    return NextResponse.json(
      { error: 'فشل تصعيد المخالفة: ' + updateRes.error.message },
      { status: 500 },
    );
  }
  if (!updateRes.data) {
    // Another reviewer decided this incident between our load and our
    // update — undo the case we just created.
    await admin.from('student_cases').delete().eq('id', newCase.id);
    return NextResponse.json(
      { error: 'تغيّرت حالة المخالفة بواسطة مراجع آخر — حدِّث الصفحة' },
      { status: 409 },
    );
  }

  // Audit. case_id + case_number anchor the bridge; the case_history
  // table will track every status move on the new case from here on.
  await writeAuditLog({
    ctx: auth.ctx,
    action: 'incident.escalate',
    targetType: 'incident',
    targetId: incidentId,
    details: {
      from_status: incident.status,
      to_status: 'escalated',
      student_id: incident.student_id,
      case_id: newCase.id,
      case_number: newCase.case_number,
      case_type: caseType,
      escalated_to: escalatedTo,
    },
    request,
  });

  return NextResponse.json({
    data: { incident: updateRes.data, case: newCase },
  });
}
