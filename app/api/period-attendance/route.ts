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

  // One server-side transaction handles count(students) + upsert(session) +
  // delete(absences) + insert(absences) atomically. See the migration
  // 2026_04_29_save_period_attendance_rpc.sql for the function body.
  // Roughly 30% faster than the previous 4-round-trip flow because we pay
  // the Vercel↔Supabase RTT only once.
  const { data: result, error: rpcErr } = await supabase.rpc('save_period_attendance', {
    p_section_id: section_id,
    p_period_id: period_id,
    p_attendance_date: attendance_date,
    p_recorded_by: auth.ctx.userId,
    p_notes: notes || '',
    p_absences: absences.map((a) => ({
      student_id: a.student_id,
      status: a.status,
      notes: a.notes || null,
    })),
  });

  if (rpcErr || !result) {
    return NextResponse.json(
      { error: 'فشل حفظ الجلسة: ' + (rpcErr?.message || 'استجابة فارغة') },
      { status: 500 },
    );
  }

  // Audit log stays a separate write — it's best-effort and doesn't need
  // to be in the same transaction as the attendance data. Run it without
  // awaiting to shave ~50ms off the response.
  writeAuditLog({
    ctx: auth.ctx,
    action: 'period_attendance.save',
    targetType: 'period_session',
    targetId: (result as any).session_id,
    details: {
      section_id, period_id, attendance_date,
      absent: (result as any).absent,
      late: (result as any).late,
      excused: (result as any).excused,
    },
    request,
  }).catch(() => { /* audit failures must not break the save */ });

  return NextResponse.json({ data: result });
}
