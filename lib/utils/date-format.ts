// Canonical date/time formatting for the Arabic UI.
//
// Policy (decided 2026-05-30): Gregorian calendar + Latin digits everywhere in
// the UI, reports, and WhatsApp messages — for consistency with phone numbers
// and national IDs, and to avoid the silent Hijri + Arabic-Indic output that a
// bare 'ar-SA' locale produces (which varies by the runtime ICU version).
//
// Timezone: every formatter is pinned to school-local time (Asia/Riyadh).
// Vercel functions run in UTC, so without an explicit timeZone a near-midnight
// timestamp would render the wrong day/time on the server (and in server-built
// WhatsApp messages). SCHOOL_TZ is reused from school-time.ts (single source).
//
// Official Hijri (Umm al-Qura) stays ONLY where a form explicitly requires it
// (e.g. the supervision print header) — those call sites pass their own locale.
//
// Use these helpers (or AR_DATE_LOCALE) instead of `toLocaleDateString('ar-SA')`.
import { SCHOOL_TZ } from './school-time';
// Re-export so call sites import the timezone from the same module as the formatters.
export { SCHOOL_TZ };

export const AR_DATE_LOCALE = 'ar-SA-u-ca-gregory-nu-latn';

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(AR_DATE_LOCALE, { timeZone: SCHOOL_TZ });
}

/** Time of day (HH:MM, 12-hour with ص/م) in school timezone. */
export function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString(AR_DATE_LOCALE, {
    timeZone: SCHOOL_TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 24-hour clock time (HH:MM, no seconds) in school timezone — for punch/clock
 *  displays where a bare numeric time reads cleaner than 12-hour ص/م. */
export function formatClockTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString(AR_DATE_LOCALE, {
    timeZone: SCHOOL_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date);
  return `${formatDate(d)} ${formatTime(d)}`;
}
