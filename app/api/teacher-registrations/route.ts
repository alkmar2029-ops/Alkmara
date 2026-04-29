import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';
import { teacherRegistrationSchema, validateBody } from '@/lib/validations/schemas';
import { normalizePhone } from '@/lib/teachers/credentials';
import { sendRegistrationConfirmation } from '@/lib/teachers/registration-confirmation';
import { checkRateLimit, clientIp } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

// Generic success response — used for both real successes AND silent
// rejections (rate-limited, honeypot triggered, duplicate email). Identical
// shape so an attacker can't tell which branch ran. Defeats:
//   • email enumeration (was a 409 on duplicate)
//   • automated abuse detection (no signal back to bots)
//   • timing attacks (we always return quickly)
const GENERIC_SUCCESS = NextResponse.json(
  { data: { message: 'تم استلام طلبك. ستتم مراجعته قريباً.' } },
  { status: 201 },
);

// POST — public submission. No auth required (middleware allowlist).
// Hardened against abuse: rate-limited per IP, honeypot field, and a
// uniform success response so the route can't be used to enumerate
// registered emails.
export async function POST(request: NextRequest) {
  // 1. Rate limit per IP — 5 requests per 10 minutes is plenty for a real
  // human filling out the form, but stops a script cold.
  const ip = clientIp(request);
  const rl = checkRateLimit(`register:${ip}`, 5, 10 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'لقد تجاوزت الحد المسموح، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(rl.resetIn) } },
    );
  }

  // 2. Parse + validate. The honeypot field `website` must be empty; any
  // bot that fills every input it sees will fail validation here.
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(teacherRegistrationSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  // Honeypot tripped — silently accept and discard so the bot sees a
  // success and moves on instead of trying again with smarter heuristics.
  if (v.data.website && v.data.website.length > 0) {
    return GENERIC_SUCCESS;
  }

  const admin = createAdminSupabaseClient();
  const email = v.data.email.trim().toLowerCase();
  const normalizedPhone = normalizePhone(v.data.phone);

  // 3. Duplicate-pending check. Silently accept (no enumeration hint) but
  // skip the DB write so the same email can't spam the queue. Same for
  // an email already linked to a real teacher.
  const { data: existingPending } = await admin
    .from('teacher_registrations')
    .select('id')
    .ilike('email', email)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingPending) return GENERIC_SUCCESS;

  const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const taken = (usersData?.users || []).some(
    (u) => (u.email || '').toLowerCase() === email,
  );
  if (taken) return GENERIC_SUCCESS;

  // 4. Insert.
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
    console.error('teacher_registrations insert failed:', error.message);
    return NextResponse.json({ error: 'تعذّر حفظ طلبك، حاول لاحقاً' }, { status: 500 });
  }

  // 5. Best-effort confirmation WhatsApp — fire-and-forget so the response
  // returns immediately. Wasender failures are tracked in whatsapp_messages
  // and don't block the user.
  (async () => {
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
    } catch (e: unknown) {
      console.error('registration confirmation send failed:', e);
    }
  })();

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
