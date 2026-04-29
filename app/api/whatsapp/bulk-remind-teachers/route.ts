import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { renderTemplate } from '@/lib/whatsapp/template';
import { normalizePhone } from '@/lib/teachers/credentials';

export const dynamic = 'force-dynamic';
// Wasender enforces 1 message per 5 seconds. 30 teachers × 5.5s ≈ 165s.
// Default Vercel timeout is 10s (Hobby) / 60s (Pro). 300s extends to the
// Pro maximum so this route can complete a typical school's roster in
// one shot. Hobby plans will still hit their 10s wall — schools running
// on Hobby should chunk via the dashboard (one section at a time).
export const maxDuration = 300;

const schema = z.object({
  message_template: z.string().min(10, 'الرسالة قصيرة جداً').max(2000),
  // 'all' (default) sends to every active teacher with a phone on file.
  // 'specific' takes an explicit list of teacher user_ids.
  scope: z.enum(['all', 'specific']).default('all'),
  teacher_user_ids: z.array(z.string().uuid()).optional(),
  // Mirror to the in-app inbox so teachers see the reminder there too.
  also_internal: z.boolean().optional().default(false),
  // Subject for the optional internal message (templates with {{teacher_name}}
  // are NOT supported in subjects — keep it generic).
  internal_subject: z.string().max(200).optional(),
});

interface Outcome {
  user_id: string;
  teacher_name: string;
  phone: string | null;
  ok: boolean;
  error: string | null;
}

// POST — send a personalized WhatsApp reminder to a batch of teachers.
//
// Each message is rendered through the existing template engine using the
// recipient's full_name as {{teacher_name}}, so admins can write one body
// and the loop produces N personalized messages.
//
// Sequenced sends with 5.5s spacing — same pacing the rest of the system
// uses for Wasender. Internal messages are mirrored optionally; their
// inserts run in parallel batches because the DB doesn't have the same
// rate limit.
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
  const v = parsed.data;

  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  // 1. Resolve target teacher list.
  let teachersQuery = admin
    .from('user_profiles')
    .select('user_id, full_name, phone, is_active')
    .eq('role', 'teacher')
    .eq('is_active', true);
  if (v.scope === 'specific') {
    if (!v.teacher_user_ids || v.teacher_user_ids.length === 0) {
      return NextResponse.json({ error: 'يجب تحديد المعلمين المستهدفين' }, { status: 400 });
    }
    teachersQuery = teachersQuery.in('user_id', v.teacher_user_ids);
  }
  const { data: teachers, error: tErr } = await teachersQuery;
  if (tErr || !teachers) {
    return NextResponse.json({ error: 'فشل جلب قائمة المعلمين' }, { status: 500 });
  }
  if (teachers.length === 0) {
    return NextResponse.json({ error: 'لا يوجد معلمون مستهدفون' }, { status: 404 });
  }

  // 2. Pull WhatsApp creds + school settings (one round trip each).
  const [{ data: ws }, { data: settings }] = await Promise.all([
    supabase.from('whatsapp_settings').select('api_key').eq('id', 1).maybeSingle(),
    supabase.from('school_settings').select('school_name, principal_name').eq('id', 1).maybeSingle(),
  ]);
  if (!ws?.api_key) {
    return NextResponse.json(
      { error: 'مفتاح API للواتساب غير مضبوط — يجب حفظه في إعدادات WhatsApp أولاً' },
      { status: 400 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const dateStr = (() => {
    try { return new Date().toLocaleDateString('ar-SA-u-ca-gregory'); }
    catch { return today; }
  })();

  // 3. Sequential WhatsApp send with rate-limit pacing.
  const outcomes: Outcome[] = [];
  let success = 0;
  let fail = 0;

  for (let i = 0; i < teachers.length; i++) {
    const t = teachers[i] as { user_id: string; full_name: string | null; phone: string | null };
    const teacherName = t.full_name || 'الأستاذ الفاضل';

    const out: Outcome = {
      user_id: t.user_id,
      teacher_name: teacherName,
      phone: t.phone || null,
      ok: false,
      error: null,
    };

    if (!t.phone) {
      out.error = 'رقم الجوال غير متوفر';
      fail++;
      outcomes.push(out);
      continue;
    }

    const message = renderTemplate(v.message_template, {
      teacher_name: teacherName,
      school_name: (settings?.school_name as string) || '',
      principal_name: (settings?.principal_name as string) || '',
      date: dateStr,
    });

    const result = await sendTextAndLog({
      supabase: admin,
      apiKey: ws.api_key as string,
      phone: normalizePhone(t.phone),
      message,
      recipientName: teacherName,
      recipientType: 'teacher',
      templateName: 'teacher_bulk_reminder',
      contextType: 'manual',
      contextId: null,
      sentBy: auth.ctx.userId,
    });

    out.ok = result.ok;
    out.error = result.error || null;
    if (result.ok) success++; else fail++;
    outcomes.push(out);

    // Rate-limit pacing — skip after the last send.
    if (i < teachers.length - 1) {
      await new Promise((res) => setTimeout(res, 5500));
    }
  }

  // 4. Mirror to in-app inbox if requested. These are cheap DB inserts; do
  // them after the WhatsApp loop so the slow path isn't blocked by them.
  if (v.also_internal) {
    const subject = v.internal_subject?.trim() || 'تذكير من الإدارة';
    const internalRows = teachers.map((t: any) => {
      const teacherName = t.full_name || 'الأستاذ الفاضل';
      const messageBody = renderTemplate(v.message_template, {
        teacher_name: teacherName,
        school_name: (settings?.school_name as string) || '',
        principal_name: (settings?.principal_name as string) || '',
        date: dateStr,
      });
      return {
        type: 'general',
        sender_id: auth.ctx.userId,
        recipient_id: t.user_id,
        subject,
        body: messageBody,
      };
    });
    // Best-effort — don't fail the whole call if the mirror insert fails.
    const { error: mirrorErr } = await supabase.from('internal_messages').insert(internalRows);
    if (mirrorErr) console.error('bulk-remind internal mirror failed:', mirrorErr.message);
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.bulk_remind_teachers',
    targetType: 'teachers',
    targetId: null,
    details: {
      scope: v.scope,
      requested: teachers.length,
      sent: success,
      failed: fail,
      also_internal: !!v.also_internal,
    },
    request,
  });

  return NextResponse.json({
    data: {
      total: teachers.length,
      sent: success,
      failed: fail,
      outcomes,
    },
  });
}
