import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { validateBody, importStudentsSchema } from '@/lib/validations/schemas';
import { STUDENT_ID_LENGTH } from '@/lib/utils/helpers';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  const supabase = createAdminSupabaseClient();

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

  const { students, grade_id, section_id, skip_duplicates } = validation.data;

  // Get existing student_ids for duplicate detection
  const studentIds = students.map((s) => s.student_id).filter(Boolean);
  const { data: existingStudents } = await supabase
    .from('students')
    .select('student_id')
    .in('student_id', studentIds);

  const existingIds = new Set((existingStudents || []).map((s: any) => s.student_id));

  // Get max device_uid once, assign incrementally
  const { data: maxRow } = await supabase
    .from('students')
    .select('device_uid')
    .order('device_uid', { ascending: false })
    .limit(1)
    .single();

  let nextUid = (maxRow?.device_uid || 0) + 1;

  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  // Collect all valid records first
  const validRecords: any[] = [];

  for (const student of students) {
    // Validate student_id length using constant
    if (!student.student_id || String(student.student_id).length !== STUDENT_ID_LENGTH) {
      results.errors.push(`رقم هوية غير صحيح: ${student.student_id || 'فارغ'}`);
      continue;
    }
    if (!student.first_name || !student.last_name) {
      results.errors.push(`بيانات ناقصة للطالب: ${student.student_id}`);
      continue;
    }

    // Check duplicate
    if (existingIds.has(String(student.student_id))) {
      if (skip_duplicates) {
        results.skipped++;
        continue;
      }
    }

    validRecords.push({
      student_id: String(student.student_id),
      first_name: student.first_name,
      last_name: student.last_name,
      father_name: student.father_name || '',
      phone: student.phone || null,
      notes: student.notes || '',
      device_uid: nextUid++,
      grade_id: student.grade_id || grade_id,
      section_id: student.section_id || section_id,
    });
  }

  // Batch insert in chunks of BATCH_SIZE
  for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
    const batch = validRecords.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from('students').insert(batch);

    if (error) {
      // If duplicate device_uid, refetch max uid and retry this batch once
      if (error.code === '23505') {
        const { data: refreshedMax } = await supabase
          .from('students')
          .select('device_uid')
          .order('device_uid', { ascending: false })
          .limit(1)
          .single();

        let retryUid = (refreshedMax?.device_uid || 0) + 1;
        for (const record of batch) {
          record.device_uid = retryUid++;
        }
        // Update nextUid for subsequent batches
        nextUid = retryUid;

        const { error: retryError } = await supabase.from('students').insert(batch);
        if (retryError) {
          // Count individual errors for this batch
          for (const record of batch) {
            results.errors.push(`خطأ في الطالب ${record.student_id}: ${retryError.message}`);
          }
          continue;
        }
      } else {
        for (const record of batch) {
          results.errors.push(`خطأ في الطالب ${record.student_id}: ${error.message}`);
        }
        continue;
      }
    }

    results.imported += batch.length;
  }

  return NextResponse.json({ data: results });
}
