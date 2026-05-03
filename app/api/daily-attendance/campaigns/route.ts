import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';
import { z } from 'zod';
import {
  PHASE_ORDER,
  emptyPhasesState,
  type PhaseKey,
  type PhasesState,
} from '@/lib/daily-attendance/campaign-types';

export const dynamic = 'force-dynamic';

const recipientSchema = z.object({
  student_id: z.number().int().positive(),
  student_name: z.string().min(1),
  phone: z.string().nullable().optional(),
  grade_name: z.string().nullable().optional(),
  section_name: z.string().nullable().optional(),
  absent_periods: z.array(z.number().int()).optional(),
});

const phaseSchema = z.object({
  key: z.enum(['absence', 'escape_after_first', 'mid_day_departure', 'selective_skip']),
  recipients: z.array(recipientSchema).max(2000),
});

const createSchema = z.object({
  attendance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phases: z.array(phaseSchema).min(1).max(4),
  custom_message: z.string().max(2000).optional().nullable(),
});

// POST — create a new multi-phase campaign and kick off the first
// worker invocation. Returns the campaign id immediately so the
// client can start polling.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات غير صالحة' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' },
      { status: 400 },
    );
  }
  const { attendance_date, phases, custom_message } = parsed.data;

  // Pre-flight: count recipients (we need to refuse empty campaigns
  // and bound the per-row INSERT).
  const totalRecipients = phases.reduce((acc, p) => acc + p.recipients.length, 0);
  if (totalRecipients === 0) {
    return NextResponse.json({ error: 'لا يوجد مستفيدون' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // Build the per-phase state snapshot so the polling client gets a
  // full picture from the campaign row alone.
  const phasesState: PhasesState = emptyPhasesState();
  for (const p of phases) {
    phasesState[p.key].total = p.recipients.length;
    phasesState[p.key].status = p.recipients.length === 0 ? 'skipped' : 'pending';
  }

  // 1. Create the campaign row.
  const { data: campaign, error: campErr } = await admin
    .from('daily_send_campaigns')
    .insert({
      attendance_date,
      status: 'pending',
      total: totalRecipients,
      phases_state: phasesState,
      custom_message: custom_message || null,
      created_by: auth.ctx.userId,
    })
    .select('id')
    .single();

  if (campErr || !campaign) {
    return NextResponse.json(
      { error: 'فشل إنشاء الحملة: ' + (campErr?.message || 'unknown') },
      { status: 500 },
    );
  }

  // 2. Bulk-insert recipients with explicit ordering.
  const rows: any[] = [];
  for (const phase of phases) {
    const order = PHASE_ORDER[phase.key as PhaseKey];
    phase.recipients.forEach((r, i) => {
      rows.push({
        campaign_id: campaign.id,
        phase_key: phase.key,
        phase_order: order,
        recipient_order: i,
        student_id: r.student_id,
        student_name: r.student_name,
        phone: r.phone || null,
        grade_name: r.grade_name || null,
        section_name: r.section_name || null,
        absent_periods: r.absent_periods || null,
        status: 'queued',
      });
    });
  }

  // Chunk the insert (Supabase rejects payloads > ~6 MB).
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error: recErr } = await admin.from('daily_send_recipients').insert(slice);
    if (recErr) {
      // Rollback the campaign row so we don't leave a dangling parent.
      await admin.from('daily_send_campaigns').delete().eq('id', campaign.id);
      return NextResponse.json(
        { error: 'فشل إدراج المستفيدين: ' + recErr.message },
        { status: 500 },
      );
    }
  }

  // 3. Trigger the worker — fire-and-forget so the response returns
  // fast. The worker authenticates with a shared secret derived from
  // the service-role key (same pattern as bulk-jobs).
  const origin = request.nextUrl.origin;
  const secret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32);
  fetch(`${origin}/api/daily-attendance/campaigns/${campaign.id}/process`, {
    method: 'POST',
    headers: { 'x-worker-secret': secret },
  }).catch(() => { /* swallowed — worker will be retried via cron sweep */ });

  return NextResponse.json({
    data: { id: campaign.id, status: 'pending', total: totalRecipients },
  }, { status: 201 });
}

// GET — list recent campaigns (for an admin history view; the
// progress panel uses /campaigns/[id] directly).
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const limit = Math.min(50, parseInt(request.nextUrl.searchParams.get('limit') || '20', 10));
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('daily_send_campaigns')
    .select('id, attendance_date, status, total, sent, failed, created_at, started_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  return NextResponse.json({ data: data || [] });
}
