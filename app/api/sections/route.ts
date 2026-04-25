import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, updateSectionsSchema } from '@/lib/validations/schemas';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { searchParams } = new URL(request.url);
  const gradeId = searchParams.get('grade_id');

  let query = supabase.from('sections').select('*, grades(name, stage)').order('sort_order');
  if (gradeId) query = query.eq('grade_id', gradeId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'حدث خطأ في جلب الشُعب' }, { status: 400 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(updateSectionsSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { grade_id, sections } = validation.data;

  // Atomic via RPC: deletes unused absent sections, upserts the new list,
  // and returns names of sections it had to keep because they are in use.
  const { data: result, error } = await supabase.rpc('update_grade_sections', {
    p_grade_id: grade_id,
    p_sections: sections,
  });

  if (error) {
    return NextResponse.json({ error: `حدث خطأ في حفظ الشُعب: ${error.message}` }, { status: 400 });
  }

  // Return the up-to-date sections for this grade so the client can refresh.
  const { data: updated } = await supabase
    .from('sections')
    .select('*')
    .eq('grade_id', grade_id)
    .order('sort_order');

  return NextResponse.json({ data: updated || [], summary: result });
}
