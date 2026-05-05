'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  FileText, Calendar, Users, Search, Printer, Loader2,
  CheckCircle2, ClipboardList, Clock, BadgeCheck, MessageSquarePlus, Layers,
} from 'lucide-react';

type ReportType = 'attendance_daily' | 'attendance_period' | 'late' | 'excused' | 'notes' | 'comprehensive' | 'period_compare';
type Scope = 'school' | 'grade' | 'section' | 'student';

const TYPE_LABELS: Record<ReportType, { label: string; icon: any; tone: string }> = {
  attendance_daily:  { label: 'الغياب اليومي (البصمة)', icon: ClipboardList, tone: 'red' },
  attendance_period: { label: 'غياب الحصص',              icon: Clock,         tone: 'orange' },
  late:              { label: 'التأخر',                   icon: Clock,         tone: 'yellow' },
  excused:           { label: 'الاستئذان',                icon: BadgeCheck,    tone: 'blue' },
  notes:             { label: 'ملاحظات الطلاب',           icon: MessageSquarePlus, tone: 'purple' },
  period_compare:    { label: 'مقارنة حصتين',             icon: Layers,        tone: 'cyan' },
  comprehensive:     { label: 'تقرير شامل (كل ما سبق)',   icon: Layers,        tone: 'green' },
};

// Period numbers shown in the dropdowns. 7 covers the typical Saudi
// middle/secondary day; bumped to 8 to accommodate longer schedules.
const PERIOD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}

export default function ReportBuilderPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">جاري التحميل...</div>}>
      <ReportBuilderInner />
    </Suspense>
  );
}

function ReportBuilderInner() {
  // Wizard state
  const [types, setTypes] = useState<Set<ReportType>>(new Set(['comprehensive']));
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [scope, setScope] = useState<Scope>('school');
  const [scopeId, setScopeId] = useState<number | null>(null);
  const [studentSearch, setStudentSearch] = useState('');

  // Pre-fill student scope when opened via /dashboard/reports/builder?student_id=N
  // (from the student detail page or global search).
  const searchParams = useSearchParams();
  useEffect(() => {
    const sid = searchParams.get('student_id');
    if (!sid) return;
    const id = parseInt(sid, 10);
    if (Number.isNaN(id)) return;
    setScope('student');
    setScopeId(id);
    // Pull the student's name into the search box so the picker shows
    // them as the active selection visually.
    (async () => {
      try {
        const r = await fetch(`/api/students/${id}`);
        if (!r.ok) return;
        const { data: s } = await r.json();
        if (s) {
          const fullName = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ');
          setStudentSearch(fullName);
        }
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Period scoping for the new "specific period" + "compare two periods"
  // features. periodMode controls which extra inputs the wizard exposes.
  type PeriodMode = 'all' | 'single' | 'compare';
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all');
  const [singlePeriod, setSinglePeriod] = useState<number>(1);
  const [comparePeriodA, setComparePeriodA] = useState<number>(1);
  const [comparePeriodB, setComparePeriodB] = useState<number>(5);

  // The period section is only meaningful when at least one period-based
  // type is selected. Hide the controls when the chosen types don't depend
  // on period_id (e.g. notes, attendance_daily) so the form stays uncluttered.
  const showsPeriodOptions = useMemo(() => {
    return types.has('attendance_period') || types.has('late') || types.has('excused')
      || types.has('comprehensive') || types.has('period_compare');
  }, [types]);

  // When user picks the comparison report type, force periodMode=compare so
  // the API receives the two period numbers it needs.
  useEffect(() => {
    if (types.has('period_compare') && periodMode !== 'compare') {
      setPeriodMode('compare');
    }
  }, [types]);

  const { data: grades = [] } = useQuery<any[]>({
    queryKey: ['grades-all'],
    queryFn: async () => (await (await fetch('/api/grades')).json()).data,
  });

  const [sectionGradeId, setSectionGradeId] = useState<number | null>(null);
  const { data: sections = [] } = useQuery<any[]>({
    queryKey: ['sections', sectionGradeId],
    queryFn: async () => {
      if (!sectionGradeId) return [];
      return (await (await fetch(`/api/sections?grade_id=${sectionGradeId}`)).json()).data;
    },
    enabled: !!sectionGradeId,
  });

  const { data: studentResults = [] } = useQuery<any[]>({
    queryKey: ['students-search', studentSearch],
    queryFn: async () => {
      if (studentSearch.trim().length < 2) return [];
      return (await (await fetch(`/api/students?search=${encodeURIComponent(studentSearch.trim())}&limit=20`)).json()).data || [];
    },
    enabled: studentSearch.trim().length >= 2,
  });

  // Reset scope_id when scope changes
  useEffect(() => { setScopeId(null); setSectionGradeId(null); setStudentSearch(''); }, [scope]);

  const toggleType = (t: ReportType) => {
    const next = new Set(types);
    if (t === 'comprehensive') {
      // Comprehensive is mutually-exclusive with the rest
      if (next.has('comprehensive')) next.delete('comprehensive');
      else { next.clear(); next.add('comprehensive'); }
    } else {
      if (next.has(t)) next.delete(t);
      else { next.delete('comprehensive'); next.add(t); }
    }
    if (next.size === 0) next.add('comprehensive');
    setTypes(next);
  };

  const setPreset = (preset: 'today' | 'yesterday' | 'week' | 'month' | 'last_month') => {
    const d = new Date();
    if (preset === 'today') { setFrom(todayStr()); setTo(todayStr()); }
    else if (preset === 'yesterday') { setFrom(daysAgo(1)); setTo(daysAgo(1)); }
    else if (preset === 'week') { setFrom(daysAgo(6)); setTo(todayStr()); }
    else if (preset === 'month') { setFrom(startOfMonth()); setTo(todayStr()); }
    else if (preset === 'last_month') {
      const last = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const end = new Date(d.getFullYear(), d.getMonth(), 0);
      setFrom(`${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-01`);
      setTo(`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`);
    }
  };

  const selectedScopeLabel = useMemo(() => {
    if (scope === 'school') return 'المدرسة كاملة';
    if (scope === 'grade' && scopeId) return grades.find((g) => g.id === scopeId)?.name || '—';
    if (scope === 'section' && scopeId) return sections.find((s) => s.id === scopeId)?.name || '—';
    return '—';
  }, [scope, scopeId, grades, sections]);

  const canGenerate =
    types.size > 0 && from && to &&
    (scope === 'school' || scopeId !== null);

  const printUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set('from', from);
    p.set('to', to);
    p.set('scope', scope);
    if (scopeId) p.set('scope_id', String(scopeId));
    p.set('types', Array.from(types).join(','));
    if (periodMode === 'single') p.set('period_number', String(singlePeriod));
    if (periodMode === 'compare' || types.has('period_compare')) {
      p.set('compare_period_a', String(comparePeriodA));
      p.set('compare_period_b', String(comparePeriodB));
    }
    return `/dashboard/reports/print?${p}`;
  }, [from, to, scope, scopeId, types, periodMode, singlePeriod, comparePeriodA, comparePeriodB]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">منشئ التقارير</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">اختر نوع التقرير، الفترة، والنطاق ثم ولّد التقرير</p>
          </div>
        </div>
      </div>

      {/* Step 1: Type */}
      <div className="card">
        <h2 className="font-semibold text-sm mb-3">١. نوع التقرير</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {(Object.keys(TYPE_LABELS) as ReportType[]).map((t) => {
            const meta = TYPE_LABELS[t];
            const Icon = meta.icon;
            const active = types.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-colors text-sm text-right ${
                  active
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{meta.label}</span>
                {active && <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Date range */}
      <div className="card">
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
          <Calendar className="w-4 h-4" />
          ٢. النطاق الزمني
        </h2>
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
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button onClick={() => setPreset('today')} className="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">اليوم</button>
          <button onClick={() => setPreset('yesterday')} className="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">أمس</button>
          <button onClick={() => setPreset('week')} className="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">آخر ٧ أيام</button>
          <button onClick={() => setPreset('month')} className="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">هذا الشهر</button>
          <button onClick={() => setPreset('last_month')} className="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">الشهر الماضي</button>
        </div>
      </div>

      {/* Step 2.5: Period selector — only when at least one type uses period
          data. Three modes: every period (default), one specific period, or
          a side-by-side comparison of two periods. */}
      {showsPeriodOptions && (
        <div className="card">
          <h2 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            ٢.٥ الحصص
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            {([
              { v: 'all',     label: 'كل الحصص',         desc: 'جميع حصص اليوم' },
              { v: 'single',  label: 'حصة محدّدة',         desc: 'تركيز على حصة واحدة' },
              { v: 'compare', label: 'مقارنة حصتين',       desc: 'وضع جدول مقارنة' },
            ] as const).map((opt) => {
              const active = periodMode === opt.v;
              // Compare mode is also auto-selected when the user picks the
              // "period_compare" report type — disable manual change to avoid
              // a confused state.
              const locked = types.has('period_compare') && opt.v !== 'compare';
              return (
                <button
                  key={opt.v}
                  onClick={() => !locked && setPeriodMode(opt.v)}
                  disabled={locked}
                  className={`text-right p-3 rounded-lg border-2 transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15'
                      : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  } ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <p className={`text-sm font-semibold ${active ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{opt.desc}</p>
                </button>
              );
            })}
          </div>

          {periodMode === 'single' && (
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400">اختر الحصة</span>
              <select
                value={singlePeriod}
                onChange={(e) => setSinglePeriod(parseInt(e.target.value, 10))}
                className="input"
              >
                {PERIOD_NUMBERS.map((n) => (
                  <option key={n} value={n}>الحصة {n}</option>
                ))}
              </select>
            </label>
          )}

          {periodMode === 'compare' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">الحصة الأولى</span>
                <select
                  value={comparePeriodA}
                  onChange={(e) => setComparePeriodA(parseInt(e.target.value, 10))}
                  className="input"
                >
                  {PERIOD_NUMBERS.map((n) => (
                    <option key={n} value={n}>الحصة {n}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">الحصة الثانية</span>
                <select
                  value={comparePeriodB}
                  onChange={(e) => setComparePeriodB(parseInt(e.target.value, 10))}
                  className="input"
                >
                  {PERIOD_NUMBERS.map((n) => (
                    <option key={n} value={n} disabled={n === comparePeriodA}>الحصة {n}</option>
                  ))}
                </select>
              </label>
              {comparePeriodA === comparePeriodB && (
                <p className="text-xs text-amber-600 dark:text-amber-400 sm:col-span-2">
                  ⚠️ اختر حصّتين مختلفتين
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Scope */}
      <div className="card">
        <h2 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          ٣. النطاق البشري
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {([['school', 'المدرسة كاملة'], ['grade', 'صف محدّد'], ['section', 'شعبة محدّدة'], ['student', 'طالب محدّد']] as const).map(([s, label]) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-2 rounded-lg border-2 transition-colors text-sm ${
                scope === s
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {scope === 'grade' && (
          <select
            value={scopeId ?? ''}
            onChange={(e) => setScopeId(e.target.value ? Number(e.target.value) : null)}
            className="input"
          >
            <option value="">اختر الصف</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}

        {scope === 'section' && (
          <div className="grid grid-cols-2 gap-2">
            <select
              value={sectionGradeId ?? ''}
              onChange={(e) => { setSectionGradeId(e.target.value ? Number(e.target.value) : null); setScopeId(null); }}
              className="input"
            >
              <option value="">اختر الصف</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select
              value={scopeId ?? ''}
              onChange={(e) => setScopeId(e.target.value ? Number(e.target.value) : null)}
              className="input"
              disabled={!sectionGradeId}
            >
              <option value="">اختر الشعبة</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {scope === 'student' && (
          <div>
            <div className="relative">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-gray-400 pointer-events-none" />
              <input
                value={studentSearch}
                onChange={(e) => { setStudentSearch(e.target.value); if (!e.target.value) setScopeId(null); }}
                className="input pe-9"
                placeholder="ابحث بالاسم أو رقم الهوية..."
              />
            </div>
            {studentResults.length > 0 && !scopeId && (
              <ul className="mt-2 max-h-60 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
                {studentResults.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => { setScopeId(s.id); setStudentSearch([s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ')); }}
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
        )}

        {scope !== 'school' && scopeId && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-2 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            مختار: {selectedScopeLabel}
          </p>
        )}
      </div>

      {/* Generate */}
      <div className="card sticky bottom-0 z-20">
        <Link
          href={canGenerate ? printUrl : '#'}
          target="_blank"
          aria-disabled={!canGenerate}
          className={`btn-primary w-full inline-flex items-center justify-center gap-2 ${!canGenerate ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
        >
          <Printer className="w-4 h-4" />
          توليد التقرير وعرضه للطباعة
        </Link>
        {!canGenerate && scope !== 'school' && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400 text-center mt-2">
            اختر العنصر المحدّد للنطاق ({scope === 'grade' ? 'الصف' : scope === 'section' ? 'الشعبة' : 'الطالب'})
          </p>
        )}
      </div>
    </div>
  );
}
