import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';
import { updateMessageStatusSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// PATCH — change status (mark read / archive / close). Only the recipient can.
// RLS enforces this; we additionally set read_at when status moves to 'read'.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(updateMessageStatusSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const patch: any = { status: v.data.status };
  if (v.data.status === 'read') patch.read_at = new Date().toISOString();

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from('internal_messages')
    .update(patch)
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'فشل التحديث: ' + error.message }, { status: 500 });
  }
  return NextResponse.json({ message: 'تم' });
}
