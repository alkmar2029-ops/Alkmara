import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import {
  generatePassword,
  sendCredentialsViaWhatsapp,
  normalizePhone,
} from '@/lib/teachers/credentials';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Same shape as POST /api/teachers but for many at once. Phone is
// optional — when missing, the account gets created without WhatsApp
// delivery and the password is returned in the response so the admin
// can hand it over manually.
const bulkSchema = z.object({
  teachers: z.array(z.object({
    full_name: z.string().min(2).max(200),
    phone: z.string().min(8).max(20).optional().nullable(),
    email: z.string().email().optional().nullable(),
  })).min(1).max(100),
  // When true, skip teachers whose name already exists in user_profiles
  // — common case when the admin re-runs the bulk import.
  skip_existing_names: z.boolean().default(true),
});

interface BulkOutcome {
  full_name: string;
  status: 'created' | 'skipped_existing' | 'failed';
  user_id?: string;
  email?: string;
  phone?: string | null;
  password?: string | null;        // only when WhatsApp wasn't sent
  whatsapp_sent?: boolean;
  error?: string;
}

/**
 * Auto-generate a placeholder email for a teacher when the admin doesn't
 * supply one. Format: teacher.<sanitized-name-token>.<short-id>@school.local
 *
 * The domain `school.local` is intentionally a non-routable TLD —
 * accounts created via bulk import use email only as a unique login
 * identifier, no actual mail is sent. The admin can change it later
 * from the teachers page if the school issues real email addresses.
 */
function autoEmail(fullName: string): string {
  const slug = fullName
    .replace(/[ً-ْٰ]/g, '')   // strip Arabic diacritics
    .replace(/[^؀-ۿa-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'teacher';
  const rand = Math.random().toString(36).slice(2, 8);
  return `teacher.${slug}.${rand}@school.local`;
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات غير صالحة' }, { status: 400 });
  }
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { teachers, skip_existing_names } = parsed.data;

  const admin = createAdminSupabaseClient();
  const supabase = await createServerSupabaseClient();

  // Fetch existing teacher names once so we can detect duplicates without
  // hitting the DB per teacher.
  const { data: existingProfiles } = await admin
    .from('user_profiles')
    .select('user_id, full_name')
    .eq('role', 'teacher')
    .eq('is_active', true);
  const existingNames = new Set(
    (existingProfiles || []).map((p) => normalizeNameForMatch(p.full_name as string)),
  );

  // Pre-load school name + portal URL once.
  const { data: settingsRow } = await supabase
    .from('school_settings')
    .select('school_name')
    .eq('id', 1)
    .maybeSingle();
  const portalBase = process.env.NEXT_PUBLIC_PORTAL_URL || request.nextUrl.origin;
  const portalUrl = `${portalBase.replace(/\/$/, '')}/teacher`;
  const schoolName = (settingsRow?.school_name as string) || undefined;

  const outcomes: BulkOutcome[] = [];
  let created = 0, skipped = 0, failed = 0;

  for (const t of teachers) {
    const fullName = t.full_name.trim();
    const out: BulkOutcome = { full_name: fullName, status: 'failed' };

    // Skip if name already exists.
    if (skip_existing_names && existingNames.has(normalizeNameForMatch(fullName))) {
      out.status = 'skipped_existing';
      skipped++;
      outcomes.push(out);
      continue;
    }

    const email = (t.email && t.email.trim()) || autoEmail(fullName);
    const password = generatePassword();
    const normalizedPhone = t.phone ? normalizePhone(t.phone) : null;

    // 1. Create auth user.
    const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      app_metadata: { role: 'teacher' },
      user_metadata: { full_name: fullName },
    });
    if (createErr || !createdUser.user) {
      out.status = 'failed';
      out.error = (createErr?.message || 'فشل إنشاء الحساب').includes('already')
        ? 'البريد مستخدم مسبقاً'
        : (createErr?.message || 'فشل إنشاء الحساب');
      failed++;
      outcomes.push(out);
      continue;
    }
    const userId = createdUser.user.id;
    out.user_id = userId;
    out.email = email;
    out.phone = normalizedPhone;

    // 2. Create profile.
    const { error: profileErr } = await admin
      .from('user_profiles')
      .upsert({
        user_id: userId,
        role: 'teacher',
        full_name: fullName,
        phone: normalizedPhone,
        is_active: true,
      }, { onConflict: 'user_id' });
    if (profileErr) {
      // Rollback auth user.
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      out.status = 'failed';
      out.error = 'فشل إنشاء الملف: ' + profileErr.message;
      failed++;
      outcomes.push(out);
      continue;
    }

    // 3. WhatsApp credentials — only when phone was provided.
    if (normalizedPhone) {
      const wa = await sendCredentialsViaWhatsapp({
        supabase: admin,
        fullName,
        email,
        phone: normalizedPhone,
        password,
        portalUrl,
        schoolName,
        teacherUserId: userId,
        sentBy: auth.ctx.userId,
      });
      out.whatsapp_sent = wa.ok;
      // Surface the password back when WhatsApp didn't go through —
      // admin can copy it to send manually.
      if (!wa.ok) out.password = password;
    } else {
      out.whatsapp_sent = false;
      out.password = password;  // no phone → password must be returned
    }

    out.status = 'created';
    created++;
    outcomes.push(out);

    // Tiny delay between creates to avoid rate-limiting auth.users
    // and to space out WhatsApp sends within the wasender 5.5s window.
    await new Promise((res) => setTimeout(res, 200));
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'teacher.bulk_create',
    targetType: 'teachers',
    targetId: null,
    details: { requested: teachers.length, created, skipped, failed },
    request,
  });

  return NextResponse.json({
    data: {
      summary: { requested: teachers.length, created, skipped, failed },
      outcomes,
    },
  }, { status: 201 });
}

/** Same loose Arabic normalization used in the schedule name matcher. */
function normalizeNameForMatch(s: string): string {
  return s
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/^(الأستاذ|الاستاذ|أ\.|ا\.|أستاذ|استاذ)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}
