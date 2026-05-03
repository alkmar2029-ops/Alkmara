import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — given a (section_id, period_number, day_of_week), return who
// SHOULD be teaching that slot per the imported schedule. Used by the
// period-attendance detail modal and the print views.
//
// Day-of-week is 0..4 (Sun..Thu). If the caller passes a date instead,
// they should derive day_of_week themselves — keeping the API param
// explicit avoids timezone surprises.
//
// Returns null when the schedule has no entry for that slot (e.g.,
// imported schedule covers periods 1-7 but you asked about period 8,
// or the Excel didn't have a row for that section/period combo).
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff', 'teacher', 'viewer']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const sectionId = parseInt(searchParams.get('section_id') || '', 10);
  const periodNumber = parseInt(searchParams.get('period_number') || '', 10);
  const dayOfWeek = parseInt(searchParams.get('day_of_week') || '', 10);
  if (!sectionId || !periodNumber || Number.isNaN(dayOfWeek)) {
    return NextResponse.json(
      { error: 'يجب تحديد section_id و period_number و day_of_week' },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('teacher_schedule')
    .select('teacher_user_id, teacher_name, subject, duty_type')
    .eq('section_id', sectionId)
    .eq('period_number', periodNumber)
    .eq('day_of_week', dayOfWeek)
    .eq('duty_type', 'class')
    .maybeSingle();

  return NextResponse.json({
    data: data
      ? {
          teacher_user_id: data.teacher_user_id,
          teacher_name: data.teacher_name,
          subject: data.subject,
        }
      : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
