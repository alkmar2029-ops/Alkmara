import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/supabase/auth';
import { validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// Unified report builder used by /dashboard/reports/builder.
// Supports six report types and four scopes — combinable.
//
// Body:
//   {
//     types: ('attendance_daily'|'attendance_period'|'late'|'excused'|'notes'|'comprehensive')[],
//     from: 'YYYY-MM-DD', to: 'YYYY-MM-DD',
//     scope: 'school' | 'grade' | 'section' | 'student',
//     scope_id?: number   // grade_id | section_id | student_id
//   }
//
// Returns a single JSON the print page renders.

const schema = z.object({
  types: z.array(z.enum([
    'attendance_daily', 'attendance_period', 'late', 'excused', 'notes', 'comprehensive',
    'period_compare',  // NEW: side-by-side comparison of two periods
  ])).min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(['school', 'grade', 'section', 'student']).default('school'),
  scope_id: z.number().int().positive().optional(),
  // Optional: limit attendance_period/late/excused to a single period number.
  // 1-7 for typical schools — matches periods.number (not the row id).
  period_number: z.number().int().min(1).max(20).optional(),
  // For period_compare: two period numbers to put side-by-side in the report.
  compare_period_a: z.number().int().min(1).max(20).optional(),
  compare_period_b: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff', 'viewer']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(schema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const { types, from, to, scope, scope_id, period_number, compare_period_a, compare_period_b } = v.data;
  const supabase = await createServerSupabaseClient();

  // Resolve the student-id set the report applies to.
  let studentIds: number[] | null = null;
  let scopeLabel = 'المدرسة كاملة';

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
      .from('sections')
      .select('id, name, grades ( name )')
      .eq('id', scope_id)
      .maybeSingle();
    if (!sec) return NextResponse.json({ error: 'الشعبة غير موجودة' }, { status: 404 });
    const { data: students } = await supabase
      .from('students').select('id').eq('section_id', scope_id).eq('is_active', true);
    studentIds = (students || []).map((x: any) => x.id);
    scopeLabel = `${(sec as any).grades?.name} / ${(sec as any).name}`;
  } else if (scope === 'grade' && scope_id) {
    const { data: g } = await supabase.from('grades').select('id, name').eq('id', scope_id).maybeSingle();
    if (!g) return NextResponse.json({ error: 'الصف غير موجود' }, { status: 404 });
    const { data: students } = await supabase
      .from('students').select('id').eq('grade_id', scope_id).eq('is_active', true);
    studentIds = (students || []).map((x: any) => x.id);
    scopeLabel = `صف ${(g as any).name}`;
  }
  // 'school' → studentIds stays null (means "all students")

  // School metadata for report header.
  const { data: settingsRow } = await supabase
    .from('school_settings').select('school_name, principal_name').eq('id', 1).maybeSingle();

  // Result containers — each report type populates its slice.
  const result: any = {
    meta: {
      from, to, scope, scope_id: scope_id ?? null,
      scope_label: scopeLabel,
      types,
      school_name: (settingsRow?.school_name as string) || '',
      principal_name: (settingsRow?.principal_name as string) || '',
      generated_at: new Date().toISOString(),
    },
    sections: {},
  };

  const wantAll = types.includes('comprehensive');
  const want = (t: string) => wantAll || (types as string[]).includes(t);

  // ============= 1. Daily attendance (fingerprint records) =============
  if (want('attendance_daily')) {
    let q = supabase
      .from('attendance_records')
      .select(`
        id, student_id, attendance_date, punch_time, status, minutes_late,
        students!inner ( student_id, first_name, father_name, last_name,
          sections ( name, grades ( name ) )
        )
      `)
      .gte('attendance_date', from)
      .lte('attendance_date', to);
    if (studentIds && studentIds.length > 0) q = q.in('student_id', studentIds);

    const { data } = await q;
    const rows = (data || []).map((r: any) => ({
      attendance_date: r.attendance_date,
      punch_time: r.punch_time,
      status: r.status,
      minutes_late: r.minutes_late,
      student_code: r.students?.student_id,
      student_name: [r.students?.first_name, r.students?.father_name, r.students?.last_name].filter(Boolean).join(' ').trim(),
      grade_name: r.students?.sections?.grades?.name,
      section_name: r.students?.sections?.name,
    }));
    result.sections.attendance_daily = {
      rows,
      counts: {
        total: rows.length,
        late: rows.filter((r) => r.status === 'late').length,
        absent: rows.filter((r) => r.status === 'absent').length,
        present: rows.filter((r) => r.status === 'present').length,
      },
    };
  }

  // ============= 2. Period attendance (per-period absences) =============
  if (want('attendance_period') || want('late') || want('excused')) {
    // sessions in range
    const { data: sessions } = await supabase
      .from('period_sessions')
      .select(`id, attendance_date, period_id, section_id, total_count,
        absent_count, late_count, excused_count, recorded_by,
        sections ( id, name, grade_id, grades ( name ) ),
        periods ( number, name )
      `)
      .gte('attendance_date', from)
      .lte('attendance_date', to);

    let filteredSessions = (sessions || []);
    if (scope === 'section' && scope_id) filteredSessions = filteredSessions.filter((s: any) => s.section_id === scope_id);
    if (scope === 'grade' && scope_id) filteredSessions = filteredSessions.filter((s: any) => s.sections?.grade_id === scope_id);
    // Single-period filter: keep only sessions whose period.number matches.
    if (period_number) {
      filteredSessions = filteredSessions.filter((s: any) => s.periods?.number === period_number);
    }
    // 'student' scope falls through — we filter absences below.

    const sessionIds = filteredSessions.map((s: any) => s.id);

    // Resolve teacher names
    const teacherIds = Array.from(new Set(filteredSessions.map((s: any) => s.recorded_by).filter(Boolean)));
    const teacherMap = new Map<string, string>();
    if (teacherIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles').select('user_id, full_name').in('user_id', teacherIds);
      for (const p of profiles || []) {
        if (p.full_name) teacherMap.set(p.user_id, p.full_name);
      }
    }

    // Pull absences
    let absencesQuery = supabase
      .from('period_absences')
      .select(`
        session_id, student_id, status, notes,
        students ( student_id, first_name, father_name, last_name,
          sections ( name, grades ( name ) )
        )
      `);
    if (sessionIds.length > 0) absencesQuery = absencesQuery.in('session_id', sessionIds);
    if (studentIds && studentIds.length > 0) absencesQuery = absencesQuery.in('student_id', studentIds);
    const { data: absences } = sessionIds.length > 0 ? await absencesQuery : { data: [] };

    const sessionsById = new Map<number, any>();
    for (const s of filteredSessions) sessionsById.set((s as any).id, s);

    const absenceRows = (absences || []).map((a: any) => {
      const s = sessionsById.get(a.session_id);
      return {
        attendance_date: s?.attendance_date,
        period_number: s?.periods?.number,
        period_name: s?.periods?.name,
        teacher_name: s?.recorded_by ? teacherMap.get(s.recorded_by) || null : null,
        section_name: s?.sections?.name,
        grade_name: s?.sections?.grades?.name,
        student_code: a.students?.student_id,
        student_name: [a.students?.first_name, a.students?.father_name, a.students?.last_name].filter(Boolean).join(' ').trim(),
        status: a.status,
        notes: a.notes,
      };
    });

    if (want('attendance_period')) {
      result.sections.attendance_period = {
        sessions: filteredSessions.map((s: any) => ({
          id: s.id,
          attendance_date: s.attendance_date,
          period_number: s.periods?.number,
          grade_name: s.sections?.grades?.name,
          section_name: s.sections?.name,
          teacher_name: s.recorded_by ? teacherMap.get(s.recorded_by) || null : null,
          total: s.total_count,
          absent: s.absent_count,
          late: s.late_count,
          excused: s.excused_count,
          present: s.total_count - s.absent_count - s.late_count - s.excused_count,
        })),
        absences: absenceRows.filter((r) => r.status === 'absent'),
        counts: {
          sessions: filteredSessions.length,
          absent: absenceRows.filter((r) => r.status === 'absent').length,
        },
      };
    }
    if (want('late')) {
      result.sections.late = {
        rows: absenceRows.filter((r) => r.status === 'late'),
        count: absenceRows.filter((r) => r.status === 'late').length,
      };
    }
    if (want('excused')) {
      result.sections.excused = {
        rows: absenceRows.filter((r) => r.status === 'excused'),
        count: absenceRows.filter((r) => r.status === 'excused').length,
      };
    }

    // ============= Period comparison (side-by-side) =============
    // Builds a per-section row showing the same metric across two periods.
    // Reuses the already-fetched `sessions` (range-scoped + role-scoped) so
    // we don't pay an extra round trip. Returns sections sorted by absolute
    // delta — biggest swing first, easiest for an admin to act on.
    if (want('period_compare') && compare_period_a && compare_period_b) {
      const aggregateByPeriod = (sessions: any[], periodNumber: number) => {
        // Map<section_id, { absent, late, excused, total, sessions, grade, section }>
        const acc = new Map<number, any>();
        for (const s of sessions) {
          if (s.periods?.number !== periodNumber) continue;
          const row = acc.get(s.section_id) || {
            section_id: s.section_id,
            grade_name: s.sections?.grades?.name || '—',
            section_name: s.sections?.name || '—',
            absent: 0, late: 0, excused: 0, total_students: 0, sessions: 0,
          };
          row.absent += s.absent_count || 0;
          row.late += s.late_count || 0;
          row.excused += s.excused_count || 0;
          row.total_students += s.total_count || 0;
          row.sessions += 1;
          acc.set(s.section_id, row);
        }
        return acc;
      };

      const aMap = aggregateByPeriod(filteredSessions, compare_period_a);
      const bMap = aggregateByPeriod(filteredSessions, compare_period_b);

      // Union of section ids — section may have been recorded for one period
      // only in the range; we still want it on the report so the gap is visible.
      const allSectionIds = new Set<number>([...aMap.keys(), ...bMap.keys()]);
      const empty = (sid: number) => {
        const ref = aMap.get(sid) || bMap.get(sid);
        return {
          section_id: sid,
          grade_name: ref?.grade_name || '—',
          section_name: ref?.section_name || '—',
          absent: 0, late: 0, excused: 0, total_students: 0, sessions: 0,
        };
      };

      const sections = Array.from(allSectionIds).map((sid) => {
        const a = aMap.get(sid) || empty(sid);
        const b = bMap.get(sid) || empty(sid);
        return {
          section_id: sid,
          grade_name: a.grade_name || b.grade_name,
          section_name: a.section_name || b.section_name,
          period_a: { absent: a.absent, late: a.late, excused: a.excused, sessions: a.sessions, total_students: a.total_students },
          period_b: { absent: b.absent, late: b.late, excused: b.excused, sessions: b.sessions, total_students: b.total_students },
          delta_absent: b.absent - a.absent,
          delta_late: b.late - a.late,
        };
      })
      // Sort: biggest absolute delta in absences first; ties by name.
      .sort((x, y) => {
        const d = Math.abs(y.delta_absent) - Math.abs(x.delta_absent);
        if (d !== 0) return d;
        return `${x.grade_name} ${x.section_name}`.localeCompare(`${y.grade_name} ${y.section_name}`, 'ar');
      });

      // Lookup the period names for the header. Supabase's TS inference
      // sometimes types nested joins as arrays; coerce here.
      const periodNames = new Map<number, string>();
      for (const s of (sessions || [])) {
        const p = (s as any).periods;
        const n = Array.isArray(p) ? p[0]?.number : p?.number;
        const nm = Array.isArray(p) ? p[0]?.name : p?.name;
        if (n && !periodNames.has(n)) {
          periodNames.set(n, nm || `الحصة ${n}`);
        }
      }

      // Totals across all sections — the "summary row" of the comparison.
      const totals = {
        period_a: sections.reduce((acc, r) => ({
          absent: acc.absent + r.period_a.absent,
          late: acc.late + r.period_a.late,
          excused: acc.excused + r.period_a.excused,
          sessions: acc.sessions + r.period_a.sessions,
        }), { absent: 0, late: 0, excused: 0, sessions: 0 }),
        period_b: sections.reduce((acc, r) => ({
          absent: acc.absent + r.period_b.absent,
          late: acc.late + r.period_b.late,
          excused: acc.excused + r.period_b.excused,
          sessions: acc.sessions + r.period_b.sessions,
        }), { absent: 0, late: 0, excused: 0, sessions: 0 }),
      };

      result.sections.period_compare = {
        period_a: { number: compare_period_a, name: periodNames.get(compare_period_a) || `الحصة ${compare_period_a}` },
        period_b: { number: compare_period_b, name: periodNames.get(compare_period_b) || `الحصة ${compare_period_b}` },
        sections,
        totals,
      };
    }
  }

  // ============= 3. Student notes =============
  if (want('notes')) {
    let q = supabase
      .from('student_notes')
      .select(`
        id, student_id, text, type, category, recorded_at,
        students ( student_id, first_name, father_name, last_name,
          sections ( name, grades ( name ) )
        )
      `)
      .gte('recorded_at', `${from}T00:00:00.000Z`)
      .lte('recorded_at', `${to}T23:59:59.999Z`);
    if (studentIds && studentIds.length > 0) q = q.in('student_id', studentIds);

    const { data } = await q;
    const rows = (data || []).map((r: any) => ({
      id: r.id,
      recorded_at: r.recorded_at,
      type: r.type,
      category: r.category,
      text: r.text,
      student_code: r.students?.student_id,
      student_name: [r.students?.first_name, r.students?.father_name, r.students?.last_name].filter(Boolean).join(' ').trim(),
      grade_name: r.students?.sections?.grades?.name,
      section_name: r.students?.sections?.name,
    }));
    result.sections.notes = {
      rows,
      counts: {
        total: rows.length,
        positive: rows.filter((r) => r.type === 'positive').length,
        negative: rows.filter((r) => r.type === 'negative').length,
      },
    };
  }

  // ============= Top concerning students (always added when applicable) =============
  // Aggregated absence/late/note counts across the date range and scope.
  if ((studentIds === null || studentIds.length > 0)) {
    type Bucket = { name: string; code: string; grade: string; section: string; absent: number; late: number; excused: number; notes_neg: number };
    const buckets = new Map<number, Bucket>();
    const bump = (sid: number, info: any, key: keyof Omit<Bucket, 'name'|'code'|'grade'|'section'>) => {
      const cur = buckets.get(sid) || { ...info, absent: 0, late: 0, excused: 0, notes_neg: 0 };
      cur[key]++;
      buckets.set(sid, cur);
    };

    if (result.sections.attendance_period?.absences) {
      for (const r of result.sections.attendance_period.absences) {
        const sid = (r as any).student_id;
        if (sid) bump(sid, { name: r.student_name, code: r.student_code, grade: r.grade_name, section: r.section_name }, 'absent');
      }
    }
    if (result.sections.late?.rows) {
      for (const r of result.sections.late.rows) {
        const sid = (r as any).student_id;
        if (sid) bump(sid, { name: r.student_name, code: r.student_code, grade: r.grade_name, section: r.section_name }, 'late');
      }
    }
    if (result.sections.excused?.rows) {
      for (const r of result.sections.excused.rows) {
        const sid = (r as any).student_id;
        if (sid) bump(sid, { name: r.student_name, code: r.student_code, grade: r.grade_name, section: r.section_name }, 'excused');
      }
    }
    if (result.sections.notes?.rows) {
      for (const r of result.sections.notes.rows) {
        if (r.type !== 'negative') continue;
        const sid = (r as any).student_id;
        if (sid) bump(sid, { name: r.student_name, code: r.student_code, grade: r.grade_name, section: r.section_name }, 'notes_neg');
      }
    }
    const ranked = Array.from(buckets.values()).sort(
      (a, b) => (b.absent + b.late + b.notes_neg) - (a.absent + a.late + a.notes_neg),
    ).slice(0, 10);
    result.sections.top_concerns = ranked;
  }

  return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
}
