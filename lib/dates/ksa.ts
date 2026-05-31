// Saudi-Arabia-anchored date helpers.
//
// The school week runs Sun..Thu and the day boundary is in Asia/Riyadh
// (UTC+3, no DST). All date-only logic in VP/counselor endpoints goes
// through these helpers.
//
// Why this module exists (Codex Sprint 2 review):
//   The first cut of the VP endpoints used `T00:00:00+03:00` parsing
//   and `getDay()`. Locally on a KSA-tz laptop the answer was right;
//   on Vercel (UTC runtime), parsing `2026-05-21T00:00:00+03:00`
//   produced a Date whose UTC value was `2026-05-20T21:00:00Z`, and
//   `getDay()` (which uses runtime-local time) returned the
//   *previous* day's weekday. Days drifted. Subs ran for the wrong
//   day_of_week. This module fixes that by pinning to NOON and using
//   `getUTCDay()` so the result is independent of where the server
//   runs.

import { z } from 'zod';

const TZ = 'Asia/Riyadh';

/**
 * Today's date in Riyadh as a YYYY-MM-DD string. Stable across runtime
 * timezones — uses Intl, not raw Date arithmetic.
 */
export function todayInRiyadh(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Day-of-week for a Riyadh-local YYYY-MM-DD date. Returns 0..6 with
 * Sunday=0, matching teacher_schedule.day_of_week (Saudi week
 * convention).
 *
 * Pinned to NOON (T12:00:00+03:00) so the underlying instant lies on
 * the same calendar day in any UTC offset between -11 and +13. Using
 * getUTCDay() means the result is independent of the runtime's local
 * timezone — same answer on Vercel UTC, Riyadh laptop, anywhere.
 */
export function dayOfWeekKsa(date: string): number {
  return new Date(`${date}T12:00:00+03:00`).getUTCDay();
}

/**
 * Strict YYYY-MM-DD calendar-date validation in the Riyadh calendar.
 * Regex alone accepts impossible dates like 2026-99-99; we then check
 * the parsed Date is valid AND round-trips through Intl to the exact
 * same string. The NaN check is critical — without it, Intl.format()
 * on an Invalid Date throws RangeError, which Codex Sprint 2 review
 * caught as a 500-vs-400 bug. Now returns false cleanly.
 */
export function isValidKsaDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00+03:00`);
  if (Number.isNaN(d.getTime())) return false;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) === date;
}

/**
 * Sunday-of-week (start of the Saudi school week) for the given date.
 * Returned as a YYYY-MM-DD string.
 */
export function startOfSaudiWeek(date: string): string {
  return addDaysKsa(date, -dayOfWeekKsa(date));
}

/**
 * Adds (or subtracts) full days to a YYYY-MM-DD date in the Riyadh
 * calendar. Tz-stable: pinned to noon + UTC arithmetic, then
 * re-rendered as a Riyadh-local YYYY-MM-DD.
 */
export function addDaysKsa(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// ===========================================================================
// Zod schema for shared client-input validation
// ===========================================================================
// Replaces ad-hoc /^\d{4}-\d{2}-\d{2}$/ regex in route bodies. Catches
// both shape errors AND impossible calendar dates (2026-02-30, 2026-99-99).
// Codex Sprint 2 review — should-fix #1.
export const ksaDateSchema = z.string().refine(isValidKsaDate, {
  message: 'تاريخ غير صالح — يجب أن يكون YYYY-MM-DD حقيقيًا',
});
