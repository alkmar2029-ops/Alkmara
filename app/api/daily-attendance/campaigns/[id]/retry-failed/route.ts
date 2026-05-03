import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// POST — re-queue every failed recipient and restart the campaign.
// Useful after fixing the underlying cause (e.g., a wasender hiccup,
// or a phone number was updated).
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  const admin = createAdminSupabaseClient();

  // Reset failed recipients back to queued and clear their error.
  const { count } = await admin
    .from('daily_send_recipients')
    .update({ status: 'queued', error: null, sent_at: null }, { count: 'exact' })
    .eq('campaign_id', id)
    .eq('status', 'failed');

  if (!count || count === 0) {
    return NextResponse.json({ error: 'لا توجد رسائل فاشلة' }, { status: 400 });
  }

  // Recompute counters and put the campaign back into processing.
  const { data: campaign } = await admin
    .from('daily_send_campaigns')
    .select('failed, sent')
    .eq('id', id)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'الحملة غير موجودة' }, { status: 404 });

  await admin
    .from('daily_send_campaigns')
    .update({
      status: 'processing',
      failed: 0,
      completed_at: null,
      cancelled_at: null,
      error_message: null,
    })
    .eq('id', id);

  // Trigger the worker.
  const origin = request.nextUrl.origin;
  const secret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32);
  fetch(`${origin}/api/daily-attendance/campaigns/${id}/process`, {
    method: 'POST',
    headers: { 'x-worker-secret': secret },
  }).catch(() => {});

  return NextResponse.json({ data: { requeued: count } });
}
