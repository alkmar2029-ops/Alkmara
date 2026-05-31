// POST /api/vp/substitutions/assign — assign a substitute to a single
// absent teacher's class period.
//
// Thin route. The full validation set (7 invariants — Codex Sprint 2)
// lives in lib/substitution/assigner.ts so it stays in lockstep with
// the bulk endpoint (م2.9). This file is just: gate → parse → call →
// audit → respond.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireManageSubstitutions } from '@/lib/personas/auth-gate';
import { assignSubstitute } from '@/lib/substitution/assigner';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    absence_id: z.number().int().positive(),
    substitute_user_id: z.string().uuid(),
    period_number: z.number().int().min(1).max(8),
  })
  .strict();

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

  const admin = createAdminSupabaseClient();
  const result = await assignSubstitute(admin, parsed.data, auth.ctx.userId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'substitution.assign',
    targetType: 'absence',
    targetId: String(parsed.data.absence_id),
    // Spread to widen the interface type to Record<string, unknown>
    // (which writeAuditLog requires). The fields are identical.
    details: { ...result.audit_details },
    request,
  });

  return NextResponse.json({ data: result.assignment }, { status: 201 });
}
