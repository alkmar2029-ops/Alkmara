// Single source of truth for the teacher-portal URL used in WhatsApp
// reminders. Resolved with this priority:
//   1. NEXT_PUBLIC_PORTAL_URL env var (set on Vercel)
//   2. The request origin if available (single-reminder route)
//   3. Hardcoded production URL as the ultimate fallback so we NEVER
//      ship a reminder without a clickable link
//
// Always returns the full URL with the /teacher suffix.

const PRODUCTION_FALLBACK = 'https://alkmara.vercel.app';

export function teacherPortalUrl(requestOrigin?: string): string {
  const base = (
    process.env.NEXT_PUBLIC_PORTAL_URL
    || requestOrigin
    || PRODUCTION_FALLBACK
  ).replace(/\/$/, '');
  return `${base}/teacher`;
}
