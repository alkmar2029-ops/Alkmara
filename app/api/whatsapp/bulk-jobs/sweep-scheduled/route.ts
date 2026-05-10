import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET — promotes any 'scheduled' bulk_send_jobs whose scheduled_for time
// has arrived. Wired up via Vercel Cron in vercel.json (every minute).
//
// Auth: either via Vercel Cron's automatic header `x-vercel-cron`, OR
// via the same shared secret used by the worker (so this can also be
// triggered manually from the dashboard if cron is unavailable).
//
// For each due job:
//   1. status: 'scheduled' → 'pending'
//   2. fire-and-forget POST to /api/whatsapp/bulk-jobs/[id]/process
export async function GET(request: NextRequest) {
  const isVercelCron = !!request.headers.get('x-vercel-cron');
  const expectedSecret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32);
  const providedSecret = request.headers.get('x-worker-secret') || '';
  const authed = isVercelCron || (expectedSecret && providedSecret === expectedSecret);
  if (!authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const nowIso = new Date().toISOString();

  // Find all jobs whose scheduled time has passed and are still 'scheduled'.
  const { data: due, error } = await admin
    .from('bulk_send_jobs')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', nowIso);

  if (error) {
    console.error('sweep-scheduled select failed:', error.message);
    return NextResponse.json({ error: 'failed to load due jobs' }, { status: 500 });
  }

  if (!due || due.length === 0) {
    return NextResponse.json({ promoted: 0 });
  }

  const ids = due.map((j: any) => j.id);
  // Promote in one statement so a parallel sweep doesn't pick the same
  // jobs (status is now 'pending', they won't match the next sweep).
  await admin
    .from('bulk_send_jobs')
    .update({ status: 'pending' })
    .in('id', ids)
    .eq('status', 'scheduled');  // guard against races

  // Fire workers in parallel; each will self-trigger as needed.
  const workerSecret = expectedSecret;
  const origin = request.nextUrl.origin;
  await Promise.allSettled(
    ids.map((id: number) =>
      fetch(`${origin}/api/whatsapp/bulk-jobs/${id}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-secret': workerSecret,
        },
      }),
    ),
  );

  return NextResponse.json({ promoted: ids.length, ids });
}
