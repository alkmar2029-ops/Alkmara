// Lightweight {{placeholder}} renderer with sensible Arabic-ready defaults.

export interface RenderVars {
  student_name?: string;
  grade?: string;
  section?: string;
  date?: string;        // YYYY-MM-DD or already formatted
  punch_time?: string;  // HH:MM:SS or already formatted
  minutes_late?: number | string;
  phone?: string;
}

export const TEMPLATE_PLACEHOLDERS: ReadonlyArray<{ key: keyof RenderVars; label: string }> = [
  { key: 'student_name', label: 'اسم الطالب' },
  { key: 'grade',        label: 'الصف' },
  { key: 'section',      label: 'الشعبة' },
  { key: 'date',         label: 'التاريخ' },
  { key: 'punch_time',   label: 'وقت البصمة' },
  { key: 'minutes_late', label: 'مدة التأخير (دقائق)' },
  { key: 'phone',        label: 'رقم الجوال' },
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
