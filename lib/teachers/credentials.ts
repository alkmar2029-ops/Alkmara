import { randomBytes } from 'crypto';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Generates a memorable yet secure 12-char password:
 * 4 lower + 4 upper + 3 digits + 1 symbol, then shuffled.
 * Avoids ambiguous chars (0/O, 1/l/I) so users can read it from WhatsApp.
 */
export function generatePassword(): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digit = '23456789';
  const symbol = '!@#$%&*';

  const buf = randomBytes(12);
  const pick = (set: string, idx: number) => set[buf[idx] % set.length];

  const chars = [
    pick(lower, 0), pick(lower, 1), pick(lower, 2), pick(lower, 3),
    pick(upper, 4), pick(upper, 5), pick(upper, 6), pick(upper, 7),
    pick(digit, 8), pick(digit, 9), pick(digit, 10),
    pick(symbol, 11),
  ];

  // Fisher-Yates shuffle using a fresh random buffer.
  const shuffleBuf = randomBytes(chars.length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBuf[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Normalize Saudi phone numbers to international form (9665XXXXXXXX, 12 digits). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('966')) return digits;
  if (digits.startsWith('05')) return '966' + digits.slice(1);
  if (digits.startsWith('5')) return '966' + digits;
  return digits;
}

interface MessageParams {
  fullName: string;
  email: string;
  password: string;
  portalUrl: string;
  schoolName?: string;
}

/**
 * Warm welcome message sent the moment an admin approves a teacher's
 * application. Tone is celebratory and emphasizes the teacher's value to the
 * school — they took the step of applying, and we want their first contact
 * with the system to feel like a genuine welcome to the family.
 */
function buildWelcomeMessage(p: MessageParams): string {
  const school = p.schoolName ? ` في ${p.schoolName}` : '';
  return `🌟 أهلاً وسهلاً بك أستاذنا الفاضل ${p.fullName} 🌹

🎉 يسعدنا أن نُعلمكم باعتماد طلب انضمامكم لأسرة المعلمين${school}،
فمرحباً بكم بين إخوانكم وزملائكم 🤝

🎓 نحن على ثقة أن وجودكم سيكون إضافةً نوعية،
وأن بصمتكم في تعليم أبنائنا ستبقى راسخة بإذن الله ✨

📋 بيانات الدخول لبوابة المعلم:

🔗 الرابط:
${p.portalUrl}

📧 البريد:
${p.email}

🔐 كلمة السر:
${p.password}

📱 لتجربة أفضل:
• افتح الرابط من المتصفح ثم اضغط «إضافة إلى الشاشة الرئيسية» ليعمل كتطبيق.
• يمكنك تغيير كلمة السر من صفحة «ملفي» داخل البوابة.

🤲 نسأل الله لكم التوفيق والسداد،
وأن يبارك في جهودكم ويُعينكم على رسالتكم التربوية النبيلة.

— مع خالص الشكر والتقدير 🌷
${p.schoolName || ''}`.trim();
}

/** Concise password-reset notification — no welcome flourish. */
function buildResetMessage(p: MessageParams): string {
  return `🔐 تم إعادة تعيين كلمة السر

أهلاً ${p.fullName} 👋

بيانات الدخول لبوابة المعلم${p.schoolName ? ` — ${p.schoolName}` : ''}:

🔗 الرابط:
${p.portalUrl}

📧 البريد:
${p.email}

🔑 كلمة السر الجديدة:
${p.password}

يمكنك تغيير كلمة السر من صفحة «ملفي» بعد الدخول.`;
}

export interface SendCredentialsParams {
  supabase: SupabaseClient;
  fullName: string;
  email: string;
  phone: string;
  password: string;
  portalUrl: string;
  isReset?: boolean;  // true → "تم إعادة تعيين كلمة السر"
  schoolName?: string;
  teacherUserId?: string | null;  // logged into whatsapp_messages.context_id
  sentBy?: string | null;         // admin's user id
}

/**
 * Sends WhatsApp message with login credentials. Returns { ok, error } —
 * caller decides whether to surface failure to the user.
 */
export async function sendCredentialsViaWhatsapp(
  params: SendCredentialsParams,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, fullName, email, phone, password, portalUrl, isReset, schoolName, teacherUserId, sentBy } = params;

  const { data: ws } = await supabase
    .from('whatsapp_settings')
    .select('api_key')
    .eq('id', 1)
    .maybeSingle();
  if (!ws?.api_key) {
    return { ok: false, error: 'مفتاح API للواتساب غير مضبوط' };
  }

  // Two distinct messages — a freshly-approved teacher gets the warm welcome
  // (they applied, were approved, and are joining the team), while a password
  // reset stays short & functional.
  const message = isReset
    ? buildResetMessage({ fullName, email, password, portalUrl, schoolName })
    : buildWelcomeMessage({ fullName, email, password, portalUrl, schoolName });

  const send = () => sendTextAndLog({
    supabase,
    apiKey: ws.api_key!,
    phone: normalizePhone(phone),
    message,
    recipientName: fullName,
    recipientType: 'teacher',
    templateName: isReset ? 'teacher_password_reset' : 'teacher_credentials',
    contextType: 'teacher_credentials',
    contextId: teacherUserId ?? null,
    sentBy: sentBy ?? null,
  });

  // Approval often happens within seconds of the registration confirmation
  // message we just sent on the same WhatsApp account, so Wasender's
  // "1 message every 5 seconds" account-protection blocks it. Detect that
  // exact error and retry once after a 6-second wait — this turns a manual
  // copy-paste into a transparent auto-retry for the admin.
  let result = await send();
  if (!result.ok && isRateLimitError(result.error)) {
    await new Promise((r) => setTimeout(r, 6000));
    result = await send();
  }
  return { ok: result.ok, error: result.error };
}

/**
 * Wasender's rate-limit response is a free-form English string. Match
 * conservatively on the distinctive phrase rather than the full text so
 * minor wording changes upstream don't break detection.
 */
function isRateLimitError(err?: string): boolean {
  if (!err) return false;
  const e = err.toLowerCase();
  return (
    e.includes('account protection') ||
    e.includes('1 message every') ||
    e.includes('rate limit')
  );
}
