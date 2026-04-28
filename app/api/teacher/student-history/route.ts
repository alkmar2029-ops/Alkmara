import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — every session the calling teacher recorded that touched a given
// student, joined with the student's status in that session. The teacher
// only sees sessions they themselves recorded — not other teachers'.
//
//   ?student_id=NUMERIC (required)
//   ?from=YYYY-MM-DD    (default: 90 days ago)
//   ?to=YYYY-MM-DD      (default: today)
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const studentId = parseInt(searchParams.get('student_id') || '', 10);
  if (Number.isNaN(studentId)) {
    return NextResponse.json({ error: 'student_id مطلوب' }, { status: 400 });
  }
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const from = searchParams.get('from') || defaultFrom.toISOString().slice(0, 10);
  const to = searchParams.get('to') || today.toISOString().slice(0, 10);

  const supabase = await createServerSupabaseClient();

  // 1. Student basics.
  const { data: student } = await supabase
    .from('students')
    .select(`
      id, student_id, first_name, father_name, last_name, phone,
      section_id, sections ( name, grades ( name ) )
    `)
    .eq('id', studentId)
    .maybeSingle();
  if (!student) {
    return NextResponse.json({ error: 'الطالب غير موجود' }, { status: 404 });
  }

  // 2. Sessions the teacher recorded for this student's section in range.
  const { data: sessions } = await supabase
    .from('period_sessions')
    .select(`
      id, attendance_date, period_id,
      periods ( number, name )
    `)
    .eq('recorded_by', ctx.userId)
    .eq('section_id', (student as any).section_id)
    .gte('attendance_date', from)
    .lte('attendance_date', to)
    .order('attendance_date', { ascending: false })
    .order('period_id', { ascending: true });

  const sessionRows = (sessions || []) as any[];
  const sessionIds = sessionRows.map((s) => s.id);

  // 3. Pull this student's absence rows (if any) for these sessions.
  const absenceMap = new Map<number, { status: string; notes: string | null }>();
  if (sessionIds.length > 0) {
    const { data: absences } = await supabase
      .from('period_absences')
      .select('session_id, status, notes')
      .in('session_id', sessionIds)
      .eq('student_id', studentId);
    for (const a of absences || []) {
      absenceMap.set((a as any).session_id, { status: (a as any).status, notes: (a as any).notes });
    }
  }

  // 4. Compose timeline rows + summary.
  const timeline = sessionRows.map((s) => {
    const entry = absenceMap.get(s.id);
    return {
      session_id: s.id,
      attendance_date: s.attendance_date,
      period_number: s.periods?.number ?? null,
      period_name: s.periods?.name ?? null,
      status: (entry?.status ?? 'present') as 'present' | 'absent' | 'late' | 'excused',
      notes: entry?.notes ?? null,
    };
  });

  const summary = {
    total: timeline.length,
    present: timeline.filter((t) => t.status === 'present').length,
    absent: timeline.filter((t) => t.status === 'absent').length,
    late: timeline.filter((t) => t.status === 'late').length,
    excused: timeline.filter((t) => t.status === 'excused').length,
  };
  const attendanceRate = summary.total > 0 ? Math.round((summary.present / summary.total) * 100) : 0;

  return NextResponse.json({
    data: {
      student: {
        id: (student as any).id,
        student_code: (student as any).student_id,
        name: [(student as any).first_name, (student as any).father_name, (student as any).last_name].filter(Boolean).join(' ').trim(),
        phone: (student as any).phone || null,
        grade: (student as any).sections?.grades?.name || '—',
        section: (student as any).sections?.name || '—',
      },
      from, to,
      summary: { ...summary, attendance_rate: attendanceRate },
      timeline,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
