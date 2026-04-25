import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, createScheduleSchema } from '@/lib/validations/schemas';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { classId: string } }) {
  const supabase = await createServerSupabaseClient();
  const classId = parseInt(params.classId);

  if (isNaN(classId)) {
    return NextResponse.json({ error: 'معرف الصف غير صالح' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('class_schedules')
    .select('*')
    .eq('class_id', classId)
    .order('day_of_week');

  if (error) return NextResponse.json({ error: 'حدث خطأ في جلب الجداول' }, { status: 400 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest, { params }: { params: { classId: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const classId = parseInt(params.classId);

  if (isNaN(classId)) {
    return NextResponse.json({ error: 'معرف الصف غير صالح' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(createScheduleSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('class_schedules')
    .insert({ ...validation.data, class_id: classId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'حدث خطأ في حفظ الجدول' }, { status: 400 });
  return NextResponse.json({ data }, { status: 201 });
}
