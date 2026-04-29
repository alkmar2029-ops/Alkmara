/**
 * Lightweight in-memory rate limiter for serverless API routes.
 *
 * Caveats: a Vercel function instance is per-process, so this is a *per-
 * instance* limit. Under heavy traffic Vercel spins up multiple instances
 * and a determined attacker could fan out across them. In practice, that
 * still slows abuse by an order of magnitude — and it's free, has zero
 * external dependencies, and degrades gracefully (the worst that happens
 * is a few extra requests slip through).
 *
 * For high-traffic SaaS use, swap this for @upstash/ratelimit (Redis-
 * backed, distributed) without changing the call site.
 */

interface Bucket {
  hits: number;       // requests counted in the current window
  resetAt: number;    // ms timestamp when the window expires
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup so the Map can't grow unbounded across long-lived
// Lambda warm starts. Cheap — only walks expired entries.
let lastSweep = Date.now();
function maybeSweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  ok: boolean;        // false → caller should reject the request
  remaining: number;  // hits left in the current window
  resetIn: number;    // seconds until the window resets
}

/**
 * Apply a fixed-window rate limit.
 *
 * @param key       — A stable identifier for the client. Best practice: a
 *                    namespace + the client IP, e.g. `"register:1.2.3.4"`.
 *                    Per-IP keeps shared NATs (schools, mobile carriers) from
 *                    locking each other out beyond reason while still
 *                    blocking abusive single sources.
 * @param maxHits   — Max requests allowed inside the window.
 * @param windowMs  — Window length in milliseconds.
 */
export function checkRateLimit(
  key: string,
  maxHits: number,
  windowMs: number,
): RateLimitResult {
  maybeSweep();
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { hits: 1, resetAt: now + windowMs });
    return { ok: true, remaining: maxHits - 1, resetIn: Math.ceil(windowMs / 1000) };
  }
  b.hits += 1;
  return {
    ok: b.hits <= maxHits,
    remaining: Math.max(0, maxHits - b.hits),
    resetIn: Math.max(0, Math.ceil((b.resetAt - now) / 1000)),
  };
}

/**
 * Extracts the client IP from a Next.js request, with sensible fallbacks
 * for Vercel. Vercel sets `x-forwarded-for` correctly; first IP in the list
 * is the real client. Falls back to a sentinel so the limit still applies
 * to any caller missing the header (e.g. local dev curl).
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}
