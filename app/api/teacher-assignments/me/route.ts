import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — current teacher's assigned sections, joined with grade info.
// Used by the teacher portal to populate the section pickers and to
// show an empty state when the teacher hasn't been assigned anything yet.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  // Admin/staff/viewer — return empty list since this endpoint is teacher-
  // specific. The dashboard pages they use don't filter by assignment.
  if (ctx.role !== 'teacher') {
    return NextResponse.json({ data: { sections: [] } });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('teacher_section_assignments')
    .select('section_id, sections (id, name, grade_id, sort_order, grades (id, name, sort_order))')
    .eq('teacher_user_id', ctx.userId);

  if (error) {
    console.error('teacher-assignments/me failed:', error.message);
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

  return NextResponse.json({ data: { sections } }, { headers: { 'Cache-Control': 'no-store' } });
}
