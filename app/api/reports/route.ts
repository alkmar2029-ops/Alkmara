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
      const { data: sections } = await supabase
        .from('sections')
        .select('id, name, grades(name, stage)')
        .order('grade_id');

      // Fetch ALL attendance records for the date in ONE query (fix N+1)
      const { data: allRecords } = await supabase
        .from('attendance_records')
        .select('section_id, status')
        .eq('attendance_date', date);

      // Group records by section_id
      const recordsBySection = new Map<number, any[]>();
      (allRecords || []).forEach((r: any) => {
        const arr = recordsBySection.get(r.section_id) || [];
        arr.push(r);
        recordsBySection.set(r.section_id, arr);
      });

      const results = [];
      for (const sec of sections || []) {
        const records = recordsBySection.get(sec.id) || [];
        const s = { present: 0, late: 0, absent: 0, excused: 0 };
        records.forEach((r: any) => { if (s.hasOwnProperty(r.status)) s[r.status as keyof typeof s]++; });
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

      const { data: students } = await supabase
        .from('students')
        .select('id, student_id, first_name, last_name, father_name')
        .eq('section_id', section_id)
        .eq('is_active', true)
        .order('first_name', { ascending: true })
        .order('father_name', { ascending: true, nullsFirst: false })
        .order('last_name', { ascending: true });

      const { data: records } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('section_id', section_id)
        .gte('attendance_date', from)
        .lte('attendance_date', to);

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
