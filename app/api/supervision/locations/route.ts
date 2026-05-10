import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, getAuthContext } from '@/lib/supabase/auth';
import { canManageSupervision } from '@/lib/supervision/permissions';

export const dynamic = 'force-dynamic';

// GET — list all supervision locations (any authenticated user can view).
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('supervision_locations')
    .select('id, name, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) return NextResponse.json({ error: 'فشل جلب المواقع' }, { status: 500 });
  return NextResponse.json({ data: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — add a new location (admin + manage_schedule perm).
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  if (!(await canManageSupervision(auth.ctx, admin))) {
    return NextResponse.json({ error: 'لا تملك صلاحية إدارة جدول الإشراف' }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }); }
  const name = String(body.name || '').trim();
  const sort_order = Number.isFinite(body.sort_order) ? Math.floor(body.sort_order) : 0;
  if (name.length < 2 || name.length > 200) {
    return NextResponse.json({ error: 'اسم الموقع يجب أن يكون 2-200 حرفاً' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('supervision_locations')
    .insert({ name, sort_order, is_active: true })
    .select('id, name, sort_order, is_active')
    .single();
  if (error) {
    if (error.message.toLowerCase().includes('duplicate')) {
      return NextResponse.json({ error: 'هذا الموقع موجود بالفعل' }, { status: 409 });
    }
    return NextResponse.json({ error: 'فشل إضافة الموقع: ' + error.message }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}
