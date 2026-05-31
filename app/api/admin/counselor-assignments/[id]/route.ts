// DELETE /api/admin/counselor-assignments/[id] — remove a single
// assignment row. The counselor instantly loses access to the students
// under that grade/section via RLS (counselor_can_see_student no longer
// returns TRUE for them on those rows).
//
// We read the row BEFORE deleting to capture before-state for the audit
// log. The counselor's name is fetched in a separate user_profiles query
// because counselor_user_id is FK'd to auth.users — PostgREST can't
// embed user_profiles through that relationship.
//
// Deleting a non-existent id is a 404 (not a silent no-op) so the UI
// can tell the admin that someone else already removed it.

import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireManageUsers } from '@/lib/personas/auth-gate';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireManageUsers();
  if (!auth.ok) return auth.res;

  // Validate id is a positive-integer string. parseInt("123abc", 10)
  // returns 123 and would let "abc" garbage through — use a strict
  // regex instead.
  if (!/^\d+$/.test(params.id)) {
    return NextResponse.json(
      { error: 'معرّف الإسناد غير صالح' },
      { status: 400 },
    );
  }
  const assignmentId = Number(params.id);

  const admin = createAdminSupabaseClient();

  // Read before-state for audit. No PostgREST embed for the counselor
  // (FK points to auth.users, not user_profiles).
  const { data: existing, error: readErr } = await admin
    .from('counselor_assignments')
    .select('id, counselor_user_id, grade_id, section_id, assigned_at')
    .eq('id', assignmentId)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json(
      { error: 'فشل قراءة الإسناد: ' + readErr.message },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: 'الإسناد غير موجود (قد يكون حُذف بالفعل)' },
      { status: 404 },
    );
  }

  // Pull the counselor's name separately for a readable audit row. Best-
  // effort: if it fails or returns nothing, we still proceed with the
  // delete — the audit just gets a null name.
  let counselorName: string | null = null;
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', existing.counselor_user_id)
    .maybeSingle();
  if (profile?.full_name) counselorName = profile.full_name;

  // Delete. No cascade concerns — counselor_assignments is leaf data
  // referenced only by the counselor_can_see_student function, which now
  // evaluates FALSE for the removed scope.
  const { error: deleteErr } = await admin
    .from('counselor_assignments')
    .delete()
    .eq('id', assignmentId);

  if (deleteErr) {
    return NextResponse.json(
      { error: 'فشل حذف الإسناد: ' + deleteErr.message },
      { status: 500 },
    );
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'counselor_assignment.delete',
    targetType: 'counselor',
    targetId: existing.counselor_user_id,
    details: {
      assignment_id: existing.id,
      counselor_name: counselorName,
      scope_type: existing.grade_id != null ? 'grade' : 'section',
      grade_id: existing.grade_id,
      section_id: existing.section_id,
      original_assigned_at: existing.assigned_at,
    },
    request,
  });

  return NextResponse.json({
    data: { deleted_id: assignmentId },
  });
}
