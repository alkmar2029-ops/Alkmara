import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — the signed-in teacher's own weekly schedule. Returns one entry
// per slot they teach OR monitor; empty/free slots aren't returned and
// are inferred client-side as gaps in the grid.
//
// Open to any authenticated user — admin/staff/viewer roles will get
// an empty list (their teacher_user_id doesn't appear in the schedule).
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('teacher_schedule')
    .select(`
      id, day_of_week, period_number, duty_type, monitoring_target, subject,
      sections ( id, name, grades ( id, name ) )
    `)
    .eq('teacher_user_id', ctx.userId)
    .order('day_of_week')
    .order('period_number');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Lookup the teacher's own display name + a few stats the UI shows
  // alongside the grid.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', ctx.userId)
    .maybeSingle();

  const slots = (data || []).map((r: any) => ({
    id: r.id,
    day_of_week: r.day_of_week,
    period_number: r.period_number,
    duty_type: r.duty_type,
    section_id: r.sections?.id ?? null,
    section_name: r.sections?.name ?? null,
    grade_name: r.sections?.grades?.name ?? null,
    subject: r.subject,
    monitoring_target: r.monitoring_target,
  }));

  // Stats
  const totalClass = slots.filter((s) => s.duty_type === 'class').length;
  const totalMonitoring = slots.filter((s) => s.duty_type === 'monitoring').length;
  const sectionFreq = new Map<string, number>();
  for (const s of slots) {
    if (s.duty_type === 'class' && s.section_name && s.grade_name) {
      const key = `${s.grade_name} / ${s.section_name}`;
      sectionFreq.set(key, (sectionFreq.get(key) || 0) + 1);
    }
  }
  const topSection = Array.from(sectionFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)[0];

  return NextResponse.json({
    data: {
      teacher_name: (profile?.full_name as string) || null,
      slots,
      stats: {
        total_class: totalClass,
        total_monitoring: totalMonitoring,
        top_section: topSection ? { name: topSection[0], count: topSection[1] } : null,
      },
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
