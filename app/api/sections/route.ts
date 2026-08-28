import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, updateSectionsBatchSchema, updateSectionsSchema } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

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

  type SectionUpdate = {
    grade_id: number;
    sections: Array<{ name: string; sort_order: number }>;
  };
  const isBatch = typeof body === 'object' && body !== null && 'updates' in body;
  let updates: SectionUpdate[];
  if (isBatch) {
    const validation = validateBody(updateSectionsBatchSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    updates = validation.data.updates;
  } else {
    const validation = validateBody(updateSectionsSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    updates = [validation.data];
  }

  // The batch RPC applies every grade update in one database transaction.
  // The legacy single-grade request remains supported for existing callers.
  const rpc = isBatch
    ? supabase.rpc('update_school_sections', { p_updates: updates })
    : supabase.rpc('update_grade_sections', {
        p_grade_id: updates[0].grade_id,
        p_sections: updates[0].sections,
      });
  const { data: result, error } = await rpc;

  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في حفظ الشُعب. لم تُطبّق أي تعديلات.' }, { status: 400 });
  }

  const gradeIds = updates.map((update) => update.grade_id);
  const { data: updated, error: updatedError } = await supabase
    .from('sections')
    .select('*')
    .in('grade_id', gradeIds)
    .order('sort_order');

  if (updatedError) {
    return NextResponse.json({ error: 'تم الحفظ، لكن تعذر تحديث قائمة الشعب' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'sections.update',
    targetType: 'grades',
    details: {
      grade_ids: gradeIds,
      requested_counts: Object.fromEntries(updates.map((update) => [update.grade_id, update.sections.length])),
      result,
    },
    request,
  });

  return NextResponse.json({ data: updated || [], summary: result });
}
