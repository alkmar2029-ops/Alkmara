import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/supabase/auth';
import { canManageSupervision } from '@/lib/supervision/permissions';

export const dynamic = 'force-dynamic';

// GET — list swap requests visible to the caller.
//   • admin/super_admin with manage_schedule → all
//   • everyone else → only their own
// Query params: ?status=pending|approved|rejected|cancelled (optional)
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const status = request.nextUrl.searchParams.get('status');

  let q = admin
    .from('supervision_swap_requests')
    .select(`
      id, requester_id, requester_assignment_id, target_assignment_id,
      reason, status, decided_by, decided_at, decision_note, created_at
    `)
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);
  if (!(await canManageSupervision(ctx, admin))) {
    q = q.eq('requester_id', ctx.userId);
  }

  const { data: requests, error } = await q;
  if (error) return NextResponse.json({ error: 'فشل جلب الطلبات: ' + error.message }, { status: 500 });

  if (!requests || requests.length === 0) {
    return NextResponse.json({ data: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Enrich with assignment details (location + day) + user names.
  const assignmentIds = Array.from(new Set([
    ...requests.map((r) => r.requester_assignment_id),
    ...requests.map((r) => r.target_assignment_id),
  ]));
  const userIds = Array.from(new Set([
    ...requests.map((r) => r.requester_id),
    ...(requests.map((r) => r.decided_by).filter(Boolean) as string[]),
  ]));

  const [{ data: assignments }, { data: profiles }] = await Promise.all([
    admin
      .from('supervision_assignments')
      .select('id, location_id, day_of_week, user_id, supervision_locations!inner(name)')
      .in('id', assignmentIds),
    admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', userIds),
  ]);

  const aMap = new Map<number, any>();
  for (const a of assignments || []) {
    aMap.set(a.id, {
      id: a.id,
      location_id: a.location_id,
      day_of_week: a.day_of_week,
      user_id: a.user_id,
      location_name: (a as any).supervision_locations?.name ?? null,
    });
  }
  const nameMap = new Map<string, string>();
  for (const p of profiles || []) {
    if (p.full_name) nameMap.set(p.user_id, p.full_name);
  }

  // Look up the target assignment's CURRENT user (it's who the swap is with).
  const targetUserIds = Array.from(new Set(
    Array.from(aMap.values()).map((a: any) => a.user_id).filter(Boolean),
  ));
  if (targetUserIds.length > 0) {
    const { data: more } = await admin
      .from('user_profiles').select('user_id, full_name').in('user_id', targetUserIds);
    for (const p of more || []) {
      if (p.full_name && !nameMap.has(p.user_id)) nameMap.set(p.user_id, p.full_name);
    }
  }

  const enriched = requests.map((r) => ({
    ...r,
    requester_name: nameMap.get(r.requester_id) || null,
    decided_by_name: r.decided_by ? nameMap.get(r.decided_by) || null : null,
    requester_assignment: aMap.get(r.requester_assignment_id) || null,
    target_assignment: aMap.get(r.target_assignment_id) || null,
    target_user_name: aMap.get(r.target_assignment_id)
      ? nameMap.get(aMap.get(r.target_assignment_id)!.user_id) || null
      : null,
  }));

  return NextResponse.json({ data: enriched }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — create a swap request. The requester must own one of the two
// assignments. Body: { requester_assignment_id, target_assignment_id, reason }
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff', 'teacher']);
  if (!auth.ok) return auth.res;

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }); }

  const requesterAssignmentId = parseInt(body.requester_assignment_id, 10);
  const targetAssignmentId = parseInt(body.target_assignment_id, 10);
  const reason = body.reason ? String(body.reason).slice(0, 500) : null;

  if (!Number.isFinite(requesterAssignmentId) || !Number.isFinite(targetAssignmentId)
      || requesterAssignmentId === targetAssignmentId) {
    return NextResponse.json({ error: 'يجب اختيار يومين مختلفين' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // Validate both assignments + ownership.
  const { data: ax } = await admin
    .from('supervision_assignments')
    .select('id, user_id')
    .in('id', [requesterAssignmentId, targetAssignmentId]);
  const requesterAss = (ax || []).find((a: any) => a.id === requesterAssignmentId);
  const targetAss = (ax || []).find((a: any) => a.id === targetAssignmentId);
  if (!requesterAss || !targetAss) {
    return NextResponse.json({ error: 'أحد التعيينات غير موجود' }, { status: 404 });
  }
  if (requesterAss.user_id !== auth.ctx.userId) {
    return NextResponse.json({ error: 'لا يمكنك طلب تبديل تعيين ليس لك' }, { status: 403 });
  }
  if (targetAss.user_id === auth.ctx.userId) {
    return NextResponse.json({ error: 'لا يمكن طلب تبديل مع نفسك' }, { status: 400 });
  }

  // Reject if there's already a pending swap on either side.
  const { data: existing } = await admin
    .from('supervision_swap_requests')
    .select('id')
    .eq('status', 'pending')
    .or(`requester_assignment_id.eq.${requesterAssignmentId},target_assignment_id.eq.${requesterAssignmentId},requester_assignment_id.eq.${targetAssignmentId},target_assignment_id.eq.${targetAssignmentId}`);
  if ((existing || []).length > 0) {
    return NextResponse.json({ error: 'يوجد طلب تبديل معلّق على أحد التعيينين' }, { status: 409 });
  }

  const { data, error } = await admin
    .from('supervision_swap_requests')
    .insert({
      requester_id: auth.ctx.userId,
      requester_assignment_id: requesterAssignmentId,
      target_assignment_id: targetAssignmentId,
      reason,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: 'فشل إنشاء الطلب: ' + error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
