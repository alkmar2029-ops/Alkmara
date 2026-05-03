import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { validateBody } from '@/lib/validations/schemas';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { renderTemplate } from '@/lib/whatsapp/template';

export const dynamic = 'force-dynamic';

const schema = z.object({
  session_id: z.number().int().positive(),
  // Optional: only send to specific statuses (default: absent only)
  statuses: z.array(z.enum(['absent', 'late', 'excused'])).optional(),
});

const STATUS_LABEL: Record<string, string> = {
  absent: 'غائب',
  late: 'متأخر',
  excused: 'مستأذن',
};

interface SendOutcome {
  student_id: number;
  student_name: string;
  phone: string | null;
  status: string;
  ok: boolean;
  error: string | null;
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(schema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const targetStatuses = v.data.statuses ?? ['absent'];

  // 1. Validate session + load context.
  const { data: session, error: sErr } = await supabase
    .from('period_sessions')
    .select(`
      id, attendance_date, recorded_by,
      sections ( name, grades ( name ) ),
      periods ( number, name )
    `)
    .eq('id', v.data.session_id)
    .maybeSingle();
  if (sErr || !session) {
    return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 });
  }

  // 2. Pull WhatsApp creds.
  const { data: ws } = await supabase
    .from('whatsapp_settings').select('api_key').eq('id', 1).maybeSingle();
  if (!ws?.api_key) {
    return NextResponse.json({ error: 'يجب حفظ مفتاح API في إعدادات WhatsApp أولاً' }, { status: 400 });
  }

  // 3. Pull template + school settings + teacher name (one round trip).
  const [{ data: tmpl }, { data: settingsRow }, { data: profile }] = await Promise.all([
    supabase.from('message_templates').select('body, is_active').eq('name', 'period_absence').maybeSingle(),
    supabase.from('school_settings').select('school_name, principal_name').eq('id', 1).maybeSingle(),
    session.recorded_by
      ? supabase.from('user_profiles').select('full_name').eq('user_id', session.recorded_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!tmpl?.body || tmpl.is_active === false) {
    return NextResponse.json({ error: 'قالب period_absence غير موجود أو معطّل' }, { status: 404 });
  }

  // 4. Pull absences with student info.
  const { data: absences } = await supabase
    .from('period_absences')
    .select(`
      status, notes,
      students!inner ( id, student_id, first_name, father_name, last_name, phone )
    `)
    .eq('session_id', session.id)
    .in('status', targetStatuses);

  if (!absences || absences.length === 0) {
    return NextResponse.json({ error: 'لا يوجد طلاب بحالة الغياب المختارة' }, { status: 404 });
  }

  // 5. Compose context shared by every message.
  const dateStr = (() => {
    try { return new Date(session.attendance_date).toLocaleDateString('ar-SA-u-ca-gregory'); }
    catch { return session.attendance_date as string; }
  })();
  const teacherName = (profile?.full_name as string)
    || (auth.ctx.role === 'admin' || auth.ctx.role === 'super_admin' || auth.ctx.role === 'staff' ? 'إدارة المدرسة' : 'المعلم');

  // 6. Send sequentially with rate-limit pacing.
  const outcomes: SendOutcome[] = [];
  let success = 0, fail = 0;

  for (let i = 0; i < absences.length; i++) {
    const a: any = absences[i];
    const stu = a.students;
    const fullName = [stu?.first_name, stu?.father_name, stu?.last_name].filter(Boolean).join(' ').trim();
    const phone: string | null = stu?.phone || null;

    const out: SendOutcome = {
      student_id: stu?.id, student_name: fullName, phone, status: a.status,
      ok: false, error: null,
    };

    if (!phone) {
      out.error = 'رقم الجوال غير متوفر';
      fail++; outcomes.push(out); continue;
    }

    const message = renderTemplate(tmpl.body, {
      student_name: fullName,
      grade: (session as any).sections?.grades?.name || '',
      section: (session as any).sections?.name || '',
      date: dateStr,
      phone,
      school_name: (settingsRow?.school_name as string) || '',
      principal_name: (settingsRow?.principal_name as string) || '',
      teacher_name: teacherName,
      period_name: (session as any).periods?.name || '',
      period_number: (session as any).periods?.number || '',
      absence_status: STATUS_LABEL[a.status] || a.status,
    });

    const result = await sendTextAndLog({
      supabase, apiKey: ws.api_key, phone, message,
      recipientName: fullName,
      recipientType: 'parent',
      templateName: 'period_absence',
      contextType: 'late',
      contextId: session.id,
      sentBy: auth.ctx.userId,
    });
    out.ok = result.ok;
    out.error = result.error || null;
    if (result.ok) success++; else fail++;
    outcomes.push(out);

    // Rate-limit pacing.
    if (i < absences.length - 1) {
      await new Promise((res) => setTimeout(res, 5500));
    }
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.send_period_absences',
    targetType: 'period_session',
    targetId: session.id,
    details: { requested: absences.length, sent: success, failed: fail, statuses: targetStatuses },
    request,
  });

  return NextResponse.json({
    data: { requested: absences.length, sent: success, failed: fail, outcomes },
  });
}
