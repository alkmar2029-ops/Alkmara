import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';
import { canManageSupervision } from '@/lib/supervision/permissions';
import { maybeSendDailyReminder } from '@/lib/supervision/reminder';

export const dynamic = 'force-dynamic';

// POST — manually trigger the morning reminder. Used by the admin
// "Resend now" button on the supervision page when the opportunistic
// trigger didn't fire (e.g. first admin opened the dashboard after
// the 6–10 window).
//
// Body: { force?: boolean }   force=true clears today's dedup row first,
//                              allowing a re-send even if already triggered.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  if (!(await canManageSupervision(auth.ctx, admin))) {
    return NextResponse.json({ error: 'لا تملك صلاحية إدارة جدول الإشراف' }, { status: 403 });
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }

  const result = await maybeSendDailyReminder(admin, {
    force: !!body.force,
    triggeredBy: auth.ctx.userId,
  });
  return NextResponse.json({ data: result });
}
