import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/supabase/auth';
import { validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// Teacher-scoped report builder. Always limits to sessions/notes the
// calling teacher recorded — no cross-teacher data leakage.
//
// Body:
//   {
//     types: ('attendance_period'|'late'|'excused'|'notes'|'comprehensive')[],
//     from: 'YYYY-MM-DD', to: 'YYYY-MM-DD',
//     scope: 'mine' | 'grade' | 'section' | 'student',
//     scope_id?: number
//   }

const schema = z.object({
  types: z.array(z.enum(['attendance_period', 'late', 'excused', 'notes', 'comprehensive'])).min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(['mine', 'grade', 'section', 'student']).default('mine'),
  scope_id: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(schema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const { types, from, to, scope, scope_id } = v.data;
  const supabase = await createServerSupabaseClient();

  // Resolve scope label and student-id constraint (for notes filter).
  let scopeLabel = 'كل حصصي';
  let studentIds: number[] | null = null;

  if (scope === 'student' && scope_id) {
    const { data: s } = await supabase
      .from('students')
      .select(`id, student_id, first_name, father_name, last_name,
        sections ( name, grades ( name ) )
      `)
      .eq('id', scope_id)
      .maybeSingle();
    if (!s) return NextResponse.json({ error: 'الطالب غير موجود' }, { status: 404 });
    studentIds = [s.id];
    scopeLabel = `${[s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ')} • ${(s as any).sections?.grades?.name} / ${(s as any).sections?.name}`;
  } else if (scope === 'section' && scope_id) {
    const { data: sec } = await supabase
      .from('sections').select('id, name, grades ( name )').eq('id', scope_id).maybeSingle();
    if (!sec) return NextResponse.json({ error: 'الشعبة غير موجودة' }, { status: 404 });
    scopeLabel = `${(sec as any).grades?.name} / ${(sec as any).name}`;
  } else if (scope === 'grade' && scope_id) {
    const { data: g } = await supabase.from('grades').select('id, name').eq('id', scope_id).maybeSingle();
    if (!g) return NextResponse.json({ error: 'الصف غير موجود' }, { status: 404 });
    scopeLabel = `صف ${(g as any).name}`;
  }

  const { data: settingsRow } = await supabase
    .from('school_settings').select('school_name, principal_name').eq('id', 1).maybeSingle();
  const { data: profile } = await supabase
    .from('user_profiles').select('full_name').eq('user_id', ctx.userId).maybeSingle();

  const teacherName = (profile?.full_name as string) || ctx.email || 'المعلم';

  const wantAll = types.includes('comprehensive');
  const want = (t: string) => wantAll || (types as string[]).includes(t);

  const result: any = {
    meta: {
      from, to, scope, scope_id: scope_id ?? null,
      scope_label: scopeLabel,
      types,
      teacher_name: teacherName,
      school_name: (settingsRow?.school_name as string) || '',
      principal_name: (settingsRow?.principal_name as string) || '',
      generated_at: new Date().toISOString(),
    },
    sections: {},
  };

  // ============= 1. Period sessions (teacher's own) =============
  // Always pulled because every other section needs it.
  let sessionsQuery = supabase
    .from('period_sessions')
    .select(`
      id, attendance_date, period_id, section_id,
      absent_count, late_count, excused_count, total_count,
      sections ( id, name, grade_id, grades ( id, name ) ),
      periods ( number, name )
    `)
    .eq('recorded_by', ctx.userId)
    .gte('attendance_date', from)
    .lte('attendance_date', to);

  const { data: rawSessions } = await sessionsQuery;
  let teacherSessions = (rawSessions || []) as any[];
  if (scope === 'section' && scope_id) teacherSessions = teacherSessions.filter((s) => s.section_id === scope_id);
  if (scope === 'grade' && scope_id) teacherSessions = teacherSessions.filter((s) => s.sections?.grade_id === scope_id);

  const sessionIds = teacherSessions.map((s) => s.id);

  // Pull absences once for everything that needs them.
  let absences: any[] = [];
  if (sessionIds.length > 0) {
    let absencesQuery = supabase
      .from('period_absences')
      .select(`
        session_id, student_id, status, notes,
        students ( id, student_id, first_name, father_name, last_name,
          sections ( name, grades ( name ) )
        )
      `)
      .in('session_id', sessionIds);
    if (studentIds) absencesQuery = absencesQuery.in('student_id', studentIds);
    const { data } = await absencesQuery;
    const sessionsById = new Map<number, any>();
    for (const s of teacherSessions) sessionsById.set(s.id, s);
    absences = (data || []).map((a: any) => {
      const s = sessionsById.get(a.session_id);
      return {
        attendance_date: s?.attendance_date,
        period_number: s?.periods?.number,
        period_name: s?.periods?.name,
        section_name: s?.sections?.name,
        grade_name: s?.sections?.grades?.name,
        student_id: a.students?.id,
        student_code: a.students?.student_id,
        student_name: [a.students?.first_name, a.students?.father_name, a.students?.last_name].filter(Boolean).join(' ').trim(),
        status: a.status,
        notes: a.notes,
      };
    });
  }

  // attendance_period
  if (want('attendance_period')) {
    result.sections.attendance_period = {
      sessions: teacherSessions.map((s) => ({
        id: s.id,
        attendance_date: s.attendance_date,
        period_number: s.periods?.number,
        grade_name: s.sections?.grades?.name,
        section_name: s.sections?.name,
        total: s.total_count,
        absent: s.absent_count,
        late: s.late_count,
        excused: s.excused_count,
        present: s.total_count - s.absent_count - s.late_count - s.excused_count,
      })),
      absences: absences.filter((a) => a.status === 'absent'),
      counts: {
        sessions: teacherSessions.length,
        absent: absences.filter((a) => a.status === 'absent').length,
      },
    };
  }
  if (want('late')) {
    result.sections.late = {
      rows: absences.filter((a) => a.status === 'late'),
      count: absences.filter((a) => a.status === 'late').length,
    };
  }
  if (want('excused')) {
    result.sections.excused = {
      rows: absences.filter((a) => a.status === 'excused'),
      count: absences.filter((a) => a.status === 'excused').length,
    };
  }

  // ============= 2. Notes (teacher's own) =============
  if (want('notes')) {
    let q = supabase
      .from('student_notes')
      .select(`
        id, student_id, text, type, category, recorded_at,
        students ( student_id, first_name, father_name, last_name,
          sections ( name, grades ( name ) )
        )
      `)
      .eq('recorded_by', ctx.userId)
      .gte('recorded_at', `${from}T00:00:00.000Z`)
      .lte('recorded_at', `${to}T23:59:59.999Z`);
    if (studentIds) q = q.in('student_id', studentIds);
    const { data } = await q;
    let rows = (data || []).map((r: any) => ({
      id: r.id,
      recorded_at: r.recorded_at,
      type: r.type,
      category: r.category,
      text: r.text,
      student_id: r.students?.id,
      student_code: r.students?.student_id,
      student_name: [r.students?.first_name, r.students?.father_name, r.students?.last_name].filter(Boolean).join(' ').trim(),
      grade_name: r.students?.sections?.grades?.name,
      section_name: r.students?.sections?.name,
    }));
    // Apply grade/section filter post-hoc for notes (no recorded_by sections data).
    if (scope === 'grade' && scope_id) {
      const { data: grade } = await supabase.from('grades').select('name').eq('id', scope_id).maybeSingle();
      const gName = (grade as any)?.name;
      rows = rows.filter((r) => r.grade_name === gName);
    } else if (scope === 'section' && scope_id) {
      const { data: sec } = await supabase.from('sections').select('name, grades ( name )').eq('id', scope_id).maybeSingle();
      const sName = (sec as any)?.name;
      const gName = (sec as any)?.grades?.name;
      rows = rows.filter((r) => r.section_name === sName && r.grade_name === gName);
    }
    result.sections.notes = {
      rows,
      counts: {
        total: rows.length,
        positive: rows.filter((r) => r.type === 'positive').length,
        negative: rows.filter((r) => r.type === 'negative').length,
      },
    };
  }

  // ============= Top concerning students =============
  type Bucket = { name: string; code: string; grade: string; section: string; absent: number; late: number; excused: number; notes_neg: number };
  const buckets = new Map<number, Bucket>();
  const bump = (sid: number, info: any, key: keyof Omit<Bucket, 'name'|'code'|'grade'|'section'>) => {
    const cur = buckets.get(sid) || { ...info, absent: 0, late: 0, excused: 0, notes_neg: 0 };
    cur[key]++;
    buckets.set(sid, cur);
  };
  for (const a of absences) {
    if (!a.student_id) continue;
    const info = { name: a.student_name, code: a.student_code, grade: a.grade_name, section: a.section_name };
    if (a.status === 'absent') bump(a.student_id, info, 'absent');
    else if (a.status === 'late') bump(a.student_id, info, 'late');
    else if (a.status === 'excused') bump(a.student_id, info, 'excused');
  }
  if (result.sections.notes?.rows) {
    for (const r of result.sections.notes.rows) {
      if (r.type !== 'negative' || !r.student_id) continue;
      bump(r.student_id, { name: r.student_name, code: r.student_code, grade: r.grade_name, section: r.section_name }, 'notes_neg');
    }
  }
  const ranked = Array.from(buckets.values())
    .sort((a, b) => (b.absent + b.late + b.notes_neg) - (a.absent + a.late + a.notes_neg))
    .slice(0, 10);
  result.sections.top_concerns = ranked;

  return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
}
