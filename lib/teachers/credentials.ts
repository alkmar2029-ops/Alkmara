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

  const heading = isReset
    ? 'تم إعادة تعيين كلمة السر'
    : 'تم إنشاء حسابك في نظام الحضور';

  const message =
`${heading}

أهلاً ${fullName} 👋

بيانات الدخول لبوابة المعلم${schoolName ? ` — ${schoolName}` : ''}:

🔗 الرابط:
${portalUrl}

📧 البريد:
${email}

🔑 كلمة السر:
${password}

ننصح بحفظ الرابط على الشاشة الرئيسية.
يمكنك تغيير كلمة السر من صفحة «ملفي» بعد الدخول.`;

  const result = await sendTextAndLog({
    supabase,
    apiKey: ws.api_key,
    phone: normalizePhone(phone),
    message,
    recipientName: fullName,
    recipientType: 'teacher',
    templateName: isReset ? 'teacher_password_reset' : 'teacher_credentials',
    contextType: 'teacher_credentials',
    contextId: teacherUserId ?? null,
    sentBy: sentBy ?? null,
  });
  return { ok: result.ok, error: result.error };
}
