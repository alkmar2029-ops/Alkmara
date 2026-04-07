import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getConnectedDeviceIds } from '@/lib/zkteco/device-service';
import { getLocalToday } from '@/lib/utils/helpers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createAdminSupabaseClient();
  const today = getLocalToday();

  try {
    const [studentsRes, sectionsRes, devicesRes, attendanceRes, settingsRes] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact' }).eq('is_active', true),
      supabase.from('sections').select('id', { count: 'exact' }),
      supabase.from('devices').select('id', { count: 'exact' }).eq('is_active', true),
      // Fetch only the status column for counting — future optimization: use an RPC/aggregate function
      supabase.from('attendance_records').select('status').eq('attendance_date', today),
      supabase.from('school_settings').select('school_name, stage').limit(1),
    ]);

    const attendance = attendanceRes.data || [];
    const summary = { present: 0, late: 0, absent: 0, excused: 0 };
    attendance.forEach((r: any) => {
      if (summary.hasOwnProperty(r.status)) summary[r.status as keyof typeof summary]++;
    });
    const total = Object.values(summary).reduce((a, b) => a + b, 0);

    const settings = settingsRes.data && settingsRes.data.length > 0 ? settingsRes.data[0] : null;

    return NextResponse.json({
      data: {
        schoolName: settings?.school_name || '',
        stage: settings?.stage || 'elementary',
        totalStudents: studentsRes.count || 0,
        totalSections: sectionsRes.count || 0,
        totalDevices: devicesRes.count || 0,
        onlineDevices: getConnectedDeviceIds().length,
        todayAttendance: {
          ...summary,
          total,
          rate: (studentsRes.count || 0) > 0 ? Math.round(((summary.present + summary.late) / (studentsRes.count || 1)) * 100 * 100) / 100 : 0,
        },
      },
    });
  } catch {
    return NextResponse.json({ error: 'حدث خطأ في جلب بيانات لوحة التحكم' }, { status: 500 });
  }
}
