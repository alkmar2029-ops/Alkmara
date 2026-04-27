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
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);

  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from('period_sessions')
    .select(`
      id, attendance_date, recorded_at, recorded_by,
      absent_count, late_count, excused_count, total_count, notes,
      section_id, period_id,
      sections ( id, name, grades ( name ) ),
      periods ( number, name )
    `)
    .order('recorded_at', { ascending: false })
    .limit(limit);

  if (mine) q = q.eq('recorded_by', ctx.userId);
  if (date) q = q.eq('attendance_date', date);
  if (from) q = q.gte('attendance_date', from);
  if (to) q = q.lte('attendance_date', to);
  if (sectionId) q = q.eq('section_id', parseInt(sectionId, 10));

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: 'فشل جلب السجل' }, { status: 500 });
  }

  const flat = (data || []).map((r: any) => ({
    id: r.id,
    attendance_date: r.attendance_date,
    recorded_at: r.recorded_at,
    recorded_by: r.recorded_by,
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
