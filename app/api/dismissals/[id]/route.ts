import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — single dismissal record (used by the print exit-pass page).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('student_dismissals')
    .select(`
      *,
      students!inner ( id, student_id, first_name, father_name, last_name, phone,
        sections!inner ( id, name, grades!inner ( id, name ) )
      )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'الاستئذان غير موجود' }, { status: 404 });
  }

  const r: any = data;
  const flat = {
    id: r.id,
    student_id: r.student_id,
    student_code: r.students?.student_id,
    student_name: [r.students?.first_name, r.students?.father_name, r.students?.last_name].filter(Boolean).join(' ').trim(),
    student_phone: r.students?.phone,
    grade_name: r.students?.sections?.grades?.name,
    section_name: r.students?.sections?.name,
    dismissal_date: r.dismissal_date,
    dismissal_time: r.dismissal_time,
    reason: r.reason,
    reason_details: r.reason_details,
    pickup_person_name: r.pickup_person_name,
    pickup_person_relationship: r.pickup_person_relationship,
    pickup_person_id_number: r.pickup_person_id_number,
    pickup_person_phone: r.pickup_person_phone,
    approved_by: r.approved_by,
    approved_by_name: r.approved_by_name,
    notes: r.notes,
    whatsapp_sent_at: r.whatsapp_sent_at,
    whatsapp_error: r.whatsapp_error,
    auto_excused_periods: r.auto_excused_periods,
    created_at: r.created_at,
  };

  return NextResponse.json({ data: flat }, { headers: { 'Cache-Control': 'no-store' } });
}

// DELETE — admin only. Auto-excused period_absences rows are NOT rolled
// back automatically; teachers can correct them manually if needed. The
// deleted row is logged in audit_logs for accountability.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from('student_dismissals')
    .select('student_id, dismissal_date')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase.from('student_dismissals').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'تعذّر الحذف' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'dismissal.delete',
    targetType: 'dismissal',
    targetId: id,
    details: existing ?? undefined,
    request,
  });

  return NextResponse.json({ message: 'تم الحذف' });
}
