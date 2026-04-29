'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ClipboardCheck, Loader2, Calendar, RefreshCw, Filter, Printer, Send,
  X, CheckCircle2, XCircle, Clock as ClockIcon, BadgeCheck, User, ChevronLeft, AlertCircle,
  Trash2,
} from 'lucide-react';

interface SessionRow {
  id: number;
  attendance_date: string;
  recorded_at: string;
  recorded_by: string | null;
  teacher_name: string | null;
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

interface SessionDetail {
  session: SessionRow & { notes: string | null };
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
  const qc = useQueryClient();

  const { data: sessions = [], isLoading, refetch, isFetching, dataUpdatedAt } = useQuery<SessionRow[]>({
    queryKey: ['period-attendance-day', date],
    queryFn: async () => (await (await fetch(`/api/period-attendance/history?date=${date}&limit=200`)).json()).data,
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
      qc.invalidateQueries({ queryKey: ['period-attendance-day'] });
      qc.invalidateQueries({ queryKey: ['period-history'] });
    },
    onError: (e: any) => toast.error(e.message),
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
          {sessions.length > 0 && (
            <button
              onClick={() => {
                const msg = `سيتم حذف ${sessions.length} جلسة بتاريخ ${date} نهائياً.\n\nهذا الإجراء لا يمكن التراجع عنه.\n\nهل أنت متأكد؟`;
                if (confirm(msg)) bulkDeleteMut.mutate();
              }}
              disabled={bulkDeleteMut.isPending}
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/25 disabled:opacity-50"
              title="حذف كل جلسات هذا التاريخ (للإدارة فقط)"
            >
              {bulkDeleteMut.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الحذف...</>
                : <><Trash2 className="w-4 h-4" /> حذف جلسات اليوم ({sessions.length})</>
              }
            </button>
          )}
        </div>
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

      {/* Heatmap matrix */}
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
          <>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr className="text-right">
                    <th className="px-3 py-2 font-medium sticky right-0 bg-gray-50 dark:bg-gray-900">الصف / الشعبة</th>
                    {periodNumbers.map((n) => (
                      <th key={n} className="px-2 py-2 font-medium text-center">حصة {n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {Array.from(sectionsMap.values()).map((row) => (
                    <tr key={`${row.grade}-${row.section}`} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-2 font-medium whitespace-nowrap sticky right-0 bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800">
                        {row.grade} / {row.section}
                      </td>
                      {periodNumbers.map((n) => {
                        const s = row.periods.get(n);
                        if (!s) {
                          return (
                            <td key={n} className="px-1 py-1 text-center" title="لم تُسجّل بعد">
                              <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-600 py-2 text-xs">
                                —
                              </div>
                            </td>
                          );
                        }
                        const tone = cellTone(s.absent_count, s.late_count, s.excused_count, s.total_count);
                        const present = s.total_count - s.absent_count - s.late_count - s.excused_count;
                        return (
                          <td key={n} className="px-1 py-1 text-center">
                            <button
                              onClick={() => setOpenSessionId(s.id)}
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
              <span className="inline-flex items-center gap-1">
                <span className="w-3 h-3 rounded border-2 border-dashed border-gray-300 dark:border-gray-700 inline-block" />
                لم تُسجّل
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
        )}
      </div>
    </div>
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
