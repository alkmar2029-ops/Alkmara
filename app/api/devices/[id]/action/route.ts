import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { DeviceService, getDeviceFromPool, addDeviceToPool, removeDeviceFromPool } from '@/lib/zkteco/device-service';
import { classifyAttendance, findMatchingSchedule } from '@/lib/utils/attendance-rules';
import { validateBody, deviceActionSchema } from '@/lib/validations/schemas';
import { getLocalToday } from '@/lib/utils/helpers';
import { requireRole, writeAuditLog, type UserRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// Admin-only: destructive or data-mutating device operations.
const ADMIN_ACTIONS = new Set(['clear-logs', 'push-users', 'pull-logs']);
// Staff or admin: connection / read-only operations.
const STAFF_ACTIONS = new Set(['connect', 'disconnect', 'sync-time', 'info', 'users', 'compare']);

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const deviceId = parseInt(params.id);
  if (isNaN(deviceId)) {
    return NextResponse.json({ error: 'معرف الجهاز غير صالح' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const validation = validateBody(deviceActionSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { action, date, confirm } = validation.data;

  // Authorize: admin-only actions need an extra confirmation flag too.
  const allowed: UserRole[] = ADMIN_ACTIONS.has(action)
    ? ['admin']
    : STAFF_ACTIONS.has(action)
      ? ['admin', 'staff']
      : ['admin', 'staff', 'viewer'];
  const auth = await requireRole(allowed);
  if (!auth.ok) return auth.res;

  if (ADMIN_ACTIONS.has(action) && confirm !== true) {
    return NextResponse.json(
      { error: 'هذه عملية حساسة وتتطلب تأكيداً صريحاً (confirm: true)' },
      { status: 400 },
    );
  }

  try {
    switch (action) {
      case 'connect': {
        const { data: device } = await supabase.from('devices').select('*').eq('id', deviceId).single();
        if (!device) return NextResponse.json({ error: 'الجهاز غير موجود' }, { status: 404 });

        const service = new DeviceService(device.ip_address, device.port);
        await service.connect();
        await addDeviceToPool(deviceId, service);

        // Use SECURITY DEFINER RPC so staff can update runtime fields without
        // RLS write access on the devices table.
        const { error: rpcError } = await supabase.rpc('set_device_runtime_status', {
          p_device_id: deviceId,
          p_status: 'connected',
          p_touch_last_seen: true,
        });
        if (rpcError) {
          return NextResponse.json(
            { error: 'تم الاتصال بالجهاز لكن فشل تحديث الحالة في قاعدة البيانات' },
            { status: 500 },
          );
        }
        return NextResponse.json({ message: 'تم الاتصال بالجهاز' });
      }

      case 'disconnect': {
        const service = getDeviceFromPool(deviceId);
        if (service) {
          await service.disconnect();
          removeDeviceFromPool(deviceId);
        }
        const { error: rpcError } = await supabase.rpc('set_device_runtime_status', {
          p_device_id: deviceId,
          p_status: 'disconnected',
          p_touch_last_seen: false,
        });
        if (rpcError) {
          return NextResponse.json(
            { error: 'تم قطع الاتصال لكن فشل تحديث الحالة في قاعدة البيانات' },
            { status: 500 },
          );
        }
        return NextResponse.json({ message: 'تم قطع الاتصال' });
      }

      case 'sync-time': {
        const service = getDeviceFromPool(deviceId);
        if (!service?.isConnected()) return NextResponse.json({ error: 'الجهاز غير متصل' }, { status: 400 });
        await service.syncTime();
        return NextResponse.json({ message: 'تم مزامنة الوقت' });
      }

      case 'info': {
        const service = getDeviceFromPool(deviceId);
        if (!service?.isConnected()) return NextResponse.json({ error: 'الجهاز غير متصل' }, { status: 400 });
        const info = await service.getDeviceInfo();
        return NextResponse.json({ data: info });
      }

      case 'users': {
        const service = getDeviceFromPool(deviceId);
        if (!service?.isConnected()) return NextResponse.json({ error: 'الجهاز غير متصل' }, { status: 400 });
        const users = await service.getDeviceUsers();
        return NextResponse.json({ data: users });
      }

      case 'clear-logs': {
        const service = getDeviceFromPool(deviceId);
        if (!service?.isConnected()) return NextResponse.json({ error: 'الجهاز غير متصل' }, { status: 400 });
        await service.clearDeviceLogs();
        await writeAuditLog({
          ctx: auth.ctx, action: 'device.clear-logs',
          targetType: 'device', targetId: deviceId, request,
        });
        return NextResponse.json({ message: 'تم مسح السجلات' });
      }

      // ============ إرسال طلاب الشُعبة للجهاز ============
      case 'push-users': {
        const service = getDeviceFromPool(deviceId);
        if (!service?.isConnected()) return NextResponse.json({ error: 'الجهاز غير متصل' }, { status: 400 });

        // Get device's linked section
        const { data: device } = await supabase.from('devices').select('section_id').eq('id', deviceId).single();
        if (!device?.section_id) return NextResponse.json({ error: 'لا توجد شُعبة مرتبطة بالجهاز' }, { status: 400 });

        // Get students in this section with grade and section names
        const { data: students } = await supabase
          .from('students')
          .select('device_uid, student_id, first_name, father_name, last_name, phone, grade_id, section_id, grades(name), sections(name)')
          .eq('section_id', device.section_id)
          .eq('is_active', true);

        if (!students || students.length === 0) {
          return NextResponse.json({ error: 'لا يوجد طلاب في هذه الشُعبة' }, { status: 400 });
        }

        const mapped = students.map((s: any) => ({
          device_uid: s.device_uid,
          student_id: s.student_id,
          first_name: s.first_name,
          last_name: `${s.father_name || ''} ${s.last_name}`.trim(),
          phone: s.phone || '',
          grade_name: s.grades?.name || '',
          section_name: s.sections?.name || '',
        }));

        const result = await service.pushUsers(mapped);

        // Log detailed errors if any
        if (result.failed > 0) {
          console.error(`[push-users] device=${deviceId}: ${result.failed} فشل في إرسالهم`, result.errors || []);
        }

        await supabase.from('device_sync_logs').insert({
          device_id: deviceId,
          sync_type: 'push_users',
          status: 'completed',
          records_synced: result.success,
        });

        await writeAuditLog({
          ctx: auth.ctx, action: 'device.push-users',
          targetType: 'device', targetId: deviceId,
          details: { total: students.length, success: result.success, failed: result.failed },
          request,
        });

        return NextResponse.json({ data: { ...result, total: students.length } });
      }

      // ============ سحب سجلات الحضور من الجهاز ============
      case 'pull-logs': {
        const service = getDeviceFromPool(deviceId);
        if (!service?.isConnected()) return NextResponse.json({ error: 'الجهاز غير متصل' }, { status: 400 });

        const { data: device } = await supabase.from('devices').select('section_id').eq('id', deviceId).single();
        if (!device?.section_id) return NextResponse.json({ error: 'لا توجد شُعبة مرتبطة بالجهاز' }, { status: 400 });

        // Pre-fetch all students for this section into a Map (fix N+1)
        const { data: sectionStudents } = await supabase
          .from('students')
          .select('id, student_id, device_uid')
          .eq('section_id', device.section_id)
          .eq('is_active', true);

        const studentByStudentId = new Map<string, { id: number }>();
        const studentByDeviceUid = new Map<number, { id: number }>();
        (sectionStudents || []).forEach((s: any) => {
          studentByStudentId.set(String(s.student_id), { id: s.id });
          if (s.device_uid) studentByDeviceUid.set(Number(s.device_uid), { id: s.id });
        });

        // Pre-fetch class schedules for this section to classify attendance
        const { data: schedules } = await supabase
          .from('class_schedules')
          .select('id, day_of_week, start_time, end_time, class_id')
          .eq('class_id', device.section_id);

        // Fetch settings for late/absent thresholds
        const { data: settingsRows } = await supabase
          .from('school_settings')
          .select('late_threshold, absent_threshold')
          .limit(1);
        const settings = settingsRows && settingsRows.length > 0 ? settingsRows[0] : null;
        const lateThreshold = settings?.late_threshold ?? 15;
        const absentThreshold = settings?.absent_threshold ?? 30;

        const logs = await service.pullAttendanceLogs();
        let synced = 0, errors = 0;
        const allRecords: any[] = [];

        for (const log of logs) {
          try {
            // Look up student from pre-fetched maps instead of querying per log
            const userId = String(log.userId || log.id);
            const uid = Number(log.uid || 0);
            const student = studentByStudentId.get(userId) || studentByDeviceUid.get(uid);

            if (!student) continue;

            const punchTime = new Date(log.timestamp);
            const attendanceDate = new Date(punchTime.getTime() - punchTime.getTimezoneOffset() * 60000).toISOString().split('T')[0];

            // Classify attendance using schedule
            let attendanceStatus: string = 'present';
            let minutesLate = 0;

            const matchedSchedule = (schedules && schedules.length > 0)
              ? findMatchingSchedule(punchTime, schedules)
              : null;

            if (matchedSchedule) {
              const classification = classifyAttendance(
                punchTime,
                matchedSchedule.start_time,
                new Date(attendanceDate),
                lateThreshold,
                absentThreshold
              );
              attendanceStatus = classification.status;
              minutesLate = classification.minutesLate;
            }
            // If no schedule found, default to 'present' with 0 minutes late (fallback)

            allRecords.push({
              student_id: student.id,
              device_id: deviceId,
              section_id: device.section_id,
              attendance_date: attendanceDate,
              punch_time: punchTime.toISOString(),
              status: attendanceStatus,
              minutes_late: minutesLate,
              source: 'device',
            });

            synced++;
          } catch { errors++; }
        }

        if (allRecords.length > 0) {
          const { error: upsertError } = await supabase
            .from('attendance_records')
            .upsert(allRecords, { onConflict: 'student_id,attendance_date' });
          if (upsertError) {
            errors += allRecords.length;
            synced = 0;
          }
        }

        await supabase.from('device_sync_logs').insert({
          device_id: deviceId,
          sync_type: 'pull_attendance',
          status: 'completed',
          records_synced: synced,
        });

        await writeAuditLog({
          ctx: auth.ctx, action: 'device.pull-logs',
          targetType: 'device', targetId: deviceId,
          details: { total: logs.length, synced, errors },
          request,
        });

        return NextResponse.json({ data: { synced, errors, total: logs.length } });
      }

      // ============ مقارنة الحضور ============
      case 'compare': {
        const targetDate = date || getLocalToday();

        const { data: device } = await supabase.from('devices').select('section_id').eq('id', deviceId).single();
        if (!device?.section_id) return NextResponse.json({ error: 'لا توجد شُعبة مرتبطة بالجهاز' }, { status: 400 });

        // Get all students in the section
        const { data: students } = await supabase
          .from('students')
          .select('id, student_id, first_name, father_name, last_name, device_uid')
          .eq('section_id', device.section_id)
          .eq('is_active', true)
          .order('first_name');

        // Get attendance records for the date
        const { data: records } = await supabase
          .from('attendance_records')
          .select('student_id, punch_time, status, minutes_late')
          .eq('section_id', device.section_id)
          .eq('attendance_date', targetDate);

        const attendanceMap = new Map<number, any>();
        (records || []).forEach((r: any) => attendanceMap.set(r.student_id, r));

        const present: any[] = [];
        const absent: any[] = [];

        (students || []).forEach((s: any) => {
          const record = attendanceMap.get(s.id);
          const studentInfo = {
            id: s.id,
            student_id: s.student_id,
            name: `${s.first_name} ${s.father_name || ''} ${s.last_name}`.trim(),
            device_uid: s.device_uid,
          };

          if (record) {
            present.push({
              ...studentInfo,
              punch_time: record.punch_time,
              status: record.status,
              minutes_late: record.minutes_late,
            });
          } else {
            absent.push(studentInfo);
          }
        });

        // Get section info
        const { data: section } = await supabase
          .from('sections')
          .select('name, grades(name, stage)')
          .eq('id', device.section_id)
          .single();

        return NextResponse.json({
          data: {
            date: targetDate,
            section_name: section?.name,
            grade_name: (section as any)?.grades?.name,
            grade_stage: (section as any)?.grades?.stage,
            total: (students || []).length,
            present_count: present.length,
            absent_count: absent.length,
            present,
            absent,
          },
        });
      }

      default:
        return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'حدث خطأ في تنفيذ العملية' }, { status: 500 });
  }
}
