import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — list past sessions with filters.
//   ?mine=1            → only sessions recorded by the calling user (teacher's history)
//   ?date=YYYY-MM-DD   → single day
//   ?from=&to=         → date range
//   ?section_id=       → one section
//   limit (default 50, max 200)
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const mine = searchParams.get('mine') === '1';
  const date = searchParams.get('date');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const sectionId = searchParams.get('section_id');
  const periodId = searchParams.get('period_id');
  const periodNumber = searchParams.get('period_number');
  const gradeId = searchParams.get('grade_id');
  const gradeName = searchParams.get('grade');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 500);

  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from('period_sessions')
    .select(`
      id, attendance_date, recorded_at, recorded_by,
      absent_count, late_count, excused_count, total_count, notes,
      section_id, period_id,
      sections!inner ( id, name, grade_id, grades!inner ( id, name ) ),
      periods!inner ( number, name )
    `)
    .order('attendance_date', { ascending: false })
    .order('period_id', { ascending: true })
    .limit(limit);

  if (mine) q = q.eq('recorded_by', ctx.userId);
  if (date) q = q.eq('attendance_date', date);
  if (from) q = q.gte('attendance_date', from);
  if (to) q = q.lte('attendance_date', to);
  if (sectionId) q = q.eq('section_id', parseInt(sectionId, 10));
  if (periodId) q = q.eq('period_id', parseInt(periodId, 10));
  // Filtering by period number / grade name needs joined-column syntax.
  if (periodNumber) q = q.eq('periods.number', parseInt(periodNumber, 10));
  if (gradeId) q = q.eq('sections.grade_id', parseInt(gradeId, 10));
  if (gradeName) q = q.eq('sections.grades.name', gradeName);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: 'فشل جلب السجل' }, { status: 500 });
  }

  // Resolve teacher names in one batch — recorded_by FKs auth.users(id), but
  // the user-facing display name lives in public.user_profiles.full_name.
  const teacherIds = Array.from(new Set((data || []).map((r: any) => r.recorded_by).filter(Boolean)));
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

  const flat = (data || []).map((r: any) => ({
    id: r.id,
    attendance_date: r.attendance_date,
    recorded_at: r.recorded_at,
    recorded_by: r.recorded_by,
    teacher_name: r.recorded_by ? (teacherMap.get(r.recorded_by) ?? null) : null,
    section_id: r.section_id,
    period_id: r.period_id,
    section_name: r.sections?.name ?? null,
    grade_name: r.sections?.grades?.name ?? null,
    period_number: r.periods?.number ?? null,
    period_name: r.periods?.name ?? null,
    absent_count: r.absent_count,
    late_count: r.late_count,
    excused_count: r.excused_count,
    total_count: r.total_count,
    notes: r.notes,
  }));

  return NextResponse.json(
    { data: flat },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
