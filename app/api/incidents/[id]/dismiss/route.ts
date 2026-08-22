// PATCH /api/incidents/[id]/dismiss — reviewer rejects an incident.
//
// م3.7. Tighter gate than the queue view (م3.6): only flag holders
// (or super_admin) can decide — counselors view but cannot act.
//
// State machine: status='submitted' OR 'under_review' → 'dismissed'.
// Any other source status returns 409 (already decided / escalated).
//
// Auth client: service-role (admin client) for the UPDATE because
// RLS UPDATE is super_admin-only after Codex Sprint 3 #2. That
// means RLS does NOT enforce scope here — the API MUST replicate
// the scope check explicitly before the update:
//
//   - super_admin: no scope check, can act anywhere
//   - flag holder: RPC reviewer_can_see_student via user-bound
//     client so auth.uid() resolves correctly inside the helper
//     (admin client → auth.uid() returns NULL → helper returns
//     FALSE always, so the RPC has to go through user-bound)
//
// Race protection: the UPDATE re-checks status IN
// ('submitted','under_review') in its WHERE clause. If a second
// reviewer dismissed/actioned the same row between our load and
// our update, the UPDATE matches zero rows → 409 with a "refresh
// please" message.
//
// Self-review guard: the submitter cannot dismiss their own
// incident even if they hold the flag — conflict of interest.

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

export const dynamic = 'force-dynamic';

const dismissSchema = z
  .object({
    // Required — the teacher reading the rejection needs a reason.
    // Min 10 chars to enforce a real explanation; max 2000 same as
    // description / decision_note for consistency.
    review_notes: z.string().min(10).max(2000),
  })
  .strict();

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // Gate: flag-only. Counselor read access (via requireIncidentsQueue)
  // does NOT extend to action endpoints.
  const auth = await requireAdminWithFlag(
    'review_teacher_incidents',
    'لا تملك صلاحية البتّ في المخالفات (يلزم review_teacher_incidents)',
  );
  if (!auth.ok) return auth.res;

  // Path param.
  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json(
      { error: 'معرّف المخالفة غير صالح' },
      { status: 400 },
    );
  }
  const incidentId = Number(params.id);

  // Body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'صيغة البيانات المرسلة غير صالحة' },
      { status: 400 },
    );
  }
  const parsed = dismissSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Load incident (service-role; RLS irrelevant here).
  const admin = createAdminSupabaseClient();
  const incidentRes = await admin
    .from('student_incidents')
    .select('id, student_id, status, submitted_by')
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

  // State machine.
  if (incident.status !== 'submitted' && incident.status !== 'under_review') {
    const label = INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status;
    return NextResponse.json(
      { error: `لا يمكن رفض مخالفة بحالة "${label}"` },
      { status: 409 },
    );
  }

  // Self-review guard.
  if (incident.submitted_by === auth.ctx.userId) {
    return NextResponse.json(
      { error: 'لا يمكنك مراجعة مخالفة قدّمتها بنفسك' },
      { status: 403 },
    );
  }

  // Scope re-validation. Admin client bypasses RLS, so we must
  // explicitly verify the caller can see this student. Super
  // bypasses; flag holders pay the helper round-trip.
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

  // Race-safe UPDATE — re-check status in WHERE so a parallel
  // decider can't double-update.
  const updateRes = await admin
    .from('student_incidents')
    .update({
      status: 'dismissed',
      reviewed_by: auth.ctx.userId,
      reviewed_at: new Date().toISOString(),
      review_notes: parsed.data.review_notes,
    })
    .eq('id', incidentId)
    .in('status', ['submitted', 'under_review'])
    .select(
      'id, student_id, status, reviewed_by, reviewed_at, review_notes',
    )
    .maybeSingle();

  if (updateRes.error) {
    return NextResponse.json(
      { error: 'فشل رفض المخالفة: ' + updateRes.error.message },
      { status: 500 },
    );
  }
  if (!updateRes.data) {
    // Status changed between our load + update — another reviewer
    // beat us to it.
    return NextResponse.json(
      { error: 'تغيّرت حالة المخالفة بواسطة مراجع آخر — حدِّث الصفحة' },
      { status: 409 },
    );
  }

  // Audit. notes_length rather than the full text — the row + the
  // status-history trigger already capture it.
  await writeAuditLog({
    ctx: auth.ctx,
    action: 'incident.dismiss',
    targetType: 'incident',
    targetId: incidentId,
    details: {
      from_status: incident.status,
      to_status: 'dismissed',
      student_id: incident.student_id,
      review_notes_length: parsed.data.review_notes.length,
    },
    request,
  });

  // TODO م3.19 — notify the submitting teacher (internal_messages
  // entry "your incident was reviewed and rejected, reason: ...").
  // Infrastructure exists but template/wiring is its own task.

  return NextResponse.json({ data: updateRes.data });
}
