import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { validateBody, updateStudentSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (isNaN(id)) {
    return NextResponse.json({ error: 'معرّف الطالب غير صالح' }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('students')
    .select('*, grades(name, stage), sections(name)')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: 'لم يتم العثور على الطالب' }, { status: 404 });
  return NextResponse.json({ data: { ...data, grade_name: data.grades?.name, section_name: data.sections?.name } });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (isNaN(id)) {
    return NextResponse.json({ error: 'معرّف الطالب غير صالح' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(updateStudentSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('students')
    .update({ ...validation.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'حدث خطأ أثناء تحديث بيانات الطالب' }, { status: 400 });
  return NextResponse.json({ data });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (isNaN(id)) {
    return NextResponse.json({ error: 'معرّف الطالب غير صالح' }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase
    .from('students')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: 'حدث خطأ أثناء حذف الطالب' }, { status: 400 });
  return NextResponse.json({ message: 'تم إلغاء تفعيل الطالب' });
}
