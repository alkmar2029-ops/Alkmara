import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';
import { maybeSendDailyReminder, riyadhDayOfWeek } from '@/lib/supervision/reminder';
import { todayInSchoolTz } from '@/lib/utils/school-time';

export const dynamic = 'force-dynamic';

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// GET — today's supervisors. Optional ?date=YYYY-MM-DD overrides for
// the print page so admin can preview future days.
//
// SIDE EFFECT: opportunistically fires the morning WhatsApp reminder
// (fire-and-forget). The reminder helper is dedup-safe via PK conflict
// on supervision_reminder_log(date), so multiple page loads won't all
// send. Skipped outside the 6am–10am Riyadh window.
//
// Response: {
//   data: {
//     date, day_of_week, day_name,
//     assignments: [{ location_id, location_name, user_id, full_name, phone }],
//     reminder_log: { sent_at, sent_count, failed_count } | null
//   }
// }
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const dateOverride = request.nextUrl.searchParams.get('date');
  const skipReminder = request.nextUrl.searchParams.get('skip_reminder') === '1';

  // Date + day-of-week resolution (Riyadh timezone).
  const date = dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride)
    ? dateOverride
    : todayInSchoolTz();
  // For an arbitrary date, we need its day-of-week in Riyadh timezone.
  // Easiest way: parse as midnight in Riyadh, ask JS for the day.
  let dayOfWeek: number;
  if (dateOverride) {
    // Date arithmetic in Riyadh tz — `${date}T00:00:00+03:00`
    const d = new Date(`${date}T00:00:00+03:00`);
    const wd = d.getDay();   // 0=Sun..6=Sat in local but date is anchored to +03:00
    // Match our 0=Sun..4=Thu convention; -1 for Fri/Sat (no schedule).
    dayOfWeek = wd >= 0 && wd <= 4 ? wd : -1;
  } else {
    const w = riyadhDayOfWeek();
    dayOfWeek = w === null ? -1 : w;
  }

  if (dayOfWeek < 0) {
    return NextResponse.json({
      data: {
        date,
        day_of_week: dayOfWeek,
        day_name: ARABIC_DAYS[new Date(`${date}T00:00:00+03:00`).getDay()] || '—',
        assignments: [],
        reminder_log: null,
        weekend: true,
      },
    });
  }

  // Today's assignments + supervisor names + phones.
  const { data: rows } = await admin
    .from('supervision_assignments')
    .select(`
      location_id, user_id, notes,
      supervision_locations!inner ( name, sort_order ),
      user_profiles!supervision_assignments_user_id_fkey ( full_name, phone )
    `)
    .eq('day_of_week', dayOfWeek);

  const assignments = (rows || [])
    .map((r: any) => ({
      location_id: r.location_id,
      location_name: r.supervision_locations?.name ?? null,
      sort_order: r.supervision_locations?.sort_order ?? 0,
      user_id: r.user_id,
      full_name: r.user_profiles?.full_name ?? null,
      phone: r.user_profiles?.phone ?? null,
      notes: r.notes,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);

  // Reminder log row (if today has been triggered).
  const { data: log } = await admin
    .from('supervision_reminder_log')
    .select('sent_at, sent_count, failed_count')
    .eq('date', date)
    .maybeSingle();

  // Opportunistic trigger — fire-and-forget. Only when we're looking at
  // TODAY (not a date override) AND the caller didn't ask to skip.
  if (!dateOverride && !skipReminder) {
    // Fire without await; the caller's response shouldn't wait for the
    // 10–20 second WhatsApp loop.
    maybeSendDailyReminder(admin, { triggeredBy: ctx.userId }).catch((e) =>
      console.error('opportunistic reminder failed:', e),
    );
  }

  return NextResponse.json({
    data: {
      date,
      day_of_week: dayOfWeek,
      day_name: ARABIC_DAYS[dayOfWeek] || '—',
      assignments,
      reminder_log: log,
      weekend: false,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
