import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  message_template: z.string().min(10, 'الرسالة قصيرة جداً').max(2000),
  scope: z.enum(['all', 'specific']).default('all'),
  teacher_user_ids: z.array(z.string().uuid()).optional(),
  also_internal: z.boolean().optional().default(false),
  internal_subject: z.string().max(200).optional(),
});

// POST — enqueue a bulk-reminder job and return immediately.
//
// The actual WhatsApp sending happens in a separate background worker
// (POST /api/whatsapp/bulk-jobs/[id]/process) so the admin can leave
// the page right after clicking send. The worker is triggered via an
// internal fire-and-forget fetch — Vercel spins up a fresh function
// instance for it, runs up to maxDuration=300, then self-triggers if
// the queue isn't drained.
//
// Returns: { job_id, total } — UI should redirect to a live progress
// page that polls GET /api/whatsapp/bulk-jobs/[id].
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }
  const v = parsed.data;

  const admin = createAdminSupabaseClient();

  // 1. Resolve target teacher list. We resolve them once now (rather than
  // at worker time) so the recipient set is locked at creation — admins
  // can deactivate teachers later without affecting an in-flight job.
  let teachersQuery = admin
    .from('user_profiles')
    .select('user_id, full_name, phone, is_active')
    .eq('role', 'teacher')
    .eq('is_active', true);
  if (v.scope === 'specific') {
    if (!v.teacher_user_ids || v.teacher_user_ids.length === 0) {
      return NextResponse.json({ error: 'يجب تحديد المعلمين المستهدفين' }, { status: 400 });
    }
    teachersQuery = teachersQuery.in('user_id', v.teacher_user_ids);
  }
  const { data: teachers, error: tErr } = await teachersQuery;
  if (tErr || !teachers || teachers.length === 0) {
    return NextResponse.json({ error: 'لا يوجد معلمون مستهدفون' }, { status: 404 });
  }

  // 2. Create the job row.
  const { data: job, error: jobErr } = await admin
    .from('bulk_send_jobs')
    .insert({
      template: v.message_template,
      also_internal: v.also_internal ?? false,
      internal_subject: v.internal_subject || null,
      status: 'pending',
      total: teachers.length,
      created_by: auth.ctx.userId,
    })
    .select('id')
    .single();
  if (jobErr || !job) {
    console.error('bulk-remind enqueue job failed:', jobErr?.message);
    return NextResponse.json({ error: 'تعذّر إنشاء المهمة' }, { status: 500 });
  }

  // 3. Insert recipients. Mark teachers without a phone as 'skipped' up
  // front so the worker doesn't have to check; counts stay accurate.
  const recipientRows = teachers.map((t: any) => ({
    job_id: job.id,
    user_id: t.user_id,
    teacher_name: t.full_name || null,
    phone: t.phone || null,
    status: t.phone ? 'queued' : 'skipped',
    error: t.phone ? null : 'رقم الجوال غير متوفر',
  }));
  const { error: recErr } = await admin.from('bulk_send_recipients').insert(recipientRows);
  if (recErr) {
    console.error('bulk-remind insert recipients failed:', recErr.message);
    // Try to clean up the orphan job so the dashboard isn't littered.
    await admin.from('bulk_send_jobs').delete().eq('id', job.id);
    return NextResponse.json({ error: 'تعذّر إعداد قائمة المستقبلين' }, { status: 500 });
  }

  // Pre-count the skipped (no-phone) ones so the job summary is accurate
  // even if the worker hasn't started yet.
  const skippedCount = recipientRows.filter((r) => r.status === 'skipped').length;
  if (skippedCount > 0) {
    await admin
      .from('bulk_send_jobs')
      .update({ failed: skippedCount })
      .eq('id', job.id);
  }

  // 4. Fire-and-forget trigger to the worker. The worker authenticates
  // via a shared secret derived from the Supabase service-role key — no
  // new env var needed. We don't await: if Vercel cancels the in-flight
  // request, the cron sweeper (added separately) will pick up the stuck
  // job within a minute.
  const workerUrl = `${request.nextUrl.origin}/api/whatsapp/bulk-jobs/${job.id}/process`;
  const workerSecret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32);
  fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
  }).catch((e) => console.error('worker trigger failed:', e));

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.bulk_remind_teachers',
    targetType: 'bulk_send_job',
    targetId: job.id,
    details: {
      scope: v.scope,
      total: teachers.length,
      skipped: skippedCount,
      also_internal: !!v.also_internal,
    },
    request,
  });

  return NextResponse.json({
    data: {
      job_id: job.id,
      total: teachers.length,
      queued: teachers.length - skippedCount,
      skipped: skippedCount,
    },
  }, { status: 202 });  // 202 Accepted — work scheduled, not yet done
}
