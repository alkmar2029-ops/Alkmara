import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, createAttendanceSchema } from '@/lib/validations/schemas';
import { getLocalToday, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/lib/utils/helpers';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || getLocalToday();
  const section_id = searchParams.get('section_id');
  const status = searchParams.get('status');
  const validStatuses = ['present', 'late', 'absent', 'excused'];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'حالة الحضور غير صالحة' }, { status: 400 });
  }
  const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
  const limit = Math.min(parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = (page - 1) * limit;

  let query = supabase
    .from('attendance_records')
    .select(`
      *,
      students(student_id, first_name, last_name, father_name, grade_id, section_id, grades(name), sections(name))
    `, { count: 'exact' })
    .order('punch_time', { ascending: false })
    .range(offset, offset + limit - 1);

  if (date) query = query.eq('attendance_date', date);
  if (section_id) query = query.eq('section_id', section_id);
  if (status) query = query.eq('status', status);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: 'حدث خطأ في جلب سجلات الحضور' }, { status: 400 });

  const records = (data || []).map((r: any) => ({
    ...r,
    student_code: r.students?.student_id,
    first_name: r.students?.first_name,
    last_name: r.students?.last_name,
    father_name: r.students?.father_name,
    grade_name: r.students?.grades?.name,
    section_name: r.students?.sections?.name,
    students: undefined,
  }));

  return NextResponse.json({ data: records, total: count, page, limit, totalPages: Math.ceil((count || 0) / limit) });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(createAttendanceSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { data, error } = await supabase.from('attendance_records').upsert({
    ...validation.data,
    source: 'manual',
  }, { onConflict: 'student_id,attendance_date' }).select().single();

  if (error) return NextResponse.json({ error: 'حدث خطأ في حفظ سجل الحضور' }, { status: 400 });
  return NextResponse.json({ data }, { status: 201 });
}
