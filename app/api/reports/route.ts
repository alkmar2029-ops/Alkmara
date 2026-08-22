import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getLocalToday } from '@/lib/utils/helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'daily';
  const date = searchParams.get('date') || getLocalToday();
  const section_id = searchParams.get('section_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  try {
    if (type === 'daily') {
      // Get all sections with their grades
      const [sectionsRes, recordsRes] = await Promise.all([
        supabase
          .from('sections')
          .select('id, name, grades(name)')
          .order('grade_id'),
        // Fetch all attendance records for the date in one thin query.
        supabase
          .from('attendance_records')
          .select('section_id, status')
          .eq('attendance_date', date),
      ]);
      if (sectionsRes.error || recordsRes.error) throw sectionsRes.error ?? recordsRes.error;
      const sections = sectionsRes.data;
      const allRecords = recordsRes.data;

      // Aggregate while scanning instead of retaining every record in memory.
      type StatusCounts = { present: number; late: number; absent: number; excused: number };
      const recordsBySection = new Map<number, StatusCounts>();
      (allRecords || []).forEach((r: any) => {
        const counts = recordsBySection.get(r.section_id) || { present: 0, late: 0, absent: 0, excused: 0 };
        if (r.status === 'present') counts.present += 1;
        else if (r.status === 'late') counts.late += 1;
        else if (r.status === 'absent') counts.absent += 1;
        else if (r.status === 'excused') counts.excused += 1;
        recordsBySection.set(r.section_id, counts);
      });

      const results = [];
      for (const sec of sections || []) {
        const s = recordsBySection.get(sec.id) || { present: 0, late: 0, absent: 0, excused: 0 };
        const total = Object.values(s).reduce((a, b) => a + b, 0);
        if (total > 0) {
          results.push({
            section_id: sec.id,
            section_name: sec.name,
            grade_name: (sec as any).grades?.name,
            ...s, total,
            attendance_rate: Math.round(((s.present + s.late) / total) * 100 * 100) / 100,
          });
        }
      }
      return NextResponse.json({ data: results });
    }

    if (type === 'section' && section_id && from && to) {
      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(from) || !dateRegex.test(to)) {
        return NextResponse.json({ error: 'صيغة التاريخ غير صالحة' }, { status: 400 });
      }
      // Validate that from <= to
      if (from > to) {
        return NextResponse.json({ error: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية' }, { status: 400 });
      }

      const [studentsRes, recordsRes] = await Promise.all([
        supabase
          .from('students')
          .select('id, student_id, first_name, last_name, father_name')
          .eq('section_id', section_id)
          .eq('is_active', true)
          .order('first_name', { ascending: true })
          .order('father_name', { ascending: true, nullsFirst: false })
          .order('last_name', { ascending: true }),
        supabase
          .from('attendance_records')
          .select('student_id, status')
          .eq('section_id', section_id)
          .gte('attendance_date', from)
          .lte('attendance_date', to),
      ]);
      if (studentsRes.error || recordsRes.error) throw studentsRes.error ?? recordsRes.error;
      const students = studentsRes.data;
      const records = recordsRes.data;

      // Use Map (not a plain object) to preserve the alphabetical insertion
      // order from the SELECT above. Plain `{}` keyed by integer IDs returns
      // values in numeric order from Object.values — silently breaking the
      // alphabetical ordering the teacher expects.
      const studentMap = new Map<number, any>();
      (students || []).forEach((s: any) => {
        studentMap.set(s.id, { ...s, summary: { present: 0, late: 0, absent: 0, excused: 0 } });
      });
      (records || []).forEach((r: any) => {
        const entry = studentMap.get(r.student_id);
        if (entry && r.status in entry.summary) entry.summary[r.status]++;
      });

      return NextResponse.json({ data: Array.from(studentMap.values()) });
    }

    return NextResponse.json({ data: [] });
  } catch {
    return NextResponse.json({ error: 'حدث خطأ في إنشاء التقرير' }, { status: 500 });
  }
}
