// PATCH /api/vp/teacher-leaves/[id]/decision — approve or reject a
// pending leave request.
//
// On APPROVAL we ALSO create the corresponding daily_teacher_absences
// rows (one per day in [start_date, end_date]). This is the documented
// flow from migration 2026_05_21_003_teacher_leaves.sql — keeping the
// trigger in the API layer (not a DB trigger) so we can:
//   - Skip days that ALREADY have an absence (manual entry beat us to
//     it). We use `ignoreDuplicates: true` to preserve existing rows.
//   - Tag the absence with the leave's type + a marker note.
//   - Best-effort: if the absence insert fails for some days, we DON'T
//     roll back the approval. The leave is approved either way; the
//     VP can complete the missing absence rows manually.
//
// Gate: requireApproveTeacherLeave — the strictest gate in the
// substitution surface. Mirrors the SQL UPDATE policy on
// teacher_leaves.
//
// State machine enforced:
//   pending → approved | rejected     (this endpoint)
//   pending → cancelled                (teacher self-cancel, separate)
//   any other source state             → 400, "already decided"

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireApproveTeacherLeave } from '@/lib/personas/auth-gate';
import { addDaysKsa } from '@/lib/dates/ksa';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    decision_note: z.string().max(2000).optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApproveTeacherLeave();
  if (!auth.ok) return auth.res;

  // Validate path param.
  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json(
      { error: 'معرّف الإجازة غير صالح' },
      { status: 400 },
    );
  }
  const leaveId = Number(params.id);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'صيغة البيانات المرسلة غير صالحة' },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const admin = createAdminSupabaseClient();

  // Load the leave row + check state.
  const leaveRes = await admin
    .from('teacher_leaves')
    .select(
      'id, teacher_user_id, start_date, end_date, leave_type, status, decided_by, decided_at',
    )
    .eq('id', leaveId)
    .maybeSingle();
  if (leaveRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب الإجازة: ' + leaveRes.error.message },
      { status: 500 },
    );
  }
  if (!leaveRes.data) {
    return NextResponse.json({ error: 'الإجازة غير موجودة' }, { status: 404 });
  }
  const leave = leaveRes.data as {
    id: number;
    teacher_user_id: string;
    start_date: string;
    end_date: string;
    leave_type: string;
    status: string;
    decided_by: string | null;
    decided_at: string | null;
  };

  // State guard: only pending requests can be decided here.
  if (leave.status !== 'pending') {
    return NextResponse.json(
      {
        error: `الإجازة في حالة "${leave.status}" — لا يمكن إعادة البتّ فيها`,
      },
      { status: 400 },
    );
  }

  // Decision write.
  const nowIso = new Date().toISOString();
  const updateRes = await admin
    .from('teacher_leaves')
    .update({
      status: body.decision,
      decided_by: auth.ctx.userId,
      decided_at: nowIso,
      decision_note: body.decision_note ?? null,
    })
    .eq('id', leaveId)
    // Defensive WHERE: re-check pending here too. If another request
    // raced us and just decided this leave, this UPDATE will affect 0
    // rows and we'll catch that as data===null below.
    .eq('status', 'pending')
    .select(
      'id, teacher_user_id, start_date, end_date, leave_type, status, decided_by, decided_at, decision_note',
    )
    // maybeSingle (not single) — when the defensive WHERE matches 0
    // rows (race), PostgREST returns data: null instead of throwing
    // PGRST116. That lets us distinguish "real DB error" from "race
    // condition" and respond 500 vs 409 correctly. (Codex Sprint 2
    // must-fix on م2.10.)
    .maybeSingle();

  if (updateRes.error) {
    return NextResponse.json(
      { error: 'فشل تحديث الإجازة: ' + updateRes.error.message },
      { status: 500 },
    );
  }
  if (!updateRes.data) {
    // Race: another admin just decided this leave between our SELECT
    // and our UPDATE. Tell the user to refresh.
    return NextResponse.json(
      {
        error: 'الإجازة لم تعد في حالة pending — قد تكون قُرِّرت في طلب آخر. حدّث الصفحة.',
      },
      { status: 409 },
    );
  }

  // On APPROVAL, materialise the absences. Best-effort — failures
  // here don't roll back the approval.
  let absencesCreated = 0;
  let absencesSkipped = 0;
  let absencesError: string | null = null;
  if (body.decision === 'approved') {
    const dates: string[] = [];
    let d = leave.start_date;
    while (d <= leave.end_date) {
      dates.push(d);
      d = addDaysKsa(d, 1);
      // Hard cap — 365 days. Catches a malformed end_date that's
      // years away without hammering the loop.
      if (dates.length > 365) break;
    }

    const rows = dates.map((date) => ({
      teacher_user_id: leave.teacher_user_id,
      absence_date: date,
      // The leave_type values overlap with the absence reason
      // convention ('sick', 'personal', 'official', ...). Carry it
      // through so reports tie back to the leave.
      reason: leave.leave_type,
      expected_return: addDaysKsa(leave.end_date, 1),
      notes: `إجازة معتمدة (#${leave.id})`,
      reported_by: auth.ctx.userId,
      reported_at: nowIso,
    }));

    // ignoreDuplicates: don't overwrite an absence the VP already
    // recorded manually for the same date.
    const absRes = await admin
      .from('daily_teacher_absences')
      .upsert(rows, {
        onConflict: 'teacher_user_id,absence_date',
        ignoreDuplicates: true,
      })
      .select('absence_date');

    if (absRes.error) {
      absencesError = absRes.error.message;
    } else {
      // Rows returned = rows actually inserted (the conflicts were
      // ignored and not returned).
      absencesCreated = (absRes.data ?? []).length;
      absencesSkipped = rows.length - absencesCreated;
    }
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher_leave.decision',
    targetType: 'teacher',
    targetId: leave.teacher_user_id,
    details: {
      leave_id: leave.id,
      decision: body.decision,
      decision_note: body.decision_note ?? null,
      start_date: leave.start_date,
      end_date: leave.end_date,
      leave_type: leave.leave_type,
      absences_created: absencesCreated,
      absences_skipped: absencesSkipped,
      absences_error: absencesError,
    },
    request,
  });

  return NextResponse.json({
    data: {
      ...updateRes.data,
      absences_created: absencesCreated,
      absences_skipped: absencesSkipped,
      absences_error: absencesError,
    },
  });
}
