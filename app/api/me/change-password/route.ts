import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';
import { changePasswordSchema, validateBody } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// POST — change my own password. Requires being signed in (any role).
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(changePasswordSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { error } = await admin.auth.admin.updateUserById(ctx.userId, {
    password: v.data.new_password,
  });
  if (error) {
    return NextResponse.json({ error: 'فشل تغيير كلمة السر: ' + error.message }, { status: 500 });
  }
  return NextResponse.json({ message: 'تم تغيير كلمة السر' });
}
