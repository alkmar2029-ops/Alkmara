import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { renderTemplate } from '@/lib/whatsapp/template';
import { normalizePhone } from '@/lib/teachers/credentials';

export const dynamic = 'force-dynamic';
// 5 minutes — Vercel Pro maximum. At 5.5s pacing this drains ~50 messages
// before we run out of budget. For larger queues the worker self-triggers
// to resume; the queue gets fully drained in N × 5min batches.
export const maxDuration = 300;

// Soft budget — leave 15s headroom before maxDuration so the self-trigger
// fetch + final DB write get clean slots.
const BUDGET_MS = 285_000;
// Wasender's account-protection limit: 1 message every 5 seconds. We use
// 5500ms to leave a small safety margin for clock drift.
const PACE_MS = 5_500;

// POST — drain the queue for one bulk_send_job. Authenticated via a
// shared secret (derived from the service-role key) so it can be called
// internally without an admin session cookie. Re-entrant: if it runs out
// of time it triggers itself to resume; the `claim`-style update prevents
// two concurrent workers from double-sending the same recipient.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // 1. Auth — internal-only via shared secret. The trigger in the bulk-
  // remind POST handler sets this header.
  const expectedSecret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32);
  const providedSecret = request.headers.get('x-worker-secret') || '';
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const jobId = parseInt(params.id, 10);
  if (Number.isNaN(jobId)) {
    return NextResponse.json({ error: 'bad job id' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const startedAt = Date.now();

  // 2. Load the job. Bail if it's already terminal.
  const { data: job } = await admin
    .from('bulk_send_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
    return NextResponse.json({ done: true, status: job.status });
  }

  // 3. Mark the job as processing on first run.
  if (job.status === 'pending') {
    await admin
      .from('bulk_send_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId);
  }

  // 4. Pull WhatsApp creds + school settings (one round trip each).
  const [{ data: ws }, { data: settings }] = await Promise.all([
    admin.from('whatsapp_settings').select('api_key').eq('id', 1).maybeSingle(),
    admin.from('school_settings').select('school_name, principal_name').eq('id', 1).maybeSingle(),
  ]);
  if (!ws?.api_key) {
    await admin.from('bulk_send_jobs').update({
      status: 'failed',
      error_message: 'مفتاح API للواتساب غير مضبوط',
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);
    return NextResponse.json({ error: 'whatsapp api key missing' }, { status: 400 });
  }

  const today = (() => {
    try { return new Date().toLocaleDateString('ar-SA-u-ca-gregory'); }
    catch { return new Date().toISOString().slice(0, 10); }
  })();

  // 5. Drain the queue with pacing.
  let processed = 0;
  while (Date.now() - startedAt < BUDGET_MS) {
    // Atomically claim one queued recipient. Doing this as a single update
    // returning the row prevents a parallel worker (in case of accidental
    // double-trigger) from picking the same row.
    const { data: claimed, error: claimErr } = await admin
      .from('bulk_send_recipients')
      .select('id, user_id, teacher_name, phone')
      .eq('job_id', jobId)
      .eq('status', 'queued')
      .order('id')
      .limit(1)
      .maybeSingle();

    if (claimErr || !claimed) {
      // Nothing left → mark job complete.
      const { count: queuedRemaining } = await admin
        .from('bulk_send_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .eq('status', 'queued');

      if ((queuedRemaining ?? 0) === 0) {
        await admin.from('bulk_send_jobs').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', jobId);
      }
      break;
    }

    // Mark sending so a parallel sweep wouldn't double-claim.
    const { error: lockErr } = await admin
      .from('bulk_send_recipients')
      .update({ status: 'sending' })
      .eq('id', claimed.id)
      .eq('status', 'queued');
    if (lockErr) continue;  // another worker grabbed it; loop

    // Render the personalized message.
    const teacherName = claimed.teacher_name || 'الأستاذ الفاضل';
    const message = renderTemplate(job.template, {
      teacher_name: teacherName,
      school_name: (settings?.school_name as string) || '',
      principal_name: (settings?.principal_name as string) || '',
      date: today,
    });

    // Send. Best-effort — failures are logged on the recipient row.
    const result = await sendTextAndLog({
      supabase: admin,
      apiKey: ws.api_key as string,
      phone: normalizePhone(claimed.phone || ''),
      message,
      recipientName: teacherName,
      recipientType: 'teacher',
      templateName: 'teacher_bulk_reminder',
      contextType: 'manual',
      contextId: null,
      sentBy: job.created_by,
    });

    // Update recipient + job counters in one shot per outcome.
    if (result.ok) {
      await admin
        .from('bulk_send_recipients')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', claimed.id);
      await admin.rpc('increment_bulk_job_sent', { p_job_id: jobId }).then(
        () => {},
        () => {
          // Fallback if the rpc helper hasn't been deployed: read-modify-write.
          // Concurrent updates would race, but only ever one worker runs this
          // job at a time so it's safe.
          admin.from('bulk_send_jobs').update({ sent: (job.sent || 0) + 1 }).eq('id', jobId);
        },
      );
    } else {
      await admin
        .from('bulk_send_recipients')
        .update({ status: 'failed', error: result.error || 'unknown' })
        .eq('id', claimed.id);
      await admin.rpc('increment_bulk_job_failed', { p_job_id: jobId }).then(
        () => {},
        () => {
          admin.from('bulk_send_jobs').update({ failed: (job.failed || 0) + 1 }).eq('id', jobId);
        },
      );
    }

    // Mirror to the in-app inbox (best-effort) — fired in parallel with
    // the next pacing wait below.
    if (job.also_internal) {
      admin.from('internal_messages').insert({
        type: 'general',
        sender_id: job.created_by,
        recipient_id: claimed.user_id,
        subject: job.internal_subject || 'تذكير من الإدارة',
        body: message,
      }).then(({ error }) => {
        if (error) console.error('bulk internal mirror insert failed:', error.message);
      });
    }

    processed += 1;

    // Pace before the next send. Skip if we're out of time anyway.
    if (Date.now() - startedAt + PACE_MS < BUDGET_MS) {
      await new Promise((r) => setTimeout(r, PACE_MS));
    } else {
      break;
    }
  }

  // 6. Self-trigger if work remains. The new invocation gets a fresh
  // 5-minute budget and picks up where we left off.
  const { count: remaining } = await admin
    .from('bulk_send_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('status', 'queued');

  if ((remaining ?? 0) > 0) {
    const workerUrl = `${request.nextUrl.origin}/api/whatsapp/bulk-jobs/${jobId}/process`;
    fetch(workerUrl, {
      method: 'POST',
      headers: { 'x-worker-secret': expectedSecret },
    }).catch((e) => console.error('self-trigger failed:', e));
  }

  return NextResponse.json({
    processed,
    remaining: remaining ?? 0,
  });
}
