/**
 * IP allowlist for ZKTeco devices.
 *
 * The default block list (rejecting all RFC1918 ranges) made it impossible to
 * register the school's actual ZKTeco devices, which sit on internal networks.
 * This module flips the model: a small set of always-blocked dangerous ranges,
 * plus an optional allowlist from env so admins can restrict to a specific
 * subnet if they want to.
 *
 * Env vars:
 *   ALLOWED_DEVICE_CIDRS         comma-separated CIDR list, e.g. "192.168.1.0/24,10.0.5.0/24"
 *   ALLOWED_DEVICE_IP_PREFIXES   comma-separated prefix list (legacy/simple), e.g. "192.168.1.,10.0.5."
 *
 * If neither env var is set, all RFC1918 private ranges are allowed by default.
 */

interface ParsedCidr {
  network: number;
  mask: number;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255 || /^0\d+/.test(p)) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function parseCidr(cidr: string): ParsedCidr | null {
  const [ip, bitsRaw] = cidr.trim().split('/');
  if (!ip || !bitsRaw) return null;
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const ipInt = ipToInt(ip);
  if (ipInt === null) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: ipInt & mask, mask };
}

let cachedCidrs: ParsedCidr[] | null | undefined;
let cachedPrefixes: string[] | null | undefined;

function getAllowedCidrs(): ParsedCidr[] | null {
  if (cachedCidrs !== undefined) return cachedCidrs;
  const raw = process.env.ALLOWED_DEVICE_CIDRS;
  if (!raw) {
    cachedCidrs = null;
    return null;
  }
  cachedCidrs = raw
    .split(',')
    .map(parseCidr)
    .filter((c): c is ParsedCidr => c !== null);
  return cachedCidrs;
}

function getAllowedPrefixes(): string[] | null {
  if (cachedPrefixes !== undefined) return cachedPrefixes;
  const raw = process.env.ALLOWED_DEVICE_IP_PREFIXES;
  if (!raw) {
    cachedPrefixes = null;
    return null;
  }
  cachedPrefixes = raw.split(',').map(s => s.trim()).filter(Boolean);
  return cachedPrefixes;
}

// Always rejected — no admin should ever target these.
function isAlwaysBlocked(ipInt: number, ip: string): boolean {
  const a = (ipInt >>> 24) & 0xff;
  const b = (ipInt >>> 16) & 0xff;
  if (a === 0) return true;                          // 0.0.0.0/8 unspecified
  if (a === 127) return true;                        // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local
  if (a >= 224) return true;                         // 224.0.0.0/4 multicast + reserved
  if (ip === '255.255.255.255') return true;         // limited broadcast
  return false;
}

function isRfc1918(ipInt: number): boolean {
  const a = (ipInt >>> 24) & 0xff;
  const b = (ipInt >>> 16) & 0xff;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export interface IpCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkDeviceIp(ip: string): IpCheckResult {
  const ipInt = ipToInt(ip);
  if (ipInt === null) return { ok: false, reason: 'عنوان IP غير صالح' };

  if (isAlwaysBlocked(ipInt, ip)) {
    return { ok: false, reason: 'عنوان IP محجوز ولا يمكن استخدامه (loopback / broadcast / link-local)' };
  }

  const cidrs = getAllowedCidrs();
  const prefixes = getAllowedPrefixes();

  if (cidrs && cidrs.length > 0) {
    const matches = cidrs.some(({ network, mask }) => (ipInt & mask) >>> 0 === network);
    if (!matches) {
      return { ok: false, reason: 'عنوان IP خارج النطاقات المسموح بها (ALLOWED_DEVICE_CIDRS)' };
    }
    return { ok: true };
  }

  if (prefixes && prefixes.length > 0) {
    const matches = prefixes.some(p => ip.startsWith(p));
    if (!matches) {
      return { ok: false, reason: 'عنوان IP خارج النطاقات المسموح بها (ALLOWED_DEVICE_IP_PREFIXES)' };
    }
    return { ok: true };
  }

  // No env config: allow private internal ranges only (school networks).
  if (!isRfc1918(ipInt)) {
    return {
      ok: false,
      reason: 'عنوان IP غير مسموح به - يجب استخدام عنوان داخلي أو ضبط ALLOWED_DEVICE_CIDRS',
    };
  }
  return { ok: true };
}

// Test-only hook to clear the cache when env changes.
export function _resetIpAllowlistCache(): void {
  cachedCidrs = undefined;
  cachedPrefixes = undefined;
}
