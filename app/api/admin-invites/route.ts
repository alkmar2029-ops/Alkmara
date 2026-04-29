import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext, writeAuditLog } from '@/lib/supabase/auth';
import { generateInviteCode, computeInviteCodeExpiry } from '@/lib/admins/invite-codes';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  invitee_name: z.string().min(2, 'اسم المدعو مطلوب').max(200),
  invitee_phone: z.string()
    .regex(/^(9665\d{8}|05\d{8})$/, 'رقم الجوال غير صالح')
    .optional()
    .or(z.literal('')),
  suggested_section_ids: z.array(z.number().int().positive()).max(50).optional(),
});

// GET — list invite codes the principal has issued. Sorted active-first
// so the principal sees pending codes at the top.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'مخصّص للمدير العام فقط' }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from('admin_invite_codes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: 'فشل جلب الرموز' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const flat = (data || []).map((r: any) => ({
    ...r,
    is_active: !r.used_at && !r.revoked_at && r.expires_at > now,
    is_expired: !r.used_at && !r.revoked_at && r.expires_at <= now,
  }));

  return NextResponse.json({ data: flat }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — generate a new invite code. Re-tries on the (rare) UUID-style
// collision so the principal never sees a "duplicate code" error.
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'مخصّص للمدير العام فقط' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'بيانات غير صالحة' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // Three retries on UNIQUE-constraint collision before giving up — the
  // odds of a collision in a 23×23×23×23×8×8×8×8 space are astronomically
  // low, but cheap to handle gracefully.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateInviteCode();
    const expiresAt = computeInviteCodeExpiry();
    const { data, error } = await admin
      .from('admin_invite_codes')
      .insert({
        code,
        invitee_name: parsed.data.invitee_name.trim(),
        invitee_phone: parsed.data.invitee_phone || null,
        suggested_section_ids: parsed.data.suggested_section_ids || null,
        created_by: ctx.userId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (!error && data) {
      await writeAuditLog({
        ctx,
        action: 'admin_invite.create',
        targetType: 'admin_invite',
        targetId: data.id,
        details: {
          invitee_name: parsed.data.invitee_name,
          suggested_sections: parsed.data.suggested_section_ids?.length || 0,
        },
        request,
      });
      return NextResponse.json({ data }, { status: 201 });
    }
    // Code collision → loop and try a fresh one.
    if (error?.code !== '23505') {
      console.error('admin_invites insert failed:', error?.message);
      return NextResponse.json({ error: 'تعذّر إنشاء الرمز' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'تعذّر توليد رمز فريد، حاول مجدداً' }, { status: 500 });
}
