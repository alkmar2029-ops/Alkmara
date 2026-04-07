import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminSupabaseClient();
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage');

    let query = supabase.from('grades').select('*').order('sort_order');
    if (stage) query = query.eq('stage', stage);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: 'حدث خطأ في جلب الصفوف' }, { status: 400 });
    return NextResponse.json({ data: data || [] });
  } catch {
    return NextResponse.json({ error: 'حدث خطأ في جلب الصفوف' }, { status: 500 });
  }
}
