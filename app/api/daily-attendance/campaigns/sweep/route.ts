import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getWorkerSecret, isWorkerRequest } from '@/lib/security/worker-secret';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const STALE_PROCESSING_MS = 2 * 60 * 1000;

// POST - pg_cron safety net for daily attendance campaigns. It starts
// pending campaigns whose fire-and-forget trigger was lost, and resumes
// processing campaigns only after their last activity is stale.
export async function POST(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();

  const { data: campaigns, error } = await admin
    .from('daily_send_campaigns')
    .select('id, status, started_at, last_sent_at')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const idsToTrigger: number[] = [];
  for (const campaign of campaigns || []) {
    const id = Number(campaign.id);
    if (campaign.status === 'pending') {
      idsToTrigger.push(id);
      continue;
    }

    const activity = (campaign.last_sent_at || campaign.started_at || '') as string;
    if (activity && activity > staleBefore) continue;

    const { count } = await admin
      .from('daily_send_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'queued');
    if ((count ?? 0) > 0) idsToTrigger.push(id);
  }

  const workerSecret = getWorkerSecret();
  const origin = request.nextUrl.origin;
  await Promise.allSettled(
    idsToTrigger.map((id) =>
      fetch(`${origin}/api/daily-attendance/campaigns/${id}/process`, {
        method: 'POST',
        headers: { 'x-worker-secret': workerSecret },
      }),
    ),
  );

  return NextResponse.json({ triggered: idsToTrigger.length, ids: idsToTrigger });
}
