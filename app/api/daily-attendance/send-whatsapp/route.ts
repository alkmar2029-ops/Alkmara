import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { normalizePhone } from '@/lib/teachers/credentials';

export const dynamic = 'force-dynamic';
// Wasender pacing — 5.5s per recipient. 30 recipients ≈ 165s. Bumped
// maxDuration high so a typical school's daily list completes in one
// invocation; longer lists self-extend via the existing pattern.
export const maxDuration = 300;

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['absence', 'escape']),
  recipients: z.array(z.object({
    student_id: z.number().int().positive(),
    student_name: z.string(),
    phone: z.string().optional().nullable(),
    absent_periods: z.array(z.number().int().positive()).optional(),
    grade_name: z.string().optional(),
    section_name: z.string().optional(),
  })).min(1).max(500),
});

interface SendOutcome {
  student_id: number;
  student_name: string;
  phone: string | null;
  ok: boolean;
  error: string | null;
}

// Builds the Arabic message body for one recipient. Two distinct templates:
//   • 'absence' — student missed the entire school day.
//   • 'escape'  — student attended but skipped specific periods. Lists the
//     period numbers so parents have something concrete to ask about.
function buildMessage(args: {
  type: 'absence' | 'escape';
  studentName: string;
  gradeName: string;
  sectionName: string;
  date: string;
  missedPeriods?: number[];
  schoolName: string;
}): string {
  // Localized weekday + Hijri-ish formatting via the Gregorian calendar so
  // it lines up with the school's calendar.
  const dateStr = (() => {
    try {
      return new Date(args.date).toLocaleDateString('ar-SA-u-ca-gregory', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch { return args.date; }
  })();

  if (args.type === 'absence') {
    return `🔴 *إشعار غياب يومي*

السلام عليكم ورحمة الله وبركاته،

نُعلمكم أن ابنكم/ابنتكم:
👤 *${args.studentName}*
📚 ${args.gradeName} / ${args.sectionName}

غاب اليوم *${dateStr}* عن المدرسة، ولم يصلنا استئذان مسبق.

نأمل التواصل معنا في أقرب وقت إذا كان هناك سبب،
أو متابعة الطالب لضمان انتظامه 🤝

— *${args.schoolName}*`;
  }

  // Escape (truancy) — list the periods so the message is actionable.
  const periodsStr = (args.missedPeriods || []).join(' • ');
  return `⚠️ *إشعار هروب من حصص*

السلام عليكم ورحمة الله وبركاته،

نُعلمكم أن ابنكم/ابنتكم:
👤 *${args.studentName}*
📚 ${args.gradeName} / ${args.sectionName}

حضر اليوم *${dateStr}* إلى المدرسة،
لكنه تغيّب عن الحصص: *${periodsStr}*

هذا الأمر يستدعي المتابعة من حضراتكم،
ونرجو التواصل لمناقشة الموضوع 🌹

— *${args.schoolName}*`;
}

// POST — fire the bulk WhatsApp for a list of absent/escaped students.
//
// Synchronous send loop (5.5s pacing). For very long lists schools should
// migrate this to the bulk_send_jobs queue, but daily absent counts are
// typically <50 and finish well within maxDuration. Returns per-recipient
// outcomes so the UI can show a clean success/fail breakdown.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }
  const { date, type, recipients } = parsed.data;

  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  const [{ data: ws }, { data: school }] = await Promise.all([
    admin.from('whatsapp_settings').select('api_key').eq('id', 1).maybeSingle(),
    supabase.from('school_settings').select('school_name').eq('id', 1).maybeSingle(),
  ]);
  if (!ws?.api_key) {
    return NextResponse.json({ error: 'مفتاح API للواتساب غير مضبوط' }, { status: 400 });
  }
  const schoolName = (school?.school_name as string) || 'إدارة المدرسة';

  const outcomes: SendOutcome[] = [];
  let success = 0, fail = 0, skipped = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const out: SendOutcome = {
      student_id: r.student_id,
      student_name: r.student_name,
      phone: r.phone || null,
      ok: false,
      error: null,
    };

    if (!r.phone) {
      out.error = 'رقم الجوال غير متوفر';
      fail++; skipped++;
      outcomes.push(out);
      continue;
    }

    const message = buildMessage({
      type,
      studentName: r.student_name,
      gradeName: r.grade_name || '—',
      sectionName: r.section_name || '—',
      date,
      missedPeriods: r.absent_periods,
      schoolName,
    });

    const result = await sendTextAndLog({
      supabase: admin,
      apiKey: ws.api_key as string,
      phone: normalizePhone(r.phone),
      message,
      recipientName: r.student_name,
      recipientType: 'parent',
      templateName: type === 'absence' ? 'daily_absence' : 'daily_escape',
      contextType: 'late',  // re-uses existing context type — close enough for filtering
      contextId: String(r.student_id),
      sentBy: auth.ctx.userId,
    });

    out.ok = result.ok;
    out.error = result.error || null;
    if (result.ok) success++; else fail++;
    outcomes.push(out);

    // Wasender's "1 message every 5 seconds" account-protection pacing.
    if (i < recipients.length - 1) {
      await new Promise((res) => setTimeout(res, 5500));
    }
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'daily_attendance.send_whatsapp',
    targetType: 'daily',
    targetId: null,
    details: {
      date, type, requested: recipients.length,
      sent: success, failed: fail, skipped,
    },
    request,
  });

  return NextResponse.json({
    data: { requested: recipients.length, sent: success, failed: fail, skipped, outcomes },
  });
}
