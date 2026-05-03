import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — for each teacher in the smart schedule, compute how often
// students were marked absent during their classes within a date range.
// This surfaces patterns like "students keep skipping أ. سعد's PE class"
// that would otherwise stay buried in the raw period_absences table.
//
// Query params:
//   ?from=YYYY-MM-DD   default = 30 days ago
//   ?to=YYYY-MM-DD     default = today
//
// Returns one row per teacher present in teacher_schedule, sorted by
// skip rate descending. The `top_students` field on each teacher
// surfaces the 3 students who skipped that teacher's classes most.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  const fromDate = searchParams.get('from') || thirtyDaysAgo;
  const toDate = searchParams.get('to') || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return NextResponse.json({ error: 'صيغة التاريخ غير صالحة' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // 1. Pull every period_session in the date range, joined with the period
  // number (so we can derive day_of_week + period_number for the schedule
  // join) and section info (for grouping).
  const { data: sessions } = await supabase
    .from('period_sessions')
    .select(`
      id, section_id, period_id, attendance_date, total_count,
      periods!inner ( id, number ),
      period_absences!period_absences_session_id_fkey ( student_id, status,
        students ( id, first_name, father_name, last_name )
      )
    `)
    .gte('attendance_date', fromDate)
    .lte('attendance_date', toDate);

  // 2. Pull the schedule keyed by (section, day, period) → teacher.
  const { data: scheduleRows } = await supabase
    .from('teacher_schedule')
    .select('teacher_user_id, teacher_name, subject, day_of_week, period_number, section_id')
    .eq('duty_type', 'class');

  const scheduleKey = (sec: number, dow: number, p: number) => `${sec}:${dow}:${p}`;
  const scheduleMap = new Map<string, { teacher_user_id: string | null; teacher_name: string; subject: string | null }>();
  for (const r of scheduleRows || []) {
    if (r.section_id != null && r.day_of_week != null && r.period_number != null) {
      scheduleMap.set(scheduleKey(r.section_id, r.day_of_week, r.period_number), {
        teacher_user_id: (r.teacher_user_id as string) || null,
        teacher_name: r.teacher_name as string,
        subject: (r.subject as string) || null,
      });
    }
  }

  // 3. Roll up stats per teacher.
  type TeacherStat = {
    teacher_name: string;
    teacher_user_id: string | null;
    subject: string | null;
    total_periods_taught: number;       // count of sessions where teacher was scheduled
    total_student_periods: number;      // sum of total_count across those sessions
    total_absences: number;             // 'absent' rows in those sessions
    skip_rate_percent: number;          // total_absences / total_student_periods * 100
    top_students: Array<{ student_id: number; name: string; count: number }>;
  };
  const stats = new Map<string, TeacherStat>();
  // Per teacher → student → skip count.
  const teacherStudentCount = new Map<string, Map<number, { name: string; count: number }>>();

  for (const session of sessions || []) {
    const periodNumber = (session as any).periods?.number;
    if (periodNumber == null) continue;
    const dow = new Date(String(session.attendance_date)).getDay();
    if (dow < 0 || dow > 4) continue;
    const sched = scheduleMap.get(scheduleKey(session.section_id as number, dow, periodNumber));
    if (!sched) continue;  // session has no schedule entry — nothing to attribute

    const key = sched.teacher_user_id || `name:${sched.teacher_name}`;
    let stat = stats.get(key);
    if (!stat) {
      stat = {
        teacher_name: sched.teacher_name,
        teacher_user_id: sched.teacher_user_id,
        subject: sched.subject,
        total_periods_taught: 0,
        total_student_periods: 0,
        total_absences: 0,
        skip_rate_percent: 0,
        top_students: [],
      };
      stats.set(key, stat);
    }
    stat.total_periods_taught++;
    stat.total_student_periods += (session.total_count as number) || 0;

    const absences = (session as any).period_absences || [];
    const stuMap = teacherStudentCount.get(key) || new Map();
    for (const a of absences) {
      if (a.status !== 'absent') continue;
      stat.total_absences++;
      const stu = a.students;
      if (!stu) continue;
      const sid = a.student_id as number;
      const name = [stu.first_name, stu.father_name, stu.last_name].filter(Boolean).join(' ').trim();
      const ex = stuMap.get(sid);
      if (ex) ex.count++;
      else stuMap.set(sid, { name, count: 1 });
    }
    teacherStudentCount.set(key, stuMap);
  }

  // 4. Compute rate + top students.
  for (const [key, s] of stats) {
    s.skip_rate_percent = s.total_student_periods > 0
      ? Math.round((s.total_absences / s.total_student_periods) * 1000) / 10
      : 0;
    const stuMap = teacherStudentCount.get(key);
    if (stuMap) {
      s.top_students = Array.from(stuMap.entries())
        .map(([sid, v]) => ({ student_id: sid, name: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
    }
  }

  const teachers = Array.from(stats.values())
    .sort((a, b) => b.skip_rate_percent - a.skip_rate_percent);

  // School-wide average for context.
  const totalAbs = teachers.reduce((acc, t) => acc + t.total_absences, 0);
  const totalSP = teachers.reduce((acc, t) => acc + t.total_student_periods, 0);
  const schoolAvg = totalSP > 0 ? Math.round((totalAbs / totalSP) * 1000) / 10 : 0;

  return NextResponse.json({
    data: {
      from: fromDate,
      to: toDate,
      school_average_percent: schoolAvg,
      teachers,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
