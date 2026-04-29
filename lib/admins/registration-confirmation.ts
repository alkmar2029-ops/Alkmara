import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { isTeacherWhatsappEnabled } from '@/lib/whatsapp/policy';
import { normalizePhone } from '@/lib/teachers/credentials';

interface ConfirmationParams {
  supabase: SupabaseClient;
  fullName: string;
  phone: string;
  schoolName?: string;
}

/**
 * Receipt message sent the moment an admin candidate submits the
 * /register/admin form. Different from the teacher version because
 * an admin reviewer is the *principal* (not a registrar) and the
 * audience here is a colleague joining management — same warmth,
 * different framing.
 */
function buildAdminConfirmation(p: ConfirmationParams): string {
  const school = p.schoolName || 'مدرستنا';
  return `🌹 السلام عليكم ورحمة الله وبركاته

أستاذنا الفاضل ${p.fullName} 🛡️

✨ شكراً لتسجيلك في فريق إدارة *${school}*،
وصلتنا بياناتك بنجاح وستتم مراجعتها من قِبَل المدير قريباً 📋

⏳ سنرسل لك بيانات الدخول عبر هذا الرقم فور اعتماد طلبك،
ثم سيُحدِّد المدير نطاقكم الإداري (الصفوف التي ستشرفون عليها) 📚

💡 *ما يميّز نظامنا الإداري:*
🛡️ صلاحيات منظَّمة وفق نطاقكم — تركيز على ما يخصّكم
📊 تقارير شاملة عن طلاب صفوفكم
📲 تواصل مباشر مع أولياء الأمور بضغطة
🔐 خصوصية بيانات الطلاب بين الإداريين

🤲 نسأل الله أن يجعل قدومك خيراً وبركة،
وأن يبارك في جهودك لخدمة طلابنا الأعزّاء.

— مع خالص التقدير 🌷
*${school}*`.trim();
}

export async function sendAdminRegistrationConfirmation(
  params: ConfirmationParams,
): Promise<{ ok: boolean; error?: string }> {
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

  const message = buildAdminConfirmation(params);
  const send = () => sendTextAndLog({
    supabase: params.supabase,
    apiKey: ws.api_key!,
    phone: normalizePhone(params.phone),
    message,
    recipientName: params.fullName,
    recipientType: 'admin',
    templateName: 'admin_registration_confirmation',
    contextType: 'teacher_registration_confirmation',
    contextId: null,
    sentBy: null,
  });

  // Single rate-limit retry — same pattern as the teacher path.
  let result = await send();
  if (!result.ok && /account protection|1 message every|rate limit/i.test(result.error || '')) {
    await new Promise((r) => setTimeout(r, 6000));
    result = await send();
  }
  return { ok: result.ok, error: result.error };
}
