import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { isTeacherWhatsappEnabled, TEACHER_WHATSAPP_DISABLED_ERROR } from '@/lib/whatsapp/policy';
import { renderTemplate } from '@/lib/whatsapp/template';
import { normalizePhone } from '@/lib/teachers/credentials';
import { teacherPortalUrl } from '@/lib/utils/portal-url';

export const dynamic = 'force-dynamic';
// 5 minutes — Vercel Pro maximum. At 6s pacing this drains ~50 messages
// before we run out of budget. For larger queues the worker self-triggers
// to resume; the queue gets fully drained in N × 5min batches.
export const maxDuration = 300;

// Soft budget — leave 15s headroom before maxDuration so the self-trigger
// fetch + final DB write get clean slots.
const BUDGET_MS = 285_000;
// Default pacing for jobs that didn't set their own. Wasender's account-
// protection limit is 1 message every 5 seconds; 5500 leaves a margin.
const DEFAULT_PACE_MS = 5_500;
// Auto-pause threshold — N same-kind errors in a row likely means a
// systemic problem (revoked creds, rate-limit ban) and continuing would
// just rack up failed rows.
const CONSECUTIVE_FAILURE_LIMIT = 3;

/** Map a Wasender error string to a coarse "kind" so we can detect
 *  N-in-a-row of the same problem. Lowercase + keyword heuristics. */
function classifyError(err: string | null | undefined): string {
  const e = (err || '').toLowerCase();
  if (!e) return 'unknown';
  if (e.includes('account protection') || e.includes('rate limit') || e.includes('1 message every')) return 'rate_limit';
  if (e.includes('unauthor') || e.includes('forbid') || e.includes('api key') || e.includes('invalid token')) return 'auth';
  if (e.includes('not exist') || e.includes('not on whatsapp') || e.includes('invalid number')) return 'bad_number';
  if (e.includes('timeout') || e.includes('econn')) return 'network';
  return 'other';
}

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

  // 2. Load the job. Bail if it's already terminal or paused/scheduled.
  const { data: job } = await admin
    .from('bulk_send_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  if (['completed','cancelled','failed','paused','scheduled'].includes(job.status)) {
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
    admin.from('whatsapp_settings').select('api_key, teachers_enabled').eq('id', 1).maybeSingle(),
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
  // Master toggle — fail the whole job loud-and-clear so the admin sees it.
  // Bulk reminders are intentional broadcasts; silently sending nothing
  // would be the wrong default.
  if (ws.teachers_enabled === false) {
    await admin.from('bulk_send_jobs').update({
      status: 'failed',
      error_message: TEACHER_WHATSAPP_DISABLED_ERROR,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);
    return NextResponse.json({ error: 'teacher whatsapp disabled' }, { status: 400 });
  }

  const today = (() => {
    try { return new Date().toLocaleDateString('ar-SA-u-ca-gregory'); }
    catch { return new Date().toISOString().slice(0, 10); }
  })();

  // Pacing knobs — read from the job. Defaults preserve teacher-bulk
  // behaviour for legacy jobs that don't have these columns.
  const audience: 'teachers' | 'parents' = job.audience || 'teachers';
  const pacingMs = job.pacing_ms || DEFAULT_PACE_MS;
  const jitterMs = job.jitter_ms || 0;
  const batchSize = job.batch_size || 0;
  const batchCooldownMs = job.batch_cooldown_ms || 0;

  // Track consecutive failures of the SAME kind for the auto-pause guard.
  let lastErrorKind: string = job.last_error_kind || '';
  let consecutiveFailures: number = job.consecutive_failures || 0;

  // 5. Drain the queue with pacing.
  let processed = 0;
  let sentInBatch = 0;
  while (Date.now() - startedAt < BUDGET_MS) {
    // Atomically claim one queued recipient. Doing this as a single update
    // returning the row prevents a parallel worker (in case of accidental
    // double-trigger) from picking the same row.
    const { data: claimed, error: claimErr } = await admin
      .from('bulk_send_recipients')
      .select('id, user_id, student_id, teacher_name, phone')
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

    // Render the personalized message — different rules per audience.
    const recipientName = claimed.teacher_name || (audience === 'parents' ? 'ولي الأمر الكريم' : 'الأستاذ الفاضل');
    const portalUrl = teacherPortalUrl();

    let message: string;
    if (audience === 'parents') {
      // Parent broadcast — use student name as recipient context, NO
      // portal URL append (parents don't have a login portal).
      message = renderTemplate(job.template, {
        student_name: recipientName,
        school_name: (settings?.school_name as string) || '',
        principal_name: (settings?.principal_name as string) || '',
        date: today,
      });
    } else {
      // Teacher reminder — preserves existing behaviour including the
      // auto-appended portal URL when the template doesn't include it.
      message = renderTemplate(job.template, {
        teacher_name: recipientName,
        school_name: (settings?.school_name as string) || '',
        principal_name: (settings?.principal_name as string) || '',
        date: today,
        portal_url: portalUrl,
      });
      if (!message.includes('/teacher')) {
        message = `${message}\n\n🔗 سجِّل الحضور من هنا:\n${portalUrl}`;
      }
    }

    // Send. Best-effort — failures are logged on the recipient row.
    const result = await sendTextAndLog({
      supabase: admin,
      apiKey: ws.api_key as string,
      phone: normalizePhone(claimed.phone || ''),
      message,
      recipientName,
      recipientType: audience === 'parents' ? 'parent' : 'teacher',
      templateName: audience === 'parents' ? 'parent_bulk_announcement' : 'teacher_bulk_reminder',
      contextType: audience === 'parents' ? 'bulk_announcement' : 'manual',
      contextId: String(jobId),
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
      // Reset consecutive failure tracking on a successful send.
      if (consecutiveFailures > 0) {
        consecutiveFailures = 0;
        lastErrorKind = '';
        await admin.from('bulk_send_jobs').update({
          consecutive_failures: 0, last_error_kind: null,
        }).eq('id', jobId);
      }
      sentInBatch += 1;
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

      // Track same-kind streak. Auto-pause if we hit the threshold —
      // continuing into the next 50 errors only burns through Wasender
      // credit and floods the log.
      const kind = classifyError(result.error);
      if (kind === lastErrorKind) {
        consecutiveFailures += 1;
      } else {
        lastErrorKind = kind;
        consecutiveFailures = 1;
      }
      await admin.from('bulk_send_jobs').update({
        consecutive_failures: consecutiveFailures,
        last_error_kind: lastErrorKind,
      }).eq('id', jobId);

      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        await admin.from('bulk_send_jobs').update({
          status: 'paused',
          error_message: `إيقاف تلقائي: ${CONSECUTIVE_FAILURE_LIMIT} إخفاقات متتالية من نوع "${lastErrorKind}". راجع وأعد التشغيل.`,
        }).eq('id', jobId);
        return NextResponse.json({ paused: true, reason: lastErrorKind });
      }
    }

    // Mirror to the in-app inbox (best-effort) — only for teacher
    // campaigns since parents don't have user_ids.
    if (job.also_internal && audience === 'teachers' && claimed.user_id) {
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

    // Batch cooldown — after every batchSize successful sends, sleep
    // for batchCooldownMs to break the constant-rate pattern Wasender
    // ban detection looks for.
    if (batchSize > 0 && batchCooldownMs > 0 && sentInBatch >= batchSize) {
      sentInBatch = 0;
      const wait = Math.min(batchCooldownMs, Math.max(0, BUDGET_MS - (Date.now() - startedAt) - 5000));
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      } else {
        break;
      }
      continue;
    }

    // Pace before the next send. Skip if we're out of time anyway.
    // Add jitter — random ± offset around the base pacing.
    const jitter = jitterMs > 0
      ? Math.floor((Math.random() * 2 - 1) * jitterMs)
      : 0;
    const wait = Math.max(1000, pacingMs + jitter);
    if (Date.now() - startedAt + wait < BUDGET_MS) {
      await new Promise((r) => setTimeout(r, wait));
    } else {
      break;
    }
  }

  // 6. Self-trigger if work remains AND we're still in a runnable state.
  const { data: jobNow } = await admin
    .from('bulk_send_jobs')
    .select('status')
    .eq('id', jobId)
    .maybeSingle();
  const stillRunnable = jobNow && ['pending','processing'].includes(jobNow.status);

  const { count: remaining } = await admin
    .from('bulk_send_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('status', 'queued');

  if ((remaining ?? 0) > 0 && stillRunnable) {
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
