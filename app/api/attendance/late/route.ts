import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getLocalToday } from '@/lib/utils/helpers';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET /api/attendance/late?date=YYYY-MM-DD&grade_id=&section_id=&device_id=
// Returns late attendance rows joined with student + grade + section, ordered by punch_time desc.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff', 'viewer']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || getLocalToday();
  const gradeId = searchParams.get('grade_id');
  const sectionId = searchParams.get('section_id');
  const deviceId = searchParams.get('device_id');

  let query = supabase
    .from('attendance_records')
    .select(`
      id, student_id, section_id, device_id, attendance_date, punch_time, status, minutes_late, source,
      students!inner(id, student_id, first_name, father_name, last_name, phone, grade_id, section_id, grades(name), sections(name))
    `)
    .eq('attendance_date', date)
    .eq('status', 'late')
    .order('punch_time', { ascending: false })
    .limit(1000);

  if (sectionId) query = query.eq('section_id', sectionId);
  if (deviceId) query = query.eq('device_id', deviceId);
  if (gradeId) query = query.eq('students.grade_id', gradeId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'فشل جلب سجلات التأخير' }, { status: 400 });

  const rows = (data || []).map((r: any) => ({
    id: r.id,
    student_id: r.student_id,
    section_id: r.section_id,
    device_id: r.device_id,
    attendance_date: r.attendance_date,
    punch_time: r.punch_time,
    status: r.status,
    minutes_late: r.minutes_late,
    source: r.source,
    student_code: r.students?.student_id,
    first_name: r.students?.first_name,
    father_name: r.students?.father_name,
    last_name: r.students?.last_name,
    phone: r.students?.phone,
    grade_id: r.students?.grade_id,
    grade_name: r.students?.grades?.name,
    section_name: r.students?.sections?.name,
  }));

  return NextResponse.json({ data: rows, total: rows.length, date }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
