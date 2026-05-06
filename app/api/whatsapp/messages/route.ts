import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — paginated list of WhatsApp messages with filters.
//   ?status=success|failed
//   ?context=note|late|teacher_credentials|manual
//   ?type=parent|teacher|admin|unknown        (recipient type)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD
//   ?q= search in phone or recipient_name
//
//   --- Reports filters (Phase: WhatsApp report) ---
//   ?sent_by=UUID                              specific sender (admin or teacher user_id)
//   ?sender_role=admin|teacher|super_admin     filter senders by role
//   ?student_id=NUMERIC                        filter by recipient_phone = that student's phone
//   ?grade_id=NUMERIC                          filter by recipient_phone IN students of that grade
//   ?section_id=NUMERIC                        filter by recipient_phone IN students of that section
//
//   ?limit (default 100, max 500)
//   ?offset (default 0)
//   ?stats_only=1                              skip the rows fetch, return only stats
//
// Response shape adds `sender_name` per row (resolved from user_profiles).
// Stats include: success, failed, today, last_24h.
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const context = searchParams.get('context');
  const type = searchParams.get('type');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const q = (searchParams.get('q') || '').trim();
  const sentBy = searchParams.get('sent_by');
  const senderRole = searchParams.get('sender_role');
  const studentId = searchParams.get('student_id');
  const gradeId = searchParams.get('grade_id');
  const sectionId = searchParams.get('section_id');
  const statsOnly = searchParams.get('stats_only') === '1';
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  // ---- Pre-flight resolutions for the cross-table filters. ----
  // student/grade/section get translated to a phone IN-list because
  // whatsapp_messages stores recipient_phone, not student_id.
  let phoneList: string[] | null = null;
  if (studentId || gradeId || sectionId) {
    let stuQuery = admin.from('students').select('phone').eq('is_active', true);
    if (studentId) stuQuery = stuQuery.eq('id', parseInt(studentId, 10));
    if (sectionId) stuQuery = stuQuery.eq('section_id', parseInt(sectionId, 10));
    if (gradeId)   stuQuery = stuQuery.eq('grade_id', parseInt(gradeId, 10));
    const { data: stuRows } = await stuQuery;
    phoneList = Array.from(new Set(
      (stuRows || []).map((r: any) => r.phone).filter((p: any): p is string => !!p),
    ));
    if (phoneList.length === 0) {
      // Nothing to find — short-circuit empty response.
      return NextResponse.json({
        data: [],
        total: 0,
        stats: { success: 0, failed: 0, today: 0, last_24h: 0 },
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
  }

  // sender_role → resolve to a list of user_ids (admin/super_admin/teacher).
  let senderUserIds: string[] | null = null;
  if (senderRole) {
    const { data: profs } = await admin
      .from('user_profiles')
      .select('user_id')
      .eq('role', senderRole);
    senderUserIds = (profs || []).map((p: any) => p.user_id).filter(Boolean);
    if (senderUserIds.length === 0) {
      return NextResponse.json({
        data: [],
        total: 0,
        stats: { success: 0, failed: 0, today: 0, last_24h: 0 },
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
  }

  const applyFilters = (qb: any) => {
    if (status === 'success' || status === 'failed') qb = qb.eq('status', status);
    if (context) qb = qb.eq('context_type', context);
    if (type) qb = qb.eq('recipient_type', type);
    if (from) qb = qb.gte('sent_at', `${from}T00:00:00.000Z`);
    if (to) qb = qb.lte('sent_at', `${to}T23:59:59.999Z`);
    if (q) {
      const safe = q.replace(/[,()*]/g, '');
      qb = qb.or(`recipient_phone.ilike.%${safe}%,recipient_name.ilike.%${safe}%`);
    }
    if (sentBy) qb = qb.eq('sent_by', sentBy);
    if (senderUserIds) qb = qb.in('sent_by', senderUserIds);
    if (phoneList) qb = qb.in('recipient_phone', phoneList);
    return qb;
  };

  // ---- Page rows ----
  let data: any[] = [];
  let count = 0;
  if (!statsOnly) {
    let listQuery = supabase
      .from('whatsapp_messages')
      .select('id, recipient_phone, recipient_name, recipient_type, template_name, context_type, context_id, message_body, status, http_status, error_message, msg_id, sent_by, sent_at', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1);
    listQuery = applyFilters(listQuery);

    const { data: rows, count: total, error } = await listQuery;
    if (error) {
      return NextResponse.json({ error: 'فشل جلب السجل: ' + error.message }, { status: 500 });
    }
    data = rows || [];
    count = total ?? 0;

    // ---- Enrich rows with sender_name (one batch lookup). ----
    const ids = Array.from(new Set(data.map((r) => r.sent_by).filter(Boolean) as string[]));
    if (ids.length > 0) {
      const { data: profs } = await admin
        .from('user_profiles')
        .select('user_id, full_name, role')
        .in('user_id', ids);
      const senderMap = new Map<string, { full_name: string; role: string }>();
      for (const p of profs || []) {
        senderMap.set(p.user_id, { full_name: p.full_name, role: p.role });
      }
      data = data.map((r) => {
        const s = r.sent_by ? senderMap.get(r.sent_by) : null;
        return {
          ...r,
          sender_name: s?.full_name ?? null,
          sender_role: s?.role ?? null,
        };
      });
    } else {
      data = data.map((r) => ({ ...r, sender_name: null, sender_role: null }));
    }
  }

  // ---- Stats for the same filter set. ----
  // todayStart anchored to school timezone (Asia/Riyadh); the "last_24h"
  // is a rolling window so it doesn't reset at midnight UTC.
  const { todayInSchoolTz } = await import('@/lib/utils/school-time');
  const today = todayInSchoolTz();  // YYYY-MM-DD
  const todayStartIso = `${today}T00:00:00.000+03:00`;  // Riyadh midnight
  const last24Start = new Date(Date.now() - 24 * 3600 * 1000);

  const [{ count: successCount }, { count: failedCount }, { count: todayCount }, { count: dayCount }] = await Promise.all([
    applyFilters(supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true }).eq('status', 'success')),
    applyFilters(supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true }).eq('status', 'failed')),
    applyFilters(supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true }).gte('sent_at', todayStartIso)),
    applyFilters(supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true }).gte('sent_at', last24Start.toISOString())),
  ]);

  return NextResponse.json(
    {
      data,
      total: count,
      stats: {
        success: successCount ?? 0,
        failed: failedCount ?? 0,
        today: todayCount ?? 0,
        last_24h: dayCount ?? 0,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
