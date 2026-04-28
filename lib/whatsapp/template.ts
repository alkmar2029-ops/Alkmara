// Lightweight {{placeholder}} renderer with sensible Arabic-ready defaults.

export interface RenderVars {
  // Common — used by every template type
  student_name?: string;
  grade?: string;
  section?: string;
  date?: string;        // YYYY-MM-DD or already formatted
  phone?: string;
  school_name?: string;
  principal_name?: string;
  teacher_name?: string;
  // Late-notification specific
  punch_time?: string;  // HH:MM:SS or already formatted
  minutes_late?: number | string;
  // Note specific
  note_text?: string;
  note_emoji?: string;
  note_type?: string;   // إيجابية | سلبية
  note_category?: string;
  // Period attendance specific
  period_name?: string;     // e.g. "الحصة الثالثة"
  period_number?: number | string;
  absence_status?: string;  // "غائب" | "متأخر" | "مستأذن"
}

export const TEMPLATE_PLACEHOLDERS: ReadonlyArray<{ key: keyof RenderVars; label: string; group?: 'common' | 'late' | 'note' }> = [
  { key: 'student_name',   label: 'اسم الطالب',           group: 'common' },
  { key: 'grade',          label: 'الصف',                  group: 'common' },
  { key: 'section',        label: 'الشعبة',                group: 'common' },
  { key: 'date',           label: 'التاريخ',               group: 'common' },
  { key: 'school_name',    label: 'اسم المدرسة',           group: 'common' },
  { key: 'principal_name', label: 'اسم المدير',            group: 'common' },
  { key: 'teacher_name',   label: 'اسم المعلم/المسجِّل',    group: 'common' },
  { key: 'phone',          label: 'رقم الجوال',            group: 'common' },
  { key: 'punch_time',     label: 'وقت البصمة',            group: 'late' },
  { key: 'minutes_late',   label: 'مدة التأخير (دقائق)',   group: 'late' },
  { key: 'note_text',      label: 'نص الملاحظة',           group: 'note' },
  { key: 'note_emoji',     label: 'أيقونة الملاحظة',       group: 'note' },
  { key: 'note_type',      label: 'نوع الملاحظة',          group: 'note' },
  { key: 'note_category',  label: 'تصنيف الملاحظة',        group: 'note' },
  { key: 'period_name',    label: 'اسم الحصة',             group: 'note' },
  { key: 'period_number',  label: 'رقم الحصة',             group: 'note' },
  { key: 'absence_status', label: 'حالة الغياب',           group: 'note' },
];

export function renderTemplate(body: string, vars: RenderVars): string {
  return String(body || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, key) => {
    const v = (vars as Record<string, unknown>)[key];
    if (v === undefined || v === null || v === '') return '';
    return String(v);
  });
}

export function formatPunchDateTime(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('ar-SA-u-ca-gregory');
    const time = d.toLocaleTimeString('ar-SA', { hour12: false });
    return { date, time };
  } catch {
    return { date: '', time: '' };
  }
}
