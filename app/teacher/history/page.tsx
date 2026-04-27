'use client';

import { useQuery } from '@tanstack/react-query';
import { History, Loader2, Calendar, Clock, BookOpen } from 'lucide-react';

interface SessionRow {
  id: number;
  attendance_date: string;
  recorded_at: string;
  section_name: string | null;
  grade_name: string | null;
  period_number: number | null;
  period_name: string | null;
  absent_count: number;
  late_count: number;
  excused_count: number;
  total_count: number;
}

export default function TeacherHistoryPage() {
  const { data: sessions = [], isLoading } = useQuery<SessionRow[]>({
    queryKey: ['my-sessions'],
    queryFn: async () => (await (await fetch('/api/period-attendance/history?mine=1&limit=100')).json()).data,
  });

  return (
    <div className="space-y-3">
      <div className="card">
        <h2 className="font-semibold text-lg flex items-center gap-2 mb-3">
          <History className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          سجل الحصص التي سجّلتها
        </h2>

        {isLoading ? (
          <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline text-gray-400" /></div>
        ) : sessions.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
            لم تسجّل أي حصة بعد.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const present = s.total_count - s.absent_count - s.late_count - s.excused_count;
              const dateAr = new Date(s.attendance_date).toLocaleDateString('ar-SA');
              return (
                <li
                  key={s.id}
                  className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {dateAr}</span>
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> الحصة {s.period_number}</span>
                    <span className="inline-flex items-center gap-1"><BookOpen className="w-3 h-3" /> {s.grade_name} / {s.section_name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400">
                      حاضر {present}
                    </span>
                    {s.absent_count > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">
                        غائب {s.absent_count}
                      </span>
                    )}
                    {s.late_count > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400">
                        متأخر {s.late_count}
                      </span>
                    )}
                    {s.excused_count > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
                        مستأذن {s.excused_count}
                      </span>
                    )}
                    <span className="ms-auto text-gray-400">
                      {new Date(s.recorded_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
