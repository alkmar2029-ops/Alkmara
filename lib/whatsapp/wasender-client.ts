// Thin wrapper around the WasenderAPI session-status endpoint.
// Docs: https://wasenderapi.com/api-docs

const BASE_URL = 'https://wasenderapi.com/api';

export type WasenderStatus = 'connected' | 'disconnected' | 'connecting' | 'scanning' | 'error' | 'unknown';

export interface CheckResult {
  ok: boolean;
  status: WasenderStatus;
  phone_number: string | null;
  raw?: unknown;
  error?: string;
  http?: number;
}

function normalizeStatus(s: string | undefined | null): WasenderStatus {
  const v = String(s || '').toLowerCase();
  if (v.includes('connect') && !v.includes('dis')) return v.includes('ing') ? 'connecting' : 'connected';
  if (v.includes('disconnect')) return 'disconnected';
  if (v.includes('scan') || v.includes('qr')) return 'scanning';
  if (v.includes('error') || v.includes('fail')) return 'error';
  if (v === 'connected' || v === 'disconnected' || v === 'connecting' || v === 'scanning' || v === 'error') {
    return v;
  }
  return 'unknown';
}

function pickPhone(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const direct = obj.phone || obj.phone_number || obj.number || obj.msisdn || obj.jid;
  if (typeof direct === 'string') return direct.replace(/@s\.whatsapp\.net$/, '').replace(/[^0-9+]/g, '') || null;
  if (obj.user && typeof obj.user === 'object') return pickPhone(obj.user);
  if (obj.data && typeof obj.data === 'object') return pickPhone(obj.data);
  return null;
}

async function call(path: string, apiKey: string, signal?: AbortSignal): Promise<{ http: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal,
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { http: res.status, body };
}

export async function checkSession(apiKey: string, sessionId?: string | null): Promise<CheckResult> {
  if (!apiKey) return { ok: false, status: 'unknown', phone_number: null, error: 'مفتاح API غير محفوظ' };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);

  try {
    // Prefer the session-specific endpoint when we have a session id.
    if (sessionId) {
      const r = await call(`/whatsapp-sessions/${encodeURIComponent(sessionId)}`, apiKey, ac.signal);
      if (r.http === 200) {
        const data = r.body?.data ?? r.body ?? {};
        return {
          ok: true,
          status: normalizeStatus(data.status),
          phone_number: pickPhone(data),
          raw: r.body,
          http: r.http,
        };
      }
      if (r.http === 401) return { ok: false, status: 'error', phone_number: null, error: 'مفتاح API غير صالح', http: 401 };
      if (r.http === 404) return { ok: false, status: 'error', phone_number: null, error: 'الجلسة غير موجودة', http: 404 };
    }

    // Fallback: account-level status (if any) or list sessions and surface the first.
    const list = await call('/whatsapp-sessions', apiKey, ac.signal);
    if (list.http === 401) return { ok: false, status: 'error', phone_number: null, error: 'مفتاح API غير صالح', http: 401 };
    if (list.http >= 200 && list.http < 300) {
      const arr = Array.isArray(list.body?.data) ? list.body.data : Array.isArray(list.body) ? list.body : [];
      if (arr.length === 0) {
        return { ok: true, status: 'disconnected', phone_number: null, raw: list.body, http: list.http };
      }
      const first = arr[0];
      return {
        ok: true,
        status: normalizeStatus(first?.status),
        phone_number: pickPhone(first),
        raw: list.body,
        http: list.http,
      };
    }

    return { ok: false, status: 'error', phone_number: null, error: `استجابة غير متوقعة (HTTP ${list.http})`, http: list.http };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, status: 'error', phone_number: null, error: 'انتهت مهلة الاتصال' };
    return { ok: false, status: 'error', phone_number: null, error: e?.message || 'فشل الاتصال بـWasenderAPI' };
  } finally {
    clearTimeout(timer);
  }
}

export function maskKey(key: string | null | undefined): string {
  if (!key) return '';
  const tail = key.slice(-4);
  return `••••••••${tail}`;
}

// ----- Sending -----

export interface SendResult {
  ok: boolean;
  http?: number;
  error?: string;
  raw?: unknown;
}

/** Normalize phone numbers to WhatsApp JID format. */
export function toJid(phone: string): string {
  const trimmed = String(phone || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed; // already a JID
  // Keep digits only (drop +, spaces, dashes); WhatsApp uses E.164 without "+".
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '';
  return `${digits}@s.whatsapp.net`;
}

export async function sendText(apiKey: string, phone: string, message: string): Promise<SendResult> {
  if (!apiKey) return { ok: false, error: 'مفتاح API غير محفوظ' };
  const jid = toJid(phone);
  if (!jid) return { ok: false, error: 'رقم الجوال غير صالح' };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);

  try {
    const res = await fetch(`${BASE_URL}/send-message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ to: jid, text: message }),
      signal: ac.signal,
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (res.status >= 200 && res.status < 300) return { ok: true, http: res.status, raw: body };
    return {
      ok: false,
      http: res.status,
      error: body?.message || body?.error || `استجابة غير متوقعة (HTTP ${res.status})`,
      raw: body,
    };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, error: 'انتهت مهلة الإرسال' };
    return { ok: false, error: e?.message || 'فشل إرسال الرسالة' };
  } finally {
    clearTimeout(timer);
  }
}
