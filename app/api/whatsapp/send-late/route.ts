import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, sendLateBulkSchema } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { sendText } from '@/lib/whatsapp/wasender-client';
import { renderTemplate, formatPunchDateTime } from '@/lib/whatsapp/template';

export const dynamic = 'force-dynamic';

interface SendOutcome {
  attendance_id: number;
  student_code: string | null;
  student_name: string;
  phone: string | null;
  ok: boolean;
  error: string | null;
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const validation = validateBody(sendLateBulkSchema, body);
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });

  const { attendance_ids, template_name } = validation.data;
  const supabase = await createServerSupabaseClient();

  // 1. Load WhatsApp settings (api_key required)
  const { data: ws } = await supabase
    .from('whatsapp_settings')
    .select('api_key, status')
    .eq('id', 1)
    .maybeSingle();
  if (!ws?.api_key) {
    return NextResponse.json({ error: 'يجب حفظ مفتاح API في إعدادات WhatsApp أولاً' }, { status: 400 });
  }

  // 2. Load template
  const { data: tmpl } = await supabase
    .from('message_templates')
    .select('body, is_active')
    .eq('name', template_name)
    .maybeSingle();
  if (!tmpl?.body) {
    return NextResponse.json({ error: 'القالب غير موجود' }, { status: 404 });
  }
  if (tmpl.is_active === false) {
    return NextResponse.json({ error: 'القالب غير مفعّل' }, { status: 400 });
  }

  // 3. Load the attendance rows + joined student/grade/section
  const { data: rows, error } = await supabase
    .from('attendance_records')
    .select(`
      id, attendance_date, punch_time, minutes_late,
      students!inner(student_id, first_name, father_name, last_name, phone, grades(name), sections(name))
    `)
    .in('id', attendance_ids);
  if (error) return NextResponse.json({ error: 'فشل جلب سجلات الحضور' }, { status: 400 });

  // 4. Send sequentially with a small delay between calls — avoids tripping
  // any aggressive rate limit on the WasenderAPI side. (16 req/min is typical.)
  const outcomes: SendOutcome[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const r of rows || []) {
    const student: any = r.students;
    const fullName = [student?.first_name, student?.father_name, student?.last_name].filter(Boolean).join(' ').trim();
    const phone: string | null = student?.phone || null;
    const { date, time } = formatPunchDateTime(r.punch_time);

    const out: SendOutcome = {
      attendance_id: r.id,
      student_code: student?.student_id ?? null,
      student_name: fullName,
      phone,
      ok: false,
      error: null,
    };

    if (!phone) {
      out.error = 'رقم الجوال غير متوفر';
      failCount++;
      outcomes.push(out);
      continue;
    }

    const message = renderTemplate(tmpl.body, {
      student_name: fullName,
      grade: student?.grades?.name,
      section: student?.sections?.name,
      date: date || r.attendance_date,
      punch_time: time || r.punch_time || '',
      minutes_late: r.minutes_late ?? 0,
      phone,
    });

    const result = await sendText(ws.api_key, phone, message);
    out.ok = result.ok;
    out.error = result.error || null;
    if (result.ok) successCount++; else failCount++;
    outcomes.push(out);

    // Small pacing delay between sends (skipped on last one).
    if (r !== (rows || [])[rows!.length - 1]) {
      await new Promise((res) => setTimeout(res, 400));
    }
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.send_late_bulk',
    targetType: 'attendance_records',
    details: {
      requested: attendance_ids.length,
      sent: successCount,
      failed: failCount,
      template: template_name,
    },
    request,
  });

  return NextResponse.json({
    data: {
      requested: attendance_ids.length,
      sent: successCount,
      failed: failCount,
      outcomes,
    },
  });
}
