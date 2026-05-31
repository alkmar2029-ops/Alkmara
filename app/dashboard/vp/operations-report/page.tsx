// VP daily operations report (م2.17).
//
// Single endpoint: GET /api/vp/operations-report/[date]. Read-only.
// Date is selectable (past, today, future — the backend supports all
// three). The morning dashboard (م2.12) is the "right now" view; this
// page is the "review or plan a specific day" view.
//
// Sections (each card maps to one slice of the OperationsReport payload):
//   1. Overview pills              — at-a-glance counters
//   2. Teacher absences            — full named list (vs. morning's top-10)
//   3. Substitution coverage       — bar + breakdown
//   4. Leave activity              — decisions on date + overlapping leaves
//   5. Supervision                 — counts + named empty posts
//   6. Dismissals                  — total + grouped by reason
//   7. Sprint 3/4 placeholders     — dimmed
//
// Print: a small Print button calls window.print(). Print CSS hides
// the sidebar, header chrome, and interactive controls so the cards
// render clean on paper. PDF export is deferred to المرحلة 6.
//
// Gate: super_admin OR view_morning_dashboard (matches the API).
// No write actions on this screen.

'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, AlertTriangle, BookOpen, Calendar, CheckCircle, Clock,
  Eye, FileBarChart, FolderOpen, LogOut, Printer, RefreshCw,
  Shield, UserCheck, Users as UsersIcon,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';

// ============== Types (mirror API response) ==============

interface AbsentTeacherEntry {
  user_id: string;
  full_name: string | null;
  reason: string | null;
  expected_return: string | null;
}

interface EmptyPost {
  location_id: number;
  name: string;
}

interface OperationsReport {
  date: string;
  day_of_week: number;
  teachers: {
    absent_count: number;
    absent_list: AbsentTeacherEntry[];
  };
  substitutions: {
    total_class_periods_needing_sub: number;
    assigned_count: number;
    pending_count: number;
    coverage_pct: number;
    unique_substitutes_count: number;
  };
  leaves: {
    decisions_on_date: { approved: number; rejected: number };
    active_overlapping: number;
    pending_overlapping: number;
  };
  supervision: {
    day_of_week: number;
    active_locations_count: number;
    assigned_count: number;
    empty_count: number;
    empty_list: EmptyPost[];
  };
  dismissals: {
    total: number;
    by_reason: Record<string, number>;
  };
  incidents_actioned: number;
  cases_opened: number;
}

const ARABIC_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// ============== Date helpers (mirror lib/dates/ksa.ts) ==============

function todayInRiyadh(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dayOfWeekKsa(date: string): number {
  return new Date(`${date}T12:00:00+03:00`).getUTCDay();
}

function addDaysKsa(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function startOfSaudiWeek(date: string): string {
  // Saudi school week starts Sunday (getUTCDay() = 0).
  return addDaysKsa(date, -dayOfWeekKsa(date));
}

// ============== Page ==============

export default function VpOperationsReportPage() {
  const { isSuperAdmin, isLoading: personaLoading, can } = usePersona();
  const canView = isSuperAdmin || can('view_morning_dashboard');

  const [date, setDate] = useState(() => todayInRiyadh());

  const reportQuery = useQuery<OperationsReport>({
    queryKey: ['vp-operations-report', date],
    queryFn: async () => {
      const r = await fetch(`/api/vp/operations-report/${date}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل التقرير');
      }
      return (await r.json()).data as OperationsReport;
    },
    enabled: !personaLoading && canView,
    staleTime: 60_000,
  });

  // ============== Render branches ==============

  if (personaLoading) return <SkeletonPage />;

  if (!canView) {
    return (
      <div className="card text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
        <p className="text-sm font-medium">لا تملك صلاحية عرض تقرير العمليات</p>
        <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
          يلزم super_admin أو صلاحية view_morning_dashboard.
        </p>
      </div>
    );
  }

  const today = todayInRiyadh();

  return (
    <div className="space-y-4">
      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-500/10 dark:to-indigo-500/10 border-purple-200 dark:border-purple-500/30 no-print">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <FileBarChart className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">تقرير العمليات اليومي</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                مراجعة يوم محدد — الغياب، التغطية، الإجازات، الإشراف، الاستئذان
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => reportQuery.refetch()}
              disabled={reportQuery.isFetching}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-500/30 hover:bg-purple-50 dark:hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reportQuery.isFetching ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!reportQuery.data || reportQuery.isLoading}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-500/30 hover:bg-purple-50 dark:hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="طباعة التقرير بصيغة ودّية للورق"
            >
              <Printer className="w-3.5 h-3.5" />
              طباعة
            </button>
          </div>
        </div>
      </div>

      {/* ============== Date control ============== */}
      <div className="card no-print">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <Calendar className="w-3.5 h-3.5" />
            تاريخ التقرير:
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <div className="flex items-center gap-1">
            <QuickDate label="اليوم" current={date} target={today} onClick={setDate} />
            <QuickDate label="أمس" current={date} target={addDaysKsa(today, -1)} onClick={setDate} />
            <QuickDate
              label="بداية الأسبوع"
              current={date}
              target={startOfSaudiWeek(today)}
              onClick={setDate}
            />
          </div>
        </div>
      </div>

      {/* ============== Body ============== */}
      {reportQuery.isLoading ? (
        <SkeletonPage />
      ) : reportQuery.isError ? (
        <div className="card border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                تعذّر تحميل التقرير
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                {reportQuery.error instanceof Error ? reportQuery.error.message : 'حاول التحديث.'}
              </p>
              <button
                type="button"
                onClick={() => reportQuery.refetch()}
                className="mt-3 text-xs px-3 py-1.5 rounded-md bg-red-100 hover:bg-red-200 dark:bg-red-500/20 dark:hover:bg-red-500/30 text-red-800 dark:text-red-300 transition-colors"
              >
                إعادة المحاولة
              </button>
            </div>
          </div>
        </div>
      ) : (
        <ReportBody data={reportQuery.data!} />
      )}

      {/* Print-friendly CSS — scoped to this page, hides chrome on @media print. */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          aside, nav, header {
            display: none !important;
          }
          body, main, .card {
            background: white !important;
            color: black !important;
          }
        }
      `}</style>
    </div>
  );
}

// ============== Quick-date pill ==============

function QuickDate({
  label, current, target, onClick,
}: {
  label: string;
  current: string;
  target: string;
  onClick: (date: string) => void;
}) {
  const active = current === target;
  return (
    <button
      type="button"
      onClick={() => onClick(target)}
      className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
        active
          ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  );
}

// ============== Report body ==============

function ReportBody({ data }: { data: OperationsReport }) {
  const weekday = ARABIC_WEEKDAYS[data.day_of_week] ?? '';

  return (
    <div className="space-y-4">
      {/* ============== Print-only header (visible on paper) ============== */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">تقرير العمليات اليومي</h1>
        <p className="text-sm">
          {weekday} • {data.date}
        </p>
      </div>

      {/* ============== Date subtitle ============== */}
      <div className="text-sm text-gray-600 dark:text-gray-300 no-print">
        {weekday} • {data.date}
      </div>

      {/* ============== Overview pills ============== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Pill
          label="معلمون غائبون"
          value={data.teachers.absent_count}
          tone={data.teachers.absent_count > 0 ? 'red' : 'green'}
          icon={AlertCircle}
        />
        <Pill
          label="تغطية الانتظار"
          value={`${data.substitutions.coverage_pct}%`}
          tone={
            data.substitutions.coverage_pct === 100
              ? 'green'
              : data.substitutions.coverage_pct >= 50
              ? 'amber'
              : 'red'
          }
          icon={UserCheck}
        />
        <Pill
          label="إجازات قيد البتّ"
          value={data.leaves.pending_overlapping}
          tone={data.leaves.pending_overlapping > 0 ? 'purple' : 'green'}
          icon={Clock}
        />
        <Pill
          label="نقاط إشراف شاغرة"
          value={data.supervision.empty_count}
          tone={data.supervision.empty_count > 0 ? 'orange' : 'green'}
          icon={Shield}
        />
        <Pill
          label="استئذان طلاب"
          value={data.dismissals.total}
          tone="indigo"
          icon={LogOut}
        />
      </div>

      {/* ============== Two-column: absences + substitution ============== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <AbsencesCard list={data.teachers.absent_list} count={data.teachers.absent_count} />
        <SubstitutionsCard subs={data.substitutions} />
      </div>

      {/* ============== Two-column: leaves + supervision ============== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <LeavesCard leaves={data.leaves} />
        <SupervisionCard sup={data.supervision} />
      </div>

      {/* ============== Dismissals ============== */}
      <DismissalsCard dismissals={data.dismissals} />

      {/* ============== Sprint 3/4 placeholders ============== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PlaceholderCard
          icon={AlertTriangle}
          label="مخالفات تمت معالجتها"
          value={data.incidents_actioned}
          note="يُفعَّل مع المرحلة 3"
        />
        <PlaceholderCard
          icon={FolderOpen}
          label="حالات إرشاد افتُتحت"
          value={data.cases_opened}
          note="يُفعَّل مع المرحلة 4"
        />
      </div>
    </div>
  );
}

// ============== Sub-cards ==============

function AbsencesCard({
  list, count,
}: {
  list: AbsentTeacherEntry[];
  count: number;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-5 h-5 text-red-500" />
        <h2 className="font-bold text-base">المعلمون الغائبون</h2>
        <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 font-mono">
          {count}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
          لا يوجد غياب مُسجَّل في هذا اليوم.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((t) => (
            <li
              key={t.user_id}
              className="px-3 py-2 rounded-lg bg-red-50/40 dark:bg-red-500/5 border border-red-100 dark:border-red-500/20"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-medium">{t.full_name ?? '—'}</span>
                {t.reason && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">
                    {t.reason}
                  </span>
                )}
              </div>
              {t.expected_return && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  العودة المتوقعة: {t.expected_return}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubstitutionsCard({
  subs,
}: {
  subs: OperationsReport['substitutions'];
}) {
  const pct = subs.coverage_pct;
  const barTone =
    pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const labelTone =
    pct === 100
      ? 'text-green-700 dark:text-green-400'
      : pct >= 50
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-red-700 dark:text-red-400';

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-indigo-500" />
          <h2 className="font-bold text-base">حصص الانتظار</h2>
        </div>
        <span className={`text-sm font-mono font-bold ${labelTone}`}>{pct}%</span>
      </div>
      <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full transition-all ${barTone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center">
        <Stat label="بحاجة بديل" value={subs.total_class_periods_needing_sub} />
        <Stat label="مُسنَدة" value={subs.assigned_count} tone="green" />
        <Stat label="متبقّية" value={subs.pending_count} tone={subs.pending_count > 0 ? 'amber' : 'gray'} />
        <Stat label="بدلاء مختلفون" value={subs.unique_substitutes_count} />
      </div>
    </div>
  );
}

function LeavesCard({
  leaves,
}: {
  leaves: OperationsReport['leaves'];
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="w-5 h-5 text-purple-500" />
        <h2 className="font-bold text-base">نشاط الإجازات</h2>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="مُعتمَدة في هذا اليوم"
            value={leaves.decisions_on_date.approved}
            tone="green"
          />
          <Stat
            label="مرفوضة في هذا اليوم"
            value={leaves.decisions_on_date.rejected}
            tone={leaves.decisions_on_date.rejected > 0 ? 'red' : 'gray'}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="إجازات نشطة في اليوم"
            value={leaves.active_overlapping}
            tone={leaves.active_overlapping > 0 ? 'amber' : 'gray'}
          />
          <Stat
            label="قيد البتّ تشمل اليوم"
            value={leaves.pending_overlapping}
            tone={leaves.pending_overlapping > 0 ? 'purple' : 'gray'}
          />
        </div>
      </div>
    </div>
  );
}

function SupervisionCard({
  sup,
}: {
  sup: OperationsReport['supervision'];
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-orange-500" />
          <h2 className="font-bold text-base">الإشراف</h2>
        </div>
        <span className="text-xs font-mono text-gray-600 dark:text-gray-400">
          {sup.assigned_count}/{sup.active_locations_count}
        </span>
      </div>
      {sup.empty_count === 0 ? (
        <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          كل نقاط الإشراف مُغطّاة.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
            <strong className="text-orange-700 dark:text-orange-400">{sup.empty_count}</strong>{' '}
            نقطة شاغرة من أصل {sup.active_locations_count}:
          </p>
          <ul className="space-y-1">
            {sup.empty_list.map((p) => (
              <li
                key={p.location_id}
                className="text-sm px-3 py-1.5 rounded-md bg-orange-50/60 dark:bg-orange-500/10 border border-orange-100 dark:border-orange-500/20"
              >
                {p.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DismissalsCard({
  dismissals,
}: {
  dismissals: OperationsReport['dismissals'];
}) {
  const entries = Object.entries(dismissals.by_reason);
  const max = entries.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <LogOut className="w-5 h-5 text-indigo-500" />
          <h2 className="font-bold text-base">الاستئذان</h2>
        </div>
        <span className="text-xs font-mono text-gray-600 dark:text-gray-400">
          {dismissals.total} حالة
        </span>
      </div>
      {dismissals.total === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
          لا حالات استئذان في هذا اليوم.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {entries
            .sort(([, a], [, b]) => b - a)
            .map(([reason, count]) => {
              const w = max > 0 ? Math.max(4, (count / max) * 100) : 0;
              return (
                <li key={reason} className="flex items-center gap-2">
                  <span className="w-32 text-xs truncate" title={reason}>
                    {reason}
                  </span>
                  <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 dark:bg-indigo-500 flex items-center justify-end px-2"
                      style={{ width: `${w}%` }}
                    >
                      <span className="text-[10px] text-white font-bold">{count}</span>
                    </div>
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

// ============== Generic helpers ==============

function Pill({
  label, value, tone, icon: Icon,
}: {
  label: string;
  value: number | string;
  tone: 'green' | 'red' | 'amber' | 'purple' | 'orange' | 'blue' | 'indigo';
  icon: any;
}) {
  const cls = {
    green:  'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400 border-green-200 dark:border-green-500/30',
    red:    'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border-red-200 dark:border-red-500/30',
    amber:  'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border-purple-200 dark:border-purple-500/30',
    orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border-orange-200 dark:border-orange-500/30',
    blue:   'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30',
  }[tone];
  return (
    <div className={`card border ${cls}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs opacity-90">{label}</p>
        <Icon className="w-4 h-4 opacity-60" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function Stat({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone?: 'green' | 'red' | 'amber' | 'purple' | 'gray';
}) {
  const valueCls = {
    green: 'text-green-700 dark:text-green-400',
    red: 'text-red-700 dark:text-red-400',
    amber: 'text-amber-700 dark:text-amber-400',
    purple: 'text-purple-700 dark:text-purple-400',
    gray: 'text-gray-700 dark:text-gray-400',
  }[tone ?? 'gray'];
  return (
    <div className="px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
      <p className="text-[11px] text-gray-600 dark:text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${valueCls}`}>{value}</p>
    </div>
  );
}

function PlaceholderCard({
  icon: Icon, label, value, note,
}: {
  icon: any;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="card opacity-60">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-500" />
        <p className="text-xs text-gray-600 dark:text-gray-400">{label}</p>
      </div>
      <p className="text-xl font-bold text-gray-500 dark:text-gray-400">{value}</p>
      <p className="text-[10px] mt-1 text-gray-500 dark:text-gray-400 italic">{note}</p>
    </div>
  );
}
