import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { normalizePhone } from '@/lib/teachers/credentials';

const RELATIONSHIP_LABELS: Record<string, string> = {
  father:    'الوالد',
  mother:    'الوالدة',
  guardian:  'ولي الأمر',
  relative:  'أحد أقارب الطالب',
  other:     'الشخص المُفوَّض',
};

const REASON_LABELS: Record<string, string> = {
  medical:   'مراجعة طبية',
  family:    'ظرف عائلي',
  emergency: 'حالة طارئة',
  other:     'استئذان',
};

/**
 * Sends a WhatsApp confirmation to the parent's phone (the one stored on
 * the student record, NOT the pickup person's phone — those can differ).
 * Falls back to the pickup person's phone when the student has no parent
 * number on file.
 *
 * Best-effort: returns ok/error so the caller can log it on the dismissal
 * row, but doesn't throw. The dismissal record stands either way.
 */
export interface DismissalWhatsappArgs {
  supabase: SupabaseClient;
  studentName: string;
  gradeName: string;
  sectionName: string;
  parentPhone: string | null;
  pickupName: string;
  pickupRelationship: string;
  pickupIdNumber?: string | null;
  reason: string;
  reasonDetails?: string | null;
  dismissalDate: string;
  dismissalTime: string;
  approvedByName: string;
  schoolName?: string;
  approvedByUserId?: string | null;
  studentId: number;
}

export async function sendDismissalWhatsapp(
  args: DismissalWhatsappArgs,
): Promise<{ ok: boolean; error?: string }> {
  if (!args.parentPhone) {
    return { ok: false, error: 'لا يوجد رقم جوال لولي الأمر' };
  }

  const { data: ws } = await args.supabase
    .from('whatsapp_settings')
    .select('api_key')
    .eq('id', 1)
    .maybeSingle();
  if (!ws?.api_key) {
    return { ok: false, error: 'مفتاح API للواتساب غير مضبوط' };
  }

  // Format date Arabic-friendly. "ar-SA-u-ca-gregory" forces the Gregorian
  // calendar so parents see the same date their phone calendar shows.
  const dateStr = (() => {
    try {
      return new Date(args.dismissalDate).toLocaleDateString('ar-SA-u-ca-gregory', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch { return args.dismissalDate; }
  })();
  // Time as HH:MM (drop seconds if present).
  const timeStr = args.dismissalTime.slice(0, 5);

  const relationshipAr = RELATIONSHIP_LABELS[args.pickupRelationship] || args.pickupRelationship;
  const reasonAr = REASON_LABELS[args.reason] || args.reason;

  const message = `🔔 *إشعار استئذان من المدرسة*

السلام عليكم ورحمة الله وبركاته،

نُعلمكم أنّه تم استئذان الطالب/ة من المدرسة:

👤 *الطالب/ة:* ${args.studentName}
📚 *الصف/الشعبة:* ${args.gradeName} / ${args.sectionName}

⏰ *تاريخ الاستئذان:* ${dateStr}
🕒 *وقت الخروج:* ${timeStr}

📋 *السبب:* ${reasonAr}${args.reasonDetails ? ` — ${args.reasonDetails}` : ''}

👨 *المُستلِم:* ${relationshipAr} — ${args.pickupName}${args.pickupIdNumber ? `\n🆔 *رقم الهوية:* ${args.pickupIdNumber}` : ''}

✓ تم الاعتماد من: ${args.approvedByName}

🤲 نسأل الله السلامة لطالبكم.

— *${args.schoolName || 'إدارة المدرسة'}*`.trim();

  const result = await sendTextAndLog({
    supabase: args.supabase,
    apiKey: ws.api_key as string,
    phone: normalizePhone(args.parentPhone),
    message,
    recipientName: args.studentName,
    recipientType: 'parent',
    templateName: 'student_dismissal',
    contextType: 'manual',
    contextId: String(args.studentId),
    sentBy: args.approvedByUserId ?? null,
  });

  return { ok: result.ok, error: result.error };
}
