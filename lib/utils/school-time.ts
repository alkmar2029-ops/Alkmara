// Centralized helpers for school-local date/time.
//
// Vercel functions execute in UTC. The school is in Riyadh (UTC+3, no
// DST). Using `new Date().toISOString()` directly tags every record
// with UTC, so:
//   • a 9pm Riyadh dismissal gets stored as 6pm
//   • a 1am Riyadh save gets dated to "yesterday" in UTC terms
// Both are bugs the deputy + admin notice immediately when the times
// they see don't match what they actually did.
//
// Use these helpers everywhere we need "today's date" or "right now"
// from the server's perspective, so all data is consistently anchored
// to local school time.

const SCHOOL_TZ = 'Asia/Riyadh';

/**
 * Today's date in school timezone, formatted as YYYY-MM-DD.
 * The Swedish locale conveniently emits ISO format (sv-SE: "2026-05-03").
 */
export function todayInSchoolTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: SCHOOL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Current time in school timezone, formatted as HH:MM:SS (24-hour).
 * Postgres TIME columns accept this format directly.
 */
export function nowTimeInSchoolTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: SCHOOL_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);
}

/**
 * "YYYY-MM-DD" + "HH:MM:SS" in one call.
 */
export function nowInSchoolTz(now: Date = new Date()): { date: string; time: string } {
  return { date: todayInSchoolTz(now), time: nowTimeInSchoolTz(now) };
}
