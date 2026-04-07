import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, updateSectionsSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(request.url);
  const gradeId = searchParams.get('grade_id');

  let query = supabase.from('sections').select('*, grades(name, stage)').order('sort_order');
  if (gradeId) query = query.eq('grade_id', gradeId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'حدث خطأ في جلب الشُعب' }, { status: 400 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = createAdminSupabaseClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(updateSectionsSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { grade_id, sections } = validation.data;

  // Delete existing sections for this grade that are not in use
  // First check which sections have students or attendance records
  const { data: existingSections } = await supabase
    .from('sections')
    .select('id, name')
    .eq('grade_id', grade_id);

  const sectionNames = sections.map((s: any) => s.name);

  // Delete sections not in the new list (only if no students AND no attendance records)
  for (const existing of (existingSections || [])) {
    if (!sectionNames.includes(existing.name)) {
      const { count: studentCount } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('section_id', existing.id);

      const { count: attendanceCount } = await supabase
        .from('attendance_records')
        .select('id', { count: 'exact', head: true })
        .eq('section_id', existing.id);

      if ((studentCount || 0) === 0 && (attendanceCount || 0) === 0) {
        await supabase.from('sections').delete().eq('id', existing.id);
      }
    }
  }

  // Upsert new sections
  const records = sections.map((s: any, i: number) => ({
    grade_id,
    name: s.name,
    sort_order: i + 1,
  }));

  const { data, error } = await supabase
    .from('sections')
    .upsert(records, { onConflict: 'grade_id,name' })
    .select();

  if (error) return NextResponse.json({ error: 'حدث خطأ في حفظ الشُعب' }, { status: 400 });
  return NextResponse.json({ data });
}
