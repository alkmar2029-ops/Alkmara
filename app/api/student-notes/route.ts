import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { createStudentNotesSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// GET — list notes with optional filters. Joined with students/grades/sections
// so the table view doesn't need follow-up queries.
//
// Query params:
//   batch_id      — return all notes from a single save operation (used by the
//                   print page right after recording)
//   student_id    — history for one student
//   from / to     — date range YYYY-MM-DD (recorded_at)
//   type          — positive | negative
//   section_id    — filter by section
//   limit         — default 100, max 500
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { searchParams } = new URL(request.url);

  const batchId = searchParams.get('batch_id');
  const studentId = searchParams.get('student_id');
  const sectionId = searchParams.get('section_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const type = searchParams.get('type');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500);

  let query = supabase
    .from('student_notes')
    .select(`
      id, student_id, template_id, text, type, category, source,
      recorded_by, recorded_at, batch_id, whatsapp_sent_at, printed_at,
      students!inner ( id, student_id, first_name, father_name, last_name, section_id,
        sections ( id, name, grades ( id, name ) )
      )
    `)
    .order('recorded_at', { ascending: false })
    .limit(limit);

  if (batchId) query = query.eq('batch_id', batchId);
  if (studentId) query = query.eq('student_id', parseInt(studentId, 10));
  if (sectionId) query = query.eq('students.section_id', parseInt(sectionId, 10));
  if (type === 'positive' || type === 'negative') query = query.eq('type', type);
  if (from) query = query.gte('recorded_at', `${from}T00:00:00.000Z`);
  if (to) query = query.lte('recorded_at', `${to}T23:59:59.999Z`);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في جلب الملاحظات' }, { status: 500 });
  }

  // Flatten joined fields for the UI.
  const flat = (data || []).map((r: any) => ({
    id: r.id,
    student_id: r.student_id,
    template_id: r.template_id,
    text: r.text,
    type: r.type,
    category: r.category,
    source: r.source,
    recorded_by: r.recorded_by,
    recorded_at: r.recorded_at,
    batch_id: r.batch_id,
    whatsapp_sent_at: r.whatsapp_sent_at,
    printed_at: r.printed_at,
    student_code: r.students?.student_id ?? null,
    student_name: r.students
      ? [r.students.first_name, r.students.father_name, r.students.last_name].filter(Boolean).join(' ')
      : null,
    grade_name: r.students?.sections?.grades?.name ?? null,
    section_name: r.students?.sections?.name ?? null,
  }));

  return NextResponse.json(
    { data: flat },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// POST — bulk create notes. Returns batch_id so the client can immediately
// open the print page filtered by that batch.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const v = validateBody(createStudentNotesSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const batchId = randomUUID();
  const now = new Date().toISOString();

  const rows = v.data.notes.map((n) => ({
    student_id: n.student_id,
    template_id: n.template_id ?? null,
    text: n.text.trim(),
    type: n.type,
    category: n.category ?? 'general',
    source: n.source,
    recorded_by: auth.ctx.userId,
    recorded_at: now,
    batch_id: batchId,
  }));

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('student_notes')
    .insert(rows)
    .select('id, student_id');

  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في حفظ الملاحظات: ' + error.message }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'student_notes.create',
    targetType: 'student_notes_batch',
    targetId: batchId,
    details: { count: rows.length },
    request,
  });

  return NextResponse.json({
    data: {
      batch_id: batchId,
      count: data?.length ?? rows.length,
      ids: data?.map((d) => d.id) ?? [],
    },
  }, { status: 201 });
}
