import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { normalizePhone } from '@/lib/teachers/credentials';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const remindSchema = z.object({
  teacher_user_id: z.string().uuid(),
  section_id: z.number().int().positive(),
  period_id: z.number().int().positive(),
  attendance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  custom_message: z.string().max(2000).optional(),
});

// POST — fire a "missing-attendance" reminder to a specific teacher.
//
// Sends BOTH channels in one call so the admin clicks once:
//   1. internal_messages row (in-app inbox notification)
//   2. WhatsApp message (using the teacher's phone from user_profiles)
//
// Both are best-effort independently — if WhatsApp fails the internal
// message still goes through, and vice versa. Returns granular status so
// the UI can show "تم الإرسال داخلياً، فشل واتساب" if needed.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const parsed = remindSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }
  const v = parsed.data;

  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  // Look up the context the message will reference: teacher name + phone,
  // section/grade names, period number/name, school name. One round trip
  // each — cheap.
  const [teacherRes, sectionRes, periodRes, settingsRes] = await Promise.all([
    admin
      .from('user_profiles')
      .select('user_id, full_name, phone')
      .eq('user_id', v.teacher_user_id)
      .eq('role', 'teacher')
      .maybeSingle(),
    supabase
      .from('sections')
      .select('id, name, grades ( name )')
      .eq('id', v.section_id)
      .maybeSingle(),
    supabase
      .from('periods')
      .select('id, number, name')
      .eq('id', v.period_id)
      .maybeSingle(),
    supabase
      .from('school_settings')
      .select('school_name')
      .eq('id', 1)
      .maybeSingle(),
  ]);

  const teacher = teacherRes.data as { user_id: string; full_name: string | null; phone: string | null } | null;
  if (!teacher) {
    return NextResponse.json({ error: 'المعلم غير موجود' }, { status: 404 });
  }
  const section = sectionRes.data as any;
  const period = periodRes.data as any;
  if (!section || !period) {
    return NextResponse.json({ error: 'الشعبة أو الحصة غير موجودة' }, { status: 404 });
  }

  const teacherName = teacher.full_name || 'الأستاذ الفاضل';
  const gradeName = section.grades?.name || '—';
  const sectionName = section.name || '—';
  const periodNumber = period.number;
  const periodName = period.name || `الحصة ${periodNumber}`;
  const schoolName = (settingsRes.data?.school_name as string) || '';

  // Build a friendly default body. The admin can override via custom_message
  // for tone-sensitive cases (e.g. repeat offender vs. first reminder).
  const defaultBody = `🔔 تذكير ودّي

السلام عليكم أ. ${teacherName}،

نلاحظ أنه لم يتم تسجيل حضور:
📚 الشعبة: ${gradeName} / ${sectionName}
⏰ الحصة: ${periodNumber} (${periodName})
📅 التاريخ: ${v.attendance_date}

نأمل تسجيلها في أقرب وقت من بوابة المعلم 🌹
${schoolName ? `\n— ${schoolName}` : ''}`;

  const messageBody = (v.custom_message && v.custom_message.trim()) || defaultBody;

  // 1. Internal message — uses the same `internal_messages` table as the
  // existing in-app inbox so the teacher sees a 🔔 badge.
  const { error: msgErr } = await supabase
    .from('internal_messages')
    .insert({
      type: 'general',
      sender_id: auth.ctx.userId,
      recipient_id: teacher.user_id,
      recipient_role: null,
      subject: `تذكير: تسجيل حضور الحصة ${periodNumber} — ${gradeName}/${sectionName}`,
      body: messageBody,
    });
  const internalSent = !msgErr;
  if (msgErr) {
    console.error('reminder internal message failed:', msgErr.message);
  }

  // 2. WhatsApp — best-effort. Skip if the teacher has no phone on file.
  let whatsappSent = false;
  let whatsappError: string | null = null;
  if (teacher.phone) {
    const { data: ws } = await admin
      .from('whatsapp_settings')
      .select('api_key')
      .eq('id', 1)
      .maybeSingle();
    if (ws?.api_key) {
      const result = await sendTextAndLog({
        supabase: admin,
        apiKey: ws.api_key as string,
        phone: normalizePhone(teacher.phone),
        message: messageBody,
        recipientName: teacherName,
        recipientType: 'teacher',
        templateName: 'attendance_reminder',
        contextType: 'manual',
        contextId: null,
        sentBy: auth.ctx.userId,
      });
      whatsappSent = result.ok;
      whatsappError = result.error || null;
    } else {
      whatsappError = 'مفتاح API للواتساب غير مضبوط';
    }
  } else {
    whatsappError = 'لا يوجد رقم جوال للمعلم';
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'period_attendance.remind',
    targetType: 'teacher',
    targetId: v.teacher_user_id,
    details: {
      section_id: v.section_id,
      period_id: v.period_id,
      attendance_date: v.attendance_date,
      internal_sent: internalSent,
      whatsapp_sent: whatsappSent,
    },
    request,
  });

  return NextResponse.json({
    data: {
      internal_sent: internalSent,
      whatsapp_sent: whatsappSent,
      whatsapp_error: whatsappError,
      teacher_name: teacherName,
    },
  });
}
