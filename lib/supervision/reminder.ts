import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { isTeacherWhatsappEnabled } from '@/lib/whatsapp/policy';
import { normalizePhone } from '@/lib/teachers/credentials';
import { todayInSchoolTz } from '@/lib/utils/school-time';

const RIYADH_SEND_WINDOW = { start: 6, end: 10 };  // 6am–10am

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

/** 0=Sun..4=Thu in Asia/Riyadh, or null if today is Fri/Sat (weekend). */
export function riyadhDayOfWeek(): number | null {
  // JS: 0=Sun, 1=Mon, ... 6=Sat. Riyadh tz.
  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Riyadh' });
  const wd = fmt.format(new Date());
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4 };
  return wd in map ? map[wd] : null;
}

function riyadhHour(): number {
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' });
  const parts = fmt.formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
}

export interface ReminderResult {
  triggered: boolean;
  reason?: string;            // why it didn't trigger (when triggered=false)
  date?: string;
  sent_count?: number;
  failed_count?: number;
}

/**
 * Atomically attempt to send today's morning supervision reminders.
 * Race-safe via PK conflict on supervision_reminder_log(date) — only the
 * caller that wins the INSERT proceeds. All other concurrent invocations
 * see a "conflict" and return early.
 *
 * Caller is expected to fire-and-forget; we never throw.
 */
export async function maybeSendDailyReminder(
  admin: SupabaseClient,
  options: { force?: boolean; triggeredBy?: string | null } = {},
): Promise<ReminderResult> {
  const today = todayInSchoolTz();   // YYYY-MM-DD (Riyadh)
  const day = riyadhDayOfWeek();
  if (day === null) return { triggered: false, reason: 'weekend' };

  const hour = riyadhHour();
  if (!options.force && (hour < RIYADH_SEND_WINDOW.start || hour >= RIYADH_SEND_WINDOW.end)) {
    return { triggered: false, reason: 'outside_window' };
  }

  // Master toggle — if WhatsApp sending is paused school-wide, skip.
  if (!(await isTeacherWhatsappEnabled(admin))) {
    return { triggered: false, reason: 'whatsapp_disabled' };
  }

  // Manual force re-send: clear any existing log row first so the INSERT
  // below succeeds. Only used by the "Resend now" admin button.
  if (options.force) {
    await admin.from('supervision_reminder_log').delete().eq('date', today);
  }

  // Race-safe lock: insert the dedup row. If another caller wins the race,
  // we get a unique-violation and bail out.
  const { error: lockErr } = await admin
    .from('supervision_reminder_log')
    .insert({ date: today, sent_count: 0, failed_count: 0, triggered_by: options.triggeredBy || null });
  if (lockErr) {
    // Most likely a duplicate-key error → already sent today.
    return { triggered: false, reason: 'already_sent_today' };
  }

  // We won the race — actually send.
  const { data: ws } = await admin
    .from('whatsapp_settings').select('api_key').eq('id', 1).maybeSingle();
  if (!ws?.api_key) {
    return { triggered: true, sent_count: 0, failed_count: 0, reason: 'no_api_key' };
  }

  // Pull today's assignments + the supervisor's name + phone in one shot.
  const { data: rows } = await admin
    .from('supervision_assignments')
    .select(`
      location_id,
      user_id,
      supervision_locations!inner ( name ),
      user_profiles!supervision_assignments_user_id_fkey ( full_name, phone )
    `)
    .eq('day_of_week', day);

  if (!rows || rows.length === 0) {
    return { triggered: true, sent_count: 0, failed_count: 0, reason: 'no_assignments' };
  }

  const dayLabel = ARABIC_DAYS[day] || '';
  let sent = 0, failed = 0;

  // Sequential send with light pacing — supervisor list is small (~10).
  for (const r of rows as any[]) {
    const fullName = r.user_profiles?.full_name || 'الأستاذ الفاضل';
    const phone = r.user_profiles?.phone;
    const location = r.supervision_locations?.name || '—';
    if (!phone) { failed++; continue; }

    const message = `📢 صباح الخير أ. ${fullName} 🌹

اليوم *${dayLabel}* لديك إشراف الفسحة في:
🏫 *${location}*

نسأل الله لكم التوفيق 🤲

— إدارة المدرسة`;

    const result = await sendTextAndLog({
      supabase: admin,
      apiKey: ws.api_key as string,
      phone: normalizePhone(phone),
      message,
      recipientName: fullName,
      recipientType: 'teacher',
      templateName: 'supervision_morning_reminder',
      contextType: 'manual',
      contextId: today,
      sentBy: options.triggeredBy || null,
    });
    if (result.ok) sent++; else failed++;

    await new Promise((r) => setTimeout(r, 2000));   // 2s pacing
  }

  await admin
    .from('supervision_reminder_log')
    .update({ sent_count: sent, failed_count: failed })
    .eq('date', today);

  return { triggered: true, date: today, sent_count: sent, failed_count: failed };
}
