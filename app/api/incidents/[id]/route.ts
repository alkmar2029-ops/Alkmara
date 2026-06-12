// PATCH /api/incidents/[id] — submitter edits their own incident
// while it is still fresh.
//
// Mirrors the م3.10 withdraw endpoint's eligibility exactly, because
// the rationale is the same ("a typo should be fixable for the same
// window in which the whole row could be deleted and resubmitted"):
//   - ownership: submitted_by must equal auth.uid() (super_admin
//     bypasses — admin override on a teacher's behalf)
//   - status must be 'submitted'. Once a reviewer decides (or flips
//     to under_review), the record is locked — even for super_admin.
//   - 30-minute window from submitted_at (super_admin bypasses).
//
// Editable fields: incident_type, severity, description,
// incident_date. NOT student_id — pointing an accusation at a
// different student is a withdraw-and-resubmit, not an edit.
//
// RLS UPDATE on student_incidents has no submitter path (reviewer
// decisions go through their own routes), so this runs on the
// service-role client after the explicit checks — the handler IS the
// security boundary, same as withdraw.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { ksaDateSchema } from '@/lib/dates/ksa';
import {
  INCIDENT_TYPES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUS_LABELS,
  type IncidentStatus,
} from '@/lib/incidents/types';

export const dynamic = 'force-dynamic';

// Same 30-minute grace window as withdraw. Super bypasses.
const EDIT_WINDOW_MS = 30 * 60 * 1000;

// description min 20 / max 2000 — mirrors the DB CHECK + create schema.
const editIncidentSchema = z
  .object({
    incident_date: ksaDateSchema.optional(),
    incident_type: z.enum(INCIDENT_TYPES).optional(),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    description: z.string().min(20).max(2000).optional(),
  })
  .strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(['teacher', 'admin', 'super_admin']);
  if (!auth.ok) return auth.res;

  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json(
      { error: 'معرّف المخالفة غير صالح' },
      { status: 400 },
    );
  }
  const incidentId = Number(params.id);

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
  const parsed = editIncidentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.incident_date !== undefined) patch.incident_date = body.incident_date;
  if (body.incident_type !== undefined) patch.incident_type = body.incident_type;
  if (body.severity !== undefined) patch.severity = body.severity;
  if (body.description !== undefined) patch.description = body.description;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'لا توجد حقول للتعديل' }, { status: 400 });
  }

  // ============== Load + eligibility checks ==============
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
      { error: 'لا يمكنك تعديل مخالفة قدّمها مستخدم آخر' },
      { status: 403 },
    );
  }

  // Status: only 'submitted' is editable — a reviewed incident is a
  // permanent record, even for super_admin.
  if (incident.status !== 'submitted') {
    const label = INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status;
    return NextResponse.json(
      { error: `لا يمكن تعديل مخالفة بحالة "${label}" — بدأت المراجعة` },
      { status: 409 },
    );
  }

  // 30-minute grace window. Super bypasses.
  if (!isSuper) {
    const submittedMs = new Date(incident.submitted_at).getTime();
    const ageMs = Date.now() - submittedMs;
    if (ageMs > EDIT_WINDOW_MS) {
      const minutesPast = Math.floor((ageMs - EDIT_WINDOW_MS) / 60_000);
      return NextResponse.json(
        {
          error:
            `انتهت مهلة التعديل (30 دقيقة من وقت التقديم${
              minutesPast > 0 ? ` — متأخّر بـ ${minutesPast} دقيقة` : ''
            }). تواصل مع الوكيل.`,
        },
        { status: 409 },
      );
    }
  }

  // ============== Race-safe UPDATE ==============
  // Re-check status='submitted' in WHERE — if a reviewer flipped the
  // status between our load and our update, zero rows match → 409.
  const updateRes = await admin
    .from('student_incidents')
    .update(patch)
    .eq('id', incidentId)
    .eq('status', 'submitted')
    .select(
      'id, student_id, incident_date, incident_type, severity, description, status, submitted_by, submitted_at',
    );

  if (updateRes.error) {
    return NextResponse.json(
      { error: 'فشل تعديل المخالفة: ' + updateRes.error.message },
      { status: 500 },
    );
  }
  if (!updateRes.data || updateRes.data.length === 0) {
    return NextResponse.json(
      {
        error:
          'تغيّرت حالة المخالفة (قد يكون المراجع فتحها) — لم يعد بالإمكان تعديلها',
      },
      { status: 409 },
    );
  }

  // Audit AFTER the confirmed update. description_length rather than
  // the full text — same convention as incident.submit.
  await writeAuditLog({
    ctx: auth.ctx,
    action: 'incident.edit',
    targetType: 'incident',
    targetId: incidentId,
    details: {
      student_id: incident.student_id,
      fields: Object.keys(patch),
      ...(body.description !== undefined
        ? { description_length: body.description.length }
        : {}),
      edit_age_seconds: Math.floor(
        (Date.now() - new Date(incident.submitted_at).getTime()) / 1000,
      ),
      admin_override: isSuper && incident.submitted_by !== auth.ctx.userId,
    },
    request,
  });

  return NextResponse.json({ data: updateRes.data[0] });
}
