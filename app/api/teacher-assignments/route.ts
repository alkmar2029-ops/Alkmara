import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

const upsertSchema = z.object({
  teacher_user_id: z.string().uuid(),
  section_ids: z.array(z.number().int().positive()).max(200),
});

// GET — full assignment matrix for the admin UI.
//
// Returns a flat list, plus the teacher and section dimensions so the
// front-end can render the toggle grid in one fetch.
export async function GET() {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();

  // Three queries in parallel — they're independent.
  const [{ data: assignments }, { data: teachers }, { data: sections }] = await Promise.all([
    admin
      .from('teacher_section_assignments')
      .select('id, teacher_user_id, section_id, assigned_by, assigned_at'),
    admin
      .from('user_profiles')
      .select('user_id, full_name, is_active')
      .eq('role', 'teacher')
      .eq('is_active', true)
      .order('full_name'),
    admin
      .from('sections')
      .select('id, name, grade_id, sort_order, grades(id, name, sort_order)')
      .order('grade_id')
      .order('sort_order'),
  ]);

  const sortedSections = (sections || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    grade_id: s.grade_id,
    grade_name: s.grades?.name || '—',
    grade_sort: s.grades?.sort_order ?? 0,
    sort_order: s.sort_order ?? 0,
  })).sort((a, b) =>
    a.grade_sort - b.grade_sort
    || a.grade_name.localeCompare(b.grade_name, 'ar')
    || a.sort_order - b.sort_order
    || a.name.localeCompare(b.name, 'ar'),
  );

  return NextResponse.json({
    data: {
      assignments: assignments || [],
      teachers: teachers || [],
      sections: sortedSections,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — replace one teacher's full assignment list.
//
// We diff the incoming `section_ids` against the current set so the audit
// log sees exactly what changed (e.g. "added الأول/أ, removed الثاني/ب")
// instead of "user X reassigned everything".
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }
  const { teacher_user_id, section_ids } = parsed.data;

  const admin = createAdminSupabaseClient();

  // 1. Verify the target user is actually a teacher; we don't want admins
  // accidentally assigning sections to a viewer or non-existent uid.
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role, full_name')
    .eq('user_id', teacher_user_id)
    .maybeSingle();
  if (!profile || profile.role !== 'teacher') {
    return NextResponse.json({ error: 'المستخدم ليس معلماً' }, { status: 400 });
  }

  // 2. Diff for audit context.
  const { data: existing } = await admin
    .from('teacher_section_assignments')
    .select('section_id')
    .eq('teacher_user_id', teacher_user_id);
  const existingIds = new Set((existing || []).map((r: any) => r.section_id as number));
  const incomingIds = new Set(section_ids);
  const toAdd = section_ids.filter((id) => !existingIds.has(id));
  const toRemove = Array.from(existingIds).filter((id) => !incomingIds.has(id));

  // 3. Apply changes — small N (typical school: <30 sections), so just
  // delete-removed + insert-added rather than a full table-rewrite.
  if (toRemove.length > 0) {
    const { error: delErr } = await admin
      .from('teacher_section_assignments')
      .delete()
      .eq('teacher_user_id', teacher_user_id)
      .in('section_id', toRemove);
    if (delErr) {
      console.error('teacher_assignments remove failed:', delErr.message);
      return NextResponse.json({ error: 'تعذّر إزالة بعض التعيينات' }, { status: 500 });
    }
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((section_id) => ({
      teacher_user_id,
      section_id,
      assigned_by: auth.ctx.userId,
    }));
    const { error: insErr } = await admin
      .from('teacher_section_assignments')
      .insert(rows);
    if (insErr) {
      console.error('teacher_assignments insert failed:', insErr.message);
      return NextResponse.json({ error: 'تعذّر إضافة بعض التعيينات' }, { status: 500 });
    }
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher_assignments.update',
    targetType: 'teacher',
    targetId: teacher_user_id,
    details: {
      teacher_name: profile.full_name,
      added: toAdd.length,
      removed: toRemove.length,
      total_now: section_ids.length,
    },
    request,
  });

  return NextResponse.json({
    data: {
      teacher_user_id,
      section_ids,
      added: toAdd.length,
      removed: toRemove.length,
    },
  });
}
