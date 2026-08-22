import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';
import { getWorkerSecret } from '@/lib/security/worker-secret';

export const dynamic = 'force-dynamic';

// POST — resume a paused campaign by retriggering the worker.
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  const admin = createAdminSupabaseClient();

  // Set back to processing — the worker will pick up where it left off
  // by querying queued recipients in phase_order/recipient_order.
  const { data, error } = await admin
    .from('daily_send_campaigns')
    .update({ status: 'processing', paused_at: null })
    .eq('id', id)
    .eq('status', 'paused')
    .select('id, status')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'الحملة ليست في حالة إيقاف مؤقت' }, { status: 400 });

  // Trigger the worker — same fire-and-forget pattern as create.
  const origin = request.nextUrl.origin;
  const secret = getWorkerSecret();
  fetch(`${origin}/api/daily-attendance/campaigns/${id}/process`, {
    method: 'POST',
    headers: { 'x-worker-secret': secret },
  }).catch(() => {});

  return NextResponse.json({ data });
}
