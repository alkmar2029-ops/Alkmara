// GET /api/admin/counselor-assignments — list all counselor → student-scope
//    assignments. The counselor's name is resolved via a separate
//    user_profiles query because counselor_user_id is FK'd to auth.users
//    (not user_profiles), so PostgREST can't embed user_profiles through
//    the FK relationship. Grades + sections DO live in public with direct
//    FKs from counselor_assignments, so those are embedded inline.
//    Supports ?counselor_user_id= filter.
//
// POST /api/admin/counselor-assignments — create a new assignment for a
//    counselor. Body enforces the XOR explicitly (grade_id XOR section_id)
//    on top of the DB CHECK constraint — fail-fast in the API gives a
//    clearer error message than a Postgres constraint violation.
//
// Both share the gate (super_admin OR manage_users via the shared
// `requireManageUsers` helper). POST also audit-logs the creation.

import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import { requireManageUsers } from '@/lib/personas/auth-gate';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Body schema with explicit XOR refinement. The DB CHECK constraint
// catches it too, but doing it in Zod gives a friendly Arabic error.
const createAssignmentSchema = z
  .object({
    counselor_user_id: z.string().uuid(),
    grade_id: z.number().int().positive().optional(),
    section_id: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (d) => (d.grade_id != null) !== (d.section_id != null),
    {
      message:
        'يجب تحديد grade_id واحد فقط أو section_id واحد فقط (لا كلاهما ولا أيهما)',
    },
  );

// ============= GET: list assignments =============
export async function GET(request: NextRequest) {
  const auth = await requireManageUsers();
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();

  const url = new URL(request.url);
  const filterCounselor = url.searchParams.get('counselor_user_id');

  // 1) Fetch assignments. Embed grades + sections (public→public FKs,
  //    PostgREST resolves them). Do NOT embed user_profiles — the
  //    counselor_user_id FK points to auth.users, not user_profiles,
  //    so the embed would either fail or return null.
  let query = admin
    .from('counselor_assignments')
    .select(`
      id,
      counselor_user_id,
      grade_id,
      section_id,
      assigned_by,
      assigned_at,
      grade:grades(name),
      section:sections(name, grade_id)
    `)
    .order('assigned_at', { ascending: false });

  if (filterCounselor) {
    query = query.eq('counselor_user_id', filterCounselor);
  }

  const { data: assignments, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: 'فشل جلب الإسنادات: ' + error.message },
      { status: 500 },
    );
  }

  // 2) Resolve counselor names via a separate query. Distinct ids only
  //    to keep the IN clause small when the same counselor has multiple
  //    assignments.
  const counselorIds = Array.from(
    new Set((assignments ?? []).map((a) => a.counselor_user_id)),
  );
  const profileMap = new Map<string, { full_name: string | null }>();
  if (counselorIds.length > 0) {
    const { data: profiles, error: profilesErr } = await admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', counselorIds);
    if (profilesErr) {
      return NextResponse.json(
        { error: 'فشل جلب أسماء المرشدين: ' + profilesErr.message },
        { status: 500 },
      );
    }
    for (const p of profiles ?? []) {
      profileMap.set(p.user_id, { full_name: p.full_name });
    }
  }

  // 3) Merge — surface counselor name alongside the rest of the row.
  const data = (assignments ?? []).map((a) => ({
    ...a,
    counselor: profileMap.get(a.counselor_user_id) ?? { full_name: null },
  }));

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// ============= POST: create assignment =============
export async function POST(request: NextRequest) {
  const auth = await requireManageUsers();
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
  const parsed = createAssignmentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const admin = createAdminSupabaseClient();

  // Verify the counselor exists, is an admin row, and has persona=counselor.
  // Assigning scope to a non-counselor is technically harmless
  // (counselor_can_see_student would still return FALSE) but it's a
  // confusing workflow — refuse with a clear hint instead.
  const { data: counselor, error: counselorErr } = await admin
    .from('user_profiles')
    .select('user_id, role, full_name, permissions')
    .eq('user_id', body.counselor_user_id)
    .maybeSingle();

  if (counselorErr) {
    return NextResponse.json(
      { error: 'فشل قراءة بيانات المرشد: ' + counselorErr.message },
      { status: 500 },
    );
  }
  if (!counselor) {
    return NextResponse.json(
      { error: 'المستخدم المحدد غير موجود' },
      { status: 404 },
    );
  }
  if (counselor.role !== 'admin' && counselor.role !== 'super_admin') {
    return NextResponse.json(
      { error: 'لا يمكن إسناد نطاق إلا لمستخدم إداري' },
      { status: 400 },
    );
  }
  const counselorPerms = (counselor.permissions ?? {}) as Record<string, unknown>;
  if (counselorPerms.persona !== 'counselor') {
    return NextResponse.json(
      {
        error:
          'هذا المستخدم ليس مرشدًا. عدّل persona إلى counselor أولًا من شاشة الأدوار.',
      },
      { status: 400 },
    );
  }

  // Verify the referenced grade/section actually exists. The FK would
  // catch it too, but a 404 with a clear message beats a generic FK
  // violation. Both error AND missing-data are surfaced.
  if (body.grade_id != null) {
    const { data: grade, error: gradeErr } = await admin
      .from('grades')
      .select('id')
      .eq('id', body.grade_id)
      .maybeSingle();
    if (gradeErr) {
      return NextResponse.json(
        { error: 'فشل التحقق من الصف: ' + gradeErr.message },
        { status: 500 },
      );
    }
    if (!grade) {
      return NextResponse.json(
        { error: 'الصف المحدد غير موجود' },
        { status: 404 },
      );
    }
  }
  if (body.section_id != null) {
    const { data: section, error: sectionErr } = await admin
      .from('sections')
      .select('id')
      .eq('id', body.section_id)
      .maybeSingle();
    if (sectionErr) {
      return NextResponse.json(
        { error: 'فشل التحقق من الشعبة: ' + sectionErr.message },
        { status: 500 },
      );
    }
    if (!section) {
      return NextResponse.json(
        { error: 'الشعبة المحددة غير موجودة' },
        { status: 404 },
      );
    }
  }

  // Insert. UNIQUE constraint catches duplicates.
  const { data: inserted, error: insertErr } = await admin
    .from('counselor_assignments')
    .insert({
      counselor_user_id: body.counselor_user_id,
      grade_id: body.grade_id ?? null,
      section_id: body.section_id ?? null,
      assigned_by: auth.ctx.userId,
    })
    .select('id, counselor_user_id, grade_id, section_id, assigned_at')
    .single();

  if (insertErr) {
    // Postgres unique violation = duplicate assignment.
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { error: 'هذا الإسناد موجود مسبقًا' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'فشل الإسناد: ' + insertErr.message },
      { status: 500 },
    );
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'counselor_assignment.create',
    targetType: 'counselor',
    targetId: body.counselor_user_id,
    details: {
      assignment_id: inserted.id,
      counselor_name: counselor.full_name,
      scope_type: body.grade_id != null ? 'grade' : 'section',
      grade_id: body.grade_id ?? null,
      section_id: body.section_id ?? null,
    },
    request,
  });

  return NextResponse.json({ data: inserted }, { status: 201 });
}
