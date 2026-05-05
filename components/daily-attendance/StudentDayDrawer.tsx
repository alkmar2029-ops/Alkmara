'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  X, Loader2, AlertCircle, User, BookOpen, Phone, Hash,
  CheckCircle2, XCircle, Clock, BadgeCheck, MinusCircle,
  MessageSquarePlus, LogOut as ExitIcon, MessageCircle, BarChart3,
} from 'lucide-react';

interface PeriodEntry {
  period_number: number;
  period_name: string | null;
  status: 'absent' | 'late' | 'excused' | 'present' | 'not_recorded';
  teacher_name: string | null;
  recorded_at: string | null;
}

interface DayAttendanceData {
  date: string;
  range: { from: number; to: number };
  student: {
    id: number;
    student_code: string;
    name: string;
    phone: string | null;
    grade_name: string | null;
    section_name: string | null;
    health_info: { conditions?: string[]; notes?: string } | null;
  };
  periods: PeriodEntry[];
}

const HEALTH_LABELS: Record<string, { label: string; emoji: string }> = {
  diabetes:     { label: 'السكري',       emoji: '🩸' },
  hypertension: { label: 'الضغط',         emoji: '💓' },
  heart:        { label: 'مشاكل القلب',   emoji: '❤️' },
  asthma:       { label: 'الربو',         emoji: '🫁' },
  allergy:      { label: 'حساسية',        emoji: '🌾' },
  epilepsy:     { label: 'الصرع',         emoji: '⚡' },
  vision:       { label: 'مشاكل البصر',   emoji: '👁️' },
  hearing:      { label: 'مشاكل السمع',   emoji: '👂' },
  other:        { label: 'أخرى',          emoji: '📋' },
};

const STATUS_META: Record<PeriodEntry['status'], { label: string; cls: string; Icon: any }> = {
  absent:       { label: 'غائب',         cls: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300 border-red-200 dark:border-red-500/40',         Icon: XCircle },
  late:         { label: 'متأخر',        cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border-amber-200 dark:border-amber-500/40', Icon: Clock },
  excused:      { label: 'مستأذن',       cls: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300 border-purple-200 dark:border-purple-500/40', Icon: BadgeCheck },
  present:      { label: 'حاضر',         cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/40', Icon: CheckCircle2 },
  not_recorded: { label: 'لم يُسجَّل',    cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400 border-gray-200 dark:border-gray-700',       Icon: MinusCircle },
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ar', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Riyadh',
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

interface Props {
  studentId: number | null;
  date: string;
  fromPeriod: number;
  toPeriod: number;
  onClose: () => void;
}

export default function StudentDayDrawer({
  studentId, date, fromPeriod, toPeriod, onClose,
}: Props) {
  const open = studentId !== null;

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const { data, isLoading, isError } = useQuery<DayAttendanceData>({
    queryKey: ['student-day-attendance', studentId, date, fromPeriod, toPeriod],
    enabled: open && studentId !== null,
    queryFn: async () => {
      const r = await fetch(
        `/api/students/${studentId}/day-attendance?date=${date}&from_period=${fromPeriod}&to_period=${toPeriod}`,
      );
      if (!r.ok) throw new Error('failed');
      return (await r.json()).data;
    },
  });

  if (!open) return null;

  const phoneDigits = data?.student.phone?.replace(/[^\d]/g, '') || '';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer — slides from the right (in RTL the visual right edge of
          the page; we anchor with right-0 + a translate animation). */}
      <div
        className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-white dark:bg-gray-900 shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Sticky header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between z-10">
          <h2 className="font-bold text-base">تفاصيل حضور الطالب</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {isLoading && (
            <div className="text-center py-12">
              <Loader2 className="w-6 h-6 animate-spin inline text-gray-400" />
            </div>
          )}

          {isError && (
            <div className="text-center py-12">
              <AlertCircle className="w-10 h-10 mx-auto text-red-400 mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-300">تعذّر تحميل بيانات الحضور</p>
            </div>
          )}

          {data && (
            <>
              {/* Identity card */}
              <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 border border-blue-200 dark:border-blue-500/30 p-3">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                    <User className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/dashboard/students/${data.student.id}`}
                      className="font-bold text-base hover:underline block"
                    >
                      {data.student.name}
                    </Link>
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-gray-600 dark:text-gray-300 mt-1">
                      {(data.student.grade_name || data.student.section_name) && (
                        <span className="inline-flex items-center gap-1">
                          <BookOpen className="w-3 h-3" />
                          {data.student.grade_name}
                          {data.student.grade_name && data.student.section_name ? ' / ' : ''}
                          {data.student.section_name}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 font-mono" dir="ltr">
                        <Hash className="w-3 h-3" />
                        {data.student.student_code}
                      </span>
                      {data.student.phone && (
                        <span className="inline-flex items-center gap-1 font-mono" dir="ltr">
                          <Phone className="w-3 h-3" />
                          {data.student.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Health alert (if any) */}
              {data.student.health_info?.conditions && data.student.health_info.conditions.length > 0 && (
                <div className="rounded-xl border-2 border-red-300 dark:border-red-500/50 bg-red-50 dark:bg-red-500/10 p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xl">🏥</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm text-red-900 dark:text-red-200 mb-1.5">
                        ⚠️ حالات صحية مسجَّلة
                      </h3>
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {data.student.health_info.conditions.map((c) => {
                          const info = HEALTH_LABELS[c] || { label: c, emoji: '📋' };
                          return (
                            <span
                              key={c}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 text-[11px] font-medium border border-red-200 dark:border-red-500/30"
                            >
                              {info.emoji} {info.label}
                            </span>
                          );
                        })}
                      </div>
                      {data.student.health_info.notes && (
                        <p className="text-[11px] text-red-800 dark:text-red-300 bg-white/50 dark:bg-black/20 p-1.5 rounded">
                          📝 {data.student.health_info.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Periods table */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="font-bold text-sm">📋 الحصص في النطاق</h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {data.date} • الحصص {data.range.from}–{data.range.to}
                  </span>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800/50">
                      <tr>
                        <th className="text-right px-2 py-2 font-semibold text-gray-600 dark:text-gray-300 w-14">الحصة</th>
                        <th className="text-right px-2 py-2 font-semibold text-gray-600 dark:text-gray-300">الحالة</th>
                        <th className="text-right px-2 py-2 font-semibold text-gray-600 dark:text-gray-300">المعلم</th>
                        <th className="text-right px-2 py-2 font-semibold text-gray-600 dark:text-gray-300 w-16">الوقت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.periods.map((p) => {
                        const meta = STATUS_META[p.status];
                        const Icon = meta.Icon;
                        return (
                          <tr key={p.period_number} className="bg-white dark:bg-gray-900">
                            <td className="px-2 py-2 font-bold text-center">{p.period_number}</td>
                            <td className="px-2 py-2">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium ${meta.cls}`}>
                                <Icon className="w-3 h-3" />
                                {meta.label}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-gray-700 dark:text-gray-300 truncate max-w-[140px]">
                              {p.teacher_name || <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-2 py-2 font-mono text-[10px] text-gray-500 dark:text-gray-400" dir="ltr">
                              {formatTime(p.recorded_at) || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                  💡 الحصص الموسومة بـ"لم يُسجَّل" يعني المعلم لم يُسجِّل الحضور بعد لتلك الحصة.
                </p>
              </div>

              {/* Action buttons grid */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {phoneDigits && (
                  <a
                    href={`https://wa.me/${phoneDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 text-sm font-medium transition-colors"
                  >
                    <MessageCircle className="w-4 h-4" />
                    واتساب الأهل
                  </a>
                )}
                <Link
                  href={`/dashboard/notes?student_id=${data.student.id}`}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/25 text-sm font-medium transition-colors"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  ملاحظة جديدة
                </Link>
                <Link
                  href={`/dashboard/dismissals?student_id=${data.student.id}`}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-500/25 text-sm font-medium transition-colors"
                >
                  <ExitIcon className="w-4 h-4" />
                  استئذان
                </Link>
                <Link
                  href={`/dashboard/reports/builder?student_id=${data.student.id}`}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 text-sm font-medium transition-colors"
                >
                  <BarChart3 className="w-4 h-4" />
                  تقرير الطالب
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
