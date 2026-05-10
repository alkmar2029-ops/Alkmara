import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAuthContext } from '@/lib/supabase/auth';
import { canManageSupervision } from '@/lib/supervision/permissions';

export const dynamic = 'force-dynamic';

// GET — full grid (all assignments) + supervisor name lookup, ordered
// for the schedule editor. Anyone authenticated can view.
//
// Response shape: { data: [{ id, location_id, day_of_week, user_id,
//                            full_name, phone, location_name }] }
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('supervision_assignments')
    .select(`
      id, location_id, day_of_week, user_id, notes, updated_at,
      supervision_locations!inner ( name ),
      user_profiles!supervision_assignments_user_id_fkey ( full_name, phone )
    `);
  if (error) return NextResponse.json({ error: 'فشل جلب الجدول: ' + error.message }, { status: 500 });

  const flat = (data || []).map((r: any) => ({
    id: r.id,
    location_id: r.location_id,
    location_name: r.supervision_locations?.name ?? null,
    day_of_week: r.day_of_week,
    user_id: r.user_id,
    full_name: r.user_profiles?.full_name ?? null,
    phone: r.user_profiles?.phone ?? null,
    notes: r.notes,
    updated_at: r.updated_at,
  }));
  return NextResponse.json({ data: flat }, { headers: { 'Cache-Control': 'no-store' } });
}

// PUT — upsert one cell (location_id × day_of_week → user_id). Replaces
// any existing assignment in that cell.
export async function PUT(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  if (!(await canManageSupervision(auth.ctx, admin))) {
    return NextResponse.json({ error: 'لا تملك صلاحية إدارة جدول الإشراف' }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }); }

  const location_id = parseInt(body.location_id, 10);
  const day_of_week = parseInt(body.day_of_week, 10);
  const user_id = String(body.user_id || '').trim();
  const notes = body.notes ? String(body.notes).slice(0, 500) : null;

  if (!Number.isFinite(location_id) || location_id <= 0) {
    return NextResponse.json({ error: 'معرّف الموقع غير صالح' }, { status: 400 });
  }
  if (!Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 4) {
    return NextResponse.json({ error: 'يوم الإشراف يجب أن يكون من الأحد إلى الخميس' }, { status: 400 });
  }
  if (!user_id) {
    return NextResponse.json({ error: 'يجب اختيار المعلم/الإداري' }, { status: 400 });
  }

  // Upsert via UNIQUE (location_id, day_of_week).
  const { data, error } = await admin
    .from('supervision_assignments')
    .upsert({
      location_id, day_of_week, user_id, notes,
      updated_by: auth.ctx.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,day_of_week' })
    .select('id, location_id, day_of_week, user_id, notes')
    .single();
  if (error) {
    if (error.message.toLowerCase().includes('foreign key')) {
      return NextResponse.json({ error: 'الموقع أو المستخدم غير موجود' }, { status: 400 });
    }
    return NextResponse.json({ error: 'فشل الحفظ: ' + error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

// DELETE — clear one cell. Query params: ?location_id=N&day_of_week=N
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  if (!(await canManageSupervision(auth.ctx, admin))) {
    return NextResponse.json({ error: 'لا تملك صلاحية إدارة جدول الإشراف' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const location_id = parseInt(sp.get('location_id') || '0', 10);
  const day_of_week = parseInt(sp.get('day_of_week') || '-1', 10);
  if (!location_id || day_of_week < 0 || day_of_week > 4) {
    return NextResponse.json({ error: 'وسائط غير صالحة' }, { status: 400 });
  }
  const { error } = await admin
    .from('supervision_assignments')
    .delete()
    .eq('location_id', location_id)
    .eq('day_of_week', day_of_week);
  if (error) return NextResponse.json({ error: 'فشل الحذف: ' + error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
