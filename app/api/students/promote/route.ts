import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, promoteSchema } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(promoteSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { confirm } = validation.data;

  if (!confirm) {
    // Preview mode — describe what the atomic RPC will do.
    const { data: settings } = await supabase.from('school_settings').select('stage').single();
    if (!settings) return NextResponse.json({ error: 'لم يتم إعداد المدرسة' }, { status: 400 });

    const { data: grades } = await supabase
      .from('grades')
      .select('id, name, sort_order')
      .eq('stage', settings.stage)
      .order('sort_order', { ascending: false });

    if (!grades || grades.length === 0) return NextResponse.json({ error: 'لا توجد صفوف' }, { status: 400 });

    const maxOrder = grades[0].sort_order;
    const preview = [];

    for (const grade of grades) {
      const { count } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('grade_id', grade.id)
        .eq('is_active', true);

      if (grade.sort_order === maxOrder) {
        preview.push({
          grade_id: grade.id,
          grade_name: grade.name,
          student_count: count || 0,
          action: 'delete',
          action_label: 'حذف (تخرّج)',
        });
      } else {
        const nextGrade = grades.find(g => g.sort_order === grade.sort_order + 1);
        preview.push({
          grade_id: grade.id,
          grade_name: grade.name,
          student_count: count || 0,
          action: 'promote',
          action_label: `ترقية إلى ${nextGrade?.name || ''}`,
          next_grade_id: nextGrade?.id,
          next_grade_name: nextGrade?.name,
        });
      }
    }

    const { count: deviceCount } = await supabase
      .from('devices')
      .select('id', { count: 'exact', head: true })
      .not('section_id', 'is', null);

    return NextResponse.json({
      data: {
        preview,
        total_students: preview.reduce((sum, p) => sum + p.student_count, 0),
        graduated_count: preview.find(p => p.action === 'delete')?.student_count || 0,
        devices_to_clear: deviceCount || 0,
      },
    });
  }

  // Atomic execution via RPC: all-or-nothing.
  const { data: result, error } = await supabase.rpc('promote_students');
  if (error) {
    return NextResponse.json(
      { error: `فشلت عملية الترقية: ${error.message}` },
      { status: 500 },
    );
  }

  const promoted = (result as { promoted?: number })?.promoted ?? 0;
  const deleted = (result as { deleted?: number })?.deleted ?? 0;

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'students.promote',
    details: { promoted, deleted },
    request,
  });

  return NextResponse.json({
    data: {
      promoted,
      deleted,
      message: `تم ترقية ${promoted} طالب وحذف ${deleted} متخرج. يجب إعادة إرسال الطلاب للأجهزة.`,
    },
  });
}
