import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';
import { teacherRegistrationSchema, validateBody } from '@/lib/validations/schemas';
import { normalizePhone } from '@/lib/teachers/credentials';
import { sendRegistrationConfirmation } from '@/lib/teachers/registration-confirmation';

export const dynamic = 'force-dynamic';

// POST — public submission. No auth required (middleware allowlist).
// Anyone can apply; admin reviews afterwards. RLS allows anon inserts of
// pending rows only, so this is safe even if the route was bypassed.
export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(teacherRegistrationSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const email = v.data.email.trim().toLowerCase();
  const normalizedPhone = normalizePhone(v.data.phone);

  // Block duplicate pending applications for the same email — gives a clearer
  // message than letting the unique-index error bubble up.
  const { data: existingPending } = await admin
    .from('teacher_registrations')
    .select('id, status')
    .ilike('email', email)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingPending) {
    return NextResponse.json(
      { error: 'يوجد طلب قيد المراجعة بهذا البريد بالفعل' },
      { status: 409 },
    );
  }

  // Block emails already linked to an active teacher account.
  const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const taken = (usersData?.users || []).some(
    (u) => (u.email || '').toLowerCase() === email,
  );
  if (taken) {
    return NextResponse.json(
      { error: 'البريد الإلكتروني مسجّل مسبقاً، تواصل مع الإدارة' },
      { status: 409 },
    );
  }

  const { data, error } = await admin
    .from('teacher_registrations')
    .insert({
      full_name: v.data.full_name.trim(),
      email,
      phone: normalizedPhone,
      status: 'pending',
    })
    .select('id, full_name, email, phone, status, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'فشل حفظ الطلب' }, { status: 500 });
  }

  // Best-effort confirmation WhatsApp — thanks the teacher and showcases what
  // they'll get once approved. Failures are swallowed: the registration row
  // is already saved, so admin can still review and approve from the dashboard.
  // We don't await admin's response — if Wasender is slow the user shouldn't
  // wait, so this runs but the API returns success regardless.
  try {
    const { data: settingsRow } = await admin
      .from('school_settings')
      .select('school_name')
      .eq('id', 1)
      .maybeSingle();
    await sendRegistrationConfirmation({
      supabase: admin,
      fullName: data.full_name,
      phone: data.phone,
      schoolName: (settingsRow?.school_name as string) || undefined,
    });
  } catch {
    // Silent — the row is already in the DB.
  }

  return NextResponse.json({ data }, { status: 201 });
}

// GET — list registrations (admin/staff). Defaults to pending unless ?status=all.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const status = request.nextUrl.searchParams.get('status') || 'pending';

  const admin = createAdminSupabaseClient();
  let query = admin
    .from('teacher_registrations')
    .select('*')
    .order('created_at', { ascending: false });

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'فشل جلب الطلبات' }, { status: 500 });
  }

  // Pending count is shown as a sidebar badge — return it cheaply.
  const { count: pendingCount } = await admin
    .from('teacher_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  return NextResponse.json(
    { data, pendingCount: pendingCount ?? 0 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
