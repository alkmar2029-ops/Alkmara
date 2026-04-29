import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, writeAuditLog, getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

const upsertSchema = z.object({
  admin_user_id: z.string().uuid(),
  section_ids: z.array(z.number().int().positive()).max(200),
});

// GET — admin × section matrix for the super_admin's UI.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'مخصّص للمدير العام فقط' }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();

  // Three queries in parallel — independent.
  const [{ data: assignments }, { data: admins }, { data: sections }] = await Promise.all([
    admin.from('admin_section_assignments')
      .select('id, admin_user_id, section_id, assigned_by, assigned_at'),
    admin.from('user_profiles')
      .select('user_id, full_name, role, is_active')
      .in('role', ['admin', 'super_admin'])
      .eq('is_active', true)
      .order('full_name'),
    admin.from('sections')
      .select('id, name, grade_id, sort_order, grades(id, name, sort_order)')
      .order('grade_id')
      .order('sort_order'),
  ]);

  const sortedSections = (sections || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    grade_id: s.grade_id,
    grade_name: s.grades?.name || '—',
    grade_sort: s.grades?.sort_order ?? 0,
    sort_order: s.sort_order ?? 0,
  })).sort((a, b) =>
    a.grade_sort - b.grade_sort
    || a.grade_name.localeCompare(b.grade_name, 'ar')
    || a.sort_order - b.sort_order
    || a.name.localeCompare(b.name, 'ar'),
  );

  return NextResponse.json({
    data: {
      assignments: assignments || [],
      admins: admins || [],
      sections: sortedSections,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — replace one admin's full assignment list. super_admins themselves
// don't need assignments (they see everything anyway), so we no-op when
// targeting one to avoid clutter.
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'مخصّص للمدير العام فقط' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }
  const { admin_user_id, section_ids } = parsed.data;

  const admin = createAdminSupabaseClient();

  // Verify target is admin/super_admin role.
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', admin_user_id)
    .maybeSingle();
  if (!profile || !['admin', 'super_admin'].includes(profile.role as string)) {
    return NextResponse.json({ error: 'المستخدم ليس إدارياً' }, { status: 400 });
  }

  // Diff for audit clarity.
  const { data: existing } = await admin
    .from('admin_section_assignments')
    .select('section_id')
    .eq('admin_user_id', admin_user_id);
  const existingIds = new Set((existing || []).map((r: any) => r.section_id as number));
  const incomingIds = new Set(section_ids);
  const toAdd = section_ids.filter((id) => !existingIds.has(id));
  const toRemove = Array.from(existingIds).filter((id) => !incomingIds.has(id));

  if (toRemove.length > 0) {
    const { error: delErr } = await admin
      .from('admin_section_assignments')
      .delete()
      .eq('admin_user_id', admin_user_id)
      .in('section_id', toRemove);
    if (delErr) {
      console.error('admin_assignments delete failed:', delErr.message);
      return NextResponse.json({ error: 'تعذّر إزالة بعض التعيينات' }, { status: 500 });
    }
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((section_id) => ({
      admin_user_id, section_id, assigned_by: ctx.userId,
    }));
    const { error: insErr } = await admin
      .from('admin_section_assignments')
      .insert(rows);
    if (insErr) {
      console.error('admin_assignments insert failed:', insErr.message);
      return NextResponse.json({ error: 'تعذّر إضافة بعض التعيينات' }, { status: 500 });
    }
  }

  await writeAuditLog({
    ctx,
    action: 'admin_assignments.update',
    targetType: 'admin',
    targetId: admin_user_id,
    details: {
      admin_name: profile.full_name,
      added: toAdd.length,
      removed: toRemove.length,
      total_now: section_ids.length,
    },
    request,
  });

  return NextResponse.json({
    data: { admin_user_id, section_ids, added: toAdd.length, removed: toRemove.length },
  });
}
