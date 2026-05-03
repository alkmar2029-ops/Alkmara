import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';
import { getConnectedDeviceIds } from '@/lib/zkteco/device-service';
import { todayInSchoolTz } from '@/lib/utils/school-time';

export const dynamic = 'force-dynamic';

// GET — comprehensive dashboard snapshot. Returns everything the new
// home page renders in a single round trip: today's pulse, smart
// alerts, 7-day trend, top/worst sections, technical health, active
// campaign id. Polls every 30s in the UI.
export async function GET() {
  const auth = await requireRole(['admin', 'staff', 'viewer']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();
  const today = todayInSchoolTz();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return todayInSchoolTz(d);
  })();
  const sevenDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);  // include today = 7 days
    return todayInSchoolTz(d);
  })();

  try {
    // Profile name for the welcome header.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', auth.ctx.userId)
      .maybeSingle();

    const [
      studentsRes, sectionsRes, devicesRes, settingsRes,
      todaySessionsRes, yesterdaySessionsRes, weekSessionsRes,
      todayDismissalsRes, allSectionsRes, periodsRes,
      pendingTeacherRegRes, pendingAdminRegRes, badPhonesRes,
      whatsappRes, activeCampaignRes,
    ] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('sections').select('id', { count: 'exact', head: true }),
      supabase.from('devices').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('school_settings').select('school_name, stage, principal_name').limit(1),
      // Today's period_sessions with absence counts.
      supabase
        .from('period_sessions')
        .select('id, section_id, period_id, total_count, absent_count, late_count, excused_count')
        .eq('attendance_date', today),
      // Yesterday — for the diff arrows.
      supabase
        .from('period_sessions')
        .select('total_count, absent_count, late_count')
        .eq('attendance_date', yesterday),
      // 7-day trend — only need date + counts, summed per day.
      supabase
        .from('period_sessions')
        .select('attendance_date, total_count, absent_count, late_count, excused_count')
        .gte('attendance_date', sevenDaysAgo)
        .lte('attendance_date', today),
      // Today's dismissals.
      supabase.from('student_dismissals').select('id, student_id', { count: 'exact' }).eq('dismissal_date', today),
      // All sections (for top/worst rankings).
      supabase.from('sections').select('id, name, grade_id, grades(name)'),
      // Active periods for "current period now" calc.
      supabase.from('periods').select('id, number, start_time, end_time').eq('is_active', true).order('number'),
      // Pending registration counts.
      supabase.from('teacher_registrations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('admin_registrations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      // Recent failed WhatsApp sends — likely bad phone numbers.
      admin.from('whatsapp_messages').select('recipient_phone', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('sent_at', sevenDaysAgo),
      // WhatsApp api status.
      admin.from('whatsapp_settings').select('api_key, status').eq('id', 1).maybeSingle(),
      // User's active background campaign (if any).
      admin.from('daily_send_campaigns').select('id, status, total, sent, failed')
        .in('status', ['pending', 'processing', 'paused'])
        .eq('created_by', auth.ctx.userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const totalStudents = studentsRes.count || 0;
    const totalSections = sectionsRes.count || 0;
    const totalDevices = devicesRes.count || 0;
    const settings = settingsRes.data?.[0] || null;

    // ============== TODAY'S PULSE ==============
    // Sum across all of today's recorded sessions. A "present" student
    // didn't appear in the absences list. We compute presence as
    // (total - absent - late - excused).
    const todaySessions = todaySessionsRes.data || [];
    const todayAbsent = todaySessions.reduce((s, r) => s + (r.absent_count || 0), 0);
    const todayLate = todaySessions.reduce((s, r) => s + (r.late_count || 0), 0);
    const todayExcused = todaySessions.reduce((s, r) => s + (r.excused_count || 0), 0);
    const todayTotalCount = todaySessions.reduce((s, r) => s + (r.total_count || 0), 0);
    // For attendance % we need student-level (not session-level) figures.
    // Approximation: count distinct absent students from period_absences.
    const sessionIds = todaySessions.map((s) => s.id);
    let distinctAbsentStudents = 0;
    let escapeStudents = 0;
    if (sessionIds.length > 0) {
      const { data: absRows } = await supabase
        .from('period_absences')
        .select('student_id, status')
        .in('session_id', sessionIds);
      const studentAbsenceCount = new Map<number, number>();
      const studentSessionCount = new Map<number, number>();
      for (const a of absRows || []) {
        if (a.status === 'absent') {
          studentAbsenceCount.set(a.student_id, (studentAbsenceCount.get(a.student_id) || 0) + 1);
        }
      }
      // For escape count, rough heuristic: students absent in some
      // periods but not all.
      // Sessions per student's section
      const sectionSessionCount = new Map<number, number>();
      for (const s of todaySessions as any[]) {
        sectionSessionCount.set(s.section_id, (sectionSessionCount.get(s.section_id) || 0) + 1);
      }
      // Get student → section mapping for the absent set
      const absentStudentIds = Array.from(studentAbsenceCount.keys());
      if (absentStudentIds.length > 0) {
        const { data: studentSecs } = await supabase
          .from('students').select('id, section_id').in('id', absentStudentIds);
        for (const s of studentSecs || []) {
          const expected = sectionSessionCount.get(s.section_id) || 0;
          const missed = studentAbsenceCount.get(s.id) || 0;
          if (missed > 0 && missed < expected) escapeStudents++;
        }
      }
      distinctAbsentStudents = studentAbsenceCount.size;
    }
    const dismissalCount = todayDismissalsRes.count || 0;
    const presentEstimate = totalStudents - distinctAbsentStudents;
    const attendancePercent = totalStudents > 0
      ? Math.round((presentEstimate / totalStudents) * 100)
      : 0;

    // ============== YESTERDAY COMPARE ==============
    const yesterdaySessions = yesterdaySessionsRes.data || [];
    const yAbsent = yesterdaySessions.reduce((s, r) => s + (r.absent_count || 0), 0);
    const yLate = yesterdaySessions.reduce((s, r) => s + (r.late_count || 0), 0);

    // ============== 7-DAY TREND ==============
    // Bucket sessions by date, compute per-day attendance %.
    const trendByDate = new Map<string, { absent: number; late: number; excused: number; total: number }>();
    for (const r of weekSessionsRes.data || []) {
      const d = String(r.attendance_date);
      const cur = trendByDate.get(d) || { absent: 0, late: 0, excused: 0, total: 0 };
      cur.absent += r.absent_count || 0;
      cur.late += r.late_count || 0;
      cur.excused += r.excused_count || 0;
      cur.total += r.total_count || 0;
      trendByDate.set(d, cur);
    }
    const trend7d: Array<{ date: string; percent: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = todayInSchoolTz(d);
      const b = trendByDate.get(ds);
      if (b && b.total > 0) {
        // Per-day session-level attendance % (uses session totals, not
        // distinct student count — good enough for trend visualization).
        const present = b.total - b.absent - b.late - b.excused;
        trend7d.push({ date: ds, percent: Math.round((present / b.total) * 100) });
      } else {
        trend7d.push({ date: ds, percent: 0 });
      }
    }

    // ============== TOP / WORST SECTIONS ==============
    // Per-section attendance % for today only.
    const sectionStats = new Map<number, { present: number; total: number }>();
    for (const s of todaySessions as any[]) {
      const cur = sectionStats.get(s.section_id) || { present: 0, total: 0 };
      cur.present += (s.total_count - s.absent_count - s.late_count - s.excused_count);
      cur.total += s.total_count;
      sectionStats.set(s.section_id, cur);
    }
    const sectionRanking: Array<{ section_id: number; grade_name: string; section_name: string; percent: number }> = [];
    for (const sec of (allSectionsRes.data || []) as any[]) {
      const stats = sectionStats.get(sec.id);
      if (!stats || stats.total === 0) continue;
      sectionRanking.push({
        section_id: sec.id,
        grade_name: sec.grades?.name || '',
        section_name: sec.name,
        percent: Math.round((stats.present / stats.total) * 100),
      });
    }
    sectionRanking.sort((a, b) => b.percent - a.percent);
    const topSections = sectionRanking.slice(0, 3);
    const worstSections = sectionRanking.slice(-3).reverse();

    // ============== ALERTS ==============
    const alerts: Array<{
      type: string; severity: 'red' | 'orange' | 'yellow' | 'blue' | 'purple';
      label: string; count: number; href: string;
    }> = [];

    // Periods that haven't been recorded for the current period number.
    // Use the most recent period's start_time to figure out which to check.
    const periods = periodsRes.data || [];
    const recordedKeys = new Set(todaySessions.map((s) => `${s.section_id}:${s.period_id}`));
    let missingCount = 0;
    if (periods.length > 0 && allSectionsRes.data) {
      // For simplicity, check period 1 only — that's what admins care
      // about most in the morning.
      const firstPeriod = periods[0];
      for (const sec of allSectionsRes.data) {
        if (!recordedKeys.has(`${sec.id}:${firstPeriod.id}`)) missingCount++;
      }
    }
    if (missingCount > 0) {
      alerts.push({
        type: 'sections_not_recorded',
        severity: 'red',
        label: `${missingCount} شعبة لم تُسجَّل الحصة الأولى`,
        count: missingCount,
        href: '/dashboard/period-attendance',
      });
    }
    if (escapeStudents > 0) {
      alerts.push({
        type: 'escapes',
        severity: 'orange',
        label: `${escapeStudents} طالب هربوا — أرسل إشعار للأهالي`,
        count: escapeStudents,
        href: '/dashboard/daily-attendance',
      });
    }
    const pendingTeachers = pendingTeacherRegRes.count || 0;
    if (pendingTeachers > 0) {
      alerts.push({
        type: 'pending_teacher_registrations',
        severity: 'yellow',
        label: `${pendingTeachers} طلب انضمام معلم بانتظار موافقتك`,
        count: pendingTeachers,
        href: '/dashboard/teacher-registrations',
      });
    }
    const pendingAdmins = pendingAdminRegRes.count || 0;
    if (pendingAdmins > 0) {
      alerts.push({
        type: 'pending_admin_registrations',
        severity: 'yellow',
        label: `${pendingAdmins} طلب إداري بانتظار موافقتك`,
        count: pendingAdmins,
        href: '/dashboard/admin-registrations',
      });
    }
    const badPhones = badPhonesRes.count || 0;
    if (badPhones > 0) {
      alerts.push({
        type: 'bad_phones',
        severity: 'blue',
        label: `${badPhones} رقم جوال فشل — يحتاج تحديث`,
        count: badPhones,
        href: '/dashboard/whatsapp-issues',
      });
    }

    // ============== TECHNICAL HEALTH ==============
    const onlineDevices = getConnectedDeviceIds().length;
    const wsApiOk = !!whatsappRes.data?.api_key;
    const wsStatus = whatsappRes.data?.status || 'unknown';

    // Active teachers — those who recorded any period today.
    const activeTeacherIds = new Set(
      (todaySessions as any[])
        .map((s) => s.recorded_by)
        .filter(Boolean),
    );

    // ============== CURRENT PERIOD ==============
    const nowHHMM = new Date().toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh',
    });
    let currentPeriod: { number: number; start_time: string | null; end_time: string | null } | null = null;
    for (const p of periods) {
      const st = (p.start_time as string) || '00:00';
      const et = (p.end_time as string) || '23:59';
      if (st <= nowHHMM && nowHHMM < et) {
        currentPeriod = { number: p.number as number, start_time: st, end_time: et };
        break;
      }
    }

    return NextResponse.json({
      data: {
        user: { name: profile?.full_name || auth.ctx.email || 'مرحبًا' },
        school: {
          name: settings?.school_name || '',
          stage: settings?.stage || '',
          principal: settings?.principal_name || '',
        },
        today: {
          date: today,
          attendance_percent: attendancePercent,
          present_count: presentEstimate,
          absent_count: distinctAbsentStudents,
          late_count: todayLate,
          excused_count: todayExcused,
          dismissal_count: dismissalCount,
          escape_count: escapeStudents,
          total_students: totalStudents,
          total_sections: totalSections,
          total_devices: totalDevices,
          recorded_sessions: todaySessions.length,
          // Yesterday comparison — negative diff means improvement.
          compare: {
            absent_diff: distinctAbsentStudents - yAbsent,
            late_diff: todayLate - yLate,
          },
          current_period: currentPeriod,
        },
        alerts,
        trend_7d: trend7d,
        top_sections: topSections,
        worst_sections: worstSections,
        health: {
          device_online: onlineDevices > 0,
          devices_connected: onlineDevices,
          devices_total: totalDevices,
          whatsapp_api_ok: wsApiOk,
          whatsapp_status: wsStatus,
          active_teachers: activeTeacherIds.size,
          bad_phones_count: badPhones,
        },
        active_campaign: activeCampaignRes.data || null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'حدث خطأ في جلب بيانات لوحة التحكم: ' + (e?.message || '') },
      { status: 500 },
    );
  }
}
