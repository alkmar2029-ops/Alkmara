import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — current admin's assigned sections, joined with grade names.
// Drives the header scope indicator + any admin-side dropdowns. Returns
// is_super_admin: true (with no sections list filter) for the principal.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  // Super admin sees everything — UI uses this to skip the "scope" banner.
  if (ctx.role === 'super_admin') {
    return NextResponse.json({
      data: { is_super_admin: true, sections: [] },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Non-admins fall through with empty data — they don't have assignments.
  if (ctx.role !== 'admin') {
    return NextResponse.json({
      data: { is_super_admin: false, sections: [] },
    });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('admin_section_assignments')
    .select('section_id, sections (id, name, grade_id, sort_order, grades (id, name, sort_order))')
    .eq('admin_user_id', ctx.userId);

  if (error) {
    console.error('admin-assignments/me failed:', error.message);
    return NextResponse.json({ error: 'تعذّر جلب التعيينات' }, { status: 500 });
  }

  const sections = (data || [])
    .map((r: any) => r.sections)
    .filter(Boolean)
    .map((s: any) => ({
      id: s.id,
      name: s.name,
      grade_id: s.grade_id,
      grade_name: s.grades?.name || '—',
      grade_sort: s.grades?.sort_order ?? 0,
      sort_order: s.sort_order ?? 0,
    }))
    .sort((a, b) =>
      a.grade_sort - b.grade_sort
      || a.grade_name.localeCompare(b.grade_name, 'ar')
      || a.sort_order - b.sort_order
      || a.name.localeCompare(b.name, 'ar'),
    );

  return NextResponse.json({
    data: { is_super_admin: false, sections },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
