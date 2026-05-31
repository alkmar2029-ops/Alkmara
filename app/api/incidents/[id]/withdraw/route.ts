// DELETE /api/incidents/[id]/withdraw — submitter pulls back an
// incident before any reviewer has touched it.
//
// م3.10. Why this is an API endpoint and not a raw RLS DELETE
// (the Codex Sprint 2 teacher_leaves cancel lesson, re-applied):
//   - A pure-RLS teacher delete would let the holder DELETE any
//     submitted row they own, with no audit trail and no easy way
//     to enforce the 30-minute grace window in one place.
//   - The incidents_delete RLS policy is super_admin-only. The
//     teacher's "withdraw" path runs through here on the
//     service-role client, which lets us:
//       * load the row + verify ownership + check status + age
//         in a coherent block
//       * write an audit entry AFTER the delete succeeds. The
//         audit_logs table has no FK to student_incidents, so the
//         audit record survives the delete; writing it after the
//         rowcount check prevents a false audit trail on races.
//       * race-protect the actual DELETE with WHERE status=
//         'submitted' so a reviewer who opened the row mid-call
//         cannot get clobbered
//
// Business rules:
//   - status must be 'submitted'. Once a reviewer flips to
//     'under_review' (or terminal), withdraw is closed. The
//     teacher must wait for the decision (dismissed / actioned /
//     escalated) or ask the reviewer to revert.
//   - The submitter must equal auth.uid(). A teacher cannot
//     withdraw another teacher's incident — even within the same
//     section.
//   - Withdraw window is 30 minutes from submitted_at. After that
//     the row is locked: reviewers may be relying on it as part
//     of an oldest-first queue, and silent deletion would break
//     workflow auditing.
//   - super_admin bypasses both the ownership check (can withdraw
//     on a teacher's behalf — admin override) and the 30-minute
//     window (legitimate cleanup of stale rows). They still
//     cannot bypass the status='submitted' rule — a reviewed
//     incident is a permanent record, not subject to withdraw.

import { NextRequest, NextResponse } from 'next/server';
import {
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import {
  INCIDENT_STATUS_LABELS,
  type IncidentStatus,
} from '@/lib/incidents/types';

export const dynamic = 'force-dynamic';

// 30-minute grace window for the submitter. Super bypasses.
const WITHDRAW_WINDOW_MS = 30 * 60 * 1000;

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  // Gate: any role that could have submitted (per м3.4's
  // requireRole). The ownership / status / age checks below
  // narrow the actual permission to "submitter, fresh row" —
  // RLS DELETE is super_admin-only and we're using admin
  // client, so this handler IS the security boundary for
  // teacher withdraws.
  const auth = await requireRole(['teacher', 'admin', 'super_admin']);
  if (!auth.ok) return auth.res;

  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json(
      { error: 'معرّف المخالفة غير صالح' },
      { status: 400 },
    );
  }
  const incidentId = Number(params.id);

  // Load. Service-role bypasses the super-admin-only RLS DELETE
  // policy; the API enforces the actual rules below.
  const admin = createAdminSupabaseClient();
  const incidentRes = await admin
    .from('student_incidents')
    .select('id, student_id, status, submitted_by, submitted_at')
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

  const isSuper = auth.ctx.role === 'super_admin';

  // Ownership: submitter only (super bypasses for admin override).
  if (!isSuper && incident.submitted_by !== auth.ctx.userId) {
    return NextResponse.json(
      { error: 'لا يمكنك سحب مخالفة قدّمها مستخدم آخر' },
      { status: 403 },
    );
  }

  // Status: only 'submitted' is withdrawable. Even super cannot
  // delete a reviewed incident through this endpoint — a permanent
  // record is the audit anchor for downstream cases.
  if (incident.status !== 'submitted') {
    const label = INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status;
    return NextResponse.json(
      { error: `لا يمكن سحب مخالفة بحالة "${label}" — بدأت المراجعة` },
      { status: 409 },
    );
  }

  // 30-minute grace window. Super bypasses (legitimate cleanup
  // of stale rows on a teacher's behalf).
  if (!isSuper) {
    const submittedMs = new Date(incident.submitted_at).getTime();
    const ageMs = Date.now() - submittedMs;
    if (ageMs > WITHDRAW_WINDOW_MS) {
      const minutesPast = Math.floor((ageMs - WITHDRAW_WINDOW_MS) / 60_000);
      return NextResponse.json(
        {
          error:
            `انتهت مهلة السحب (30 دقيقة من وقت التقديم${
              minutesPast > 0 ? ` — متأخّر بـ ${minutesPast} دقيقة` : ''
            }). تواصل مع الوكيل لرفضها رسميًا.`,
        },
        { status: 409 },
      );
    }
  }

  // Race-safe DELETE: re-check status='submitted' in WHERE. If a
  // reviewer flipped to under_review between our load and our
  // delete, the WHERE matches zero rows and .select() returns an
  // empty array — we map that to 409.
  const deleteRes = await admin
    .from('student_incidents')
    .delete()
    .eq('id', incidentId)
    .eq('status', 'submitted')
    .select('id');

  if (deleteRes.error) {
    return NextResponse.json(
      { error: 'فشل سحب المخالفة: ' + deleteRes.error.message },
      { status: 500 },
    );
  }
  if (!deleteRes.data || deleteRes.data.length === 0) {
    // Status changed between our load + delete — reviewer beat us.
    return NextResponse.json(
      {
        error:
          'تغيّرت حالة المخالفة (قد يكون المراجع فتحها) — لم يعد بالإمكان سحبها',
      },
      { status: 409 },
    );
  }

  // Audit AFTER the rowcount check. audit_logs.target_id is plain
  // TEXT with no FK, so the audit survives the deleted incident row,
  // but we only write it after a confirmed delete to avoid a false
  // "withdraw" entry when a reviewer wins the race.
  await writeAuditLog({
    ctx: auth.ctx,
    action: 'incident.withdraw',
    targetType: 'incident',
    targetId: incidentId,
    details: {
      student_id: incident.student_id,
      original_submitted_by: incident.submitted_by,
      original_submitted_at: incident.submitted_at,
      withdraw_age_seconds: Math.floor((Date.now() - new Date(incident.submitted_at).getTime()) / 1000),
      // Distinguish "the teacher withdrew their own" from
      // "super_admin withdrew someone else's" in the audit trail.
      admin_override: isSuper && incident.submitted_by !== auth.ctx.userId,
    },
    request,
  });

  return NextResponse.json({ data: { id: incidentId, withdrawn: true } });
}
