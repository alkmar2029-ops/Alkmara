import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, updateSettingsSchema } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const [{ data, error }, { count: sectionsCount, error: sectionsError }] = await Promise.all([
    supabase.from('school_settings').select('*').limit(1),
    supabase.from('sections').select('id', { count: 'exact', head: true }),
  ]);

  if (error || sectionsError) return NextResponse.json({ error: 'حدث خطأ في جلب الإعدادات' }, { status: 400 });

  // If no settings row exists, return default settings
  if (!data || data.length === 0) {
    return NextResponse.json({
      data: {
        id: 1,
        school_name: '',
        stage: 'elementary',
        academic_year: '',
        has_sections: false,
      },
    }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
  }

  return NextResponse.json({
    data: { ...data[0], has_sections: (sectionsCount || 0) > 0 },
  }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(updateSettingsSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  if (validation.data.stage || validation.data.section_type) {
    const [{ data: current, error: currentError }, { count, error: countError }] = await Promise.all([
      supabase.from('school_settings').select('stage, section_type').eq('id', 1).single(),
      supabase.from('sections').select('id', { count: 'exact', head: true }),
    ]);
    if (currentError || countError) {
      return NextResponse.json({ error: 'تعذر التحقق من إعدادات الشعب الحالية' }, { status: 500 });
    }
    const changesStructure = (
      (validation.data.stage && validation.data.stage !== current.stage)
      || (validation.data.section_type && validation.data.section_type !== current.section_type)
    );
    if ((count || 0) > 0 && changesStructure) {
      return NextResponse.json({
        error: 'لا يمكن تغيير المرحلة أو تصنيف الشعب بعد إنشائها. عدّل عدد الشعب من صفحة الصفوف والشعب.',
      }, { status: 409 });
    }
  }

  if (validation.data.academic_year) {
    const { data: currentYear, error: currentYearError } = await supabase
      .from('school_settings')
      .select('academic_year, academic_year_id')
      .eq('id', 1)
      .single();
    if (currentYearError) {
      return NextResponse.json({ error: 'تعذر التحقق من العام الدراسي الحالي' }, { status: 500 });
    }
    if (currentYear.academic_year_id && validation.data.academic_year !== currentYear.academic_year) {
      return NextResponse.json({
        error: 'يتم تغيير العام الدراسي من صفحة «فتح عام دراسي» لضمان الأرشفة والترقية الآمنة.',
      }, { status: 409 });
    }
  }

  // Always update row id=1 (single school)
  const { data, error } = await supabase
    .from('school_settings')
    .update({ ...validation.data, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'حدث خطأ في حفظ الإعدادات' }, { status: 400 });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'settings.update',
    targetType: 'school_settings',
    targetId: 1,
    details: { changed_keys: Object.keys(validation.data) },
    request,
  });

  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
