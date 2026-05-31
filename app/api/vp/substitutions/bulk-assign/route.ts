// POST /api/vp/substitutions/bulk-assign — assign multiple substitutes
// in one request.
//
// UX flow: the VP picks substitutes for several pending periods on the
// substitutions screen and clicks "Save All". This endpoint processes
// each pick through the same validation set as the single-assign
// endpoint (lib/substitution/assigner.ts), returning a per-item
// success/failure summary.
//
// PROCESSING ORDER:
//   Serial, not parallel. Each item's pre-check looks at the current
//   state of substitution_assignments — and EARLIER items in the same
//   batch may have just inserted rows that LATER items need to see.
//   Example: VP picks teacher X for absence A period 3, then teacher
//   X for absence B period 3. Item 2 must see Item 1's row to fail
//   the double-book check. Parallel processing would race and let
//   both pass the pre-check, then the DB UNIQUE constraint would
//   catch the second with a raw 23505 instead of the friendly 400.
//
// PARTIAL SUCCESS:
//   We don't roll back successful items if a later one fails. The VP
//   gets per-item results and can adjust the failed picks. HTTP 207
//   Multi-Status signals "some succeeded, some failed". HTTP 201
//   when all succeeded.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireManageSubstitutions } from '@/lib/personas/auth-gate';
import {
  assignSubstitute,
  type AssignSubstituteParams,
} from '@/lib/substitution/assigner';

export const dynamic = 'force-dynamic';

const itemSchema = z
  .object({
    absence_id: z.number().int().positive(),
    substitute_user_id: z.string().uuid(),
    period_number: z.number().int().min(1).max(8),
  })
  .strict();

// Capped at 25 items per request (Codex Sprint 2 review: should-fix #4
// lowered from 50). A realistic "Save All" is 3-4 absent teachers ×
// ~5 periods = ~20 picks, so 25 still covers the real ceiling while
// keeping the serial loop well inside Vercel's 60s function budget.
const bodySchema = z
  .object({
    assignments: z.array(itemSchema).min(1).max(25),
  })
  .strict();

type ItemResult =
  | {
      index: number;
      status: 'succeeded';
      assignment: {
        id: number;
        absence_id: number;
        substitute_user_id: string;
        period_number: number;
      };
    }
  | {
      index: number;
      status: 'failed';
      error: string;
      http_status: number;
      // The original input is echoed back so the UI can highlight the
      // failing row without keying by index alone.
      input: AssignSubstituteParams;
    };

export async function POST(request: NextRequest) {
  const auth = await requireManageSubstitutions();
  if (!auth.ok) return auth.res;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'صيغة البيانات المرسلة غير صالحة' },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const items = parsed.data.assignments;

  // Reject within-batch duplicate slots before processing. Same
  // (absence_id, period_number) twice in the payload would silently
  // become "last write wins" via upsert — confusing for the UI.
  // (Codex Sprint 2 follow-up note on م2.9.)
  const seenSlots = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const key = `${items[i].absence_id}:${items[i].period_number}`;
    if (seenSlots.has(key)) {
      return NextResponse.json(
        {
          error:
            `العنصر ${i + 1} مكرَّر — نفس (absence_id=${items[i].absence_id}, period_number=${items[i].period_number}) ظهر سابقًا في الـ batch`,
        },
        { status: 400 },
      );
    }
    seenSlots.add(key);
  }

  const admin = createAdminSupabaseClient();
  const results: ItemResult[] = [];

  // Serial loop. Each iteration's pre-checks see the previous
  // iteration's inserts, so a same-substitute conflict in a single
  // batch is caught with a friendly 400 not a raw DB 23505.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const result = await assignSubstitute(admin, item, auth.ctx.userId);

    if (result.ok) {
      // Per-item audit. `bulk: true` + `bulk_index` lets us reconstruct
      // a batch later by filtering audit_logs.
      await writeAuditLog({
        ctx: auth.ctx,
        action: 'substitution.assign',
        targetType: 'absence',
        targetId: String(item.absence_id),
        details: {
          ...result.audit_details,
          bulk: true,
          bulk_index: i,
          bulk_total: items.length,
        },
        request,
      });

      results.push({
        index: i,
        status: 'succeeded',
        assignment: {
          id: result.assignment.id,
          absence_id: result.assignment.absence_id,
          substitute_user_id: result.assignment.substitute_user_id,
          period_number: result.assignment.period_number,
        },
      });
    } else {
      results.push({
        index: i,
        status: 'failed',
        error: result.error,
        http_status: result.status,
        input: item,
      });
    }
  }

  const succeeded = results.filter((r) => r.status === 'succeeded').length;
  const failed = results.length - succeeded;

  // 201 for all-success, 207 Multi-Status for partial. Never 500 for
  // a per-item failure — the batch itself processed correctly.
  const httpStatus = failed === 0 ? 201 : 207;

  return NextResponse.json(
    {
      data: {
        total: items.length,
        succeeded,
        failed,
        results,
      },
    },
    { status: httpStatus },
  );
}
