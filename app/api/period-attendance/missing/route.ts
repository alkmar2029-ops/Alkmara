import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — full sections × periods grid for a given date, marking which cells
// are recorded vs. missing. Used by the admin "session monitor" view to
// spot teachers who haven't taken attendance yet.
//
//   ?date=YYYY-MM-DD   (default: today)
//
// Returns:
//   {
//     date,
//     sections: [{ id, grade_id, grade_name, section_name, sort_order }],
//     periods:  [{ id, number, name, start_time, end_time }],
//     // sparse map keyed by `${section_id}:${period_id}` — present means
//     // the session was recorded; absent means it's missing.
//     recorded: { '12:3': { session_id, absent_count, late_count, ... } },
//     stats: {
//       total_expected,    // sections × periods (only for active periods)
//       total_recorded,
//       total_missing,
//       coverage_percent,
//     }
//   }
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const date = request.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'صيغة التاريخ غير صالحة' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Sections, periods, and recorded sessions in parallel — three independent
  // reads, no point sequencing them.
  const [sectionsRes, periodsRes, recordedRes] = await Promise.all([
    supabase
      .from('sections')
      .select('id, grade_id, name, sort_order, grades ( id, name, sort_order )')
      .order('grade_id')
      .order('sort_order'),
    supabase
      .from('periods')
      .select('id, number, name, start_time, end_time')
      .order('sort_order')
      .order('number'),
    supabase
      .from('period_sessions')
      .select('id, section_id, period_id, absent_count, late_count, excused_count, total_count, recorded_at, recorded_by')
      .eq('attendance_date', date),
  ]);

  if (sectionsRes.error || periodsRes.error || recordedRes.error) {
    return NextResponse.json({ error: 'فشل جلب البيانات' }, { status: 500 });
  }

  const sections = (sectionsRes.data || []).map((s: any) => ({
    id: s.id,
    grade_id: s.grade_id,
    grade_name: s.grades?.name || '—',
    grade_sort: s.grades?.sort_order ?? 0,
    section_name: s.name,
    sort_order: s.sort_order,
  })).sort((a, b) =>
    a.grade_sort - b.grade_sort ||
    a.grade_name.localeCompare(b.grade_name, 'ar') ||
    a.sort_order - b.sort_order ||
    a.section_name.localeCompare(b.section_name, 'ar'),
  );

  const periods = periodsRes.data || [];

  // Resolve teacher names in one batch so the cell can show "by أ. محمد"
  // without N+1 fetches client-side.
  const teacherIds = Array.from(new Set(
    (recordedRes.data || []).map((r: any) => r.recorded_by).filter(Boolean) as string[],
  ));
  const teacherNameMap = new Map<string, string>();
  if (teacherIds.length > 0) {
    const adminClient = (await import('@/lib/supabase/server')).createAdminSupabaseClient();
    const { data: profiles } = await adminClient
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', teacherIds);
    for (const p of profiles || []) {
      if (p.full_name) teacherNameMap.set(p.user_id as string, p.full_name as string);
    }
  }

  // Build a sparse map of recorded cells keyed by "<section>:<period>".
  type RecordedCell = {
    session_id: number;
    absent_count: number;
    late_count: number;
    excused_count: number;
    total_count: number;
    recorded_at: string;
    recorded_by: string | null;
    teacher_name: string | null;
  };
  const recorded: Record<string, RecordedCell> = {};
  for (const r of recordedRes.data || []) {
    recorded[`${r.section_id}:${r.period_id}`] = {
      session_id: r.id as number,
      absent_count: r.absent_count as number,
      late_count: r.late_count as number,
      excused_count: r.excused_count as number,
      total_count: r.total_count as number,
      recorded_at: r.recorded_at as string,
      recorded_by: (r.recorded_by as string) || null,
      teacher_name: r.recorded_by ? (teacherNameMap.get(r.recorded_by as string) || null) : null,
    };
  }

  const totalExpected = sections.length * periods.length;
  const totalRecorded = (recordedRes.data || []).length;
  const totalMissing = Math.max(0, totalExpected - totalRecorded);
  const coverage = totalExpected > 0 ? Math.round((totalRecorded / totalExpected) * 100) : 0;

  return NextResponse.json({
    data: {
      date,
      sections,
      periods,
      recorded,
      stats: {
        total_expected: totalExpected,
        total_recorded: totalRecorded,
        total_missing: totalMissing,
        coverage_percent: coverage,
      },
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
