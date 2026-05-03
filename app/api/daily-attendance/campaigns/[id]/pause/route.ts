import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// POST — pause a running campaign. The worker checks status before
// each send; setting status='paused' makes it stop the loop and exit.
// Resuming retriggers a fresh worker invocation.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('daily_send_campaigns')
    .update({ status: 'paused', paused_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['pending', 'processing'])
    .select('id, status')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'الحملة لا يمكن إيقافها (حالتها لا تسمح)' }, { status: 400 });

  return NextResponse.json({ data });
}
