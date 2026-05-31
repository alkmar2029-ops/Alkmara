// Substitute assignment logic shared by single-assign (م2.8) and
// bulk-assign (م2.9). The route handlers are now thin: parse body,
// gate, call assignSubstitute() per item, write audit, return.
//
// Why this lives in lib/ instead of duplicated across routes:
//   The validation set is long (7 queries + 7 invariant checks) and
//   Codex caught two regressions there in m2.8 alone (double-booking
//   + notification-state reset). Duplicating in m2.9 would just be
//   another place to forget a check. Single source of truth keeps
//   the invariants honest.
//
// Returns a discriminated union:
//   { ok: true,  assignment, audit_details }
//   { ok: false, error, status }
// Callers map the failure status to HTTP and write the audit log
// from audit_details on success.

import type { SupabaseClient } from '@supabase/supabase-js';
import { dayOfWeekKsa } from '@/lib/dates/ksa';

export interface AssignSubstituteParams {
  absence_id: number;
  substitute_user_id: string;
  period_number: number;
}

interface AssignmentRow {
  id: number;
  absence_id: number;
  substitute_user_id: string;
  day_of_week: number;
  period_number: number;
  section_id: number | null;
  assigned_at: string;
  whatsapp_sent_at: string | null;
  acknowledged_at: string | null;
}

export interface AssignmentAuditDetails {
  absent_teacher_name: string | null;
  substitute_name: string | null;
  day_of_week: number;
  period_number: number;
  section_id: number | null;
  subject: string | null;
  assignment_id: number;
  previous_substitute_user_id: string | null;
  substitute_changed: boolean;
  notification_reset: boolean;
}

export type AssignResult =
  | { ok: true; assignment: AssignmentRow; audit_details: AssignmentAuditDetails }
  | { ok: false; error: string; status: number };

export async function assignSubstitute(
  admin: SupabaseClient,
  params: AssignSubstituteParams,
  assignedBy: string,
): Promise<AssignResult> {
  const { absence_id, substitute_user_id, period_number } = params;

  // -- Phase 1: load the absence (drives every downstream lookup) ---
  const absenceRes = await admin
    .from('daily_teacher_absences')
    .select('id, teacher_user_id, absence_date')
    .eq('id', absence_id)
    .maybeSingle();
  if (absenceRes.error) {
    return { ok: false, error: 'فشل جلب الغياب: ' + absenceRes.error.message, status: 500 };
  }
  if (!absenceRes.data) {
    return { ok: false, error: 'سجل الغياب غير موجود', status: 404 };
  }
  const absence = absenceRes.data as {
    id: number;
    teacher_user_id: string;
    absence_date: string;
  };

  // day_of_week DERIVED from absence_date — single source of truth.
  const day_of_week = dayOfWeekKsa(absence.absence_date);

  // Can't sub yourself in.
  if (substitute_user_id === absence.teacher_user_id) {
    return { ok: false, error: 'لا يمكن للمعلم أن يكون بديل نفسه', status: 400 };
  }

  // -- Phase 2: all pre-write checks in parallel --------------------
  const [
    originalSlotRes,
    subProfileRes,
    subBusyRes,
    subAbsentRes,
    absentTeacherProfile,
    subAlreadyBookedRes,
    existingAssignmentRes,
  ] = await Promise.all([
    admin
      .from('teacher_schedule')
      .select('section_id, duty_type, subject')
      .eq('teacher_user_id', absence.teacher_user_id)
      .eq('day_of_week', day_of_week)
      .eq('period_number', period_number)
      .maybeSingle(),
    admin
      .from('user_profiles')
      .select('role, is_active, full_name')
      .eq('user_id', substitute_user_id)
      .maybeSingle(),
    admin
      .from('teacher_schedule')
      .select('duty_type')
      .eq('teacher_user_id', substitute_user_id)
      .eq('day_of_week', day_of_week)
      .eq('period_number', period_number)
      .in('duty_type', ['class', 'monitoring'])
      .maybeSingle(),
    admin
      .from('daily_teacher_absences')
      .select('id')
      .eq('teacher_user_id', substitute_user_id)
      .eq('absence_date', absence.absence_date)
      .maybeSingle(),
    admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', absence.teacher_user_id)
      .maybeSingle(),
    // Double-book guard: substitute booked at another absence in this slot?
    admin
      .from('substitution_assignments')
      .select('id, absence_id')
      .eq('substitute_user_id', substitute_user_id)
      .eq('assignment_date', absence.absence_date)
      .eq('period_number', period_number)
      .neq('absence_id', absence_id)
      .maybeSingle(),
    // Existing row at THIS (absence_id, slot) — drives notification reset.
    admin
      .from('substitution_assignments')
      .select('id, substitute_user_id, whatsapp_sent_at, acknowledged_at')
      .eq('absence_id', absence_id)
      .eq('day_of_week', day_of_week)
      .eq('period_number', period_number)
      .maybeSingle(),
  ]);

  if (
    originalSlotRes.error ||
    subProfileRes.error ||
    subBusyRes.error ||
    subAbsentRes.error ||
    absentTeacherProfile.error ||
    subAlreadyBookedRes.error ||
    existingAssignmentRes.error
  ) {
    const err =
      originalSlotRes.error ??
      subProfileRes.error ??
      subBusyRes.error ??
      subAbsentRes.error ??
      absentTeacherProfile.error ??
      subAlreadyBookedRes.error ??
      existingAssignmentRes.error;
    return { ok: false, error: 'فشل التحقق: ' + err!.message, status: 500 };
  }

  // -- Phase 3: invariant checks ------------------------------------
  if (!originalSlotRes.data) {
    return {
      ok: false,
      error: 'الحصة الأصلية غير موجودة في جدول المعلم الغائب',
      status: 400,
    };
  }
  const originalSlot = originalSlotRes.data as {
    section_id: number | null;
    duty_type: string;
    subject: string | null;
  };
  if (originalSlot.duty_type !== 'class') {
    return {
      ok: false,
      error: `لا يمكن إسناد بديل لحصة بنوع "${originalSlot.duty_type}" — الإسناد للحصص الدراسية فقط`,
      status: 400,
    };
  }

  if (!subProfileRes.data) {
    return { ok: false, error: 'البديل غير موجود', status: 404 };
  }
  const subProfile = subProfileRes.data as {
    role: string;
    is_active: boolean;
    full_name: string | null;
  };
  if (subProfile.role !== 'teacher') {
    return { ok: false, error: 'البديل يجب أن يكون بدور teacher', status: 400 };
  }
  if (!subProfile.is_active) {
    return { ok: false, error: 'البديل غير نشط — لا يمكن إسناده', status: 400 };
  }

  if (subBusyRes.data) {
    const busy = subBusyRes.data as { duty_type: string };
    return {
      ok: false,
      error: `البديل مشغول في نفس الحصة بـ "${busy.duty_type}" — اختر بديلًا آخر`,
      status: 400,
    };
  }

  if (subAbsentRes.data) {
    return {
      ok: false,
      error: 'البديل مُسجَّل غائبًا في نفس اليوم — اختر بديلًا آخر',
      status: 400,
    };
  }

  if (subAlreadyBookedRes.data) {
    return {
      ok: false,
      error:
        'البديل مُسنَد بالفعل لغياب آخر في نفس التاريخ والحصة — اختر بديلًا غيره',
      status: 400,
    };
  }

  // -- Phase 4: notification reset + upsert -------------------------
  const existingAssignment = existingAssignmentRes.data as
    | { substitute_user_id: string }
    | null;
  const existingSub = existingAssignment?.substitute_user_id ?? null;
  const substituteChanged =
    existingSub !== null && existingSub !== substitute_user_id;

  const upsertRes = await admin
    .from('substitution_assignments')
    .upsert(
      {
        absence_id,
        substitute_user_id,
        assignment_date: absence.absence_date,
        day_of_week,
        period_number,
        section_id: originalSlot.section_id,
        assigned_by: assignedBy,
        assigned_at: new Date().toISOString(),
        ...(substituteChanged
          ? { whatsapp_sent_at: null, acknowledged_at: null }
          : {}),
      },
      { onConflict: 'absence_id,day_of_week,period_number' },
    )
    .select(
      'id, absence_id, substitute_user_id, day_of_week, period_number, section_id, assigned_at, whatsapp_sent_at, acknowledged_at',
    )
    .single();

  if (upsertRes.error) {
    // Race: another request just inserted a conflicting row — most
    // likely the substitution_assignments_no_double_book unique
    // constraint catching a same-slot booking that the API pre-check
    // didn't see because the other transaction hadn't committed yet.
    // Convert to a friendly 409 with a retry hint instead of a raw 500.
    // (Codex Sprint 2 follow-up note on م2.8.)
    if ((upsertRes.error as { code?: string }).code === '23505') {
      return {
        ok: false,
        error:
          'تعارض في الإسناد — قد يكون البديل أُسنِد للتو لغياب آخر. حدّث الصفحة وأعد المحاولة.',
        status: 409,
      };
    }
    return { ok: false, error: 'فشل الإسناد: ' + upsertRes.error.message, status: 500 };
  }

  const absentTeacher = absentTeacherProfile.data as { full_name: string | null } | null;

  return {
    ok: true,
    assignment: upsertRes.data as AssignmentRow,
    audit_details: {
      absent_teacher_name: absentTeacher?.full_name ?? null,
      substitute_name: subProfile.full_name,
      day_of_week,
      period_number,
      section_id: originalSlot.section_id,
      subject: originalSlot.subject,
      assignment_id: (upsertRes.data as AssignmentRow).id,
      previous_substitute_user_id: substituteChanged ? existingSub : null,
      substitute_changed: substituteChanged,
      notification_reset: substituteChanged,
    },
  };
}
