import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — list recent bulk-send jobs. Used for the history page so admins
// can audit past sends and re-open completed ones.
export async function GET() {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('bulk_send_jobs')
    .select('id, status, total, sent, failed, also_internal, internal_subject, error_message, created_at, started_at, completed_at, template')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: 'فشل جلب المهام' }, { status: 500 });
  }
  return NextResponse.json({ data: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}
