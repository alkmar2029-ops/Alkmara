import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — full day report.
//   ?date=YYYY-MM-DD (required)
//   ?grade=GRADE_NAME (optional filter)
//
// Returns sessions with their absent/late/excused students grouped — exactly
// what the print page needs in one round trip.
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const grade = searchParams.get('grade');
  if (!date) return NextResponse.json({ error: 'date مطلوب' }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // 1. Sessions for the day.
  const { data: sessions, error } = await supabase
    .from('period_sessions')
    .select(`
      id, attendance_date, recorded_at, recorded_by, section_id, period_id,
      absent_count, late_count, excused_count, total_count, notes,
      sections ( id, name, grade_id, grades ( id, name ) ),
      periods ( id, number, name )
    `)
    .eq('attendance_date', date)
    .order('period_id')
    .order('section_id');

  if (error) {
    return NextResponse.json({ error: 'فشل جلب البيانات' }, { status: 500 });
  }

  // 2. Filter by grade (server-side join, post-filter for simplicity).
  const filtered = (sessions || []).filter((s: any) =>
    !grade || s.sections?.grades?.name === grade
  );
  const sessionIds = filtered.map((s: any) => s.id);

  // 3. Resolve teacher names.
  const teacherIds = Array.from(new Set(filtered.map((s: any) => s.recorded_by).filter(Boolean)));
  const teacherMap = new Map<string, string>();
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', teacherIds);
    for (const p of profiles || []) {
      if (p.full_name) teacherMap.set(p.user_id, p.full_name);
    }
  }

  // 4. Pull all absences for these sessions in one shot.
  let absencesBySession = new Map<number, Array<any>>();
  if (sessionIds.length > 0) {
    const { data: absences } = await supabase
      .from('period_absences')
      .select(`
        session_id, status, notes,
        students!inner ( id, student_id, first_name, father_name, last_name )
      `)
      .in('session_id', sessionIds);

    for (const a of absences || []) {
      const arr = absencesBySession.get((a as any).session_id) || [];
      const stu: any = (a as any).students;
      arr.push({
        student_id: stu?.id,
        student_code: stu?.student_id,
        name: [stu?.first_name, stu?.father_name, stu?.last_name].filter(Boolean).join(' ').trim(),
        status: (a as any).status,
        notes: (a as any).notes || null,
      });
      absencesBySession.set((a as any).session_id, arr);
    }
  }

  // 5. School metadata for the header.
  const { data: settingsRow } = await supabase
    .from('school_settings')
    .select('school_name, principal_name')
    .eq('id', 1)
    .maybeSingle();

  // 6. Shape rows for the print page.
  const rows = filtered.map((s: any) => ({
    id: s.id,
    section_id: s.section_id,
    section_name: s.sections?.name ?? null,
    grade_name: s.sections?.grades?.name ?? null,
    period_id: s.period_id,
    period_number: s.periods?.number ?? null,
    period_name: s.periods?.name ?? null,
    teacher_name: s.recorded_by ? (teacherMap.get(s.recorded_by) ?? null) : null,
    recorded_at: s.recorded_at,
    absent_count: s.absent_count,
    late_count: s.late_count,
    excused_count: s.excused_count,
    total_count: s.total_count,
    present_count: s.total_count - s.absent_count - s.late_count - s.excused_count,
    notes: s.notes,
    absences: absencesBySession.get(s.id) || [],
  }));

  // 7. Aggregate totals.
  const totals = rows.reduce((acc, r) => ({
    sessions: acc.sessions + 1,
    present: acc.present + r.present_count,
    absent: acc.absent + r.absent_count,
    late: acc.late + r.late_count,
    excused: acc.excused + r.excused_count,
  }), { sessions: 0, present: 0, absent: 0, late: 0, excused: 0 });

  return NextResponse.json({
    data: {
      date,
      grade: grade || null,
      school_name: (settingsRow?.school_name as string) || '',
      principal_name: (settingsRow?.principal_name as string) || '',
      totals,
      rows,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
