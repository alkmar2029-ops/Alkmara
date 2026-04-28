import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — count of unread messages for the calling user.
// Used by the bell-icon badge that polls every ~30 seconds.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ count: 0 });

  const supabase = await createServerSupabaseClient();
  // 'sent' is the unread state — once the user opens it we flip to 'read'.
  const { count, error } = await supabase
    .from('internal_messages')
    .select('*', { count: 'exact', head: true })
    .or(`recipient_id.eq.${ctx.userId},recipient_role.eq.${ctx.role}`)
    .eq('status', 'sent')
    // Don't count my own outgoing messages — they always start in 'sent'.
    .neq('sender_id', ctx.userId);

  if (error) return NextResponse.json({ count: 0 });
  return NextResponse.json({ count: count ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
}
