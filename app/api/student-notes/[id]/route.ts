import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// Mirror the CHECK constraints on student_notes — keep in sync with
// 2026_04_27_student_notes.sql.
const NOTE_TYPES = ['positive', 'negative'] as const;
const NOTE_CATEGORIES = ['academic', 'behavior', 'attendance', 'participation', 'general'] as const;

// Two kinds of PATCH in one endpoint:
//   - stamps:  { mark_printed } / { mark_whatsapp_sent } — the print
//     pages' original contract, unchanged.
//   - content: { text, type, category } — the history view's edit
//     modal. Ownership-gated below (own note, or super_admin).
const patchSchema = z.object({
  mark_printed: z.boolean().optional(),
  mark_whatsapp_sent: z.boolean().optional(),
  text: z.string().trim().min(2, 'نص الملاحظة قصير جداً').max(1000).optional(),
  type: z.enum(NOTE_TYPES).optional(),
  category: z.enum(NOTE_CATEGORIES).optional(),
}).strict();

// PATCH — stamp printed/whatsapp timestamps, or edit the note content.
//
// Stamps keep the old semantics: any allowed role can stamp rows RLS
// lets them update (teachers their own, staff/admin any).
//
// Content edits are ownership-gated at the API: the recorder can edit
// their own note; super_admin can edit any note. Editing does NOT
// retract an already-delivered WhatsApp message — the UI warns, and
// the audit entry records whatsapp_already_sent.
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(['admin', 'staff', 'teacher']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  let raw: unknown = {};
  try { raw = await request.json(); } catch { /* empty body is OK */ }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const stampPatch: Record<string, unknown> = {};
  if (body.mark_printed) stampPatch.printed_at = new Date().toISOString();
  if (body.mark_whatsapp_sent) stampPatch.whatsapp_sent_at = new Date().toISOString();

  const contentPatch: Record<string, unknown> = {};
  if (body.text !== undefined) contentPatch.text = body.text;
  if (body.type !== undefined) contentPatch.type = body.type;
  if (body.category !== undefined) contentPatch.category = body.category;

  if (Object.keys(stampPatch).length === 0 && Object.keys(contentPatch).length === 0) {
    return NextResponse.json({ error: 'لا توجد حقول للتحديث' }, { status: 400 });
  }

  const isSuper = auth.ctx.role === 'super_admin';
  const isContentEdit = Object.keys(contentPatch).length > 0;
  let existing: {
    recorded_by: string | null;
    student_id: number;
    whatsapp_sent_at: string | null;
  } | null = null;

  if (isContentEdit) {
    // Admin client for the precheck so 404 vs 403 is accurate
    // regardless of RLS visibility.
    const admin = createAdminSupabaseClient();
    const rowRes = await admin
      .from('student_notes')
      .select('id, recorded_by, student_id, whatsapp_sent_at')
      .eq('id', id)
      .maybeSingle();
    if (rowRes.error) {
      return NextResponse.json({ error: 'فشل جلب الملاحظة' }, { status: 500 });
    }
    if (!rowRes.data) {
      return NextResponse.json({ error: 'الملاحظة غير موجودة' }, { status: 404 });
    }
    existing = rowRes.data;
    if (!isSuper && existing.recorded_by !== auth.ctx.userId) {
      return NextResponse.json(
        { error: 'لا يمكنك تعديل ملاحظة سجّلها مستخدم آخر' },
        { status: 403 },
      );
    }
  }

  // User-bound client — RLS stays a second boundary (teachers can only
  // update their own rows; staff/admin/super pass the staff policy).
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('student_notes')
    .update({ ...stampPatch, ...contentPatch })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في التحديث' }, { status: 500 });
  }

  if (isContentEdit && existing) {
    await writeAuditLog({
      ctx: auth.ctx,
      action: 'student_notes.update',
      targetType: 'student_note',
      targetId: id,
      details: {
        fields: Object.keys(contentPatch),
        student_id: existing.student_id,
        whatsapp_already_sent: !!existing.whatsapp_sent_at,
        admin_override: isSuper && existing.recorded_by !== auth.ctx.userId,
      },
      request,
    });
  }

  return NextResponse.json({ data });
}

// DELETE — the recorder can delete their own note; super_admin any.
//
// RLS DELETE on student_notes is admin-only, so the teacher path runs
// on the service-role client after explicit ownership checks — this
// handler IS the security boundary (same pattern as the incidents
// withdraw endpoint). Deleting does NOT retract an already-delivered
// WhatsApp message; the audit entry preserves what was deleted.
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(['admin', 'staff', 'teacher']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const rowRes = await admin
    .from('student_notes')
    .select('id, recorded_by, student_id, type, text, whatsapp_sent_at')
    .eq('id', id)
    .maybeSingle();
  if (rowRes.error) {
    return NextResponse.json({ error: 'فشل جلب الملاحظة' }, { status: 500 });
  }
  if (!rowRes.data) {
    return NextResponse.json({ error: 'الملاحظة غير موجودة' }, { status: 404 });
  }
  const row = rowRes.data;

  const isSuper = auth.ctx.role === 'super_admin';
  if (!isSuper && row.recorded_by !== auth.ctx.userId) {
    return NextResponse.json(
      { error: 'لا يمكنك حذف ملاحظة سجّلها مستخدم آخر' },
      { status: 403 },
    );
  }

  const { error } = await admin.from('student_notes').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في الحذف' }, { status: 500 });
  }

  // Audit AFTER the delete — audit_logs has no FK to student_notes, so
  // the trail (including the deleted text length and type) survives.
  await writeAuditLog({
    ctx: auth.ctx,
    action: 'student_notes.delete',
    targetType: 'student_note',
    targetId: id,
    details: {
      student_id: row.student_id,
      type: row.type,
      text_length: row.text?.length ?? 0,
      recorded_by: row.recorded_by,
      whatsapp_already_sent: !!row.whatsapp_sent_at,
      admin_override: isSuper && row.recorded_by !== auth.ctx.userId,
    },
    request,
  });

  return NextResponse.json({ message: 'تم الحذف' });
}
