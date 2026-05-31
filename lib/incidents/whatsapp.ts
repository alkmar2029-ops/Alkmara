// م3.19 — guardian WhatsApp notification when an incident is actioned.
//
// Mirrors lib/dismissals/whatsapp.ts: best-effort, never throws, returns
// { ok, error } so the caller can surface the outcome without failing
// the request. The incident is already recorded as actioned by the time
// this runs — the message is a courtesy notification, not part of the
// transaction.
//
// Privacy posture: the message tells the guardian their own child had a
// note recorded and that action was taken, plus the incident TYPE and
// DATE. It deliberately does NOT include the verbatim internal
// `action_taken` / `description` text (staff-authored, internal). The
// guardian phone + student identity are read server-side from the
// students row — never trusted from the request body.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTextAndLog } from '@/lib/whatsapp/log';
import { normalizePhone } from '@/lib/teachers/credentials';
import { AR_DATE_LOCALE, SCHOOL_TZ } from '@/lib/utils/date-format';
import { INCIDENT_TYPE_LABELS, type IncidentType } from '@/lib/incidents/types';

export interface IncidentActionWhatsappArgs {
  /** Service-role client — the send + log + lookups all bypass RLS. */
  admin: SupabaseClient;
  incidentId: number;
  studentId: number;
  incidentType: string;
  incidentDate: string;
  /** The reviewer who triggered the action (for whatsapp_messages.sent_by). */
  sentBy?: string | null;
}

export async function notifyGuardianOfIncidentAction(
  args: IncidentActionWhatsappArgs,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const { admin, incidentId, studentId, incidentType, incidentDate, sentBy } = args;

  // Idempotency — never double-notify for the same incident. The action
  // endpoint can only transition an incident to 'actioned' once (race-
  // safe UPDATE), but a prior SUCCESSFUL send (or a re-entry from a
  // future sweep) short-circuits here. A prior FAILED send is allowed to
  // retry.
  const { data: existing } = await admin
    .from('whatsapp_messages')
    .select('id')
    .eq('context_type', 'incident')
    .eq('context_id', String(incidentId))
    .eq('status', 'success')
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: true, skipped: true };
  }

  // Resolve guardian phone + student identity server-side.
  const { data: student, error: studentErr } = await admin
    .from('students')
    .select('first_name, father_name, last_name, phone, sections(name, grades(name))')
    .eq('id', studentId)
    .maybeSingle();
  if (studentErr || !student) {
    return { ok: false, error: 'تعذّر جلب بيانات الطالب' };
  }
  if (!student.phone) {
    return { ok: false, error: 'لا يوجد رقم جوال لولي الأمر' };
  }

  const { data: ws } = await admin
    .from('whatsapp_settings')
    .select('api_key')
    .eq('id', 1)
    .maybeSingle();
  if (!ws?.api_key) {
    return { ok: false, error: 'مفتاح API للواتساب غير مضبوط' };
  }

  const studentName = [student.first_name, student.father_name, student.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const sec = student.sections as { name?: string; grades?: { name?: string } } | null;
  const sectionName = sec?.name ?? '';
  const gradeName = sec?.grades?.name ?? '';
  const typeLabel = INCIDENT_TYPE_LABELS[incidentType as IncidentType] ?? incidentType;

  // Gregorian + Latin digits + Riyadh tz, same policy as the dismissal
  // message (P2.9 date-format unification).
  const dateStr = (() => {
    try {
      return new Date(incidentDate).toLocaleDateString(AR_DATE_LOCALE, {
        timeZone: SCHOOL_TZ,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return incidentDate;
    }
  })();

  const classLine =
    gradeName || sectionName
      ? `\n📚 *الصف/الشعبة:* ${gradeName}${sectionName ? ' / ' + sectionName : ''}`
      : '';

  const message = `🔔 *إشعار من إدارة المدرسة*

السلام عليكم ورحمة الله وبركاته،

نُعلمكم بأنّه تم تسجيل ملاحظة بحقّ ابنكم/ابنتكم واتُّخِذ الإجراء التربوي المناسب بشأنها:

👤 *الطالب/ة:* ${studentName}${classLine}
📌 *نوع الملاحظة:* ${typeLabel}
📅 *التاريخ:* ${dateStr}

نرجو تعاونكم معنا في متابعة سلوك ابنكم. وللاستفسار عن التفاصيل يُرجى التواصل مع إدارة المدرسة.

— *إدارة المدرسة*`.trim();

  const result = await sendTextAndLog({
    apiKey: ws.api_key as string,
    phone: normalizePhone(student.phone),
    message,
    recipientName: studentName,
    recipientType: 'parent',
    templateName: 'incident_action',
    contextType: 'incident',
    contextId: String(incidentId),
    sentBy: sentBy ?? null,
  });

  return { ok: result.ok, error: result.error };
}
