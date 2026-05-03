'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ClipboardCheck, Loader2, Calendar, RefreshCw, Filter, Printer, Send,
  X, CheckCircle2, XCircle, Clock as ClockIcon, BadgeCheck, User, ChevronLeft, AlertCircle,
  Trash2, Bell, MessageCircle, EyeOff,
} from 'lucide-react';

interface SectionRow {
  id: number;
  grade_id: number;
  grade_name: string;
  grade_sort: number;
  section_name: string;
  sort_order: number;
}
interface PeriodRow {
  id: number;
  number: number;
  name: string | null;
  start_time: string | null;
  end_time: string | null;
}
interface RecordedCell {
  session_id: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  total_count: number;
  recorded_at: string;
  recorded_by: string | null;
  teacher_name: string | null;
}
interface MonitorData {
  date: string;
  sections: SectionRow[];
  periods: PeriodRow[];
  recorded: Record<string, RecordedCell>;
  stats: {
    total_expected: number;
    total_recorded: number;
    total_missing: number;
    coverage_percent: number;
  };
}

// Inline shape returned by GET /api/period-attendance/session/[id].
interface SessionDetail {
  session: {
    id: number;
    section_id: number;
    period_id: number;
    attendance_date: string;
    recorded_at: string;
    recorded_by: string | null;
    teacher_name: string | null;
    section_name: string | null;
    grade_name: string | null;
    period_number: number | null;
    period_name: string | null;
    notes: string | null;
  };
  summary: { total: number; present: number; absent: number; late: number; excused: number };
  students: Array<{
    id: number;
    student_id: string;
    name: string;
    phone: string | null;
    status: 'present' | 'absent' | 'late' | 'excused';
    notes: string | null;
  }>;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Heatmap color for a session cell based on absence ratio.
// 0% = green, <10% = yellow, 10-25% = orange, >25% = red.
function cellTone(absent: number, late: number, excused: number, total: number) {
  if (total <= 0) return { bg: 'bg-green-100 dark:bg-green-500/15', text: 'text-green-700 dark:text-green-300', border: 'border-green-200 dark:border-green-500/30' };
  const issues = absent + late + excused;
  const ratio = issues / total;
  if (issues === 0) return { bg: 'bg-green-100 dark:bg-green-500/15', text: 'text-green-700 dark:text-green-300', border: 'border-green-200 dark:border-green-500/30' };
  if (ratio < 0.1) return { bg: 'bg-yellow-100 dark:bg-yellow-500/15', text: 'text-yellow-700 dark:text-yellow-300', border: 'border-yellow-200 dark:border-yellow-500/30' };
  if (ratio < 0.25) return { bg: 'bg-orange-100 dark:bg-orange-500/15', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200 dark:border-orange-500/30' };
  return { bg: 'bg-red-100 dark:bg-red-500/15', text: 'text-red-700 dark:text-red-300', border: 'border-red-200 dark:border-red-500/30' };
}

export default function PeriodAttendancePage() {
  const [date, setDate] = useState(todayStr());
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);
  const [missingTarget, setMissingTarget] = useState<{
    section: SectionRow; period: PeriodRow; date: string;
  } | null>(null);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const qc = useQueryClient();

  // Full sections × periods grid for the date — every expected cell, with
  // a sparse map of which ones are recorded. Drives both the heatmap and
  // the "missing" badges/clicks.
  const { data: monitor, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery<MonitorData>({
    queryKey: ['period-monitor', date],
    queryFn: async () => (await (await fetch(`/api/period-attendance/missing?date=${date}`)).json()).data,
    refetchInterval: 60_000,  // auto-refresh each minute (only on this tab)
  });

  // Wipe every session for the currently-selected date. Triple-confirm because
  // this is destructive — convenient for clearing test data or fixing a
  // wholesale wrong-day save.
  const bulkDeleteMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/period-attendance/sessions?date=${date}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الحذف');
      return d.deleted as number;
    },
    onSuccess: (count) => {
      toast.success(`تم حذف ${count} جلسة من تاريخ ${date}`);
      qc.invalidateQueries({ queryKey: ['period-monitor'] });
      qc.invalidateQueries({ queryKey: ['period-history'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Filter sections by grade selector. Also support "show missing only"
  // — hides any section row that has every period recorded (cleans the view
  // when only a handful of cells are missing).
  const visibleSections = useMemo(() => {
    if (!monitor) return [];
    return monitor.sections.filter((s) => {
      if (gradeFilter !== 'all' && s.grade_name !== gradeFilter) return false;
      if (showMissingOnly) {
        const allRecorded = monitor.periods.every(
          (p) => monitor.recorded[`${s.id}:${p.id}`],
        );
        if (allRecorded) return false;
      }
      return true;
    });
  }, [monitor, gradeFilter, showMissingOnly]);

  const gradesAvailable = useMemo(() => {
    if (!monitor) return [];
    const s = new Set<string>();
    monitor.sections.forEach((x) => s.add(x.grade_name));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [monitor]);

  // Aggregate counts across recorded cells (visible scope respects filters).
  const totals = useMemo(() => {
    if (!monitor) return { sessions: 0, absent: 0, late: 0, excused: 0 };
    return Object.values(monitor.recorded).reduce((acc, s) => ({
      sessions: acc.sessions + 1,
      absent: acc.absent + s.absent_count,
      late: acc.late + s.late_count,
      excused: acc.excused + s.excused_count,
    }), { sessions: 0, absent: 0, late: 0, excused: 0 });
  }, [monitor]);

  const lastUpdated = useMemo(() => {
    if (!dataUpdatedAt) return '';
    const d = new Date(dataUpdatedAt);
    return d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  }, [dataUpdatedAt]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <ClipboardCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">حضور الحصص</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              ملخص لحظي للحصص المسجّلة هذا اليوم
              {lastUpdated && <> • آخر تحديث: <span className="font-mono" dir="ltr">{lastUpdated}</span></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/dashboard/period-attendance/print?date=${date}${gradeFilter !== 'all' ? '&grade=' + encodeURIComponent(gradeFilter) : ''}`}
            target="_blank"
            className="btn-secondary inline-flex items-center gap-1 text-sm"
          >
            <Printer className="w-4 h-4" /> طباعة التقرير
          </Link>
          <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary inline-flex items-center gap-1 text-sm">
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            تحديث
          </button>
          {monitor && monitor.stats.total_recorded > 0 && (
            <button
              onClick={() => {
                const msg = `سيتم حذف ${monitor.stats.total_recorded} جلسة بتاريخ ${date} نهائياً.\n\nهذا الإجراء لا يمكن التراجع عنه.\n\nهل أنت متأكد؟`;
                if (confirm(msg)) bulkDeleteMut.mutate();
              }}
              disabled={bulkDeleteMut.isPending}
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/25 disabled:opacity-50"
              title="حذف كل جلسات هذا التاريخ (للإدارة فقط)"
            >
              {bulkDeleteMut.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الحذف...</>
                : <><Trash2 className="w-4 h-4" /> حذف جلسات اليوم ({monitor.stats.total_recorded})</>
              }
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          <div>
            <label className="label flex items-center gap-1"><EyeOff className="w-3 h-3" /> العرض</label>
            <button
              onClick={() => setShowMissingOnly((v) => !v)}
              className={`input w-full text-right inline-flex items-center justify-between ${showMissingOnly ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300' : ''}`}
            >
              <span>{showMissingOnly ? 'الناقص فقط ✓' : 'الكل'}</span>
              <span className="text-xs opacity-70">اضغط للتبديل</span>
            </button>
          </div>
        </div>
      </div>

      {/* Coverage banner — the key new metric */}
      {monitor && (
        <div className={`card p-4 ${
          monitor.stats.coverage_percent === 100 ? 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30' :
          monitor.stats.coverage_percent >= 80 ? 'bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30' :
          monitor.stats.coverage_percent >= 50 ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30' :
          'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider opacity-70">نسبة الالتزام</p>
              <p className="text-3xl font-bold mt-1">{monitor.stats.coverage_percent}%</p>
              <p className="text-sm mt-1">
                تم تسجيل <strong>{monitor.stats.total_recorded}</strong> من
                {' '}<strong>{monitor.stats.total_expected}</strong> جلسة متوقّعة
                {monitor.stats.total_missing > 0 && (
                  <> • <strong className="text-red-600 dark:text-red-400">{monitor.stats.total_missing}</strong> ناقصة ⚠️</>
                )}
              </p>
            </div>
            <div className="flex-1 max-w-xs">
              <div className="w-full bg-white/60 dark:bg-black/30 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    monitor.stats.coverage_percent === 100 ? 'bg-green-500' :
                    monitor.stats.coverage_percent >= 80 ? 'bg-blue-500' :
                    monitor.stats.coverage_percent >= 50 ? 'bg-amber-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${monitor.stats.coverage_percent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="جلسات مسجّلة" value={totals.sessions} />
        <Stat label="إجمالي غياب" value={totals.absent} tone="red" />
        <Stat label="إجمالي تأخر" value={totals.late} tone="yellow" />
        <Stat label="إجمالي استئذان" value={totals.excused} tone="blue" />
      </div>

      {/* Heatmap matrix */}
      <div className="card">
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
        ) : !monitor || monitor.sections.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            لا توجد شُعب مسجَّلة في النظام بعد. أضف الصفوف والشعب أولاً.
          </div>
        ) : visibleSections.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
            {showMissingOnly
              ? '✓ ممتاز! كل الجلسات في النطاق المعروض مُسجَّلة.'
              : 'لا توجد نتائج للفلتر المحدّد.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr className="text-right">
                    <th className="px-3 py-2 font-medium sticky right-0 bg-gray-50 dark:bg-gray-900">الصف / الشعبة</th>
                    {monitor.periods.map((p) => (
                      <th key={p.id} className="px-2 py-2 font-medium text-center">حصة {p.number}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {visibleSections.map((sec) => (
                    <tr key={sec.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-2 font-medium whitespace-nowrap sticky right-0 bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800">
                        {sec.grade_name} / {sec.section_name}
                      </td>
                      {monitor.periods.map((p) => {
                        const s = monitor.recorded[`${sec.id}:${p.id}`];
                        if (!s) {
                          // Missing cell — clickable, opens reminder modal.
                          return (
                            <td key={p.id} className="px-1 py-1 text-center">
                              <button
                                onClick={() => setMissingTarget({ section: sec, period: p, date })}
                                className="w-full rounded-md border-2 border-dashed border-red-300 dark:border-red-500/40 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400 py-2 text-xs transition-colors group"
                                title={`جلسة ناقصة — اضغط لتذكير المعلم`}
                              >
                                <Bell className="w-3.5 h-3.5 mx-auto mb-0.5 group-hover:animate-pulse" />
                                <div className="text-[10px] font-medium">لم تُسجَّل</div>
                              </button>
                            </td>
                          );
                        }
                        const tone = cellTone(s.absent_count, s.late_count, s.excused_count, s.total_count);
                        const present = s.total_count - s.absent_count - s.late_count - s.excused_count;
                        return (
                          <td key={p.id} className="px-1 py-1 text-center">
                            <button
                              onClick={() => setOpenSessionId(s.session_id)}
                              className={`w-full rounded-md border ${tone.bg} ${tone.border} ${tone.text} px-1.5 py-1.5 transition-transform hover:scale-105 hover:shadow-sm text-right`}
                              title={`${s.teacher_name ?? '—'} • ${present}/${s.total_count}`}
                            >
                              {s.teacher_name && (
                                <div className="text-[10px] truncate opacity-90 mb-0.5 font-medium">
                                  <User className="w-2.5 h-2.5 inline" /> {s.teacher_name}
                                </div>
                              )}
                              <div className="text-sm font-bold leading-tight">{present}<span className="opacity-60">/{s.total_count}</span></div>
                              {(s.absent_count + s.late_count + s.excused_count) > 0 && (
                                <div className="text-[10px] flex justify-center gap-1 mt-0.5">
                                  {s.absent_count > 0 && <span>غ {s.absent_count}</span>}
                                  {s.late_count > 0 && <span>ت {s.late_count}</span>}
                                  {s.excused_count > 0 && <span>س {s.excused_count}</span>}
                                </div>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-3 flex flex-wrap gap-x-4 gap-y-1 px-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded border-2 border-dashed border-red-400 dark:border-red-500/50 inline-block" />
                لم تُسجَّل (اضغط للتذكير)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-green-100 border border-green-300 dark:bg-green-500/20 dark:border-green-500/40 inline-block" />
                الكل حاضر
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300 dark:bg-yellow-500/20 dark:border-yellow-500/40 inline-block" />
                غياب خفيف (&lt;10%)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 dark:bg-orange-500/20 dark:border-orange-500/40 inline-block" />
                غياب متوسط (10-25%)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-red-100 border border-red-300 dark:bg-red-500/20 dark:border-red-500/40 inline-block" />
                غياب شديد (&gt;25%)
              </span>
              <span className="ms-auto">غ = غائب • ت = متأخر • س = مستأذن</span>
            </div>
          </>
        )}
      </div>

      {/* Detail modal */}
      {openSessionId !== null && (
        <SessionDetailModal sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />
      )}

      {/* Missing-session reminder modal */}
      {missingTarget && (
        <MissingSessionReminderModal
          section={missingTarget.section}
          period={missingTarget.period}
          date={missingTarget.date}
          onClose={() => setMissingTarget(null)}
        />
      )}
    </div>
  );
}

// =================== Detail modal ===================
function SessionDetailModal({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<SessionDetail>({
    queryKey: ['session-detail', sessionId],
    queryFn: async () => (await (await fetch(`/api/period-attendance/session/${sessionId}`)).json()).data,
  });

  // Print state — which categories to include in the printable report.
  // Defaults: the three "exception" buckets (absent/late/excused). Present
  // is opt-in because a 30-name list bloats the page; admin can tick it.
  const [printOpen, setPrintOpen] = useState(false);
  const [printOpts, setPrintOpts] = useState({
    absent: true,
    late: true,
    excused: true,
    present: false,
  });
  const allSelected =
    printOpts.absent && printOpts.late && printOpts.excused && printOpts.present;
  const noneSelected =
    !printOpts.absent && !printOpts.late && !printOpts.excused && !printOpts.present;
  const toggleAll = () => {
    const v = !allSelected;
    setPrintOpts({ absent: v, late: v, excused: v, present: v });
  };
  const doPrint = () => {
    setPrintOpen(false);
    // Wait for the dialog to unmount + the print-area to lay out, then fire.
    setTimeout(() => window.print(), 80);
  };

  const sendWaMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/whatsapp/send-period-absences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, statuses: ['absent'] }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإرسال');
      return d.data as { sent: number; failed: number };
    },
    onSuccess: (d) => {
      if (d.failed > 0) toast(`أُرسل ${d.sent} • فشل ${d.failed}`, { icon: '⚠️' });
      else toast.success(`تم إرسال ${d.sent} رسالة لأولياء الغائبين`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Admin-only: clear out a session entirely (e.g. removing test data, fixing
  // a teacher's mistaken save). period_absences are wiped via ON DELETE
  // CASCADE in the DB.
  const deleteMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/period-attendance/session/${sessionId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الحذف');
    },
    onSuccess: () => {
      toast.success('تم حذف الجلسة');
      qc.invalidateQueries({ queryKey: ['period-monitor'] });
      qc.invalidateQueries({ queryKey: ['period-history'] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="font-semibold text-lg">تفاصيل الحصة</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
          ) : isError || !data ? (
            <div className="text-center py-12 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle className="w-6 h-6 mx-auto mb-2" />
              فشل تحميل التفاصيل
            </div>
          ) : (
            <>
              {/* Meta */}
              <dl className="grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">الصف / الشعبة</dt>
                  <dd className="font-medium">{data.session.grade_name} / {data.session.section_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">الحصة</dt>
                  <dd className="font-medium">الحصة {data.session.period_number}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">المعلم المسجِّل</dt>
                  <dd className="font-medium">{data.session.teacher_name || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">وقت التسجيل</dt>
                  <dd className="font-medium font-mono text-xs" dir="ltr">
                    {new Date(data.session.recorded_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                  </dd>
                </div>
              </dl>

              {/* Summary */}
              <div className="grid grid-cols-4 gap-2">
                <SummaryPill icon={CheckCircle2} label="حاضر" value={data.summary.present} tone="green" />
                <SummaryPill icon={XCircle}      label="غائب" value={data.summary.absent}  tone="red" />
                <SummaryPill icon={ClockIcon}    label="متأخر" value={data.summary.late}    tone="yellow" />
                <SummaryPill icon={BadgeCheck}   label="مستأذن" value={data.summary.excused} tone="blue" />
              </div>

              {/* Lists by status */}
              <StudentList title="غائبون" students={data.students.filter((s) => s.status === 'absent')} tone="red" />
              <StudentList title="متأخرون" students={data.students.filter((s) => s.status === 'late')} tone="yellow" />
              <StudentList title="مستأذنون" students={data.students.filter((s) => s.status === 'excused')} tone="blue" />
              <details className="text-sm">
                <summary className="cursor-pointer text-gray-600 dark:text-gray-300 hover:underline">
                  عرض الحاضرين ({data.summary.present})
                </summary>
                <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                  {data.students.filter((s) => s.status === 'present').map((s) => (
                    <li key={s.id} className="text-gray-700 dark:text-gray-300 truncate">• {s.name}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>

        {/* Footer */}
        {data && (
          <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => {
                if (confirm('هل أنت متأكد من حذف هذه الجلسة؟ سيتم حذف جميع سجلات الغياب المرتبطة بها.')) {
                  deleteMut.mutate();
                }
              }}
              disabled={deleteMut.isPending}
              className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/25 disabled:opacity-50"
              title="حذف الجلسة (إداري فقط)"
            >
              {deleteMut.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الحذف...</>
                : <><Trash2 className="w-4 h-4" /> حذف الجلسة</>
              }
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setPrintOpen(true)}
                className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600"
                title="طباعة كشف الحضور"
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
              {data.summary.absent > 0 && (
                <button
                  onClick={() => sendWaMut.mutate()}
                  disabled={sendWaMut.isPending}
                  className="btn-primary inline-flex items-center gap-1 text-sm"
                >
                  {sendWaMut.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الإرسال... (~{Math.ceil(data.summary.absent * 5.5)}ث)</>
                    : <><Send className="w-4 h-4" /> إرسال واتساب لأولياء الغائبين ({data.summary.absent})</>
                  }
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Print options sub-dialog — renders above the modal (z-60). */}
      {printOpen && data && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={(e) => {
            // Stop the click from bubbling up to the outer modal's onClose
            // — otherwise dismissing the print dialog would also close the
            // session detail modal.
            e.stopPropagation();
            setPrintOpen(false);
          }}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-sm w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Printer className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                ماذا تطبع؟
              </h3>
              <button
                onClick={() => setPrintOpen(false)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 mb-1">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4" />
              <span className="font-medium">الجميع</span>
            </label>
            <div className="border-t border-gray-200 dark:border-gray-700 my-2" />

            <div className="space-y-1">
              <label className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <input
                  type="checkbox"
                  checked={printOpts.absent}
                  onChange={(e) => setPrintOpts({ ...printOpts, absent: e.target.checked })}
                  className="w-4 h-4"
                />
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="flex-1">الغائبون</span>
                <span className="text-xs text-gray-500 font-mono">{data.summary.absent}</span>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <input
                  type="checkbox"
                  checked={printOpts.late}
                  onChange={(e) => setPrintOpts({ ...printOpts, late: e.target.checked })}
                  className="w-4 h-4"
                />
                <ClockIcon className="w-4 h-4 text-yellow-600" />
                <span className="flex-1">المتأخرون</span>
                <span className="text-xs text-gray-500 font-mono">{data.summary.late}</span>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <input
                  type="checkbox"
                  checked={printOpts.excused}
                  onChange={(e) => setPrintOpts({ ...printOpts, excused: e.target.checked })}
                  className="w-4 h-4"
                />
                <BadgeCheck className="w-4 h-4 text-blue-600" />
                <span className="flex-1">المستأذنون</span>
                <span className="text-xs text-gray-500 font-mono">{data.summary.excused}</span>
              </label>
              <label className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <input
                  type="checkbox"
                  checked={printOpts.present}
                  onChange={(e) => setPrintOpts({ ...printOpts, present: e.target.checked })}
                  className="w-4 h-4"
                />
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="flex-1">الحاضرون</span>
                <span className="text-xs text-gray-500 font-mono">{data.summary.present}</span>
              </label>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setPrintOpen(false)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                إلغاء
              </button>
              <button
                onClick={doPrint}
                disabled={noneSelected}
                className="flex-1 btn-primary inline-flex items-center justify-center gap-1 text-sm disabled:opacity-50"
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print-only area — hidden on screen, visible only in print preview. */}
      {data && (
        <div className="session-print-area" aria-hidden>
          <div className="print-header">
            <h1>كشف حضور الحصة</h1>
            <div className="print-meta">
              <p><strong>التاريخ:</strong> {data.session.attendance_date}</p>
              <p><strong>الصف / الشعبة:</strong> {data.session.grade_name} / {data.session.section_name}</p>
              <p><strong>الحصة:</strong> الحصة {data.session.period_number}</p>
              <p><strong>المعلم المسجِّل:</strong> {data.session.teacher_name || '—'}</p>
            </div>
          </div>

          <table className="print-summary">
            <thead>
              <tr>
                <th>الإجمالي</th>
                <th>حاضر</th>
                <th>غائب</th>
                <th>متأخر</th>
                <th>مستأذن</th>
                <th>نسبة الحضور</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{data.summary.total}</td>
                <td>{data.summary.present}</td>
                <td>{data.summary.absent}</td>
                <td>{data.summary.late}</td>
                <td>{data.summary.excused}</td>
                <td>
                  {data.summary.total > 0
                    ? Math.round((data.summary.present / data.summary.total) * 100) + '٪'
                    : '—'}
                </td>
              </tr>
            </tbody>
          </table>

          {printOpts.absent && data.summary.absent > 0 && (
            <PrintSection
              title="الغائبون"
              students={data.students.filter((s) => s.status === 'absent')}
            />
          )}
          {printOpts.late && data.summary.late > 0 && (
            <PrintSection
              title="المتأخرون"
              students={data.students.filter((s) => s.status === 'late')}
            />
          )}
          {printOpts.excused && data.summary.excused > 0 && (
            <PrintSection
              title="المستأذنون"
              students={data.students.filter((s) => s.status === 'excused')}
            />
          )}
          {printOpts.present && data.summary.present > 0 && (
            <PrintSection
              title="الحاضرون"
              students={data.students.filter((s) => s.status === 'present')}
            />
          )}

          <div className="print-footer">
            <p className="print-stamp">
              تاريخ الطباعة:{' '}
              {new Date().toLocaleString('ar-SA-u-ca-gregory', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <div className="print-signatures">
              <div>توقيع المعلم: ............................</div>
              <div>توقيع الإدارة: ............................</div>
            </div>
          </div>
        </div>
      )}

      {/* Print stylesheet — scoped to .session-print-area. */}
      <style jsx global>{`
        .session-print-area { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          .session-print-area, .session-print-area * { visibility: visible !important; }
          .session-print-area {
            display: block !important;
            position: absolute;
            inset: 0;
            background: white !important;
            color: black !important;
            padding: 8mm;
            font-family: 'Cairo', 'Tajawal', system-ui, sans-serif;
            font-size: 11pt;
          }
          @page { size: A4 portrait; margin: 10mm; }
          .session-print-area .print-header h1 {
            text-align: center;
            font-size: 18pt;
            margin: 0 0 10pt;
            font-weight: 800;
            color: #111827;
          }
          .session-print-area .print-meta {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4pt 16pt;
            margin: 0 0 10pt;
            padding: 6pt 8pt;
            background: #f9fafb;
            border: 0.5pt solid #d4d4d8;
            border-radius: 3pt;
          }
          .session-print-area .print-meta p { margin: 0; font-size: 10pt; }
          .session-print-area .print-summary {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12pt;
          }
          .session-print-area .print-summary th,
          .session-print-area .print-summary td {
            border: 0.5pt solid #9ca3af;
            padding: 5pt 6pt;
            text-align: center;
            font-size: 10pt;
          }
          .session-print-area .print-summary th { background: #e5e7eb; font-weight: 700; }
          .session-print-area .print-section { margin-bottom: 12pt; page-break-inside: avoid; }
          .session-print-area .print-section h2 {
            font-size: 13pt;
            margin: 0 0 6pt;
            padding: 5pt 8pt;
            background: #f3f4f6;
            border-right: 4pt solid #2563eb;
            font-weight: 700;
          }
          .session-print-area .print-section table {
            width: 100%;
            border-collapse: collapse;
          }
          .session-print-area .print-section th,
          .session-print-area .print-section td {
            border: 0.5pt solid #9ca3af;
            padding: 4pt 6pt;
            font-size: 10pt;
            text-align: right;
          }
          .session-print-area .print-section th { background: #f9fafb; font-weight: 700; }
          .session-print-area .print-footer {
            margin-top: 18pt;
            padding-top: 6pt;
            border-top: 0.5pt solid #d4d4d8;
          }
          .session-print-area .print-stamp {
            font-size: 8.5pt;
            color: #6b7280;
            margin: 0 0 14pt;
          }
          .session-print-area .print-signatures {
            display: flex;
            justify-content: space-between;
            gap: 24pt;
            font-size: 10pt;
          }
        }
      `}</style>
    </div>
  );
}

// Single status section in the printed report — table with row numbers,
// student names, and a blank signature column.
function PrintSection({
  title,
  students,
}: {
  title: string;
  students: SessionDetail['students'];
}) {
  return (
    <section className="print-section">
      <h2>{title} ({students.length})</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: '8%' }}>#</th>
            <th>اسم الطالب</th>
            <th style={{ width: '24%' }}>رقم الطالب</th>
            <th style={{ width: '18%' }}>التوقيع</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s, i) => (
            <tr key={s.id}>
              <td style={{ textAlign: 'center' }}>{i + 1}</td>
              <td>{s.name}</td>
              <td style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace' }}>
                {s.student_id}
              </td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SummaryPill({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: 'green'|'red'|'yellow'|'blue' }) {
  const cls = {
    green:  'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30',
    red:    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/30',
    blue:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${cls}`}>
      <Icon className="w-4 h-4 mx-auto mb-1" />
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px]">{label}</p>
    </div>
  );
}

function StudentList({ title, students, tone }: {
  title: string;
  students: Array<{ id: number; name: string; student_id: string; notes: string | null }>;
  tone: 'red' | 'yellow' | 'blue';
}) {
  if (students.length === 0) return null;
  const cls = {
    red:    'text-red-700 dark:text-red-400',
    yellow: 'text-yellow-700 dark:text-yellow-400',
    blue:   'text-blue-700 dark:text-blue-400',
  }[tone];
  return (
    <div>
      <h4 className={`font-semibold text-sm ${cls} mb-2 flex items-center gap-2`}>
        <ChevronLeft className="w-3 h-3" /> {title} ({students.length})
      </h4>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
        {students.map((s) => (
          <li key={s.id} className="py-1.5 flex items-center gap-2">
            <span className="font-mono text-xs text-gray-500 dark:text-gray-400 w-24 shrink-0" dir="ltr">{s.student_id}</span>
            <span className="flex-1 truncate text-gray-900 dark:text-gray-100">{s.name}</span>
            {s.notes && <span className="text-xs text-gray-500 dark:text-gray-400 italic">({s.notes})</span>}
          </li>
        ))}
      </ul>
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

// =================== Missing-session reminder modal ===================
// Opens when admin clicks an unrecorded cell in the heatmap. Lets them pick
// a teacher and fire a dual reminder (in-app message + WhatsApp). Pre-fills
// a sensible Arabic body the admin can edit before sending.
function MissingSessionReminderModal({
  section, period, date, onClose,
}: {
  section: SectionRow; period: PeriodRow; date: string; onClose: () => void;
}) {
  const [teacherId, setTeacherId] = useState<string>('');
  const [customMessage, setCustomMessage] = useState<string>('');

  // Load all active teachers for the picker.
  const { data: teachers = [], isLoading: loadingTeachers } = useQuery<Array<{
    user_id: string; full_name: string; phone: string | null; email: string | null;
  }>>({
    queryKey: ['teachers-for-reminder'],
    queryFn: async () => {
      const r = await fetch('/api/teachers');
      if (!r.ok) return [];
      const d = await r.json();
      return (d.data || []).filter((t: any) => t.is_active !== false);
    },
    staleTime: 5 * 60_000,
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!teacherId) throw new Error('اختر المعلم أولاً');
      const r = await fetch('/api/period-attendance/remind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacher_user_id: teacherId,
          section_id: section.id,
          period_id: period.id,
          attendance_date: date,
          custom_message: customMessage.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإرسال');
      return d.data as {
        internal_sent: boolean;
        whatsapp_sent: boolean;
        whatsapp_error: string | null;
        teacher_name: string;
      };
    },
    onSuccess: (d) => {
      if (d.internal_sent && d.whatsapp_sent) {
        toast.success(`✓ تم إرسال التذكير لـ${d.teacher_name} (داخلياً + واتساب)`);
      } else if (d.internal_sent) {
        toast(`أُرسل داخلياً • فشل واتساب: ${d.whatsapp_error}`, { icon: '⚠️', duration: 5000 });
      } else if (d.whatsapp_sent) {
        toast(`أُرسل واتساب • فشل الإرسال الداخلي`, { icon: '⚠️', duration: 5000 });
      } else {
        toast.error(`لم يصل التذكير. ${d.whatsapp_error || ''}`);
      }
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800 bg-amber-50 dark:bg-amber-500/10">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-amber-500 rounded-full flex items-center justify-center">
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-lg">تذكير بتسجيل الحضور</h2>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {section.grade_name} / {section.section_name} • حصة {period.number}
                {period.name && ` (${period.name})`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-500/20">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="label flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              المعلم المُراد تذكيره *
            </label>
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="input"
              disabled={loadingTeachers || sendMut.isPending}
            >
              <option value="">— اختر معلماً —</option>
              {teachers.map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.full_name} {t.phone ? `(${t.phone})` : '(بدون جوال)'}
                </option>
              ))}
            </select>
            {teachers.length === 0 && !loadingTeachers && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                لا يوجد معلمون مسجَّلون بعد.
              </p>
            )}
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" />
              رسالة مخصّصة (اختيارياً)
            </label>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="input"
              rows={4}
              placeholder="اتركها فارغة لاستخدام الرسالة الافتراضية المهذّبة..."
              maxLength={2000}
              disabled={sendMut.isPending}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              لو تركتها فارغة، سترسل رسالة افتراضية تذكيرية تتضمّن الشعبة والحصة والتاريخ.
            </p>
          </div>

          {/* Info banner */}
          <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-0.5">سيُرسَل التذكير عبر قناتين:</p>
              <ul className="list-disc ps-5 space-y-0.5">
                <li>📨 <strong>رسالة داخلية</strong> تظهر في صندوق وارد المعلم</li>
                <li>📱 <strong>واتساب</strong> على رقم المعلم المسجَّل</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            إلغاء
          </button>
          <button
            onClick={() => sendMut.mutate()}
            disabled={!teacherId || sendMut.isPending}
            className="btn-primary inline-flex items-center gap-1 text-sm"
          >
            {sendMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الإرسال...</>
              : <><Send className="w-4 h-4" /> إرسال التذكير</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
