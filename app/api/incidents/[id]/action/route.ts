// PATCH /api/incidents/[id]/action — reviewer records the action
// taken on an incident (the "yes, we did something about it" path).
//
// م3.8. Mirror of م3.7 dismiss with three differences:
//   - body shape: action_taken (required) + parent_notified (optional)
//   - target status: 'actioned' (vs 'dismissed')
//   - parent_notified_at: stamped server-side when parent_notified=true
//
// Same gate (review_teacher_incidents flag), same scope re-validation,
// same race-safe UPDATE pattern, same self-review guard.
//
// WhatsApp notification to the parent is deferred to م3.19 — even
// when parent_notified=true here, the row records the intent but no
// message is sent yet. The actioned status + parent_notified_at
// timestamp serve as the audit anchor; م3.19 will pick them up.

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
  type IncidentStatus,
} from '@/lib/incidents/types';
import { notifyGuardianOfIncidentAction } from '@/lib/incidents/whatsapp';

export const dynamic = 'force-dynamic';

const actionSchema = z
  .object({
    action_taken: z.string().min(10).max(2000),
    parent_notified: z.boolean().optional(),
  })
  .strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'صيغة البيانات المرسلة غير صالحة' },
      { status: 400 },
    );
  }
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const admin = createAdminSupabaseClient();
  const incidentRes = await admin
    .from('student_incidents')
    .select('id, student_id, status, submitted_by, incident_type, incident_date')
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

  if (incident.status !== 'submitted' && incident.status !== 'under_review') {
    const label = INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status;
    return NextResponse.json(
      { error: `لا يمكن اتخاذ إجراء على مخالفة بحالة "${label}"` },
      { status: 409 },
    );
  }

  if (incident.submitted_by === auth.ctx.userId) {
    return NextResponse.json(
      { error: 'لا يمكنك مراجعة مخالفة قدّمتها بنفسك' },
      { status: 403 },
    );
  }

  // Scope re-validation — same pattern as م3.7. Super bypasses;
  // flag holders go through user-bound RPC.
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

  // parent_notified_at is server-stamped when the flag is true, so
  // the audit + UI can see WHEN the parent was marked as notified.
  // If parent_notified is false (or omitted), both stay null — the
  // reviewer can come back later and update via a future endpoint
  // once WhatsApp wiring (م3.19) actually sends the message. The
  // current row only records the reviewer's INTENT.
  const parentNotified = body.parent_notified === true;
  const nowIso = new Date().toISOString();

  const updateRes = await admin
    .from('student_incidents')
    .update({
      status: 'actioned',
      reviewed_by: auth.ctx.userId,
      reviewed_at: nowIso,
      action_taken: body.action_taken,
      parent_notified: parentNotified,
      parent_notified_at: parentNotified ? nowIso : null,
    })
    .eq('id', incidentId)
    .in('status', ['submitted', 'under_review'])
    .select(
      'id, student_id, status, reviewed_by, reviewed_at, action_taken, parent_notified, parent_notified_at',
    )
    .maybeSingle();

  if (updateRes.error) {
    return NextResponse.json(
      { error: 'فشل تسجيل الإجراء: ' + updateRes.error.message },
      { status: 500 },
    );
  }
  if (!updateRes.data) {
    return NextResponse.json(
      { error: 'تغيّرت حالة المخالفة بواسطة مراجع آخر — حدِّث الصفحة' },
      { status: 409 },
    );
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'incident.action',
    targetType: 'incident',
    targetId: incidentId,
    details: {
      from_status: incident.status,
      to_status: 'actioned',
      student_id: incident.student_id,
      action_taken_length: body.action_taken.length,
      parent_notified: parentNotified,
    },
    request,
  });

  // م3.19 — notify the guardian over WhatsApp when the reviewer marked
  // parent_notified. Best-effort: the incident is already actioned and
  // the intent recorded, so a send failure must NOT fail the request.
  // We surface the outcome so the UI can show "sent / not sent". The
  // guardian phone + student identity are resolved server-side from the
  // students row (never trusted from the request body).
  let whatsapp:
    | { ok: boolean; error?: string; skipped?: boolean }
    | null = null;
  if (parentNotified) {
    whatsapp = await notifyGuardianOfIncidentAction({
      admin,
      incidentId,
      studentId: incident.student_id,
      incidentType: incident.incident_type,
      incidentDate: incident.incident_date,
      sentBy: auth.ctx.userId,
    });
  }

  return NextResponse.json({ data: updateRes.data, whatsapp });
}
