import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET — list all templates. Read-open to any authenticated user (RLS allows).
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, name, description, body, is_active, updated_at')
    .order('name');

  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في جلب القوالب' }, { status: 500 });
  }
  return NextResponse.json(
    { data: data || [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
