import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';
import { sendMessageSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// GET — list messages addressed to me, sent by me, or broadcast to my role.
//   ?box=inbox|sent|archive|all   (default: inbox)
//   ?status=sent|read|archived
//   ?student_id=NUMERIC
//   ?thread_id=UUID
//   ?limit (default 100)
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const box = searchParams.get('box') || 'inbox';
  const status = searchParams.get('status');
  const studentId = searchParams.get('student_id');
  const threadId = searchParams.get('thread_id');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500);

  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from('internal_messages')
    .select(`
      id, thread_id, type, sender_id, recipient_id, recipient_role,
      student_id, subject, body, parent_message_id, status,
      read_at, created_at,
      students ( student_id, first_name, father_name, last_name,
        sections ( name, grades ( name ) )
      )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Box filter — RLS already enforces visibility, but we narrow further.
  if (box === 'inbox') {
    q = q.or(`recipient_id.eq.${ctx.userId},recipient_role.eq.${ctx.role}`);
    if (status !== 'archived') q = q.neq('status', 'archived');
  } else if (box === 'sent') {
    q = q.eq('sender_id', ctx.userId);
  } else if (box === 'archive') {
    q = q.eq('status', 'archived');
  }

  if (status) q = q.eq('status', status);
  if (studentId) q = q.eq('student_id', parseInt(studentId, 10));
  if (threadId) q = q.eq('thread_id', threadId);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: 'فشل جلب الرسائل: ' + error.message }, { status: 500 });
  }

  // Resolve sender + recipient display names in one batch.
  const userIds = Array.from(new Set([
    ...(data || []).map((r: any) => r.sender_id),
    ...(data || []).map((r: any) => r.recipient_id).filter(Boolean),
  ]));
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const admin = createAdminSupabaseClient();
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', userIds);
    for (const p of profiles || []) {
      if (p.full_name) nameMap.set(p.user_id, p.full_name);
    }
  }

  const flat = (data || []).map((r: any) => ({
    id: r.id,
    thread_id: r.thread_id,
    type: r.type,
    sender_id: r.sender_id,
    sender_name: nameMap.get(r.sender_id) ?? null,
    recipient_id: r.recipient_id,
    recipient_name: r.recipient_id ? (nameMap.get(r.recipient_id) ?? null) : null,
    recipient_role: r.recipient_role,
    student_id: r.student_id,
    student_code: r.students?.student_id ?? null,
    student_name: r.students
      ? [r.students.first_name, r.students.father_name, r.students.last_name].filter(Boolean).join(' ').trim()
      : null,
    student_grade: r.students?.sections?.grades?.name ?? null,
    student_section: r.students?.sections?.name ?? null,
    subject: r.subject,
    body: r.body,
    parent_message_id: r.parent_message_id,
    status: r.status,
    read_at: r.read_at,
    created_at: r.created_at,
    is_mine: r.sender_id === ctx.userId,
  }));

  return NextResponse.json({ data: flat }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — send a new message (admin/staff/teacher).
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  // super_admin always passes (school's root); otherwise must be admin/staff/teacher.
  if (!['super_admin', 'admin', 'staff', 'teacher'].includes(ctx.role)) {
    return NextResponse.json({ error: 'لا تملك صلاحية إرسال رسائل' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(sendMessageSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // If this is a reply, inherit thread_id from parent.
  let threadId: string | undefined;
  if (v.data.parent_message_id) {
    const { data: parent } = await supabase
      .from('internal_messages')
      .select('thread_id')
      .eq('id', v.data.parent_message_id)
      .maybeSingle();
    threadId = (parent?.thread_id as string) || undefined;
  }

  const insert: any = {
    type: v.data.parent_message_id ? 'reply' : v.data.type,
    sender_id: ctx.userId,
    recipient_id: v.data.recipient_id || null,
    recipient_role: v.data.recipient_role || null,
    student_id: v.data.student_id || null,
    subject: v.data.subject || null,
    body: v.data.body.trim(),
    parent_message_id: v.data.parent_message_id || null,
  };
  if (threadId) insert.thread_id = threadId;

  const { data, error } = await supabase
    .from('internal_messages')
    .insert(insert)
    .select('id, thread_id, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'فشل الإرسال: ' + error.message }, { status: 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}
