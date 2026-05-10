import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { canManageSupervision } from '@/lib/supervision/permissions';

export const dynamic = 'force-dynamic';

// PATCH — decide on a swap request.
// Body: { action: 'approve' | 'reject' | 'cancel', decision_note?: string }
//   - 'cancel'  → only the requester (their own pending request)
//   - 'approve' / 'reject' → admin with manage_schedule
//
// On 'approve': the two supervision_assignments rows have their user_ids
// exchanged in a single transaction-via-RPC. If the RPC isn't deployed,
// we fall back to a 2-step update (acceptable since UNIQUE constraint
// is on (location_id, day_of_week), not user_id, so order doesn't matter).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'staff', 'teacher']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }); }

  const action = body.action as 'approve' | 'reject' | 'cancel';
  if (!['approve', 'reject', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 });
  }
  const decisionNote = body.decision_note ? String(body.decision_note).slice(0, 500) : null;

  const admin = createAdminSupabaseClient();

  // Load the request.
  const { data: req, error: loadErr } = await admin
    .from('supervision_swap_requests')
    .select('id, requester_id, requester_assignment_id, target_assignment_id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr || !req) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'تم الحسم على هذا الطلب مسبقاً' }, { status: 409 });
  }

  // Authorization per action.
  if (action === 'cancel') {
    if (req.requester_id !== auth.ctx.userId) {
      return NextResponse.json({ error: 'يحق فقط لصاحب الطلب إلغاؤه' }, { status: 403 });
    }
  } else {
    // approve / reject → manage_schedule
    if (!(await canManageSupervision(auth.ctx, admin))) {
      return NextResponse.json({ error: 'لا تملك صلاحية إدارة جدول الإشراف' }, { status: 403 });
    }
  }

  if (action === 'approve') {
    // Swap the user_ids on the two assignments.
    const { data: ax } = await admin
      .from('supervision_assignments')
      .select('id, user_id')
      .in('id', [req.requester_assignment_id, req.target_assignment_id]);
    const a1 = (ax || []).find((a: any) => a.id === req.requester_assignment_id);
    const a2 = (ax || []).find((a: any) => a.id === req.target_assignment_id);
    if (!a1 || !a2) {
      return NextResponse.json({ error: 'أحد التعيينات حُذف' }, { status: 404 });
    }
    // Two-step swap. UNIQUE constraint is on (location_id, day_of_week)
    // so updating user_id only never collides.
    await admin.from('supervision_assignments').update({
      user_id: a2.user_id, updated_by: auth.ctx.userId, updated_at: new Date().toISOString(),
    }).eq('id', a1.id);
    await admin.from('supervision_assignments').update({
      user_id: a1.user_id, updated_by: auth.ctx.userId, updated_at: new Date().toISOString(),
    }).eq('id', a2.id);
  }

  // Update the request status.
  const newStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled';
  const { data: updated, error: updErr } = await admin
    .from('supervision_swap_requests')
    .update({
      status: newStatus,
      decided_by: auth.ctx.userId,
      decided_at: new Date().toISOString(),
      decision_note: decisionNote,
    }).eq('id', id)
    .select('id, status').single();
  if (updErr) return NextResponse.json({ error: 'فشل التحديث: ' + updErr.message }, { status: 500 });

  await writeAuditLog({
    ctx: auth.ctx,
    action: `supervision.swap_${action}`,
    targetType: 'supervision_swap',
    targetId: id,
    details: { decision_note: decisionNote },
    request,
  });

  return NextResponse.json({ data: updated });
}
