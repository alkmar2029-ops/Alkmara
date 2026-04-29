import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { isTeacherWhatsappEnabled } from '@/lib/whatsapp/policy';
import { generatePassword, normalizePhone } from '@/lib/teachers/credentials';

// Re-export so callers don't need to know that the helpers live in the
// teacher module. Admin and teacher generation use identical logic.
export { generatePassword, normalizePhone };

interface MessageParams {
  fullName: string;
  email: string;
  password: string;
  portalUrl: string;
  schoolName?: string;
}

/**
 * Welcome message for a freshly approved admin. Mirrors the teacher
 * welcome but framed for an administrative audience — they're joining
 * the management team, not the teaching corps.
 */
function buildAdminWelcomeMessage(p: MessageParams): string {
  const school = p.schoolName ? ` في ${p.schoolName}` : '';
  return `🌟 أهلاً وسهلاً بك أستاذنا الفاضل ${p.fullName} 🌹

🎉 يسعدنا اعتماد طلب انضمامكم لفريق إدارة${school}،
ونرحّب بكم ضمن الفريق المسؤول عن متابعة أبنائنا الطلاب 🤝

🛡️ سيتم تخصيص نطاقكم الإداري (الصفوف/الشعب) من قبل المدير،
ولن تروا البيانات إلا بعد التخصيص — هذا لضمان خصوصية الطلاب.

📋 بيانات الدخول للوحة الإدارة:

🔗 الرابط:
${p.portalUrl}

📧 البريد:
\`\`\`${p.email}\`\`\`

🔐 كلمة السر:
\`\`\`${p.password}\`\`\`

💡 ستصلك رسالتان قصيرتان بعد قليل تحويان البريد وكلمة السر منفصلين —
اضغط مطوَّلاً على أيٍّ منهما ثم اختر "نسخ" للصقه مباشرة في صفحة الدخول.

📱 لتجربة أفضل:
• افتح الرابط من المتصفح ثم اضغط «إضافة إلى الشاشة الرئيسية» ليعمل كتطبيق.
• يمكنك تغيير كلمة السر من إعدادات حسابك بعد الدخول.

🤲 نسأل الله لكم التوفيق والسداد في رسالتكم،
وأن يبارك في جهودكم لخدمة طلابنا.

— مع خالص الشكر والتقدير 🌷
${p.schoolName || ''}`.trim();
}

export interface SendAdminCredentialsParams {
  supabase: SupabaseClient;
  fullName: string;
  email: string;
  phone: string;
  password: string;
  portalUrl: string;
  schoolName?: string;
  adminUserId?: string | null;
  sentBy?: string | null;
}

/**
 * Sends the admin credentials over WhatsApp as three messages:
 *   1. Full welcome with credentials embedded.
 *   2. Bare email — long-press → Copy.
 *   3. Bare password — long-press → Copy.
 *
 * Identical UX pattern to the teacher flow but uses admin-specific
 * template names so the WhatsApp log can filter cleanly.
 */
export async function sendAdminCredentialsViaWhatsapp(
  params: SendAdminCredentialsParams,
): Promise<{ ok: boolean; error?: string }> {
  // Honor the global "teachers WhatsApp" toggle — if WhatsApp is muted
  // school-wide we don't want to leak admin credentials by accident.
  if (!(await isTeacherWhatsappEnabled(params.supabase))) {
    return { ok: false, error: 'إرسال الواتساب موقوف من الإعدادات' };
  }

  const { data: ws } = await params.supabase
    .from('whatsapp_settings')
    .select('api_key')
    .eq('id', 1)
    .maybeSingle();
  if (!ws?.api_key) {
    return { ok: false, error: 'مفتاح API للواتساب غير مضبوط' };
  }

  const message = buildAdminWelcomeMessage({
    fullName: params.fullName,
    email: params.email,
    password: params.password,
    portalUrl: params.portalUrl,
    schoolName: params.schoolName,
  });

  const send = (body: string, templateName: string) => sendTextAndLog({
    supabase: params.supabase,
    apiKey: ws.api_key!,
    phone: normalizePhone(params.phone),
    message: body,
    recipientName: params.fullName,
    recipientType: 'admin',
    templateName,
    contextType: 'teacher_credentials',  // re-uses existing context type for log filter compatibility
    contextId: params.adminUserId ?? null,
    sentBy: params.sentBy ?? null,
  });

  // Same one-retry-on-rate-limit pattern as teacher credentials.
  let result = await send(message, 'admin_credentials');
  if (!result.ok && /account protection|1 message every|rate limit/i.test(result.error || '')) {
    await new Promise((r) => setTimeout(r, 6000));
    result = await send(message, 'admin_credentials');
  }

  if (result.ok) {
    try {
      await new Promise((r) => setTimeout(r, 5500));
      await send(params.email, 'admin_email_only');

      await new Promise((r) => setTimeout(r, 5500));
      await send(params.password, 'admin_password_only');
    } catch (e) {
      console.error('admin credentials follow-up failed:', e);
    }
  }

  return { ok: result.ok, error: result.error };
}
