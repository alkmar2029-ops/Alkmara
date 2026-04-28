'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  FileText, Calendar, Users, Search, Printer, CheckCircle2,
  ClipboardList, Clock, BadgeCheck, MessageSquarePlus, Layers,
} from 'lucide-react';

type ReportType = 'attendance_period' | 'late' | 'excused' | 'notes' | 'comprehensive';
type Scope = 'mine' | 'grade' | 'section' | 'student';

const TYPE_META: Record<ReportType, { label: string; icon: any }> = {
  attendance_period: { label: 'غياب الحصص', icon: ClipboardList },
  late:              { label: 'التأخر',     icon: Clock },
  excused:           { label: 'الاستئذان',  icon: BadgeCheck },
  notes:             { label: 'ملاحظاتي',   icon: MessageSquarePlus },
  comprehensive:     { label: 'تقرير شامل',  icon: Layers },
};

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

export default function TeacherReportsBuilderPage() {
  const [types, setTypes] = useState<Set<ReportType>>(new Set(['comprehensive']));
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [scope, setScope] = useState<Scope>('mine');
  const [scopeId, setScopeId] = useState<number | null>(null);
  const [studentSearch, setStudentSearch] = useState('');

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

  useEffect(() => { setScopeId(null); setSectionGradeId(null); setStudentSearch(''); }, [scope]);

  const toggleType = (t: ReportType) => {
    const next = new Set(types);
    if (t === 'comprehensive') {
      if (next.has('comprehensive')) next.delete('comprehensive');
      else { next.clear(); next.add('comprehensive'); }
    } else {
      if (next.has(t)) next.delete(t);
      else { next.delete('comprehensive'); next.add(t); }
    }
    if (next.size === 0) next.add('comprehensive');
    setTypes(next);
  };

  const setPreset = (p: 'today' | 'yesterday' | 'week' | 'month' | 'last_month') => {
    const d = new Date();
    if (p === 'today') { setFrom(todayStr()); setTo(todayStr()); }
    else if (p === 'yesterday') { setFrom(daysAgo(1)); setTo(daysAgo(1)); }
    else if (p === 'week') { setFrom(daysAgo(6)); setTo(todayStr()); }
    else if (p === 'month') { setFrom(startOfMonth()); setTo(todayStr()); }
    else if (p === 'last_month') {
      const last = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const end = new Date(d.getFullYear(), d.getMonth(), 0);
      setFrom(`${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-01`);
      setTo(`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`);
    }
  };

  const canGenerate = types.size > 0 && from && to && (scope === 'mine' || scopeId !== null);

  const printUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set('from', from);
    p.set('to', to);
    p.set('scope', scope);
    if (scopeId) p.set('scope_id', String(scopeId));
    p.set('types', Array.from(types).join(','));
    return `/teacher/reports/print?${p}`;
  }, [from, to, scope, scopeId, types]);

  return (
    <div className="space-y-3 pb-32">
      {/* Header */}
      <div className="card flex items-center gap-3">
        <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
          <FileText className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold">منشئ التقارير</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">تقارير حصصي وملاحظاتي</p>
        </div>
      </div>

      {/* Step 1: Type — vertical list, big tap targets */}
      <div className="card">
        <h2 className="font-semibold text-sm mb-2">١. نوع التقرير</h2>
        <div className="grid grid-cols-1 gap-1.5">
          {(Object.keys(TYPE_META) as ReportType[]).map((t) => {
            const meta = TYPE_META[t];
            const Icon = meta.icon;
            const active = types.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm text-right transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{meta.label}</span>
                {active && <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Date range */}
      <div className="card">
        <h2 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
          <Calendar className="w-4 h-4" /> ٢. الفترة
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
          <button onClick={() => setPreset('today')} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">اليوم</button>
          <button onClick={() => setPreset('yesterday')} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">أمس</button>
          <button onClick={() => setPreset('week')} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">٧ أيام</button>
          <button onClick={() => setPreset('month')} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">هذا الشهر</button>
          <button onClick={() => setPreset('last_month')} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">الشهر الماضي</button>
        </div>
      </div>

      {/* Step 3: Scope */}
      <div className="card">
        <h2 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
          <Users className="w-4 h-4" /> ٣. النطاق
        </h2>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {([['mine', 'كل حصصي'], ['grade', 'صف'], ['section', 'شعبة'], ['student', 'طالب']] as const).map(([s, label]) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-2 rounded-lg border-2 text-sm ${
                scope === s
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {scope === 'grade' && (
          <select value={scopeId ?? ''} onChange={(e) => setScopeId(e.target.value ? Number(e.target.value) : null)} className="input">
            <option value="">اختر الصف</option>
            {grades.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}

        {scope === 'section' && (
          <div className="grid grid-cols-2 gap-2">
            <select
              value={sectionGradeId ?? ''}
              onChange={(e) => { setSectionGradeId(e.target.value ? Number(e.target.value) : null); setScopeId(null); }}
              className="input"
            >
              <option value="">الصف</option>
              {grades.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select
              value={scopeId ?? ''}
              onChange={(e) => setScopeId(e.target.value ? Number(e.target.value) : null)}
              className="input"
              disabled={!sectionGradeId}
            >
              <option value="">الشعبة</option>
              {sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                placeholder="ابحث بالاسم أو الهوية..."
              />
            </div>
            {studentResults.length > 0 && !scopeId && (
              <ul className="mt-2 max-h-48 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
                {studentResults.map((s: any) => (
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

        {scope !== 'mine' && scopeId && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-2 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> تم التحديد
          </p>
        )}
      </div>

      {/* Generate */}
      <div className="card sticky bottom-0 z-20">
        <Link
          href={canGenerate ? printUrl : '#'}
          target="_blank"
          aria-disabled={!canGenerate}
          className={`btn-primary w-full inline-flex items-center justify-center gap-2 py-3 ${!canGenerate ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
        >
          <Printer className="w-5 h-5" />
          توليد التقرير
        </Link>
      </div>
    </div>
  );
}
