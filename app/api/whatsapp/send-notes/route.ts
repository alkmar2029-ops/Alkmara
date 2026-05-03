import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { sendNotesWhatsappSchema, validateBody } from '@/lib/validations/schemas';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { renderTemplate } from '@/lib/whatsapp/template';
import { canTeachersSendWhatsapp, TEACHER_CANNOT_SEND_WHATSAPP_ERROR } from '@/lib/whatsapp/policy';

export const dynamic = 'force-dynamic';

interface SendOutcome {
  note_id: number;
  student_code: string | null;
  student_name: string;
  phone: string | null;
  type: 'positive' | 'negative';
  ok: boolean;
  error: string | null;
}

export async function POST(request: NextRequest) {
  // Admin and staff are always allowed. Teachers are allowed only when
  // the admin has flipped the precautionary toggle ON in /dashboard/whatsapp;
  // we check the flag below so the API is the single source of truth.
  const auth = await requireRole(['admin', 'staff', 'teacher']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(sendNotesWhatsappSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // Toggle gate for teacher role.
  if (auth.ctx.role === 'teacher') {
    if (!(await canTeachersSendWhatsapp(supabase))) {
      return NextResponse.json({ error: TEACHER_CANNOT_SEND_WHATSAPP_ERROR }, { status: 403 });
    }
  }

  // 1. WhatsApp credentials. We use the service-role (admin) client here
  // because whatsapp_settings has admin-only RLS — teachers can't read
  // it directly, but they ARE allowed to send (gated by the teacher policy
  // toggle above). The API key never leaves the server, so escalating
  // privilege only for this read is safe.
  const adminClient = createAdminSupabaseClient();
  const { data: ws } = await adminClient
    .from('whatsapp_settings')
    .select('api_key')
    .eq('id', 1)
    .maybeSingle();
  if (!ws?.api_key) {
    return NextResponse.json({ error: 'يجب حفظ مفتاح API في إعدادات WhatsApp أولاً' }, { status: 400 });
  }

  // 2. Load both note templates (positive + negative) and the school settings
  // — we only fetch once per request rather than per-note.
  const [{ data: tmplRows }, { data: settingsRow }, { data: profile }] = await Promise.all([
    supabase
      .from('message_templates')
      .select('name, body, is_active')
      .in('name', ['note_positive', 'note_negative']),
    supabase
      .from('school_settings')
      .select('school_name, principal_name')
      .eq('id', 1)
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', auth.ctx.userId)
      .maybeSingle(),
  ]);

  const tmplByName = new Map<string, { body: string; is_active: boolean }>();
  for (const t of tmplRows || []) tmplByName.set(t.name as string, t as any);

  // Sender label shown in WhatsApp messages. We avoid leaking emails into
  // parent-facing messages — fall back to a generic admin/teacher label.
  const teacherName =
    (profile?.full_name as string)
    || (auth.ctx.role === 'admin' || auth.ctx.role === 'super_admin' || auth.ctx.role === 'staff' ? 'إدارة المدرسة' : 'المعلم');

  // 3. Load notes — by batch or by ids — joined with student/grade/section.
  let q = supabase
    .from('student_notes')
    .select(`
      id, text, type, category, recorded_at, whatsapp_sent_at,
      students!inner ( student_id, first_name, father_name, last_name, phone,
        sections ( name, grades ( name ) )
      )
    `);
  if (v.data.batch_id) q = q.eq('batch_id', v.data.batch_id);
  if (v.data.note_ids && v.data.note_ids.length > 0) q = q.in('id', v.data.note_ids);

  const { data: notes, error } = await q;
  if (error) {
    return NextResponse.json({ error: 'فشل جلب الملاحظات' }, { status: 500 });
  }
  if (!notes || notes.length === 0) {
    return NextResponse.json({ error: 'لا توجد ملاحظات للإرسال' }, { status: 404 });
  }

  // 4. Send sequentially with pacing — same pattern as send-late.
  const outcomes: SendOutcome[] = [];
  let success = 0, fail = 0, skipped = 0;
  const sentNoteIds: number[] = [];

  for (let i = 0; i < notes.length; i++) {
    const n: any = notes[i];
    const student = n.students;
    const fullName = [student?.first_name, student?.father_name, student?.last_name].filter(Boolean).join(' ').trim();
    const phone: string | null = student?.phone || null;
    const tmplName = n.type === 'positive' ? 'note_positive' : 'note_negative';
    const tmpl = tmplByName.get(tmplName);

    const out: SendOutcome = {
      note_id: n.id,
      student_code: student?.student_id ?? null,
      student_name: fullName,
      phone,
      type: n.type,
      ok: false,
      error: null,
    };

    if (!tmpl?.body) {
      out.error = `القالب ${tmplName} غير موجود`;
      fail++; outcomes.push(out); continue;
    }
    if (tmpl.is_active === false) {
      out.error = `القالب ${tmplName} غير مفعّل`;
      skipped++; outcomes.push(out); continue;
    }
    if (!phone) {
      out.error = 'رقم الجوال غير متوفر';
      fail++; outcomes.push(out); continue;
    }

    const dateStr = (() => {
      try {
        return new Date(n.recorded_at).toLocaleDateString('ar-SA-u-ca-gregory');
      } catch { return n.recorded_at as string; }
    })();

    const message = renderTemplate(tmpl.body, {
      student_name: fullName,
      grade: student?.sections?.grades?.name || '',
      section: student?.sections?.name || '',
      date: dateStr,
      phone,
      school_name: (settingsRow?.school_name as string) || '',
      principal_name: (settingsRow?.principal_name as string) || '',
      teacher_name: teacherName,
      note_text: n.text,
      note_emoji: n.type === 'positive' ? '🌟' : '⚠️',
      note_type: n.type === 'positive' ? 'إيجابية' : 'سلبية',
      note_category: n.category || '',
    });

    const result = await sendTextAndLog({
      supabase, apiKey: ws.api_key, phone, message,
      recipientName: fullName,
      recipientType: 'parent',
      templateName: tmplName,
      contextType: 'note',
      contextId: n.id,
      sentBy: auth.ctx.userId,
    });
    out.ok = result.ok;
    out.error = result.error || null;
    if (result.ok) {
      success++;
      sentNoteIds.push(n.id);
    } else {
      fail++;
    }
    outcomes.push(out);

    // Pace 5.5s between sends — Wasender's "Account Protection" rate limits
    // to 1 message every 5 seconds; we add a small buffer.
    if (i < notes.length - 1) {
      await new Promise((res) => setTimeout(res, 5500));
    }
  }

  // 5. Mark sent notes — bulk update
  if (sentNoteIds.length > 0) {
    await supabase
      .from('student_notes')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .in('id', sentNoteIds);
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.send_notes',
    targetType: v.data.batch_id ? 'note_batch' : 'note_ids',
    targetId: v.data.batch_id ?? null,
    details: { requested: notes.length, sent: success, failed: fail, skipped },
    request,
  });

  return NextResponse.json({
    data: {
      requested: notes.length,
      sent: success,
      failed: fail,
      skipped,
      outcomes,
    },
  });
}
