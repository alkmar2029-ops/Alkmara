import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { isTeacherWhatsappEnabled, TEACHER_WHATSAPP_DISABLED_ERROR } from '@/lib/whatsapp/policy';
import { todayInSchoolTz } from '@/lib/utils/school-time';

export const dynamic = 'force-dynamic';

// Recommended ban-prevention pacing for parent broadcasts.
// • 6000ms base + ±1500ms jitter → effective 4.5s–7.5s per send,
//   variable enough that Wasender's "constant rate" detector doesn't
//   fire.
// • Cooldown of 60s every 50 successful sends — breaks the pattern
//   completely so an external observer sees us as bursty/normal rather
//   than a steady firehose.
// 1000 messages ≈ (6 × 1000) + (60 × 20 cooldowns) ≈ 7200s = 2 hours.
const PARENT_PACING_MS = 6_000;
const PARENT_JITTER_MS = 1_500;
const PARENT_BATCH_SIZE = 50;
const PARENT_BATCH_COOLDOWN_MS = 60_000;

const schema = z.object({
  message_template: z.string().min(10, 'الرسالة قصيرة جداً').max(2000),
  audience: z.enum(['all', 'grade', 'section', 'students']).default('all'),
  grade_id: z.number().int().positive().optional().nullable(),
  section_id: z.number().int().positive().optional().nullable(),
  student_ids: z.array(z.number().int().positive()).optional(),
  // ISO-8601 timestamp; null/missing = send immediately.
  scheduled_for: z.string().datetime({ offset: true }).optional().nullable(),
  // Set true to skip the time-of-day warning (admin acknowledged it).
  acknowledge_school_hours: z.boolean().optional().default(false),
});

// School hours in Asia/Riyadh — bulk parent campaigns ideally run
// AFTER these so they don't compete with teacher-driven WhatsApp
// (notes, late notifications, dismissals) for Wasender bandwidth.
const SCHOOL_HOURS_START = 7;   // 7am
const SCHOOL_HOURS_END = 14;    // 2pm

/** Returns the current hour in Asia/Riyadh. */
function currentRiyadhHour(): number {
  // Intl gives us "HH:mm" in the chosen timezone; parse the hour.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', hour12: false, timeZone: 'Asia/Riyadh',
  });
  const parts = fmt.formatToParts(new Date());
  const hh = parts.find((p) => p.type === 'hour')?.value || '0';
  return parseInt(hh, 10);
}

/** Resolve the recipient list (id, name, phone) for the given audience. */
async function resolveRecipients(admin: ReturnType<typeof createAdminSupabaseClient>, v: z.infer<typeof schema>) {
  let q = admin
    .from('students')
    .select('id, first_name, father_name, last_name, phone')
    .eq('is_active', true);

  if (v.audience === 'grade' && v.grade_id)   q = q.eq('grade_id', v.grade_id);
  if (v.audience === 'section' && v.section_id) q = q.eq('section_id', v.section_id);
  if (v.audience === 'students' && v.student_ids && v.student_ids.length > 0) {
    q = q.in('id', v.student_ids);
  }

  const { data, error } = await q.range(0, 4999);
  if (error) throw new Error('فشل جلب قائمة الطلاب: ' + error.message);
  return data || [];
}

// POST — enqueue a parent-broadcast job. Returns the job id immediately
// so the UI can redirect to the live progress page.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات غير صالحة' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }
  const v = parsed.data;

  const admin = createAdminSupabaseClient();

  // 1. Master toggle — fail fast.
  if (!(await isTeacherWhatsappEnabled(admin))) {
    return NextResponse.json({ error: TEACHER_WHATSAPP_DISABLED_ERROR }, { status: 400 });
  }

  // 2. School-hours guard — if the admin tried to send NOW during
  // school hours and didn't acknowledge, return a soft warning so the UI
  // can prompt for confirmation or scheduling.
  const isScheduled = !!v.scheduled_for && new Date(v.scheduled_for).getTime() > Date.now() + 60_000;
  if (!isScheduled && !v.acknowledge_school_hours) {
    const h = currentRiyadhHour();
    if (h >= SCHOOL_HOURS_START && h < SCHOOL_HOURS_END) {
      // Suggest a sensible "after school" time (3pm Riyadh today).
      const today = todayInSchoolTz();   // YYYY-MM-DD
      const suggestedAt = `${today}T15:00:00+03:00`;
      return NextResponse.json({
        error: 'أنت في وقت الدوام (7ص – 2م). الرسائل ستتنافس مع رسائل المعلمين. الأفضل تأجيلها لما بعد الدوام.',
        code: 'SCHOOL_HOURS_WARNING',
        suggested_scheduled_for: suggestedAt,
      }, { status: 409 });
    }
  }

  // 3. Resolve recipients.
  const students = await resolveRecipients(admin, v);
  if (students.length === 0) {
    return NextResponse.json({ error: 'لا يوجد طلاب مطابقون للفلاتر المحددة' }, { status: 404 });
  }

  // 4. Create the job row. Status starts as 'scheduled' if scheduled_for
  // is in the future, else 'pending' (worker fires immediately).
  const status = isScheduled ? 'scheduled' : 'pending';
  const { data: job, error: jobErr } = await admin
    .from('bulk_send_jobs')
    .insert({
      template: v.message_template,
      audience: 'parents',
      status,
      total: students.length,
      pacing_ms: PARENT_PACING_MS,
      jitter_ms: PARENT_JITTER_MS,
      batch_size: PARENT_BATCH_SIZE,
      batch_cooldown_ms: PARENT_BATCH_COOLDOWN_MS,
      scheduled_for: v.scheduled_for || null,
      target_filter: {
        audience: v.audience,
        grade_id: v.grade_id || null,
        section_id: v.section_id || null,
        student_ids: v.student_ids || null,
      },
      created_by: auth.ctx.userId,
    })
    .select('id')
    .single();
  if (jobErr || !job) {
    return NextResponse.json({ error: 'تعذّر إنشاء المهمة: ' + (jobErr?.message || '')}, { status: 500 });
  }

  // 5. Insert recipients. Mark phone-less rows as 'skipped' up front so
  // the worker doesn't pull them and counts stay accurate.
  // Shuffle (Fisher-Yates) so the send order isn't sequential by student
  // id — Wasender's heuristics flag long runs of consecutive numbers.
  const shuffled = [...students];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const recipientRows = shuffled.map((s: any) => {
    const fullName = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ').trim();
    return {
      job_id: job.id,
      user_id: null,
      student_id: s.id,
      teacher_name: fullName,   // re-used as recipient_name (column name is legacy)
      phone: s.phone || null,
      status: s.phone ? 'queued' : 'skipped',
      error: s.phone ? null : 'رقم الجوال غير متوفر',
    };
  });

  const { error: recErr } = await admin.from('bulk_send_recipients').insert(recipientRows);
  if (recErr) {
    // Clean up orphan job.
    await admin.from('bulk_send_jobs').delete().eq('id', job.id);
    return NextResponse.json({ error: 'تعذّر إعداد قائمة المستلمين: ' + recErr.message }, { status: 500 });
  }

  // Pre-bump skipped count.
  const skippedCount = recipientRows.filter((r) => r.status === 'skipped').length;
  if (skippedCount > 0) {
    await admin.from('bulk_send_jobs').update({ failed: skippedCount }).eq('id', job.id);
  }

  // 6. Trigger the worker NOW unless scheduled for later.
  if (!isScheduled) {
    const workerUrl = `${request.nextUrl.origin}/api/whatsapp/bulk-jobs/${job.id}/process`;
    const workerSecret = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32);
    fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': workerSecret,
      },
    }).catch((e) => console.error('worker trigger failed:', e));
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'whatsapp.bulk_parents_create',
    targetType: 'bulk_send_job',
    targetId: job.id,
    details: {
      audience: v.audience,
      total: students.length,
      with_phone: students.length - skippedCount,
      scheduled_for: v.scheduled_for || null,
      filters: {
        grade_id: v.grade_id || null,
        section_id: v.section_id || null,
        student_count: v.student_ids?.length || null,
      },
    },
    request,
  });

  return NextResponse.json({
    data: {
      job_id: job.id,
      status,
      total: students.length,
      with_phone: students.length - skippedCount,
      skipped: skippedCount,
      scheduled_for: v.scheduled_for || null,
    },
  }, { status: 201 });
}
