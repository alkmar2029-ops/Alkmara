// /api/vp/teacher-leaves — admin-side leave request management.
//
//   GET  → list with filters (status, date range, teacher)
//   POST → admin submits on a teacher's behalf (status='pending')
//
// The PATCH decision endpoint lives in [id]/decision/route.ts (م2.10
// part 2).
//
// Teachers submit their OWN requests via /api/teacher/leaves (later
// sprint, not VP-side). The RLS INSERT policy on teacher_leaves allows
// both teacher self-insert (gated by user_id match) and admin entry.
// Teacher UPDATE is NOT in RLS anymore — after migration 005, cancel
// flows go through a dedicated server-role API endpoint that enforces
// status-only changes (tracked as tech debt #9).
//
// Gates:
//   - GET:  requireVpDashboard — listing is read-only operations data
//   - POST: requireApproveTeacherLeave — admin entry is an approval-
//     adjacent action; we keep it behind the stricter gate so a plain
//     VP-academic can't conjure leave requests without intent.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/supabase/auth';
import {
  requireVpDashboard,
  requireApproveTeacherLeave,
} from '@/lib/personas/auth-gate';
import { ksaDateSchema } from '@/lib/dates/ksa';

export const dynamic = 'force-dynamic';

const LEAVE_TYPES = [
  'sick',
  'personal',
  'official',
  'maternity',
  'pilgrimage',
  'other',
] as const;

const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

// ============= GET: list with filters =============
const listQuerySchema = z.object({
  status: z.enum(LEAVE_STATUSES).optional(),
  teacher_user_id: z.string().uuid().optional(),
  // Date overlap filters: returns rows whose range overlaps with
  // [start_date_from, end_date_to] if both provided. ksaDateSchema
  // validates shape + calendar reality.
  start_date_from: ksaDateSchema.optional(),
  end_date_to: ksaDateSchema.optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireVpDashboard();
  if (!auth.ok) return auth.res;

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    teacher_user_id: url.searchParams.get('teacher_user_id') ?? undefined,
    start_date_from: url.searchParams.get('start_date_from') ?? undefined,
    end_date_to: url.searchParams.get('end_date_to') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات الفلتر غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const filters = parsed.data;

  const admin = createAdminSupabaseClient();

  let query = admin
    .from('teacher_leaves')
    .select(
      'id, teacher_user_id, start_date, end_date, leave_type, reason, status, requested_at, decided_by, decided_at, decision_note',
    )
    .order('requested_at', { ascending: false })
    .limit(200);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.teacher_user_id) query = query.eq('teacher_user_id', filters.teacher_user_id);
  // Date range = OVERLAP, not contained-within. A leave overlaps the
  // window [from, to] iff its end_date >= from AND its start_date <= to.
  // The previous version's gte/lte on start_date/end_date implemented
  // "contained" which silently missed leaves that straddled the window.
  // (Codex Sprint 2 should-fix on م2.10.)
  if (filters.start_date_from) query = query.gte('end_date', filters.start_date_from);
  if (filters.end_date_to) query = query.lte('start_date', filters.end_date_to);

  const leavesRes = await query;
  if (leavesRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب الإجازات: ' + leavesRes.error.message },
      { status: 500 },
    );
  }

  const leaves = (leavesRes.data ?? []) as Array<{
    id: number;
    teacher_user_id: string;
    start_date: string;
    end_date: string;
    leave_type: string;
    reason: string | null;
    status: string;
    requested_at: string;
    decided_by: string | null;
    decided_at: string | null;
    decision_note: string | null;
  }>;

  // Resolve names — teacher_user_id + decided_by both FK to auth.users,
  // can't be embedded via PostgREST. One query covers both lookups.
  const userIds = Array.from(
    new Set([
      ...leaves.map((l) => l.teacher_user_id),
      ...leaves.map((l) => l.decided_by).filter((x): x is string => !!x),
    ]),
  );
  const nameMap = new Map<string, string | null>();
  if (userIds.length > 0) {
    const profilesRes = await admin
      .from('user_profiles')
      .select('user_id, full_name')
      .in('user_id', userIds);
    if (profilesRes.error) {
      return NextResponse.json(
        { error: 'فشل جلب الأسماء: ' + profilesRes.error.message },
        { status: 500 },
      );
    }
    for (const p of profilesRes.data ?? []) {
      nameMap.set((p as any).user_id, (p as any).full_name ?? null);
    }
  }

  // Days count = inclusive day count from start_date to end_date.
  // Date strings only, no time component → integer day math is safe.
  const daysCount = (a: string, b: string) => {
    const ms = new Date(`${b}T12:00:00+03:00`).getTime() - new Date(`${a}T12:00:00+03:00`).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
  };

  const data = leaves.map((l) => ({
    ...l,
    teacher_name: nameMap.get(l.teacher_user_id) ?? null,
    decided_by_name: l.decided_by ? nameMap.get(l.decided_by) ?? null : null,
    days_count: daysCount(l.start_date, l.end_date),
  }));

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// ============= POST: admin submit on teacher's behalf =============
const createSchema = z
  .object({
    teacher_user_id: z.string().uuid(),
    start_date: ksaDateSchema,
    end_date: ksaDateSchema,
    leave_type: z.enum(LEAVE_TYPES),
    reason: z.string().max(2000).optional(),
  })
  .strict()
  .refine((d) => d.end_date >= d.start_date, {
    message: 'تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية',
  });

export async function POST(request: NextRequest) {
  const auth = await requireApproveTeacherLeave();
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
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const admin = createAdminSupabaseClient();

  // Validate target user is an active teacher (same gate as POST absences).
  const targetRes = await admin
    .from('user_profiles')
    .select('role, is_active, full_name')
    .eq('user_id', body.teacher_user_id)
    .maybeSingle();
  if (targetRes.error) {
    return NextResponse.json(
      { error: 'فشل التحقق من المعلم: ' + targetRes.error.message },
      { status: 500 },
    );
  }
  if (!targetRes.data) {
    return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
  }
  const target = targetRes.data as {
    role: string;
    is_active: boolean;
    full_name: string | null;
  };
  if (target.role !== 'teacher') {
    return NextResponse.json(
      { error: 'الإجازة تُقدَّم لمستخدم بدور teacher فقط' },
      { status: 400 },
    );
  }
  if (!target.is_active) {
    return NextResponse.json({ error: 'المعلم غير نشط' }, { status: 400 });
  }

  // Insert as 'pending' — admin entry doesn't auto-approve; the
  // separate decision endpoint handles that workflow.
  const insertRes = await admin
    .from('teacher_leaves')
    .insert({
      teacher_user_id: body.teacher_user_id,
      start_date: body.start_date,
      end_date: body.end_date,
      leave_type: body.leave_type,
      reason: body.reason ?? null,
      status: 'pending',
      // requested_at default NOW(), decided_* stays null.
    })
    .select('id, teacher_user_id, start_date, end_date, leave_type, reason, status, requested_at')
    .single();

  if (insertRes.error) {
    return NextResponse.json(
      { error: 'فشل إنشاء طلب الإجازة: ' + insertRes.error.message },
      { status: 500 },
    );
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher_leave.create',
    targetType: 'teacher',
    targetId: body.teacher_user_id,
    details: {
      teacher_name: target.full_name,
      leave_id: insertRes.data.id,
      start_date: body.start_date,
      end_date: body.end_date,
      leave_type: body.leave_type,
      submitted_by_admin: true,
    },
    request,
  });

  return NextResponse.json({ data: insertRes.data }, { status: 201 });
}
