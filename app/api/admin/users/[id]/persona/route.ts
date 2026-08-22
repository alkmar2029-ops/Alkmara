// PATCH /api/admin/users/[id]/persona — update a user's persona, vp_scope,
// vp_grade_scope, and permission flags.
//
// Same auth gate as GET /api/admin/personas (super_admin OR manage_users
// flag). On top of that, four guardrails enforced here:
//
//   1. Target must be an admin (role IN ['admin','super_admin']) — you
//      can't set a persona on a teacher row.
//   2. Modifying a super_admin requires the caller to BE a super_admin.
//      A regular admin with manage_users can't elevate or alter the
//      principal's access.
//   3. Self-modification requires `?force_self=true`. Without it, a
//      principal who accidentally clears their own manage_users flag
//      would lock themselves out of this endpoint.
//   4. `permissions` is MERGED, not replaced — legacy flags not present
//      in the request body are preserved. The UI is the source of truth
//      only for what it shows; hidden/legacy flags must survive.
//
// Audit log records only the *changed* fields (before/after) for
// persona, vp_scope, vp_grade_scope, and individual flags. The full
// JSONB blob is NOT dumped — that would noise up the audit table and
// leak unchanged values.

import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireManageUsers } from '@/lib/personas/auth-gate';
import { z } from 'zod';
import { PERMISSION_KEYS } from '@/lib/validations/schemas';
import {
  PERSONA_VALUES,
  VP_SCOPE_VALUES,
  NEW_PERSONA_FLAG_KEYS,
  isPersona,
  isVpScope,
  type Persona,
  type VpScope,
} from '@/lib/personas/types';

export const dynamic = 'force-dynamic';

// Allowlist for permission flag keys = legacy 10 + new 13 = 23 booleans.
// Used to reject typos in the `permissions` body field instead of
// silently writing junk keys to the JSONB.
const ALL_FLAG_KEYS = new Set<string>([
  ...PERMISSION_KEYS,
  ...NEW_PERSONA_FLAG_KEYS,
]);

const patchPersonaSchema = z
  .object({
    persona: z.enum(PERSONA_VALUES).optional(),
    vp_scope: z.enum(VP_SCOPE_VALUES).nullable().optional(),
    // Array of grade IDs (positive ints). Capped at 20 — no school has
    // more grades; the cap is just a sanity bound.
    vp_grade_scope: z
      .array(z.number().int().positive())
      .max(20)
      .nullable()
      .optional(),
    // Partial flag map — any subset of allowed keys → boolean. Refined
    // to reject keys outside ALL_FLAG_KEYS so we never write `manage_xxx`
    // typos into the JSONB.
    permissions: z
      .record(z.string(), z.boolean())
      .refine(
        (perms) => Object.keys(perms).every((k) => ALL_FLAG_KEYS.has(k)),
        { message: 'permissions يحتوي على flag غير معروف' },
      )
      .optional(),
  })
  .strict();

// Audit diff shape — entries appear only for actually-changed values.
type ChangePair<T> = { from: T; to: T };
type AuditDiff = {
  persona?: ChangePair<Persona>;
  vp_scope?: ChangePair<VpScope | null>;
  vp_grade_scope?: ChangePair<number[] | null>;
  flags?: Record<string, ChangePair<boolean>>;
};

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // ============= Gate: super_admin OR manage_users =============
  // Centralised in lib/personas/auth-gate.ts. Refactored 2026-05-20 to
  // match م1.3 and م1.5 — was inline before.
  const auth = await requireManageUsers();
  if (!auth.ok) return auth.res;

  const targetId = params.id;

  // ============= Parse + validate body =============
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'صيغة البيانات المرسلة غير صالحة' },
      { status: 400 },
    );
  }
  const parsed = patchPersonaSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // ============= Read target =============
  const admin = createAdminSupabaseClient();
  const { data: target, error: readErr } = await admin
    .from('user_profiles')
    .select('user_id, role, permissions, vp_grade_scope')
    .eq('user_id', targetId)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json(
      { error: 'فشل قراءة بيانات المستخدم: ' + readErr.message },
      { status: 500 },
    );
  }
  if (!target) {
    return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
  }

  // Only admin rows have personas. A teacher with persona='counselor' is
  // a corruption case — block it at the API.
  if (target.role !== 'admin' && target.role !== 'super_admin') {
    return NextResponse.json(
      { error: 'لا يمكن تعديل الـ persona لمستخدم غير إداري' },
      { status: 400 },
    );
  }

  // ============= Guardrail: super_admin protection =============
  if (target.role === 'super_admin' && auth.ctx.role !== 'super_admin') {
    return NextResponse.json(
      { error: 'تعديل super_admin يتطلب super_admin' },
      { status: 403 },
    );
  }

  // ============= Guardrail: self-modification =============
  // Caller editing their own row may accidentally lock themselves out
  // (e.g., clearing manage_users → can't unlock themselves). Require
  // explicit ?force_self=true to confirm intent.
  const url = new URL(request.url);
  const forceSelf = url.searchParams.get('force_self') === 'true';
  if (targetId === auth.ctx.userId && !forceSelf) {
    return NextResponse.json(
      {
        error: 'تعديل صلاحياتك الذاتية يتطلب ?force_self=true (احتراز من فقد الوصول)',
        hint: 'أضف ?force_self=true إلى URL الطلب لو متأكد من نيتك.',
      },
      { status: 403 },
    );
  }

  // ============= Build the merged permissions JSONB =============
  // CRITICAL: do NOT replace the whole JSONB. Spread the existing keys
  // first, then overlay the changes. Legacy / hidden flags survive.
  const existingPerms = (target.permissions ?? {}) as Record<string, unknown>;
  const newPerms: Record<string, unknown> = { ...existingPerms };

  // Apply persona change (lives inside the JSONB at the key "persona")
  if (body.persona !== undefined) {
    newPerms.persona = body.persona;
  }

  // Apply vp_scope change: null = delete the key (cleaner than storing null)
  if (body.vp_scope !== undefined) {
    if (body.vp_scope === null) {
      delete newPerms.vp_scope;
    } else {
      newPerms.vp_scope = body.vp_scope;
    }
  }

  // Apply individual flag changes. Skip the special string keys —
  // persona/vp_scope must use their dedicated top-level body fields.
  if (body.permissions) {
    for (const [key, value] of Object.entries(body.permissions)) {
      if (key === 'persona' || key === 'vp_scope') continue;
      newPerms[key] = value;
    }
  }

  // ============= Persona consistency (DB CHECK constraints + cleanup) =============
  // Resolve the final values that will land in the row.
  const finalPersona: Persona = isPersona(newPerms.persona)
    ? newPerms.persona
    : 'general_admin';
  let finalVpScope: VpScope | null = isVpScope(newPerms.vp_scope)
    ? newPerms.vp_scope
    : null;
  let finalVpGradeScope: number[] | null =
    body.vp_grade_scope !== undefined
      ? body.vp_grade_scope
      : target.vp_grade_scope ?? null;

  // VP requires a scope.
  if (finalPersona === 'vice_principal' && finalVpScope === null) {
    return NextResponse.json(
      { error: 'persona=vice_principal يتطلب vp_scope' },
      { status: 400 },
    );
  }

  // Non-VP must not carry vp_scope or vp_grade_scope. Clean them up
  // silently — prevents inconsistent state when a user is moved out of
  // a VP role without explicitly clearing these.
  if (finalPersona !== 'vice_principal') {
    delete newPerms.vp_scope;
    finalVpScope = null;
    finalVpGradeScope = null;
  }

  // ============= Apply update =============
  const { error: updateErr } = await admin
    .from('user_profiles')
    .update({
      permissions: newPerms,
      vp_grade_scope: finalVpGradeScope,
    })
    .eq('user_id', targetId);

  if (updateErr) {
    return NextResponse.json(
      { error: 'فشل التحديث: ' + updateErr.message },
      { status: 500 },
    );
  }

  // ============= Compute audit diff (changed values only) =============
  const oldPersona: Persona = isPersona(existingPerms.persona)
    ? existingPerms.persona
    : 'general_admin';
  const oldVpScope: VpScope | null = isVpScope(existingPerms.vp_scope)
    ? existingPerms.vp_scope
    : null;
  const oldVpGradeScope: number[] | null = target.vp_grade_scope ?? null;

  const diff: AuditDiff = {};

  if (oldPersona !== finalPersona) {
    diff.persona = { from: oldPersona, to: finalPersona };
  }
  if (oldVpScope !== finalVpScope) {
    diff.vp_scope = { from: oldVpScope, to: finalVpScope };
  }
  // Arrays: compare via JSON serialization (order-sensitive — that's OK,
  // the UI sorts grade ids before submitting).
  if (JSON.stringify(oldVpGradeScope) !== JSON.stringify(finalVpGradeScope)) {
    diff.vp_grade_scope = { from: oldVpGradeScope, to: finalVpGradeScope };
  }

  if (body.permissions) {
    const flagDiff: Record<string, ChangePair<boolean>> = {};
    for (const [key, newVal] of Object.entries(body.permissions)) {
      if (key === 'persona' || key === 'vp_scope') continue;
      const oldVal = existingPerms[key] === true; // coerce missing/non-bool to false
      if (oldVal !== newVal) {
        flagDiff[key] = { from: oldVal, to: newVal };
      }
    }
    if (Object.keys(flagDiff).length > 0) {
      diff.flags = flagDiff;
    }
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'admin.persona_update',
    targetType: 'admin',
    targetId,
    details: {
      target_role: target.role,
      self_modification: targetId === auth.ctx.userId,
      changes: diff,
    },
    request,
  });

  // ============= Response =============
  return NextResponse.json({
    data: {
      user_id: targetId,
      role: target.role,
      persona: finalPersona,
      vp_scope: finalVpScope,
      vp_grade_scope: finalVpGradeScope,
      changes_count:
        (diff.persona ? 1 : 0) +
        (diff.vp_scope ? 1 : 0) +
        (diff.vp_grade_scope ? 1 : 0) +
        (diff.flags ? Object.keys(diff.flags).length : 0),
    },
  });
}
