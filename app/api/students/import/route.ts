import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, importStudentsSchema } from '@/lib/validations/schemas';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(importStudentsSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { students, grade_id, section_id } = validation.data;
  const autoCreateGrades = (body as any)?.auto_create_grades === true;

  // Creating grades/sections is admin-only (RLS), so staff cannot use
  // auto_create_grades — refuse upfront instead of letting silent insert
  // failures leave students orphaned without grade/section.
  if (autoCreateGrades && auth.ctx.role !== 'admin' && auth.ctx.role !== 'super_admin') {
    return NextResponse.json(
      { error: 'إنشاء الصفوف والشعب تلقائياً يتطلب صلاحية المدير' },
      { status: 403 },
    );
  }

  // =============== إنشاء الصفوف والشعب تلقائياً ===============
  // خريطة: اسم الصف → grade_id
  const gradeMap = new Map<string, number>();
  // خريطة: "grade_id:section_name" → section_id
  const sectionMap = new Map<string, number>();

  if (autoCreateGrades) {
    // جمع أسماء الصفوف والشعب من بيانات الطلاب
    const uniqueGrades = new Set<string>();
    const gradeSections = new Map<string, Set<string>>();

    for (const s of students) {
      const gName = (s as any).grade_name;
      const sName = (s as any).section_name;
      if (gName) {
        uniqueGrades.add(gName);
        if (sName) {
          if (!gradeSections.has(gName)) gradeSections.set(gName, new Set());
          gradeSections.get(gName)!.add(sName);
        }
      }
    }

    // جلب الصفوف الموجودة
    const { data: existingGrades } = await supabase.from('grades').select('id, name');
    for (const g of existingGrades || []) gradeMap.set(g.name, g.id);

    // إنشاء الصفوف الجديدة — لا نتجاهل أخطاء الإدراج حتى لا يبقى الطلاب
    // بدون صف/شعبة بسبب فشل صامت في RLS.
    for (const gName of uniqueGrades) {
      if (!gradeMap.has(gName)) {
        // تحديد المرحلة من الاسم
        let stage = 'middle';
        if (gName.includes('ابتدائي')) stage = 'elementary';
        else if (gName.includes('ثانوي')) stage = 'secondary';

        const { data: newGrade, error: gradeErr } = await supabase
          .from('grades')
          .insert({ name: gName, stage, sort_order: gradeMap.size + 1 })
          .select('id')
          .single();
        if (gradeErr || !newGrade) {
          return NextResponse.json(
            { error: `فشل إنشاء الصف "${gName}": ${gradeErr?.message || 'سبب غير معروف'}` },
            { status: 500 },
          );
        }
        gradeMap.set(gName, newGrade.id);
      }
    }

    // جلب الشعب الموجودة
    const { data: existingSections } = await supabase.from('sections').select('id, name, grade_id');
    for (const s of existingSections || []) sectionMap.set(`${s.grade_id}:${s.name}`, s.id);

    // إنشاء الشعب الجديدة
    for (const [gName, sNames] of gradeSections) {
      const gId = gradeMap.get(gName);
      if (!gId) continue;
      let sortOrder = 1;
      for (const sName of sNames) {
        const key = `${gId}:${sName}`;
        if (!sectionMap.has(key)) {
          const { data: newSection, error: sectionErr } = await supabase
            .from('sections')
            .insert({ grade_id: gId, name: sName, sort_order: sortOrder++ })
            .select('id')
            .single();
          if (sectionErr || !newSection) {
            return NextResponse.json(
              { error: `فشل إنشاء الشعبة "${sName}" في الصف "${gName}": ${sectionErr?.message || 'سبب غير معروف'}` },
              { status: 500 },
            );
          }
          sectionMap.set(key, newSection.id);
        }
      }
    }
  }

  // =============== معالجة الطلاب ===============

  // كشف المكرر
  const studentIds = students.map((s) => s.student_id).filter(Boolean);
  const { data: existingStudents } = await supabase
    .from('students')
    .select('student_id')
    .in('student_id', studentIds.length > 0 ? studentIds : ['__none__']);

  const existingIds = new Set((existingStudents || []).map((s: any) => s.student_id));

  const results = { imported: 0, skipped: 0, errors: [] as string[], grades_created: gradeMap.size, sections_created: sectionMap.size };

  const validRecords: Array<{
    student_id: string;
    first_name: string;
    last_name: string;
    father_name: string;
    phone: string | null;
    grade_id: number | null;
    section_id: number | null;
  }> = [];

  for (const student of students) {
    if (!student.student_id || !/^\d{7,10}$/.test(String(student.student_id))) {
      results.errors.push(`رقم هوية غير صحيح: ${student.student_id || 'فارغ'}`);
      continue;
    }
    if (!student.first_name) {
      results.errors.push(`الاسم مطلوب للطالب: ${student.student_id}`);
      continue;
    }

    // كشف المكرر
    if (existingIds.has(String(student.student_id))) {
      results.skipped++;
      continue;
    }

    // تحديد الصف والشعبة
    let finalGradeId = student.grade_id || grade_id;
    let finalSectionId = student.section_id || section_id;

    if (autoCreateGrades) {
      const gName = (student as any).grade_name;
      const sName = (student as any).section_name;
      if (gName && gradeMap.has(gName)) {
        finalGradeId = gradeMap.get(gName);
        if (sName) {
          const key = `${finalGradeId}:${sName}`;
          if (sectionMap.has(key)) finalSectionId = sectionMap.get(key);
        }
      }
    }

    validRecords.push({
      student_id: String(student.student_id),
      first_name: student.first_name,
      last_name: student.last_name || '',
      father_name: student.father_name || '',
      phone: student.phone || null,
      grade_id: finalGradeId || null,
      section_id: finalSectionId || null,
    });
  }

  // Allocate all device_uids up-front from the sequence (single round-trip),
  // guaranteeing no collisions even with concurrent imports.
  let allocated: number[] = [];
  if (validRecords.length > 0) {
    const { data: uids, error: uidsError } = await supabase
      .rpc('next_device_uids', { n: validRecords.length });
    if (uidsError || !Array.isArray(uids) || uids.length < validRecords.length) {
      return NextResponse.json(
        { error: 'فشل في تخصيص معرّفات الأجهزة للطلاب' },
        { status: 500 },
      );
    }
    allocated = uids.map(Number);
  }

  // Batch insert in chunks of BATCH_SIZE
  for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
    const slice = validRecords.slice(i, i + BATCH_SIZE);
    const batch = slice.map((rec, j) => ({ ...rec, device_uid: allocated[i + j] }));

    const { error } = await supabase.from('students').insert(batch);

    if (error) {
      for (const record of batch) {
        results.errors.push(`خطأ في الطالب ${record.student_id}: ${error.message}`);
      }
      continue;
    }

    results.imported += batch.length;
  }

  return NextResponse.json({ data: results });
}
