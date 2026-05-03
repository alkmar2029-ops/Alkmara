import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

interface CommitInput {
  // The parsed teacher records (from /api/teacher-schedule preview),
  // already enriched with the admin's chosen teacher_user_id mapping.
  teachers: Array<{
    teacher_name: string;
    teacher_user_id: string | null;       // null = couldn't match, allowed
    cells: Array<{
      day_of_week: number;
      period_number: number;
      duty_type: 'class' | 'monitoring' | 'free';
      section_id: number | null;          // resolved at preview time
      subject: string | null;
      monitoring_target: number | null;
    }>;
  }>;
}

/**
 * Commit a parsed schedule to the database, replacing the previous one.
 *
 * Replace-all semantics: we DELETE every row in teacher_schedule first,
 * then INSERT the new set. This matches user expectation ("uploading a
 * new schedule replaces the old") and keeps the table coherent — no
 * stray rows from a teacher who got removed between uploads.
 *
 * The whole operation runs through the service-role client so RLS
 * never gets in the way; the caller has already passed requireRole
 * above this point.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: CommitInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات غير صالحة' }, { status: 400 });
  }

  if (!Array.isArray(body.teachers) || body.teachers.length === 0) {
    return NextResponse.json({ error: 'لا يوجد معلمون للحفظ' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // 1. Replace-all: clear the table.
  const { error: delErr } = await admin
    .from('teacher_schedule')
    .delete()
    .gt('id', 0);  // matches every row; .delete() requires a filter
  if (delErr) {
    return NextResponse.json(
      { error: 'فشل حذف الجدول السابق: ' + delErr.message },
      { status: 500 },
    );
  }

  // 2. Insert all rows. We only persist 'class' and 'monitoring' rows —
  // 'free' periods are absence-of-data, no need to bloat the table.
  const rowsToInsert: any[] = [];
  for (const t of body.teachers) {
    if (!t.teacher_user_id) continue;  // skip unmatched teachers entirely
    for (const c of t.cells) {
      if (c.duty_type === 'free') continue;
      if (c.duty_type === 'class' && !c.section_id) continue;  // missing section
      rowsToInsert.push({
        teacher_user_id: t.teacher_user_id,
        teacher_name: t.teacher_name,
        day_of_week: c.day_of_week,
        period_number: c.period_number,
        section_id: c.duty_type === 'class' ? c.section_id : null,
        subject: c.subject,
        duty_type: c.duty_type,
        monitoring_target: c.monitoring_target,
        imported_by: auth.ctx.userId,
      });
    }
  }

  if (rowsToInsert.length === 0) {
    return NextResponse.json({ error: 'لم يتم تحديد أي خانة قابلة للحفظ' }, { status: 400 });
  }

  // Insert in chunks to stay under Supabase's request size limit.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const slice = rowsToInsert.slice(i, i + CHUNK);
    const { error: insErr } = await admin.from('teacher_schedule').insert(slice);
    if (insErr) {
      return NextResponse.json(
        { error: `فشل إدراج الجدول: ${insErr.message}`, inserted },
        { status: 500 },
      );
    }
    inserted += slice.length;
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher_schedule.import',
    targetType: 'teacher_schedule',
    targetId: null,
    details: {
      teachers_committed: body.teachers.filter((t) => t.teacher_user_id).length,
      rows_inserted: inserted,
    },
    request,
  });

  return NextResponse.json({
    data: {
      teachers_committed: body.teachers.filter((t) => t.teacher_user_id).length,
      teachers_skipped_unmatched: body.teachers.filter((t) => !t.teacher_user_id).length,
      rows_inserted: inserted,
    },
  });
}
