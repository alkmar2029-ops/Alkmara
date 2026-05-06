import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { createDismissalSchema, validateBody } from '@/lib/validations/schemas';
import { autoExcuseRemainingPeriods } from '@/lib/dismissals/auto-excuse';
import { nowInSchoolTz } from '@/lib/utils/school-time';
import { sendDismissalWhatsapp } from '@/lib/dismissals/whatsapp';

export const dynamic = 'force-dynamic';

// GET — list dismissals with filters.
//   ?date=YYYY-MM-DD          (single day)
//   ?from=YYYY-MM-DD&to=...   (range)
//   ?student_id=NUMERIC
//   ?limit                    (default 100, max 500)
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const studentId = searchParams.get('student_id');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500);

  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from('student_dismissals')
    .select(`
      id, student_id, dismissal_date, dismissal_time,
      reason, reason_details,
      pickup_person_name, pickup_person_relationship,
      pickup_person_id_number, pickup_person_phone,
      approved_by, approved_by_name,
      notes, whatsapp_sent_at, whatsapp_error, auto_excused_periods,
      created_at,
      students!inner ( id, student_id, first_name, father_name, last_name, phone,
        sections!inner ( id, name, grades!inner ( id, name ) )
      )
    `)
    .order('dismissal_date', { ascending: false })
    .order('dismissal_time', { ascending: false })
    .limit(limit);

  if (date) q = q.eq('dismissal_date', date);
  if (from) q = q.gte('dismissal_date', from);
  if (to) q = q.lte('dismissal_date', to);
  if (studentId) q = q.eq('student_id', parseInt(studentId, 10));

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: 'فشل جلب السجل' }, { status: 500 });
  }

  // Flatten the joined fields for the table view.
  const flat = (data || []).map((r: any) => ({
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
  }));

  return NextResponse.json({ data: flat }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — record a new dismissal. Triggers two side-effects:
//   1. WhatsApp notification to the parent (best-effort).
//   2. Auto-excuse on remaining period_sessions for the day (best-effort).
// Both are tolerant — neither failure rolls back the dismissal record.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }
  const v = validateBody(createDismissalSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  // 1. Resolve the student + the deputy's display name (for the receipt
  // and the WhatsApp message). One round trip each — small.
  const [{ data: student }, { data: deputyProfile }] = await Promise.all([
    supabase
      .from('students')
      .select(`id, student_id, first_name, father_name, last_name, phone, section_id, social_info,
        sections!inner ( id, name, grades!inner ( id, name ) )
      `)
      .eq('id', v.data.student_id)
      .maybeSingle(),
    admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', auth.ctx.userId)
      .maybeSingle(),
  ]);
  if (!student) {
    return NextResponse.json({ error: 'الطالب غير موجود' }, { status: 404 });
  }

  // 1b. ENFORCE custody/social-info pickup restrictions.
  // Compares the submitted pickup_person_name against social_info.blocked_pickup
  // (substring match, both sides normalized) and against social_info.authorized_pickup.
  //
  // Outcomes:
  //   - blocked_pickup match     → 403 hard block (unless override_blocked_pickup=true; admin only)
  //   - not in authorized_pickup → 422 soft block (unless override_blocked_pickup=true)
  //   - everything OK            → proceed
  const social = (student as any).social_info as {
    authorized_pickup?: string[];
    blocked_pickup?: string[];
  } | null;
  const pickupName = v.data.pickup_person_name.trim();
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const pickupNorm = norm(pickupName);

  if (social) {
    const blockedHit = (social.blocked_pickup || []).find((n) => {
      const x = norm(n);
      return x.length > 0 && (pickupNorm.includes(x) || x.includes(pickupNorm));
    });

    if (blockedHit && !v.data.override_blocked_pickup) {
      return NextResponse.json({
        error: `🛑 تم رفض الاستئذان: "${pickupName}" ضمن قائمة الممنوعين من استلام هذا الطالب (${blockedHit})`,
        code: 'PICKUP_BLOCKED',
        blocked_match: blockedHit,
      }, { status: 403 });
    }

    // Override path: requires admin role and a written reason.
    if (blockedHit && v.data.override_blocked_pickup) {
      if (auth.ctx.role !== 'admin' && auth.ctx.role !== 'super_admin') {
        return NextResponse.json({
          error: 'فقط الأدمن يستطيع تجاوز قيود الاستلام',
          code: 'OVERRIDE_NOT_ALLOWED',
        }, { status: 403 });
      }
      if (!(v.data.override_reason || '').trim()) {
        return NextResponse.json({
          error: 'يجب كتابة سبب التجاوز',
          code: 'OVERRIDE_REASON_REQUIRED',
        }, { status: 400 });
      }
    }

    // Soft block — pickup name not in authorized list AND there IS an
    // authorized list defined. Empty list means "no restriction".
    const authorized = (social.authorized_pickup || []).filter((n) => n.trim());
    if (authorized.length > 0 && !v.data.override_blocked_pickup) {
      const isAuthorized = authorized.some((n) => {
        const x = norm(n);
        return x.length > 0 && (pickupNorm.includes(x) || x.includes(pickupNorm));
      });
      if (!isAuthorized) {
        return NextResponse.json({
          error: `⚠️ "${pickupName}" غير مدرج ضمن المسموح لهم باستلام هذا الطالب. المسموح: ${authorized.join('، ')}. يحتاج موافقة الأدمن.`,
          code: 'PICKUP_NOT_AUTHORIZED',
          authorized_list: authorized,
        }, { status: 422 });
      }
    }
  }

  const studentFullName = [student.first_name, student.father_name, student.last_name]
    .filter(Boolean).join(' ').trim();
  const deputyName = (deputyProfile?.full_name as string)
    || (auth.ctx.role === 'admin' || auth.ctx.role === 'super_admin' ? 'إدارة المدرسة' : 'الوكيل');

  // 2. Insert the dismissal row.
  // Vercel runs in UTC; the school is in Riyadh (UTC+3). Anchor the
  // default date+time to school local time so a 9pm dismissal isn't
  // stored as 6pm.
  const { date: today, time: nowTime } = nowInSchoolTz();
  const dismissalDate = v.data.dismissal_date || today;
  const dismissalTime = v.data.dismissal_time || nowTime;

  const { data: inserted, error: insErr } = await supabase
    .from('student_dismissals')
    .insert({
      student_id: v.data.student_id,
      dismissal_date: dismissalDate,
      dismissal_time: dismissalTime,
      reason: v.data.reason,
      reason_details: v.data.reason_details || null,
      pickup_person_name: v.data.pickup_person_name.trim(),
      pickup_person_relationship: v.data.pickup_person_relationship,
      pickup_person_id_number: v.data.pickup_person_id_number || null,
      pickup_person_phone: v.data.pickup_person_phone || null,
      approved_by: auth.ctx.userId,
      approved_by_name: deputyName,
      notes: v.data.notes || null,
    })
    .select('id')
    .single();
  if (insErr || !inserted) {
    console.error('dismissals insert failed:', insErr?.message);
    return NextResponse.json({ error: 'تعذّر حفظ الاستئذان' }, { status: 500 });
  }

  const dismissalId = inserted.id as number;

  // 3. Side effects — fire in parallel, store results back on the row.
  //   • Auto-excuse the remaining periods.
  //   • WhatsApp notification.
  // School-name fetch is outside the gather so we only do it once.
  const { data: settingsRow } = await supabase
    .from('school_settings')
    .select('school_name')
    .eq('id', 1)
    .maybeSingle();

  const [autoExcusedCount, waResult] = await Promise.all([
    v.data.auto_excuse_periods === false
      ? Promise.resolve(0)
      : autoExcuseRemainingPeriods(supabase, {
          studentId: v.data.student_id,
          dismissalDate,
          dismissalTime,
        }),
    v.data.send_whatsapp === false
      ? Promise.resolve({ ok: false, error: 'تم تخطّي الإرسال' as string | undefined })
      : sendDismissalWhatsapp({
          supabase: admin,
          studentName: studentFullName,
          gradeName: (student as any).sections?.grades?.name || '—',
          sectionName: (student as any).sections?.name || '—',
          parentPhone: student.phone || v.data.pickup_person_phone || null,
          pickupName: v.data.pickup_person_name,
          pickupRelationship: v.data.pickup_person_relationship,
          pickupIdNumber: v.data.pickup_person_id_number || null,
          reason: v.data.reason || 'other',
          reasonDetails: v.data.reason_details || null,
          dismissalDate,
          dismissalTime,
          approvedByName: deputyName,
          schoolName: (settingsRow?.school_name as string) || undefined,
          approvedByUserId: auth.ctx.userId,
          studentId: v.data.student_id,
        }),
  ]);

  // 4. Persist the side-effect outcomes onto the dismissal row.
  await supabase
    .from('student_dismissals')
    .update({
      auto_excused_periods: autoExcusedCount,
      whatsapp_sent_at: waResult.ok ? new Date().toISOString() : null,
      whatsapp_error: waResult.ok ? null : (waResult.error || null),
    })
    .eq('id', dismissalId);

  await writeAuditLog({
    ctx: auth.ctx,
    action: v.data.override_blocked_pickup ? 'dismissal.create_with_override' : 'dismissal.create',
    targetType: 'dismissal',
    targetId: dismissalId,
    details: {
      student_id: v.data.student_id,
      reason: v.data.reason,
      auto_excused_periods: autoExcusedCount,
      whatsapp_sent: waResult.ok,
      // Audit trail for legal liability — captures who overrode what.
      override_blocked_pickup: v.data.override_blocked_pickup || false,
      override_reason: v.data.override_blocked_pickup ? (v.data.override_reason || null) : null,
      pickup_person_name: v.data.pickup_person_name,
    },
    request,
  });

  return NextResponse.json({
    data: {
      id: dismissalId,
      student_name: studentFullName,
      grade_name: (student as any).sections?.grades?.name,
      section_name: (student as any).sections?.name,
      dismissal_date: dismissalDate,
      dismissal_time: dismissalTime,
      auto_excused_periods: autoExcusedCount,
      whatsapp_sent: waResult.ok,
      whatsapp_error: waResult.ok ? null : waResult.error,
    },
  }, { status: 201 });
}
