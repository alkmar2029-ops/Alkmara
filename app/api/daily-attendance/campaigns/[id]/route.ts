import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — campaign snapshot for polling. Returns the row + a small
// `recent` array of the last few outcomes so the UI can show "last
// recipients sent".
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'staff', 'viewer']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: campaign } = await admin
    .from('daily_send_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: 'الحملة غير موجودة' }, { status: 404 });
  }

  // Last 8 sent/failed recipients — drives the "آخر رسالة" feed in the UI.
  const { data: recent } = await admin
    .from('daily_send_recipients')
    .select('id, phase_key, student_name, phone, status, error, sent_at')
    .eq('campaign_id', id)
    .in('status', ['sent', 'failed'])
    .order('sent_at', { ascending: false })
    .limit(8);

  return NextResponse.json({
    data: { campaign, recent: recent || [] },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
