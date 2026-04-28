'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  History, Loader2, Calendar, Clock, BookOpen, Filter, Search, Pencil,
  Printer, BarChart3, User, FileDown, ChevronDown, X, AlertCircle,
  CheckCircle2, XCircle, Award,
} from 'lucide-react';

interface SessionRow {
  id: number;
  attendance_date: string;
  recorded_at: string;
  section_id: number;
  period_id: number;
  grade_id: number | null;
  section_name: string | null;
  grade_name: string | null;
  period_number: number | null;
  period_name: string | null;
  absent_count: number;
  late_count: number;
  excused_count: number;
  total_count: number;
}

type Tab = 'sessions' | 'insights' | 'student' | 'reports';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function TeacherHistoryPage() {
  const [tab, setTab] = useState<Tab>('sessions');

  return (
    <div className="space-y-3">
      <div className="card">
        <h2 className="font-semibold text-lg flex items-center gap-2 mb-3">
          <History className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          سجل حصصي
        </h2>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 -mx-4 px-4 overflow-x-auto">
          <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')} Icon={History} label="الجلسات" />
          <TabButton active={tab === 'insights'} onClick={() => setTab('insights')} Icon={BarChart3} label="إحصاءاتي" />
          <TabButton active={tab === 'student'} onClick={() => setTab('student')} Icon={User} label="سجل طالب" />
          <TabButton active={tab === 'reports'} onClick={() => setTab('reports')} Icon={FileDown} label="تقارير PDF" />
        </div>
      </div>

      {tab === 'sessions' && <SessionsTab />}
      {tab === 'insights' && <InsightsTab />}
      {tab === 'student' && <StudentTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

function TabButton({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-sm whitespace-nowrap transition-colors ${
        active
          ? 'border-blue-500 text-blue-700 dark:text-blue-400 font-medium'
          : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

// ==================== TAB 1: Sessions ====================
function SessionsTab() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');

  const { data: sessions = [], isLoading } = useQuery<SessionRow[]>({
    queryKey: ['my-sessions', from, to],
    queryFn: async () => {
      const p = new URLSearchParams({ mine: '1', from, to, limit: '500' });
      return (await (await fetch(`/api/period-attendance/history?${p}`)).json()).data;
    },
  });

  // Build filter options from the current dataset.
  const grades = useMemo(() => {
    const s = new Set<string>();
    sessions.forEach((x) => x.grade_name && s.add(x.grade_name));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [sessions]);

  const sectionsForGrade = useMemo(() => {
    const s = new Set<string>();
    sessions.forEach((x) => {
      if (gradeFilter === 'all' || x.grade_name === gradeFilter) {
        if (x.section_name) s.add(x.section_name);
      }
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));
  }, [sessions, gradeFilter]);

  const periods = useMemo(() => {
    const s = new Set<number>();
    sessions.forEach((x) => { if (x.period_number) s.add(x.period_number); });
    return Array.from(s).sort((a, b) => a - b);
  }, [sessions]);

  // Reset cascading filters
  useEffect(() => { setSectionFilter('all'); }, [gradeFilter]);

  const filtered = useMemo(() => sessions.filter((s) => {
    if (gradeFilter !== 'all' && s.grade_name !== gradeFilter) return false;
    if (sectionFilter !== 'all' && s.section_name !== sectionFilter) return false;
    if (periodFilter !== 'all' && String(s.period_number) !== periodFilter) return false;
    return true;
  }), [sessions, gradeFilter, sectionFilter, periodFilter]);

  const totals = useMemo(() => filtered.reduce((acc, s) => ({
    sessions: acc.sessions + 1,
    absent: acc.absent + s.absent_count,
    late: acc.late + s.late_count,
    excused: acc.excused + s.excused_count,
  }), { sessions: 0, absent: 0, late: 0, excused: 0 }), [filtered]);

  const setPreset = (days: number) => { setFrom(daysAgo(days)); setTo(todayStr()); };

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">من</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" max={to} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">إلى</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" max={todayStr()} />
          </label>
          <div className="col-span-2 sm:col-span-1 flex flex-wrap gap-1 items-end">
            <button onClick={() => { setFrom(todayStr()); setTo(todayStr()); }} className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">اليوم</button>
            <button onClick={() => setPreset(7)} className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">٧ أيام</button>
            <button onClick={() => setPreset(30)} className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">شهر</button>
            <button onClick={() => setPreset(90)} className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">٣ أشهر</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-2">
          <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="input text-sm">
            <option value="all">كل الصفوف</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="input text-sm" disabled={sectionsForGrade.length === 0}>
            <option value="all">كل الشُعب</option>
            {sectionsForGrade.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} className="input text-sm">
            <option value="all">كل الحصص</option>
            {periods.map((n) => <option key={n} value={String(n)}>الحصة {n}</option>)}
          </select>
        </div>

        {/* Summary */}
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 grid grid-cols-4 gap-2 text-xs">
          <Stat label="جلسات" value={totals.sessions} />
          <Stat label="غياب" value={totals.absent} tone="red" />
          <Stat label="تأخر" value={totals.late} tone="yellow" />
          <Stat label="استئذان" value={totals.excused} tone="blue" />
        </div>

        {(gradeFilter !== 'all' || sectionFilter !== 'all' || periodFilter !== 'all') && (
          <button
            onClick={() => { setGradeFilter('all'); setSectionFilter('all'); setPeriodFilter('all'); }}
            className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> مسح الفلاتر
          </button>
        )}
      </div>

      {/* Sessions list */}
      <div className="card">
        {isLoading ? (
          <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline text-gray-400" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
            لا توجد جلسات تطابق الفلاتر
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((s) => <SessionItem key={s.id} session={s} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function SessionItem({ session: s }: { session: SessionRow }) {
  const present = s.total_count - s.absent_count - s.late_count - s.excused_count;
  const issues = s.absent_count + s.late_count + s.excused_count;
  const dateAr = new Date(s.attendance_date).toLocaleDateString('ar-SA');
  const tone =
    issues === 0 ? 'border-green-300 dark:border-green-500/40 bg-green-50/40 dark:bg-green-500/5' :
    (issues / s.total_count) < 0.1 ? 'border-yellow-300 dark:border-yellow-500/40 bg-yellow-50/40 dark:bg-yellow-500/5' :
    (issues / s.total_count) < 0.25 ? 'border-orange-300 dark:border-orange-500/40 bg-orange-50/40 dark:bg-orange-500/5' :
    'border-red-300 dark:border-red-500/40 bg-red-50/40 dark:bg-red-500/5';

  return (
    <li className={`border rounded-lg p-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300 mb-1.5">
        <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> {dateAr}</span>
        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> الحصة {s.period_number}</span>
        <span className="inline-flex items-center gap-1"><BookOpen className="w-3 h-3" /> {s.grade_name} / {s.section_name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs mb-2">
        <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400">حاضر {present}</span>
        {s.absent_count > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">غائب {s.absent_count}</span>}
        {s.late_count > 0 && <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400">متأخر {s.late_count}</span>}
        {s.excused_count > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">مستأذن {s.excused_count}</span>}
        <span className="ms-auto text-gray-400">{new Date(s.recorded_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-200 dark:border-gray-700/40">
        <Link
          href={`/teacher?date=${s.attendance_date}&period_id=${s.period_id}&grade_id=${s.grade_id ?? ''}&section_id=${s.section_id}`}
          className="text-xs px-2.5 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-500/25 inline-flex items-center gap-1"
        >
          <Pencil className="w-3 h-3" /> تعديل
        </Link>
        <Link
          href={`/teacher/print/session/${s.id}`}
          target="_blank"
          className="text-xs px-2.5 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center gap-1"
        >
          <Printer className="w-3 h-3" /> طباعة
        </Link>
      </div>
    </li>
  );
}

// ==================== TAB 2: Insights ====================
function InsightsTab() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());

  const { data, isLoading } = useQuery<any>({
    queryKey: ['teacher-insights', from, to],
    queryFn: async () => (await (await fetch(`/api/teacher/insights?from=${from}&to=${to}&limit=10`)).json()).data,
  });

  const setPreset = (days: number) => { setFrom(daysAgo(days)); setTo(todayStr()); };

  return (
    <div className="space-y-3">
      {/* Range */}
      <div className="card">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">من</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" max={to} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400">إلى</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" max={todayStr()} />
          </label>
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          <button onClick={() => setPreset(7)} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">٧ أيام</button>
          <button onClick={() => setPreset(30)} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">٣٠ يوم</button>
          <button onClick={() => setPreset(90)} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">٩٠ يوم</button>
          <button onClick={() => setPreset(180)} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">فصل دراسي</button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin inline text-gray-400" /></div>
      ) : !data ? (
        <p className="text-center text-gray-500 dark:text-gray-400 text-sm py-12">لا توجد بيانات</p>
      ) : (
        <>
          {/* Overall stats */}
          <div className="card">
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <Award className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              ملخصي
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <Stat label="معدل الحضور" value={data.totals.attendance_rate} suffix="%" tone="green" />
              <Stat label="جلسات" value={data.totals.sessions} />
              <Stat label="غياب" value={data.totals.absent} tone="red" />
              <Stat label="تأخر" value={data.totals.late} tone="yellow" />
            </div>
          </div>

          {/* Top students */}
          <TopList title="أكثر الطلاب غياباً" items={data.top_absent} field="absent" tone="red" />
          <TopList title="أكثر الطلاب تأخراً" items={data.top_late} field="late" tone="yellow" />
          <TopList title="أكثر الطلاب استئذاناً" items={data.top_excused} field="excused" tone="blue" />

          {/* By period */}
          {data.by_period?.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-sm mb-2">معدل الحضور حسب الحصة</h3>
              <div className="space-y-1.5">
                {data.by_period.map((p: any) => (
                  <div key={p.period}>
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 mb-0.5">
                      <span>الحصة {p.period}</span>
                      <span className="font-mono">{p.rate}%</span>
                    </div>
                    <div className="h-2 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div
                        className={`h-full ${p.rate >= 90 ? 'bg-green-500' : p.rate >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${p.rate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By section */}
          {data.by_section?.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-sm mb-2">مقارنة الشُعب (الأقل أولاً)</h3>
              <ul className="text-xs divide-y divide-gray-200 dark:divide-gray-800">
                {data.by_section.map((s: any) => (
                  <li key={`${s.grade}-${s.section}`} className="flex items-center justify-between py-1.5">
                    <span>{s.grade} / {s.section}</span>
                    <span className={`font-mono ${s.rate >= 90 ? 'text-green-600 dark:text-green-400' : s.rate >= 75 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                      {s.rate}% • {s.present}/{s.total}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TopList({ title, items, field, tone }: {
  title: string;
  items: Array<{ id: number; student_code: string; name: string; grade: string; section: string; absent: number; late: number; excused: number }>;
  field: 'absent' | 'late' | 'excused';
  tone: 'red' | 'yellow' | 'blue';
}) {
  const [showAll, setShowAll] = useState(false);
  if (!items || items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, 5);
  const cls = {
    red:    'text-red-600 dark:text-red-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    blue:   'text-blue-600 dark:text-blue-400',
  }[tone];

  return (
    <div className="card">
      <h3 className={`font-semibold text-sm mb-2 ${cls}`}>{title}</h3>
      <ul className="text-sm divide-y divide-gray-200 dark:divide-gray-800">
        {visible.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 py-1.5">
            <span className="w-6 text-xs text-gray-400 text-center">#{i + 1}</span>
            <Link
              href={`/teacher/history?student=${s.id}&tab=student`}
              className="flex-1 min-w-0 hover:underline"
            >
              <p className="truncate">{s.name}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                {s.grade} / {s.section} • {s.student_code}
              </p>
            </Link>
            <span className={`font-bold ${cls}`}>{s[field]}</span>
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button onClick={() => setShowAll(!showAll)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2">
          {showAll ? 'عرض أقل' : `عرض الكل (${items.length})`}
        </button>
      )}
    </div>
  );
}

// ==================== TAB 3: Student Lookup ====================
function StudentTab() {
  const [studentId, setStudentId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());

  // Search students by name/id
  const { data: studentResults = [] } = useQuery<any[]>({
    queryKey: ['student-search', search],
    queryFn: async () => {
      if (search.trim().length < 2) return [];
      const r = await fetch(`/api/students?search=${encodeURIComponent(search.trim())}&limit=20`);
      return (await r.json()).data || [];
    },
    enabled: search.trim().length >= 2,
  });

  const { data: history, isLoading } = useQuery<any>({
    queryKey: ['student-history', studentId, from, to],
    queryFn: async () => {
      if (!studentId) return null;
      const r = await fetch(`/api/teacher/student-history?student_id=${studentId}&from=${from}&to=${to}`);
      return (await r.json()).data;
    },
    enabled: !!studentId,
  });

  const STATUS_COLOR: Record<string, string> = {
    present: 'bg-green-500',
    absent:  'bg-red-500',
    late:    'bg-yellow-500',
    excused: 'bg-blue-500',
  };
  const STATUS_LABEL: Record<string, string> = {
    present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'مستأذن',
  };

  return (
    <div className="space-y-3">
      {/* Student picker */}
      <div className="card">
        <label className="label flex items-center gap-1"><Search className="w-3 h-3" /> ابحث عن طالب</label>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setStudentId(null); }}
          className="input"
          placeholder="اسم أو رقم هوية..."
        />
        {search.trim().length >= 2 && studentResults.length > 0 && !studentId && (
          <ul className="mt-2 max-h-60 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
            {studentResults.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => { setStudentId(s.id); setSearch(''); }}
                  className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-sm"
                >
                  <p className="font-medium">{[s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ')}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{s.student_id}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Range + result */}
      {studentId && (
        <>
          <div className="card">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">من</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" max={to} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">إلى</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" max={todayStr()} />
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline text-gray-400" /></div>
          ) : !history ? (
            <p className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">لا توجد بيانات</p>
          ) : (
            <>
              <div className="card">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h3 className="font-semibold">{history.student.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {history.student.grade} / {history.student.section}
                      <span className="ms-2 font-mono" dir="ltr">{history.student.student_code}</span>
                    </p>
                  </div>
                  <Link
                    href={`/teacher/print/student/${studentId}?from=${from}&to=${to}`}
                    target="_blank"
                    className="text-xs px-2.5 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center gap-1 shrink-0"
                  >
                    <Printer className="w-3 h-3" /> تقرير الطالب
                  </Link>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <Stat label="معدل" value={history.summary.attendance_rate} suffix="%" tone="green" />
                  <Stat label="غياب" value={history.summary.absent} tone="red" />
                  <Stat label="تأخر" value={history.summary.late} tone="yellow" />
                  <Stat label="استئذان" value={history.summary.excused} tone="blue" />
                </div>
              </div>

              {/* Heatmap */}
              <div className="card">
                <h4 className="text-sm font-semibold mb-2">الخط الزمني</h4>
                <div className="flex gap-1 flex-wrap">
                  {history.timeline.map((t: any) => (
                    <div
                      key={t.session_id}
                      className={`w-6 h-6 rounded ${STATUS_COLOR[t.status]} relative group cursor-help`}
                      title={`${new Date(t.attendance_date).toLocaleDateString('ar-SA')} • حصة ${t.period_number} • ${STATUS_LABEL[t.status]}${t.notes ? ` (${t.notes})` : ''}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-500 dark:text-gray-400">
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> حاضر</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> غائب</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500" /> متأخر</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500" /> مستأذن</span>
                </div>
              </div>

              {/* Detailed timeline list */}
              <div className="card">
                <h4 className="text-sm font-semibold mb-2">السجل التفصيلي</h4>
                {history.timeline.length === 0 ? (
                  <p className="text-center text-gray-500 dark:text-gray-400 text-sm py-4">
                    لم تسجّل حصصاً مع هذا الطالب في الفترة المحددة
                  </p>
                ) : (
                  <ul className="text-sm divide-y divide-gray-200 dark:divide-gray-800">
                    {history.timeline.map((t: any) => (
                      <li key={t.session_id} className="flex items-center gap-2 py-1.5">
                        <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[t.status]}`} />
                        <span className="flex-1">
                          {new Date(t.attendance_date).toLocaleDateString('ar-SA')} • الحصة {t.period_number}
                        </span>
                        <span className="text-xs text-gray-600 dark:text-gray-300">{STATUS_LABEL[t.status]}</span>
                        {t.notes && <span className="text-xs text-gray-400 italic">({t.notes})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ==================== TAB 4: Reports ====================
function ReportsTab() {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-1.5">
        <FileDown className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        تقارير قابلة للطباعة
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-gray-500 dark:text-gray-400">من</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" max={to} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 dark:text-gray-400">إلى</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" max={todayStr()} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <button onClick={() => { setFrom(todayStr()); setTo(todayStr()); }} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">اليوم</button>
        <button onClick={() => { setFrom(daysAgo(7)); setTo(todayStr()); }} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">آخر ٧ أيام</button>
        <button onClick={() => { setFrom(daysAgo(30)); setTo(todayStr()); }} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">آخر شهر</button>
      </div>

      <div className="space-y-2 pt-3 border-t border-gray-200 dark:border-gray-800">
        <Link
          href={`/teacher/print/range?from=${from}&to=${to}`}
          target="_blank"
          className="btn-primary w-full inline-flex items-center justify-center gap-1.5 text-sm"
        >
          <Printer className="w-4 h-4" />
          طباعة التقرير ({from === to ? from : `${from} → ${to}`})
        </Link>
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          يضم: ملخص الفترة + كل جلساتك + قائمة الغياب التفصيلية
        </p>
      </div>
    </div>
  );
}

// ==================== Helpers ====================
function Stat({ label, value, suffix = '', tone = 'gray' }: { label: string; value: number; suffix?: string; tone?: 'gray'|'green'|'red'|'yellow'|'blue' }) {
  const cls = {
    gray:   'text-gray-900 dark:text-gray-100',
    green:  'text-green-600 dark:text-green-400',
    red:    'text-red-600 dark:text-red-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    blue:   'text-blue-600 dark:text-blue-400',
  }[tone];
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 text-center bg-gray-50 dark:bg-gray-900">
      <p className="text-[10px] text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${cls}`}>{value}{suffix}</p>
    </div>
  );
}
