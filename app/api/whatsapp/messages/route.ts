import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — paginated list of WhatsApp messages with filters.
//   ?status=success|failed
//   ?context=note|late|teacher_credentials|manual
//   ?type=parent|teacher|admin|unknown
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD
//   ?q= search in phone or recipient_name
//   ?limit (default 100, max 500)
//   ?offset (default 0)
//
// Also returns a `stats` object with counts for the current filter — handy
// for the page header.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const context = searchParams.get('context');
  const type = searchParams.get('type');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const q = (searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  const supabase = await createServerSupabaseClient();

  const applyFilters = (qb: any) => {
    if (status === 'success' || status === 'failed') qb = qb.eq('status', status);
    if (context) qb = qb.eq('context_type', context);
    if (type) qb = qb.eq('recipient_type', type);
    if (from) qb = qb.gte('sent_at', `${from}T00:00:00.000Z`);
    if (to) qb = qb.lte('sent_at', `${to}T23:59:59.999Z`);
    if (q) {
      // Escape PostgREST or-list special chars to keep the filter literal.
      const safe = q.replace(/[,()*]/g, '');
      qb = qb.or(`recipient_phone.ilike.%${safe}%,recipient_name.ilike.%${safe}%`);
    }
    return qb;
  };

  // Page rows
  let listQuery = supabase
    .from('whatsapp_messages')
    .select('id, recipient_phone, recipient_name, recipient_type, template_name, context_type, context_id, message_body, status, http_status, error_message, msg_id, sent_by, sent_at', { count: 'exact' })
    .order('sent_at', { ascending: false })
    .range(offset, offset + limit - 1);
  listQuery = applyFilters(listQuery);

  const { data, count, error } = await listQuery;
  if (error) {
    return NextResponse.json({ error: 'فشل جلب السجل: ' + error.message }, { status: 500 });
  }

  // Lightweight stats (totals for the same filter, plus today/24h)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const last24Start = new Date(Date.now() - 24 * 3600 * 1000);

  const [{ count: successCount }, { count: failedCount }, { count: todayCount }, { count: dayCount }] = await Promise.all([
    applyFilters(supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true }).eq('status', 'success')),
    applyFilters(supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true }).eq('status', 'failed')),
    supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true }).gte('sent_at', todayStart.toISOString()),
    supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true }).gte('sent_at', last24Start.toISOString()),
  ]);

  return NextResponse.json(
    {
      data: data || [],
      total: count ?? 0,
      stats: {
        success: successCount ?? 0,
        failed: failedCount ?? 0,
        today: todayCount ?? 0,
        last_24h: dayCount ?? 0,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
