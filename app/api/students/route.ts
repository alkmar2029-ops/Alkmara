import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, createStudentSchema } from '@/lib/validations/schemas';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '@/lib/utils/helpers';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

/** Escape special PostgREST filter characters from a search term. */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,.*()\\%_]/g, '');
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
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

  // Alphabetical by full name: first → father → last. Postgres' default
  // text ordering is alphabetical for Arabic letters; the three-key sort
  // gives stable, predictable order when first names match (very common
  // for "محمد", "أحمد", etc.).
  let query = supabase
    .from('students')
    .select('*, grades(name, stage), sections(name)', { count: 'exact' })
    .eq('is_active', true)
    .order('first_name', { ascending: true })
    .order('father_name', { ascending: true, nullsFirst: false })
    .order('last_name', { ascending: true })
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

  // Keep grades + sections nested objects on the response so callers
  // that read s.grades?.name / s.sections?.name (notes page, dismissal
  // form, etc.) display correctly. Also expose flat grade_name/
  // section_name for callers that prefer those.
  const students = (data || []).map((s: any) => ({
    ...s,
    grade_name: s.grades?.name,
    grade_stage: s.grades?.stage,
    section_name: s.sections?.name,
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
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();

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

  // Allocate a collision-free device_uid via the database sequence (RPC).
  const { data: nextUid, error: uidError } = await supabase.rpc('next_device_uid');
  if (uidError || typeof nextUid !== 'number') {
    return NextResponse.json({ error: 'فشل في تخصيص معرّف الجهاز' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('students')
    .insert({ ...validatedData, device_uid: nextUid })
    .select()
    .single();

  if (error) {
    // Surface the actual Postgres error message so the admin can
    // diagnose: e.g. "duplicate key value violates unique constraint"
    // (student_id already exists), "violates foreign key constraint"
    // (section_id doesn't match), etc. A blanket "حدث خطأ" hid these
    // for too long.
    const msg = error.message || '';
    let userMsg = 'حدث خطأ أثناء إضافة الطالب';
    if (msg.toLowerCase().includes('duplicate') && msg.includes('student_id')) {
      userMsg = 'رقم الهوية مستخدم بالفعل لطالب آخر';
    } else if (msg.toLowerCase().includes('foreign key')) {
      userMsg = 'الصف أو الشعبة غير موجود في النظام';
    } else if (msg.toLowerCase().includes('row-level security')) {
      userMsg = 'لا تملك صلاحية إضافة طالب لهذه الشعبة';
    } else if (msg) {
      userMsg = `حدث خطأ: ${msg}`;
    }
    return NextResponse.json({ error: userMsg, details: msg }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
