import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { todayInSchoolTz } from '@/lib/utils/school-time';

const BULK_SEND_WINDOW_MS = 10 * 60_000;
const BULK_SEND_MAX_CAMPAIGNS = 3;
const BULK_SEND_DAILY_RECIPIENT_LIMIT = 1_500;

export interface BulkSendLimitResult {
  ok: boolean;
  res?: NextResponse;
}

/**
 * Lightweight abuse guard for bulk WhatsApp entry points.
 *
 * The burst limiter intentionally mirrors the existing in-memory limiter:
 * cheap and good enough to slow rapid abuse. The daily recipient cap is
 * reserved through Postgres, because it protects real Wasender cost and must
 * survive Vercel multi-instance fanout and cold starts.
 */
export async function checkBulkSendLimit(
  admin: SupabaseClient,
  userId: string,
  recipientCount: number,
): Promise<BulkSendLimitResult> {
  const rate = checkRateLimit(
    `bulk:${userId}`,
    BULK_SEND_MAX_CAMPAIGNS,
    BULK_SEND_WINDOW_MS,
  );
  if (!rate.ok) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error: 'تم تجاوز حد إنشاء حملات واتساب الجماعية، حاول لاحقاً',
          code: 'BULK_SEND_RATE_LIMIT',
          retry_after: rate.resetIn,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.resetIn) },
        },
      ),
    };
  }

  const today = todayInSchoolTz();
  const { data, error } = await admin.rpc('reserve_whatsapp_bulk_quota', {
    p_user_id: userId,
    p_usage_date: today,
    p_recipient_count: Math.max(0, recipientCount),
    p_daily_limit: BULK_SEND_DAILY_RECIPIENT_LIMIT,
  });
  if (error) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error: 'تعذر التحقق من حد رسائل واتساب اليومي',
          code: 'BULK_SEND_QUOTA_UNAVAILABLE',
        },
        { status: 503 },
      ),
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    const usedToday = Number(row?.used_before ?? 0);
    const remainingToday = Number(row?.remaining ?? 0);

    return {
      ok: false,
      res: NextResponse.json(
        {
          error: 'تم تجاوز الحد اليومي لمستلمي رسائل واتساب الجماعية',
          code: 'BULK_SEND_DAILY_RECIPIENT_LIMIT',
          daily_limit: BULK_SEND_DAILY_RECIPIENT_LIMIT,
          used_today: usedToday,
          remaining_today: remainingToday,
        },
        { status: 429 },
      ),
    };
  }

  return { ok: true };
}
