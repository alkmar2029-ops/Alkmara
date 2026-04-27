'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2, Calendar, RefreshCw, Filter } from 'lucide-react';

interface SessionRow {
  id: number;
  attendance_date: string;
  recorded_at: string;
  recorded_by: string | null;
  section_id: number;
  period_id: number;
  section_name: string | null;
  grade_name: string | null;
  period_number: number | null;
  period_name: string | null;
  absent_count: number;
  late_count: number;
  excused_count: number;
  total_count: number;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function PeriodAttendancePage() {
  const [date, setDate] = useState(todayStr());
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  const { data: sessions = [], isLoading, refetch, isFetching } = useQuery<SessionRow[]>({
    queryKey: ['period-attendance-day', date],
    queryFn: async () => (await (await fetch(`/api/period-attendance/history?date=${date}&limit=200`)).json()).data,
  });

  // Build the matrix (grade/section × period)
  const sectionsMap = useMemo(() => {
    const m = new Map<string, { grade: string; section: string; periods: Map<number, SessionRow> }>();
    for (const s of sessions) {
      if (gradeFilter !== 'all' && s.grade_name !== gradeFilter) continue;
      const key = `${s.grade_name}__${s.section_name}`;
      if (!m.has(key)) {
        m.set(key, { grade: s.grade_name || '—', section: s.section_name || '—', periods: new Map() });
      }
      m.get(key)!.periods.set(s.period_number || 0, s);
    }
    return m;
  }, [sessions, gradeFilter]);

  const gradesAvailable = useMemo(() => {
    const s = new Set<string>();
    sessions.forEach((x) => x.grade_name && s.add(x.grade_name));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [sessions]);

  const periodNumbers = useMemo(() => {
    const s = new Set<number>();
    sessions.forEach((x) => { if (x.period_number) s.add(x.period_number); });
    return Array.from(s).sort((a, b) => a - b);
  }, [sessions]);

  const totals = useMemo(() => {
    return sessions.reduce((acc, s) => ({
      sessions: acc.sessions + 1,
      absent: acc.absent + s.absent_count,
      late: acc.late + s.late_count,
      excused: acc.excused + s.excused_count,
    }), { sessions: 0, absent: 0, late: 0, excused: 0 });
  }, [sessions]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">حضور الحصص</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              ملخص الحصص التي سجّلها المعلمون لهذا اليوم
            </p>
          </div>
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary inline-flex items-center gap-1">
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          تحديث
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> التاريخ</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" max={todayStr()} />
          </div>
          <div>
            <label className="label flex items-center gap-1"><Filter className="w-3 h-3" /> الصف</label>
            <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="input">
              <option value="all">كل الصفوف</option>
              {gradesAvailable.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="جلسات مسجّلة" value={totals.sessions} />
        <Stat label="إجمالي غياب" value={totals.absent} tone="red" />
        <Stat label="إجمالي تأخر" value={totals.late} tone="yellow" />
        <Stat label="إجمالي استئذان" value={totals.excused} tone="blue" />
      </div>

      {/* Matrix */}
      <div className="card">
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            لم يسجّل أي معلم حضور حصة في هذا اليوم بعد.
          </div>
        ) : sectionsMap.size === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">لا توجد نتائج للفلتر المحدّد.</div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium">الصف / الشعبة</th>
                  {periodNumbers.map((n) => (
                    <th key={n} className="px-2 py-2 font-medium text-center w-16">حصة {n}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {Array.from(sectionsMap.values()).map((row) => (
                  <tr key={`${row.grade}-${row.section}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {row.grade} / {row.section}
                    </td>
                    {periodNumbers.map((n) => {
                      const s = row.periods.get(n);
                      if (!s) {
                        return (
                          <td key={n} className="px-2 py-2 text-center text-xs text-gray-400">
                            —
                          </td>
                        );
                      }
                      const present = s.total_count - s.absent_count - s.late_count - s.excused_count;
                      const hasIssue = s.absent_count + s.late_count + s.excused_count;
                      return (
                        <td key={n} className="px-2 py-2 text-center" title={`حاضر ${present} / ${s.total_count}`}>
                          {hasIssue === 0 ? (
                            <span className="inline-block w-7 h-7 rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 text-xs leading-7 font-bold">
                              ✓
                            </span>
                          ) : (
                            <div className="inline-flex flex-col items-center text-[10px] gap-0.5 leading-tight">
                              {s.absent_count > 0 && <span className="text-red-600 dark:text-red-400">غ {s.absent_count}</span>}
                              {s.late_count > 0 && <span className="text-yellow-600 dark:text-yellow-400">ت {s.late_count}</span>}
                              {s.excused_count > 0 && <span className="text-blue-600 dark:text-blue-400">س {s.excused_count}</span>}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-3 flex flex-wrap gap-3 px-3">
              <span>✓ كل الطلاب حاضرون</span>
              <span>غ = غائب</span>
              <span>ت = متأخر</span>
              <span>س = مستأذن</span>
              <span>— لم تُسجّل بعد</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'red' | 'yellow' | 'blue' }) {
  const cls = {
    gray:  'text-gray-900 dark:text-gray-100',
    red:   'text-red-600 dark:text-red-400',
    yellow:'text-yellow-600 dark:text-yellow-400',
    blue:  'text-blue-600 dark:text-blue-400',
  }[tone];
  return (
    <div className="card text-center py-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
    </div>
  );
}
