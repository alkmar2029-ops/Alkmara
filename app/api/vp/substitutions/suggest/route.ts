// GET /api/vp/substitutions/suggest — top-N substitute candidates for a
// single (day_of_week, period_number) slot.
//
// Read-only — gated by requireVpDashboard (any VP with view access can
// see suggestions; the actual assignment is a separate write endpoint
// in م2.8 with the stricter requireManageSubstitutions gate).
//
// The algorithm lives in lib/substitution/suggester.ts. This route is
// just HTTP plumbing: validate the query string, default the date,
// hand off to the suggester, surface errors.
//
// Query params:
//   day_of_week        — 0..4 (Sun..Thu), required
//   period_number      — 1..8, required
//   date               — YYYY-MM-DD, optional (defaults to today/Riyadh)
//   original_teacher_id — UUID, optional (excluded from candidates)
//   limit              — 1..10, optional (default 3)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireVpDashboard } from '@/lib/personas/auth-gate';
import { suggestSubstitutes } from '@/lib/substitution/suggester';
import { todayInRiyadh, ksaDateSchema } from '@/lib/dates/ksa';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  // z.coerce.number is essential here — searchParams values are strings.
  day_of_week: z.coerce.number().int().min(0).max(4),
  period_number: z.coerce.number().int().min(1).max(8),
  // ksaDateSchema validates both shape + calendar reality.
  date: ksaDateSchema.optional(),
  original_teacher_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireVpDashboard();
  if (!auth.ok) return auth.res;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    day_of_week: url.searchParams.get('day_of_week'),
    period_number: url.searchParams.get('period_number'),
    date: url.searchParams.get('date') ?? undefined,
    original_teacher_id: url.searchParams.get('original_teacher_id') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const date = parsed.data.date ?? todayInRiyadh();
  const limit = parsed.data.limit ?? 3;
  const admin = createAdminSupabaseClient();

  try {
    const candidates = await suggestSubstitutes(
      admin,
      {
        day_of_week: parsed.data.day_of_week,
        period_number: parsed.data.period_number,
        date,
        original_teacher_id: parsed.data.original_teacher_id ?? null,
      },
      limit,
    );

    return NextResponse.json(
      {
        data: {
          date,
          day_of_week: parsed.data.day_of_week,
          period_number: parsed.data.period_number,
          count: candidates.length,
          candidates,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'فشل اقتراح البدلاء' },
      { status: 500 },
    );
  }
}
