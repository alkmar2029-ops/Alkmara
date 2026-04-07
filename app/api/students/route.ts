import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { validateBody, createStudentSchema } from '@/lib/validations/schemas';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '@/lib/utils/helpers';

export const dynamic = 'force-dynamic';

/** Escape special PostgREST filter characters from a search term. */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,.*()\\%_]/g, '');
}

export async function GET(request: NextRequest) {
  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(request.url);
  const rawSearch = searchParams.get('search');
  const grade_id = searchParams.get('grade_id');
  const section_id = searchParams.get('section_id');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const offset = (page - 1) * limit;

  let query = supabase
    .from('students')
    .select('*, grades(name, stage), sections(name)', { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (rawSearch) {
    const search = sanitizeSearch(rawSearch);
    if (search.length > 0) {
      query = query.or(
        `student_id.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,father_name.ilike.%${search}%`,
      );
    }
  }
  if (grade_id) query = query.eq('grade_id', grade_id);
  if (section_id) query = query.eq('section_id', section_id);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: 'حدث خطأ أثناء جلب بيانات الطلاب' }, { status: 400 });

  const students = (data || []).map((s: any) => ({
    ...s,
    grade_name: s.grades?.name,
    grade_stage: s.grades?.stage,
    section_name: s.sections?.name,
    grades: undefined,
    sections: undefined,
  }));

  return NextResponse.json({
    data: students,
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  });
}

export async function POST(request: NextRequest) {
  const supabase = createAdminSupabaseClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(createStudentSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const validatedData = validation.data;

  // Retry loop for device_uid race condition (up to 3 attempts)
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Fetch current max device_uid
    const { data: maxRow } = await supabase
      .from('students')
      .select('device_uid')
      .order('device_uid', { ascending: false })
      .limit(1)
      .single();

    const nextUid = (maxRow?.device_uid || 0) + 1;

    const { data, error } = await supabase
      .from('students')
      .insert({ ...validatedData, device_uid: nextUid })
      .select()
      .single();

    if (!error) {
      return NextResponse.json({ data }, { status: 201 });
    }

    // If unique constraint violation on device_uid, retry
    if (error.code === '23505' && attempt < MAX_RETRIES - 1) {
      continue;
    }

    return NextResponse.json({ error: 'حدث خطأ أثناء إضافة الطالب' }, { status: 400 });
  }

  return NextResponse.json({ error: 'فشل في تخصيص معرّف الجهاز، يرجى المحاولة مرة أخرى' }, { status: 500 });
}
