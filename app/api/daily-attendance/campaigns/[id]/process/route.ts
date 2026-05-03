import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { buildPhaseMessage } from '@/lib/daily-attendance/messages';
import {
  PHASE_ORDER,
  type PhaseKey,
  type PhasesState,
} from '@/lib/daily-attendance/campaign-types';

export const dynamic = 'force-dynamic';
// Vercel Pro: 5 minutes max. At 5.5s pacing this drains ~50 messages
// per call; the worker self-triggers when the budget runs low so a
// 200-recipient campaign completes in ~4 invocations spread over 18
// minutes of wall-clock time.
export const maxDuration = 300;

const BUDGET_MS = 285_000;     // ~15s headroom for the self-trigger fetch
const PACE_MS = 5_500;         // wasender 1-msg-per-5s + safety margin

// POST — drain the queue for a daily-attendance campaign. Authenticated
// internally via a shared secret (derived from the service-role key)
// so it can be called from the create/resume endpoints without a
// session cookie. Re-entrant: claims one recipient at a time via a
// status update, so two concurrent workers never double-send.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // 1. Auth — internal-only.
  const expectedSecret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32);
  const providedSecret = request.headers.get('x-worker-secret') || '';
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const campaignId = parseInt(params.id, 10);
  if (Number.isNaN(campaignId)) {
    return NextResponse.json({ error: 'bad campaign id' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const startedAt = Date.now();

  // 2. Load the campaign. Bail if terminal/paused/cancelled.
  let { data: campaign } = await admin
    .from('daily_send_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (['completed', 'cancelled', 'failed'].includes(campaign.status)) {
    return NextResponse.json({ done: true, status: campaign.status });
  }
  if (campaign.status === 'paused') {
    return NextResponse.json({ done: true, status: 'paused' });
  }

  // 3. First-run housekeeping.
  if (campaign.status === 'pending') {
    await admin
      .from('daily_send_campaigns')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', campaignId);
    campaign.status = 'processing';
  }

  // 4. WhatsApp + school context (cached for the whole worker run).
  const [{ data: ws }, { data: settings }] = await Promise.all([
    admin.from('whatsapp_settings').select('api_key').eq('id', 1).maybeSingle(),
    admin.from('school_settings').select('school_name').eq('id', 1).maybeSingle(),
  ]);
  if (!ws?.api_key) {
    await admin.from('daily_send_campaigns').update({
      status: 'failed',
      error_message: 'مفتاح API للواتساب غير مضبوط',
      completed_at: new Date().toISOString(),
    }).eq('id', campaignId);
    return NextResponse.json({ error: 'whatsapp api key missing' }, { status: 400 });
  }
  const schoolName = (settings?.school_name as string) || 'المدرسة';

  // 5. Drain loop. Each iteration claims one queued recipient (the
  // earliest in phase_order/recipient_order), sends it, updates the
  // row, then sleeps for the wasender pace.
  let processedThisRun = 0;
  while (Date.now() - startedAt < BUDGET_MS) {
    // Re-check campaign status before each send so pause/cancel takes
    // effect within ~6 seconds of the user clicking the button.
    const { data: fresh } = await admin
      .from('daily_send_campaigns')
      .select('status')
      .eq('id', campaignId)
      .maybeSingle();
    if (!fresh) break;
    if (fresh.status !== 'processing') {
      // Paused / cancelled / completed externally.
      return NextResponse.json({ stopped: true, status: fresh.status });
    }

    // Atomically claim the next recipient by flipping queued → sending
    // for the smallest (phase_order, recipient_order) tuple.
    const { data: nextList } = await admin
      .from('daily_send_recipients')
      .select('id, phase_key, student_id, student_name, phone, grade_name, section_name, absent_periods')
      .eq('campaign_id', campaignId)
      .eq('status', 'queued')
      .order('phase_order', { ascending: true })
      .order('recipient_order', { ascending: true })
      .limit(1);

    if (!nextList || nextList.length === 0) {
      // Queue drained — mark campaign complete.
      await admin.from('daily_send_campaigns').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_phase: null,
      }).eq('id', campaignId);
      return NextResponse.json({ done: true, status: 'completed' });
    }

    const r = nextList[0];

    // Claim it — guard against races by gating on the existing 'queued'
    // status. If another worker already grabbed it, skip and retry.
    const { data: claimed } = await admin
      .from('daily_send_recipients')
      .update({ status: 'sending' })
      .eq('id', r.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    // Track current phase on the parent so the UI shows progress.
    if (campaign.current_phase !== r.phase_key) {
      campaign.current_phase = r.phase_key;
      const newState = bumpPhaseRunning(campaign.phases_state as PhasesState, r.phase_key as PhaseKey);
      await admin.from('daily_send_campaigns').update({
        current_phase: r.phase_key,
        phases_state: newState,
      }).eq('id', campaignId);
      campaign.phases_state = newState;
    }

    // Skip recipients without a phone — mark as skipped, not failed.
    if (!r.phone || !r.phone.trim()) {
      await admin.from('daily_send_recipients').update({
        status: 'skipped',
        error: 'لا يوجد رقم جوال',
        sent_at: new Date().toISOString(),
      }).eq('id', r.id);
      // Phase state — count as failed for UI purposes (phone-less rows
      // didn't get notified, even though we didn't try).
      const updated = bumpPhaseFail(campaign.phases_state as PhasesState, r.phase_key as PhaseKey);
      await admin.from('daily_send_campaigns').update({
        failed: (campaign.failed as number) + 1,
        phases_state: updated,
        last_recipient_name: r.student_name,
      }).eq('id', campaignId);
      campaign.failed = (campaign.failed as number) + 1;
      campaign.phases_state = updated;
      continue;
    }

    // Build + send the message.
    const message = buildPhaseMessage(r.phase_key as PhaseKey, {
      studentName: r.student_name,
      gradeName: r.grade_name,
      sectionName: r.section_name,
      date: campaign.attendance_date,
      missedPeriods: (r.absent_periods as number[]) || undefined,
      schoolName,
    });

    const result = await sendTextAndLog({
      apiKey: ws.api_key as string,
      phone: r.phone as string,
      message,
      recipientName: r.student_name,
      recipientType: 'parent',
      templateName: `daily_${r.phase_key}`,
      contextType: 'note',
      contextId: r.id,
      sentBy: campaign.created_by as string,
    });

    // Persist outcome on the recipient row.
    await admin.from('daily_send_recipients').update({
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : (result.error || 'unknown error'),
      sent_at: new Date().toISOString(),
    }).eq('id', r.id);

    // Update parent counters + phase state in one round-trip.
    const ok = result.ok;
    const phaseState = ok
      ? bumpPhaseSent(campaign.phases_state as PhasesState, r.phase_key as PhaseKey)
      : bumpPhaseFail(campaign.phases_state as PhasesState, r.phase_key as PhaseKey);
    await admin.from('daily_send_campaigns').update({
      sent: (campaign.sent as number) + (ok ? 1 : 0),
      failed: (campaign.failed as number) + (ok ? 0 : 1),
      phases_state: phaseState,
      last_recipient_name: r.student_name,
      last_sent_at: new Date().toISOString(),
    }).eq('id', campaignId);
    campaign.sent = (campaign.sent as number) + (ok ? 1 : 0);
    campaign.failed = (campaign.failed as number) + (ok ? 0 : 1);
    campaign.phases_state = phaseState;
    processedThisRun++;

    // Pace.
    await new Promise((res) => setTimeout(res, PACE_MS));
  }

  // 6. Budget exhausted but queue not empty — self-trigger to continue
  // and exit cleanly. Don't await the trigger fetch.
  const origin = request.nextUrl.origin;
  fetch(`${origin}/api/daily-attendance/campaigns/${campaignId}/process`, {
    method: 'POST',
    headers: { 'x-worker-secret': expectedSecret },
  }).catch(() => {});
  return NextResponse.json({ continuing: true, processed: processedThisRun });
}

// ============== phase-state helpers ==============

function bumpPhaseRunning(state: PhasesState, key: PhaseKey): PhasesState {
  const copy = { ...state };
  // Mark previous "running" as done (we've moved on).
  for (const k of Object.keys(copy) as PhaseKey[]) {
    if (copy[k].status === 'running') copy[k] = { ...copy[k], status: 'done' };
  }
  copy[key] = { ...copy[key], status: 'running' };
  return copy;
}

function bumpPhaseSent(state: PhasesState, key: PhaseKey): PhasesState {
  const copy = { ...state };
  copy[key] = { ...copy[key], sent: copy[key].sent + 1 };
  if (copy[key].sent + copy[key].failed >= copy[key].total) {
    copy[key].status = 'done';
  }
  return copy;
}

function bumpPhaseFail(state: PhasesState, key: PhaseKey): PhasesState {
  const copy = { ...state };
  copy[key] = { ...copy[key], failed: copy[key].failed + 1 };
  if (copy[key].sent + copy[key].failed >= copy[key].total) {
    copy[key].status = 'done';
  }
  return copy;
}
