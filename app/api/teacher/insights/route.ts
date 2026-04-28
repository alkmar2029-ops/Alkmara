import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — analytics for the calling teacher's recorded sessions.
//   ?from=YYYY-MM-DD  (default: 30 days ago)
//   ?to=YYYY-MM-DD    (default: today)
//   ?limit=10         (default: 10 — top students per status)
//
// Returns:
//   • totals: counts of sessions/present/absent/late/excused
//   • by_period: attendance rate per period number
//   • by_section: attendance rate per (grade, section)
//   • top_absent / top_late / top_excused: top-N students by status count
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = searchParams.get('from') || defaultFrom.toISOString().slice(0, 10);
  const to = searchParams.get('to') || today.toISOString().slice(0, 10);
  const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10) || 10, 50);

  const supabase = await createServerSupabaseClient();

  // 1. Sessions for the teacher in the range.
  const { data: sessions } = await supabase
    .from('period_sessions')
    .select(`
      id, attendance_date, section_id, period_id,
      absent_count, late_count, excused_count, total_count,
      sections ( name, grades ( name ) ),
      periods ( number )
    `)
    .eq('recorded_by', ctx.userId)
    .gte('attendance_date', from)
    .lte('attendance_date', to);

  const sessionRows = sessions || [];
  const sessionIds = sessionRows.map((s: any) => s.id);

  // 2. Aggregate totals.
  const totals = sessionRows.reduce((acc: any, s: any) => ({
    sessions: acc.sessions + 1,
    students_seen: acc.students_seen + s.total_count,
    absent: acc.absent + s.absent_count,
    late: acc.late + s.late_count,
    excused: acc.excused + s.excused_count,
  }), { sessions: 0, students_seen: 0, absent: 0, late: 0, excused: 0 });
  const present = totals.students_seen - totals.absent - totals.late - totals.excused;
  const attendanceRate = totals.students_seen > 0 ? Math.round((present / totals.students_seen) * 100) : 0;

  // 3. By period.
  const byPeriodMap = new Map<number, { total: number; absent: number; late: number; excused: number }>();
  for (const s of sessionRows as any[]) {
    const n = s.periods?.number || 0;
    if (!n) continue;
    const cur = byPeriodMap.get(n) || { total: 0, absent: 0, late: 0, excused: 0 };
    cur.total += s.total_count;
    cur.absent += s.absent_count;
    cur.late += s.late_count;
    cur.excused += s.excused_count;
    byPeriodMap.set(n, cur);
  }
  const byPeriod = Array.from(byPeriodMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([n, v]) => {
      const p = v.total - v.absent - v.late - v.excused;
      return {
        period: n,
        total: v.total,
        present: p,
        absent: v.absent,
        late: v.late,
        excused: v.excused,
        rate: v.total > 0 ? Math.round((p / v.total) * 100) : 0,
      };
    });

  // 4. By section.
  const bySectionMap = new Map<string, { grade: string; section: string; total: number; absent: number; late: number; excused: number }>();
  for (const s of sessionRows as any[]) {
    const grade = s.sections?.grades?.name || '—';
    const section = s.sections?.name || '—';
    const key = `${grade}__${section}`;
    const cur = bySectionMap.get(key) || { grade, section, total: 0, absent: 0, late: 0, excused: 0 };
    cur.total += s.total_count;
    cur.absent += s.absent_count;
    cur.late += s.late_count;
    cur.excused += s.excused_count;
    bySectionMap.set(key, cur);
  }
  const bySection = Array.from(bySectionMap.values())
    .map((v) => {
      const p = v.total - v.absent - v.late - v.excused;
      return {
        ...v,
        present: p,
        rate: v.total > 0 ? Math.round((p / v.total) * 100) : 0,
      };
    })
    .sort((a, b) => a.rate - b.rate);  // worst first

  // 5. Top students by status.
  let topAbsent: any[] = [], topLate: any[] = [], topExcused: any[] = [];
  if (sessionIds.length > 0) {
    const { data: absences } = await supabase
      .from('period_absences')
      .select(`
        student_id, status,
        students ( id, student_id, first_name, father_name, last_name,
          sections ( name, grades ( name ) )
        )
      `)
      .in('session_id', sessionIds);

    type StudentBucket = {
      id: number; student_code: string; name: string; grade: string; section: string;
      absent: number; late: number; excused: number;
    };
    const buckets = new Map<number, StudentBucket>();
    for (const a of absences || []) {
      const stu: any = (a as any).students;
      if (!stu) continue;
      const sid = stu.id as number;
      const cur = buckets.get(sid) || {
        id: sid,
        student_code: stu.student_id,
        name: [stu.first_name, stu.father_name, stu.last_name].filter(Boolean).join(' ').trim(),
        grade: stu.sections?.grades?.name || '—',
        section: stu.sections?.name || '—',
        absent: 0, late: 0, excused: 0,
      };
      const status = (a as any).status as string;
      if (status === 'absent') cur.absent++;
      else if (status === 'late') cur.late++;
      else if (status === 'excused') cur.excused++;
      buckets.set(sid, cur);
    }
    const list = Array.from(buckets.values());
    topAbsent = [...list].filter((s) => s.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, limit);
    topLate = [...list].filter((s) => s.late > 0).sort((a, b) => b.late - a.late).slice(0, limit);
    topExcused = [...list].filter((s) => s.excused > 0).sort((a, b) => b.excused - a.excused).slice(0, limit);
  }

  return NextResponse.json({
    data: {
      from, to,
      totals: { ...totals, present, attendance_rate: attendanceRate },
      by_period: byPeriod,
      by_section: bySection,
      top_absent: topAbsent,
      top_late: topLate,
      top_excused: topExcused,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
