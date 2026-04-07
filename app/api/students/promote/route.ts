import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { validateBody, promoteSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const supabase = createAdminSupabaseClient();

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
    // Preview mode - show what will happen
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
        // Last grade - will be deleted (graduated)
        preview.push({
          grade_id: grade.id,
          grade_name: grade.name,
          student_count: count || 0,
          action: 'delete',
          action_label: 'حذف (تخرّج)',
        });
      } else {
        // Will be promoted to next grade
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

    // Count devices that will be cleared
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

  // Execute promotion
  const { data: settings } = await supabase.from('school_settings').select('stage').single();
  if (!settings) return NextResponse.json({ error: 'لم يتم إعداد المدرسة' }, { status: 400 });

  const { data: grades } = await supabase
    .from('grades')
    .select('id, name, sort_order')
    .eq('stage', settings.stage)
    .order('sort_order', { ascending: false });

  if (!grades || grades.length === 0) return NextResponse.json({ error: 'لا توجد صفوف' }, { status: 400 });

  const maxOrder = grades[0].sort_order;
  let promoted = 0;
  let deleted = 0;

  // Process from highest grade to lowest to avoid conflicts
  for (const grade of grades) {
    if (grade.sort_order === maxOrder) {
      // Delete graduated students (soft delete)
      const { data: deletedRows } = await supabase
        .from('students')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('grade_id', grade.id)
        .eq('is_active', true)
        .select('id');
      deleted += deletedRows?.length || 0;
    } else {
      // Find next grade
      const nextGrade = grades.find(g => g.sort_order === grade.sort_order + 1);
      if (!nextGrade) continue;

      // Get sections mapping: try to match by name
      const { data: currentSections } = await supabase
        .from('sections')
        .select('id, name')
        .eq('grade_id', grade.id);

      const { data: nextSections } = await supabase
        .from('sections')
        .select('id, name')
        .eq('grade_id', nextGrade.id);

      // For each section in current grade, find matching section in next grade
      for (const currentSection of (currentSections || [])) {
        const matchingNext = (nextSections || []).find(ns => ns.name === currentSection.name);

        if (matchingNext) {
          const { data: updatedRows } = await supabase
            .from('students')
            .update({
              grade_id: nextGrade.id,
              section_id: matchingNext.id,
              is_fingerprint_enrolled: false,
              enrolled_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('section_id', currentSection.id)
            .eq('is_active', true)
            .select('id');
          promoted += updatedRows?.length || 0;
        } else {
          const { data: updatedRows } = await supabase
            .from('students')
            .update({
              grade_id: nextGrade.id,
              section_id: null,
              is_fingerprint_enrolled: false,
              enrolled_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('section_id', currentSection.id)
            .eq('is_active', true)
            .select('id');
          promoted += updatedRows?.length || 0;
        }
      }

      // Also handle students without section
      const { data: noSectionRows } = await supabase
        .from('students')
        .update({
          grade_id: nextGrade.id,
          section_id: null,
          is_fingerprint_enrolled: false,
          enrolled_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('grade_id', grade.id)
        .is('section_id', null)
        .eq('is_active', true)
        .select('id');
      promoted += noSectionRows?.length || 0;
    }
  }

  // Clear all device sync - reset fingerprint status
  await supabase
    .from('devices')
    .update({ status: 'disconnected', last_seen_at: null })
    .not('section_id', 'is', null);

  return NextResponse.json({
    data: {
      promoted,
      deleted,
      message: `تم ترقية ${promoted} طالب وحذف ${deleted} متخرج. يجب إعادة إرسال الطلاب للأجهزة.`,
    },
  });
}
