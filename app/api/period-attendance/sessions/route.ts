import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// DELETE — bulk clear all sessions for a given date (admin only).
//
// Useful for wiping load-test data or clearing a date entirely if attendance
// was recorded against the wrong day. Tightly scoped: admin-only, requires
// an explicit `date` query param so a missing param can't accidentally
// delete everything. ON DELETE CASCADE on period_absences.session_id wipes
// the absence rows too.
//
// Query params:
//   ?date=YYYY-MM-DD    (required)
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const date = request.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'يجب تحديد التاريخ بصيغة YYYY-MM-DD' },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  // Count first so we can report what was actually removed (and audit it).
  const { count: before } = await supabase
    .from('period_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('attendance_date', date);

  const { error } = await supabase
    .from('period_sessions')
    .delete()
    .eq('attendance_date', date);

  if (error) {
    console.error('bulk-delete period_sessions failed:', error.message);
    return NextResponse.json({ error: 'تعذّر الحذف الجماعي' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'period_session.bulk_delete',
    targetType: 'period_session',
    targetId: null,
    details: { date, deleted_count: before ?? 0 },
    request,
  });

  return NextResponse.json({
    message: `تم حذف ${before ?? 0} جلسة من تاريخ ${date}`,
    deleted: before ?? 0,
  });
}
