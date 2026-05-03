import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requireRole, getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — find the most recent in-flight campaign for the signed-in
// admin. Used by the dashboard page to auto-attach the progress panel
// after a tab close/reopen so the user doesn't lose visibility.
//
// "In-flight" here = pending | processing | paused. Completed/failed/
// cancelled campaigns aren't returned — the user can browse history
// from a separate endpoint if needed.
export async function GET() {
  const auth = await requireRole(['admin', 'staff', 'viewer']);
  if (!auth.ok) return auth.res;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ data: null });

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('daily_send_campaigns')
    .select('id, status, total, sent, failed, current_phase, attendance_date, started_at, last_recipient_name')
    .in('status', ['pending', 'processing', 'paused'])
    // Filter to campaigns the current user created — avoids cross-admin
    // confusion when multiple admins use the dashboard.
    .eq('created_by', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ data: data || null });
}
