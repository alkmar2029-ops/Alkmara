// POST /api/vp/absences — mark a teacher absent for a given date.
//
// Idempotent via upsert on the (teacher_user_id, absence_date) unique
// key: re-marking the same teacher on the same date updates the
// reason / expected_return / notes / reported_by / reported_at fields
// rather than 409'ing. This matches the VP's mental model — "I'm
// recording the latest state, not appending a log entry".
//
// Three Codex Sprint 2 gates (م2.6):
//   1. requireManageSubstitutions — only super_admin OR holders of the
//      flag can write here. requireVpDashboard would let a view-only
//      VP through (e.g., VP-administrative who shouldn't be marking
//      absences).
//   2. Upsert via PostgREST onConflict, NOT a try-catch 23505. Cleaner
//      semantics + one round trip.
//   3. Verify the target user actually has role='teacher'. Marking an
//      admin / staff / counselor "absent" would corrupt the
//      substitution workflow (they have no class periods to cover).

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireManageSubstitutions } from '@/lib/personas/auth-gate';
import { todayInRiyadh, ksaDateSchema } from '@/lib/dates/ksa';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const createAbsenceSchema = z
  .object({
    teacher_user_id: z.string().uuid(),
    // Optional — defaults to today (Riyadh) in the handler. Keeping
    // the default in the handler rather than the schema makes the
    // audit log cleaner: we record exactly what was sent.
    // ksaDateSchema validates both shape AND calendar reality —
    // 2026-02-30 / 2026-99-99 are rejected (Codex Sprint 2).
    absence_date: ksaDateSchema.optional(),
    reason: z.string().max(50).optional(),
    expected_return: ksaDateSchema.nullable().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  // Gate (1): super_admin OR manage_substitutions flag. VP-academic and
  // VP-student_affairs typically hold the flag; principal/general_admin
  // can be granted it too.
  const auth = await requireManageSubstitutions();
  if (!auth.ok) return auth.res;

  // Parse + validate body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'صيغة البيانات المرسلة غير صالحة' },
      { status: 400 },
    );
  }
  const parsed = createAbsenceSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const absenceDate = body.absence_date ?? todayInRiyadh();

  // Sanity: expected_return cannot precede absence_date. Not a DB
  // constraint (kept the schema flexible) but a clear UX guardrail.
  if (body.expected_return && body.expected_return < absenceDate) {
    return NextResponse.json(
      { error: 'تاريخ العودة المتوقع لا يصح قبل تاريخ الغياب' },
      { status: 400 },
    );
  }

  const admin = createAdminSupabaseClient();

  // Gate (3): verify the target is actually a teacher. We could let
  // RLS catch this (CHECK constraint on role isn't there, so RLS would
  // pass), but a clear 4xx beats writing a corrupt absence and noticing
  // only when the substitution workflow fails to find class periods.
  const targetRes = await admin
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', body.teacher_user_id)
    .maybeSingle();

  if (targetRes.error) {
    return NextResponse.json(
      { error: 'فشل التحقق من المعلم: ' + targetRes.error.message },
      { status: 500 },
    );
  }
  if (!targetRes.data) {
    return NextResponse.json(
      { error: 'المستخدم غير موجود' },
      { status: 404 },
    );
  }
  if (targetRes.data.role !== 'teacher') {
    return NextResponse.json(
      {
        error:
          'لا يمكن تسجيل غياب إلا لمستخدم بدور teacher (الدور الحالي: ' +
          targetRes.data.role +
          ')',
      },
      { status: 400 },
    );
  }

  // Gate (2): upsert on the unique key. PostgREST handles the conflict
  // and either INSERT or UPDATE — no 23505 to catch.
  const upsertRes = await admin
    .from('daily_teacher_absences')
    .upsert(
      {
        teacher_user_id: body.teacher_user_id,
        absence_date: absenceDate,
        reason: body.reason ?? null,
        expected_return: body.expected_return ?? null,
        notes: body.notes ?? null,
        reported_by: auth.ctx.userId,
        // Refresh reported_at on UPDATE so "when was this last recorded"
        // matches the most recent VP action. INSERT will use this
        // value too (no DEFAULT NOW conflict).
        reported_at: new Date().toISOString(),
      },
      { onConflict: 'teacher_user_id,absence_date' },
    )
    .select('id, teacher_user_id, absence_date, reason, expected_return, notes, reported_by, reported_at')
    .single();

  if (upsertRes.error) {
    return NextResponse.json(
      { error: 'فشل تسجيل الغياب: ' + upsertRes.error.message },
      { status: 500 },
    );
  }

  // Audit. The "mark" action is intentionally upsert-flavoured — same
  // string for new + revision. The details payload carries every
  // submitted field so the audit row is self-describing.
  await writeAuditLog({
    ctx: auth.ctx,
    action: 'absence.mark',
    targetType: 'teacher',
    targetId: body.teacher_user_id,
    details: {
      teacher_name: targetRes.data.full_name,
      absence_date: absenceDate,
      reason: body.reason ?? null,
      expected_return: body.expected_return ?? null,
      notes_provided: typeof body.notes === 'string' && body.notes.length > 0,
    },
    request,
  });

  return NextResponse.json({ data: upsertRes.data }, { status: 201 });
}
