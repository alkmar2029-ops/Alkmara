import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRecordAttendance } from '@/lib/personas/auth-gate';

export const dynamic = 'force-dynamic';

// GET — minimal class roster for the period-attendance ENTRY modal.
//
// Returns id + name fields ONLY. It deliberately does NOT use /api/students
// (which selects `*`, including health_info / social_info) so that a وكيل
// recording attendance never receives sensitive student data over the wire —
// that data requires view_health_info / view_social_info, which this surface
// grants neither. Rows are still RLS-gated by the server client.
//
// Gated identically to the save endpoint (requireRecordAttendance): teacher/
// staff by role, admin only with take_attendance, super_admin always.
export async function GET(request: NextRequest) {
  const auth = await requireRecordAttendance();
  if (!auth.ok) return auth.res;

  const sectionId = parseInt(new URL(request.url).searchParams.get('section_id') || '', 10);
  if (!sectionId) {
    return NextResponse.json({ error: 'يجب تحديد section_id' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('students')
    .select('id, student_id, first_name, father_name, last_name')
    .eq('section_id', sectionId)
    .eq('is_active', true)
    .order('first_name', { ascending: true })
    .order('father_name', { ascending: true, nullsFirst: false })
    .order('last_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'فشل تحميل الطلاب' }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}
