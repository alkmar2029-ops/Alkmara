import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { academicYearRolloverSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

function rolloverError(message: string): string {
  if (message.includes('already exists')) return 'العام الدراسي الجديد موجود مسبقاً ولا يمكن فتحه مرة أخرى.';
  if (message.includes('already exists with status')) return 'العام الدراسي الجديد موجود بحالة لا تسمح بإعادة فتحه.';
  if (message.includes('completed rollover')) return 'لا توجد عملية افتتاح مكتملة قابلة للتراجع.';
  if (message.includes('rollback window has expired')) return 'انتهت مهلة التراجع الآمن (24 ساعة).';
  if (message.includes('new-year activity exists')) return 'بدأ تسجيل بيانات في العام الجديد؛ تم منع التراجع لحماية السجلات.';
  if (message.includes('student assignments changed')) return 'تغيّرت بيانات طلاب بعد افتتاح العام؛ تم منع التراجع لحماية البيانات.';
  if (message.includes('current academic year')) return 'لم يتم إعداد عام دراسي حالي مفتوح.';
  return message;
}
export async function GET() {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const [{ data: preview, error: previewError }, { data: years, error: yearsError }, { data: rollovers, error: rolloverErrorResult }] = await Promise.all([
    supabase.rpc('preview_academic_year_rollover'),
    supabase.from('academic_years')
      .select('id, name, start_date, end_date, status, opened_at, closed_at, created_at')
      .order('start_date', { ascending: false }),
    supabase.from('academic_year_rollovers')
      .select('id, from_academic_year_id, to_academic_year_id, status, promoted_count, graduated_count, unassigned_section_count, created_at, completed_at, reversed_at, summary')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const error = previewError || yearsError || rolloverErrorResult;
  if (error) {
    return NextResponse.json({ error: rolloverError(error.message) }, { status: 500 });
  }

  const latestCompleted = (rollovers || []).find((item) => item.status === 'completed');
  const canRollback = Boolean(
    latestCompleted?.completed_at
      && Date.now() - new Date(latestCompleted.completed_at).getTime() <= 24 * 60 * 60 * 1000,
  );

  return NextResponse.json({
    data: {
      ...((preview || {}) as object),
      years: years || [],
      rollovers: rollovers || [],
      rollback: latestCompleted ? { ...latestCompleted, can_rollback: canRollback } : null,
    },
  }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات الطلب غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(academicYearRolloverSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  if (validation.data.action === 'rollback') {
    const { data, error } = await supabase.rpc('rollback_academic_year_rollover', {
      p_rollover_id: validation.data.rollover_id,
    });
    if (error) return NextResponse.json({ error: rolloverError(error.message) }, { status: 409 });

    await writeAuditLog({
      ctx: auth.ctx,
      action: 'academic_year.rollback',
      targetType: 'academic_year_rollover',
      targetId: validation.data.rollover_id,
      details: data as Record<string, unknown>,
      request,
    });

    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const { data, error } = await supabase.rpc('open_next_academic_year', {
    p_new_year_name: validation.data.new_year_name,
    p_start_date: validation.data.start_date,
    p_end_date: validation.data.end_date,
    p_idempotency_key: validation.data.idempotency_key,
  });
  if (error) return NextResponse.json({ error: rolloverError(error.message) }, { status: 409 });

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'academic_year.rollover',
    targetType: 'academic_year',
    targetId: String((data as { rollover_id?: string } | null)?.rollover_id || ''),
    details: data as Record<string, unknown>,
    request,
  });

  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
