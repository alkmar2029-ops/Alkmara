import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// POST — cancel a campaign. Stops further sends; recipients already
// processed stay marked sent/failed.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('daily_send_campaigns')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ['pending', 'processing', 'paused'])
    .select('id, status')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'الحملة لا يمكن إلغاؤها (حالتها لا تسمح)' }, { status: 400 });

  // Mark all queued recipients as skipped so the dashboard doesn't
  // show them as "still pending" in the campaign history.
  await admin
    .from('daily_send_recipients')
    .update({ status: 'skipped' })
    .eq('campaign_id', id)
    .eq('status', 'queued');

  return NextResponse.json({ data });
}
