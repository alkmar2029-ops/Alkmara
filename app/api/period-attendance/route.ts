import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { savePeriodAttendanceSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// GET — fetch the saved attendance for a (date, period, section) so the
// teacher can see who's already marked. Returns:
//   { session: PeriodSession | null, absences: { student_id, status, notes }[] }
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff', 'teacher', 'viewer']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const sectionId = parseInt(searchParams.get('section_id') || '', 10);
  const periodId = parseInt(searchParams.get('period_id') || '', 10);
  const date = searchParams.get('date');
  if (!sectionId || !periodId || !date) {
    return NextResponse.json({ error: 'يجب تحديد section_id و period_id و date' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: session } = await supabase
    .from('period_sessions')
    .select('*')
    .eq('section_id', sectionId)
    .eq('period_id', periodId)
    .eq('attendance_date', date)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ data: { session: null, absences: [] } });
  }

  const { data: absences } = await supabase
    .from('period_absences')
    .select('student_id, status, notes')
    .eq('session_id', session.id);

  return NextResponse.json({
    data: { session, absences: absences || [] },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — save a session. Idempotent upsert: re-saving the same (date, period,
// section) replaces the previous absences list. Teachers can edit indefinitely.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff', 'teacher']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(savePeriodAttendanceSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const { section_id, period_id, attendance_date, absences, notes } = v.data;
  const supabase = await createServerSupabaseClient();

  // Count totals for the cached fields on the session row.
  const absentCount = absences.filter((a) => a.status === 'absent').length;
  const lateCount = absences.filter((a) => a.status === 'late').length;
  const excusedCount = absences.filter((a) => a.status === 'excused').length;

  // Total students in the section (so report can compute "present" without a join).
  const { count: total } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', section_id)
    .eq('is_active', true);

  // 1. Upsert the session.
  const { data: session, error: sessErr } = await supabase
    .from('period_sessions')
    .upsert({
      section_id,
      period_id,
      attendance_date,
      recorded_by: auth.ctx.userId,
      recorded_at: new Date().toISOString(),
      absent_count: absentCount,
      late_count: lateCount,
      excused_count: excusedCount,
      total_count: total ?? 0,
      notes: notes || null,
    }, { onConflict: 'section_id,period_id,attendance_date' })
    .select()
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: 'فشل حفظ الجلسة: ' + (sessErr?.message || '') }, { status: 500 });
  }

  // 2. Replace absence rows for this session.
  // Cleanest: delete existing rows, then insert fresh — within a single round
  // trip (small N, typically < 50).
  const { error: delErr } = await supabase
    .from('period_absences')
    .delete()
    .eq('session_id', session.id);
  if (delErr) {
    return NextResponse.json({ error: 'فشل تحديث الغياب' }, { status: 500 });
  }

  if (absences.length > 0) {
    const rows = absences.map((a) => ({
      session_id: session.id,
      student_id: a.student_id,
      status: a.status,
      notes: a.notes || null,
    }));
    const { error: insErr } = await supabase.from('period_absences').insert(rows);
    if (insErr) {
      return NextResponse.json({ error: 'فشل حفظ الغياب: ' + insErr.message }, { status: 500 });
    }
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'period_attendance.save',
    targetType: 'period_session',
    targetId: session.id,
    details: { section_id, period_id, attendance_date, absent: absentCount, late: lateCount, excused: excusedCount },
    request,
  });

  return NextResponse.json({
    data: {
      session_id: session.id,
      absent: absentCount, late: lateCount, excused: excusedCount,
      total: total ?? 0,
    },
  });
}
