import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { normalizePhone } from './credentials';

interface ConfirmationParams {
  supabase: SupabaseClient;
  fullName: string;
  phone: string;
  schoolName?: string;
}

/**
 * Confirmation message sent the moment a teacher submits the public
 * registration form. Goal: reassure them their application arrived, set the
 * expectation that they need to wait for admin approval, and showcase what
 * the teacher portal will give them once they're in — so they're excited to
 * see the credentials arrive.
 *
 * Tone: warm + professional. The teacher hasn't been approved yet, so we
 * don't say "welcome to the family" — that's reserved for the post-approval
 * message. Here it's "thanks for applying, here's what to look forward to".
 */
function buildRegistrationConfirmation(p: ConfirmationParams): string {
  const school = p.schoolName || 'مدرستنا';
  return `🌹 السلام عليكم ورحمة الله وبركاته

أستاذنا الفاضل ${p.fullName} 🌟

✨ شكراً لتسجيلك في *${school}*،
وصلتنا بياناتك بنجاح وستتم مراجعتها من قِبَل الإدارة قريباً بإذن الله 📋

⏳ سنرسل لك بيانات الدخول عبر هذا الرقم فور اعتماد طلبك،
لذا احرص على بقاء واتسابك مفعّلاً 📱

━━━━━━━━━━━━━━━

🎓 *لمحة عمّا ينتظرك في تطبيق المعلم:*

📲 *تطبيق ذكي على جوالك:*
• يعمل كتطبيق مستقل بعد التثبيت من المتصفح
• تصميم سريع وسلس مع وضع داكن مريح للعين 🌙
• يعمل أحياناً بدون إنترنت ويُزامن تلقائياً عند الاتصال

📝 *تسجيل الحضور بسهولة:*
• تسجيل الحضور والغياب والتأخير والاستئذان لكل حصّة بنقرات بسيطة ✓
• حفظ تلقائي لجلسة الحصّة (٤٥ دقيقة) حتى لو خرجت من التطبيق
• خارطة حرارية لمتابعة أنماط غياب الطلاب 🔥

🎙️ *ملاحظات الطلاب باللمسات والصوت:*
• سجّل ملاحظاتك الإيجابية والسلوكية للطلاب 💬
• تحويل صوتك إلى نص مباشرة بالعربية الفصحى 🎤
• قوالب جاهزة (شكر، تنبيه، تميّز...) قابلة للتعديل

📊 *تقارير ذكية تخدمك وتخدم الطالب:*
• تقارير دورية احترافية لأداء طلابك جاهزة للطباعة
• قائمة "الطلاب الذين يحتاجون متابعة" بنقرة واحدة 🎯
• سجل كامل لكل طالب على حدة لمتابعته بدقة

📱 *تواصل مباشر مع أولياء الأمور:*
• إرسال الإشعارات والملاحظات عبر الواتساب تلقائياً 💚
• قوالب رسائل احترافية معدّة من الإدارة
• شراكة حقيقية بين البيت والمدرسة 🤝

📨 *تواصل داخلي مع الإدارة:*
• مراسلات مباشرة بينك وبين الإدارة داخل التطبيق
• إشعارات فورية عند ورود رسالة جديدة 🔔

━━━━━━━━━━━━━━━

🎯 *كيف يخدم هذا الطالب؟*

🌱 متابعة دقيقة لأداء كل طالب ومعالجة أي تراجع مبكراً
👨‍👩‍👦 تواصل فوري مع الأهل يقطع المسافة بين البيت والمدرسة
🏆 تقدير الطلاب المتميّزين وإبراز جهودهم
💡 ملاحظات هادفة تُسهم في تطوير سلوكه الأكاديمي والأخلاقي

━━━━━━━━━━━━━━━

🤲 نسأل الله أن يُيسّر أمرك،
وأن يجعل قدومك خيراً وبركة على طلابنا الأعزّاء.

— مع خالص التقدير 🌷
*${school}*`.trim();
}

/**
 * Best-effort send. Failures are swallowed — we never want a WhatsApp issue
 * to block the actual registration flow. Returns ok/error for logging only.
 */
export async function sendRegistrationConfirmation(
  params: ConfirmationParams,
): Promise<{ ok: boolean; error?: string }> {
  const { data: ws } = await params.supabase
    .from('whatsapp_settings')
    .select('api_key')
    .eq('id', 1)
    .maybeSingle();
  if (!ws?.api_key) {
    return { ok: false, error: 'مفتاح API للواتساب غير مضبوط' };
  }

  const message = buildRegistrationConfirmation(params);
  const send = () => sendTextAndLog({
    supabase: params.supabase,
    apiKey: ws.api_key!,
    phone: normalizePhone(params.phone),
    message,
    recipientName: params.fullName,
    recipientType: 'teacher',
    templateName: 'teacher_registration_confirmation',
    contextType: 'teacher_registration_confirmation',
    contextId: null,
    sentBy: null,
  });

  // Auto-retry once on Wasender rate-limit — see lib/teachers/credentials.ts
  // for the same pattern. This message follows immediately after the user
  // submits, so a back-to-back send (e.g. another teacher just registered)
  // can hit the 5-second account-protection window.
  let result = await send();
  if (!result.ok && isRateLimitError(result.error)) {
    await new Promise((r) => setTimeout(r, 6000));
    result = await send();
  }
  return { ok: result.ok, error: result.error };
}

function isRateLimitError(err?: string): boolean {
  if (!err) return false;
  const e = err.toLowerCase();
  return (
    e.includes('account protection') ||
    e.includes('1 message every') ||
    e.includes('rate limit')
  );
}
