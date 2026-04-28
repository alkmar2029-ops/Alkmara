import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — full detail for a single period-session, used by the cell-click modal:
//   • session info (date, period, section, teacher, recorded_at, counts)
//   • every active student in the section, joined with their status
//     ('present' = no absences row; 'absent' / 'late' / 'excused' = explicit)
//   • status notes if any
//
// Shaped so the UI can render lists by status without follow-up queries.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const sessionId = parseInt(params.id, 10);
  if (Number.isNaN(sessionId)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // 1. Session row + joined section/period/grade.
  const { data: session, error: sErr } = await supabase
    .from('period_sessions')
    .select(`
      id, section_id, period_id, attendance_date, recorded_by, recorded_at,
      absent_count, late_count, excused_count, total_count, notes,
      sections ( id, name, grades ( id, name ) ),
      periods ( id, number, name )
    `)
    .eq('id', sessionId)
    .maybeSingle();

  if (sErr || !session) {
    return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 });
  }

  // 2. Teacher display name.
  let teacherName: string | null = null;
  if (session.recorded_by) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', session.recorded_by)
      .maybeSingle();
    teacherName = (profile?.full_name as string) || null;
  }

  // 3. All active students in this section.
  const { data: students } = await supabase
    .from('students')
    .select('id, student_id, first_name, father_name, last_name, phone')
    .eq('section_id', session.section_id)
    .eq('is_active', true)
    .order('first_name');

  // 4. Absence rows for this session.
  const { data: absences } = await supabase
    .from('period_absences')
    .select('student_id, status, notes')
    .eq('session_id', session.id);

  const statusMap = new Map<number, { status: 'absent' | 'late' | 'excused'; notes: string | null }>();
  for (const a of absences || []) {
    statusMap.set(a.student_id as number, { status: a.status as any, notes: (a.notes as any) || null });
  }

  // 5. Decorate each student with status.
  const studentRows = (students || []).map((s: any) => {
    const fullName = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ').trim();
    const entry = statusMap.get(s.id);
    return {
      id: s.id,
      student_id: s.student_id,
      name: fullName,
      phone: s.phone || null,
      status: (entry?.status ?? 'present') as 'present' | 'absent' | 'late' | 'excused',
      notes: entry?.notes ?? null,
    };
  });

  const summary = {
    total: studentRows.length,
    present: studentRows.filter((s) => s.status === 'present').length,
    absent: studentRows.filter((s) => s.status === 'absent').length,
    late: studentRows.filter((s) => s.status === 'late').length,
    excused: studentRows.filter((s) => s.status === 'excused').length,
  };

  return NextResponse.json({
    data: {
      session: {
        id: session.id,
        attendance_date: session.attendance_date,
        recorded_at: session.recorded_at,
        recorded_by: session.recorded_by,
        teacher_name: teacherName,
        section_id: session.section_id,
        section_name: (session as any).sections?.name ?? null,
        grade_name: (session as any).sections?.grades?.name ?? null,
        period_id: session.period_id,
        period_number: (session as any).periods?.number ?? null,
        period_name: (session as any).periods?.name ?? null,
        notes: session.notes,
      },
      summary,
      students: studentRows,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
