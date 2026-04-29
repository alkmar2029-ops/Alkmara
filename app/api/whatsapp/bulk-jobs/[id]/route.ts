import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — single job + per-recipient list. Used by the live progress page.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const jobId = parseInt(params.id, 10);
  if (Number.isNaN(jobId)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const [{ data: job }, { data: recipients }] = await Promise.all([
    admin.from('bulk_send_jobs').select('*').eq('id', jobId).maybeSingle(),
    admin
      .from('bulk_send_recipients')
      .select('id, user_id, teacher_name, phone, status, error, sent_at')
      .eq('job_id', jobId)
      .order('id'),
  ]);

  if (!job) {
    return NextResponse.json({ error: 'المهمة غير موجودة' }, { status: 404 });
  }

  return NextResponse.json(
    { data: { job, recipients: recipients || [] } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// DELETE — cancel a job. Marks the row as cancelled; the worker checks
// this on each loop iteration and exits cleanly. Recipients already sent
// are NOT recalled — WhatsApp doesn't support unsend.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const jobId = parseInt(params.id, 10);
  if (Number.isNaN(jobId)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from('bulk_send_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['pending', 'processing']);

  if (error) {
    return NextResponse.json({ error: 'تعذّر الإلغاء' }, { status: 500 });
  }

  // Mark any still-queued recipients as skipped so the worker won't pick them.
  await admin
    .from('bulk_send_recipients')
    .update({ status: 'skipped', error: 'تم إلغاء المهمة' })
    .eq('job_id', jobId)
    .eq('status', 'queued');

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'bulk_send.cancel',
    targetType: 'bulk_send_job',
    targetId: jobId,
    request,
  });

  return NextResponse.json({ message: 'تم الإلغاء' });
}
