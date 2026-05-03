'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Calendar, Loader2, Users, Eye, ClipboardCheck, Coffee } from 'lucide-react';

interface ScheduleSlot {
  id: number;
  day_of_week: number;
  period_number: number;
  duty_type: 'class' | 'monitoring' | 'free';
  section_id: number | null;
  section_name: string | null;
  grade_name: string | null;
  subject: string | null;
  monitoring_target: number | null;
}

interface MyScheduleResponse {
  teacher_name: string | null;
  slots: ScheduleSlot[];
  stats: {
    total_class: number;
    total_monitoring: number;
    top_section: { name: string; count: number } | null;
  };
}

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

export default function MySchedulePage() {
  const { data, isLoading } = useQuery<MyScheduleResponse>({
    queryKey: ['my-schedule'],
    queryFn: async () => {
      const r = await fetch('/api/teacher-schedule/me');
      if (!r.ok) throw new Error('فشل تحميل الجدول');
      return (await r.json()).data;
    },
  });

  // Index slots by (day, period) so the grid can render in O(1) per cell.
  const grid = useMemo(() => {
    const m = new Map<string, ScheduleSlot>();
    for (const s of data?.slots || []) {
      m.set(`${s.day_of_week}:${s.period_number}`, s);
    }
    return m;
  }, [data]);

  // Today + current period highlighting. Saudi week: Sun=0..Thu=4. We
  // only highlight days within range.
  const todayDow = (() => {
    const d = new Date().getDay();
    return d >= 0 && d <= 4 ? d : -1;
  })();

  if (isLoading) {
    return (
      <div className="card text-center py-12">
        <Loader2 className="w-6 h-6 animate-spin inline text-gray-400" />
      </div>
    );
  }

  if (!data || data.slots.length === 0) {
    return (
      <div className="card text-center py-12">
        <Calendar className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
        <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">لا يوجد جدول لك بعد</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          سيظهر هنا فور رفع الجدول الذكي من الإدارة.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
          <Calendar className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">جدولي الأسبوعي</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {data.teacher_name || 'المعلم'}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card text-center py-3">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">حصص أسبوعيًا</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{data.stats.total_class}</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">مناوبات</p>
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{data.stats.total_monitoring}</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">أكثر شعبة</p>
          <p className="text-sm font-bold text-purple-700 dark:text-purple-400 truncate">
            {data.stats.top_section?.name || '—'}
          </p>
          {data.stats.top_section && (
            <p className="text-[10px] text-gray-500">{data.stats.top_section.count} حصة</p>
          )}
        </div>
      </div>

      {/* Grid — desktop view */}
      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="border-b py-2 text-xs text-gray-500 dark:text-gray-400 w-16">الحصة</th>
              {DAY_NAMES.map((d, idx) => (
                <th
                  key={idx}
                  className={`border-b py-2 text-center ${
                    todayDow === idx ? 'bg-yellow-50 dark:bg-yellow-500/10' : ''
                  }`}
                >
                  {d}
                  {todayDow === idx && (
                    <span className="block text-[10px] font-normal text-yellow-700 dark:text-yellow-400">اليوم</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p) => (
              <tr key={p}>
                <td className="border-b py-2 text-center font-bold text-gray-700 dark:text-gray-300">{p}</td>
                {DAY_NAMES.map((_, idx) => {
                  const slot = grid.get(`${idx}:${p}`);
                  return (
                    <td
                      key={idx}
                      className={`border-b p-1 align-top ${
                        todayDow === idx ? 'bg-yellow-50/50 dark:bg-yellow-500/5' : ''
                      }`}
                    >
                      <SlotCell slot={slot} dayIndex={idx} period={p} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile view — by day */}
      <div className="md:hidden space-y-2">
        {DAY_NAMES.map((dayName, dayIdx) => {
          const dayStots = PERIODS.map((p) => grid.get(`${dayIdx}:${p}`));
          const hasAny = dayStots.some((s) => s);
          return (
            <div
              key={dayIdx}
              className={`card ${todayDow === dayIdx ? 'border-yellow-300 dark:border-yellow-500/40' : ''}`}
            >
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                {dayName}
                {todayDow === dayIdx && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300">
                    اليوم
                  </span>
                )}
              </h3>
              {!hasAny ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-3">
                  لا توجد حصص
                </p>
              ) : (
                <ul className="space-y-1">
                  {PERIODS.map((p) => {
                    const slot = grid.get(`${dayIdx}:${p}`);
                    return (
                      <li key={p} className="flex items-center gap-2 text-xs">
                        <span className="font-bold w-6 text-center">{p}</span>
                        <div className="flex-1">
                          <SlotCell slot={slot} dayIndex={dayIdx} period={p} compact />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One cell in the grid. Color-coded by duty type, with a quick-action
// "تسجيل الحضور" button on class slots that pre-fills the recording form.
function SlotCell({
  slot,
  dayIndex,
  period,
  compact = false,
}: {
  slot: ScheduleSlot | undefined;
  dayIndex: number;
  period: number;
  compact?: boolean;
}) {
  // Today's slots get the active-class hint.
  const todayDow = new Date().getDay();
  const isToday = todayDow === dayIndex;

  if (!slot) {
    return (
      <div className={`text-[10px] text-gray-400 dark:text-gray-600 ${compact ? '' : 'text-center py-2'}`}>
        <Coffee className="w-3 h-3 inline mb-0.5" /> فراغ
      </div>
    );
  }

  if (slot.duty_type === 'monitoring') {
    return (
      <div className={`text-xs ${compact ? '' : 'p-1'} rounded bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30`}>
        <Eye className="w-3 h-3 inline" /> مناوبة
        {slot.monitoring_target && <span className="font-bold"> {slot.monitoring_target}</span>}
      </div>
    );
  }

  // duty_type === 'class'
  const sectionLabel = slot.grade_name && slot.section_name
    ? `${slot.grade_name} / ${slot.section_name}`
    : slot.section_name || '—';

  return (
    <div className={`text-xs ${compact ? '' : 'p-1'} rounded bg-blue-50 dark:bg-blue-500/15 text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-500/30`}>
      <p className="font-semibold leading-tight truncate">{sectionLabel}</p>
      {slot.subject && <p className="text-[10px] opacity-80 leading-tight truncate">{slot.subject}</p>}
      {isToday && slot.section_id && (
        <Link
          href={`/teacher?section_id=${slot.section_id}&period_number=${period}`}
          className="inline-flex items-center gap-1 text-[10px] mt-0.5 underline"
        >
          <ClipboardCheck className="w-3 h-3" /> تسجيل الحضور
        </Link>
      )}
    </div>
  );
}
