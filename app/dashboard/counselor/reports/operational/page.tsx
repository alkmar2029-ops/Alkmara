// Counselor operational report UI (م6.2).
//
// Consumer of /api/counselor/reports/operational (м6.1). Read-only,
// no charts, just cards + simple bars + lists. Date range default is
// last-30-days rolling — matches the API default exactly so the first
// render needs no overrides.
//
// =====================================================================
// SCOPE / GATING
// =====================================================================
// Client gate via usePersona: super_admin OR persona='counselor'.
// view_confidential_notes flag holders are blocked at this layer AND
// at the API (the privacy decision is enforced top-to-bottom — see
// م5.2 / م6.1 headers).
//
// =====================================================================
// NAME FALLBACK — TOP_5 RISK LIST
// =====================================================================
// The API's user-bound `students` lookup can return null when RLS on
// students doesn't cover the counselor's full risk-score scope. Per
// م6.2 plan: do NOT render a scary "غير معروف". Instead render
// `طالب #123` so the counselor can correlate by ID and ask coordination
// to surface the student manually if needed. Super_admin always sees
// real names — the fallback is a counselor-only edge case.
//
// =====================================================================
// NOTES LABEL — "ملاحظاتك المسجلة"
// =====================================================================
// The API filters notes by `recorded_by = caller_user_id`. This is
// "my work" — the counselor's own contemporaneous log entries — NOT
// "every note visible in their scope". The UI must label this clearly
// so the counselor doesn't compare their tally against a colleague's
// memory of how many notes were written on the same student. The
// school-wide aggregate of notes is for the principal report (м6.3+),
// not this one.
//
// =====================================================================
// NO HEAVY CHARTS IN V1
// =====================================================================
// All "trends" are reduced to simple horizontal bars or numeric stats.
// Recharts / shadcn / nivo add bundle weight and animation cost for a
// counselor surface that's used a few times a month. If the principal
// or a follow-up sprint asks for time-series, that's м6.4+ scope.

'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, BarChart3, Calendar, ClipboardList, FileBarChart, FolderOpen,
  MessageSquare, Printer, RefreshCw, Shield, Sparkles, TrendingUp, Users as UsersIcon,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';

// =====================================================================
// Types — mirror /api/counselor/reports/operational
// =====================================================================

interface ReportRange  { from: string; to: string; }
interface ReportScope  { mode: 'counselor' | 'super_admin'; students_in_scope: number; }

interface ReportCases {
  opened_in_range:    number;
  resolved_in_range:  number;
  closed_in_range:    number;
  reopened_in_range:  number;
  currently_active:   number;
  by_type:            Record<string, number>;
  by_severity:        Record<string, number>;
}

interface ReportPlans {
  created_in_range:   number;
  completed_in_range: number;
  cancelled_in_range: number;
  currently_active:   number;
  currently_on_hold:  number;
  currently_overdue:  number;
}

interface ReportSessions {
  held_in_range:           number;
  total_duration_minutes:  number;
  by_type:                 Record<string, number>;
}

interface ReportNotes {
  recorded_in_range: number;
  confidential:      number;
  non_confidential:  number;
  by_type: { positive: number; negative: number };
}

interface RiskTopItem {
  student_id:   number;
  student_name: string | null;
  score:        number;
  is_stale:     boolean;
}

interface ReportRisk {
  students_scored: number;
  stale_count:     number;
  average_score:   number | null;
  above_50:        number;
  above_70:        number;
  top_5:           RiskTopItem[];
}

interface OperationalReport {
  range:          ReportRange;
  scope:          ReportScope;
  cases:          ReportCases;
  plans:          ReportPlans;
  sessions:       ReportSessions;
  notes:          ReportNotes;
  risk_landscape: ReportRisk;
}

// =====================================================================
// Date helpers — duplicated from lib/dates/ksa.ts because the helpers
// there import zod (server-only constraint). Same logic, no zod dep.
// =====================================================================

function todayInRiyadh(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDaysKsa(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// =====================================================================
// Arabic labels for enum-ish columns
// =====================================================================

const CASE_TYPE_LABEL: Record<string, string> = {
  academic:    'أكاديمي',
  behavioral:  'سلوكي',
  social:      'اجتماعي',
  family:      'أسري',
  psychological: 'نفسي',
  other:       'أخرى',
};

const SEVERITY_LABEL: Record<string, string> = {
  low:      'منخفضة',
  medium:   'متوسطة',
  high:     'مرتفعة',
  critical: 'حرجة',
};

const SESSION_TYPE_LABEL: Record<string, string> = {
  individual: 'فردية',
  group:      'جماعية',
  family:     'أسرية',
  parent:     'مع ولي الأمر',
  followup:   'متابعة',
};

const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'indigo' | 'gray'> = {
  critical: 'red',
  high:     'red',
  medium:   'amber',
  low:      'indigo',
};

// =====================================================================
// Page
// =====================================================================

export default function CounselorOperationalReportPage() {
  const { isSuperAdmin, isCounselor, isLoading: personaLoading } = usePersona();
  const canView = isSuperAdmin || isCounselor;

  const today = useMemo(() => todayInRiyadh(), []);
  const [from, setFrom] = useState(() => addDaysKsa(todayInRiyadh(), -30));
  const [to,   setTo]   = useState(() => todayInRiyadh());

  // Client-side guard for from > to. Keeps the bad request from flying
  // and gives a quiet inline note instead of a 400 toast.
  const invalidRange = from > to;

  const reportQuery = useQuery<OperationalReport>({
    queryKey: ['counselor-operational-report', from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      const r = await fetch(`/api/counselor/reports/operational?${params}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل التقرير');
      }
      return (await r.json()).data as OperationalReport;
    },
    enabled: !personaLoading && canView && !invalidRange,
    staleTime: 60_000,
  });

  if (personaLoading) return <SkeletonPage />;

  if (!canView) {
    return (
      <div className="card text-center py-12 border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/5">
        <Shield className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
        <p className="text-sm text-red-700 dark:text-red-400 font-medium">
          تقرير العمليات متاح للمرشدين الطلابيين فقط.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Next.js hoists this <title> from a client component into <head>.
          Per-page title improves browser tab + screen reader announcements. */}
      <title>تقرير العمليات — لوحة المرشد</title>

      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-500/10 dark:to-purple-500/10 border-indigo-200 dark:border-indigo-500/30 no-print">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <FileBarChart className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">تقرير العمليات</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                مراجعة فترة محدّدة — الحالات، الخطط، الجلسات، الملاحظات، صورة المخاطر.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => reportQuery.refetch()}
              disabled={reportQuery.isFetching || invalidRange}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reportQuery.isFetching ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!reportQuery.data || reportQuery.isLoading}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="طباعة التقرير بصيغة ودّية للورق"
            >
              <Printer className="w-3.5 h-3.5" />
              طباعة
            </button>
          </div>
        </div>
      </div>

      {/* ============== Date range card ============== */}
      <div className="card no-print">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <Calendar className="w-3.5 h-3.5" />
            الفترة:
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-600 dark:text-gray-400">من</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-600 dark:text-gray-400">إلى</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
          </label>
          <div className="flex items-center gap-1 flex-wrap">
            <QuickRange label="آخر ٧ أيام"  fromVal={addDaysKsa(today, -7)}   toVal={today} setFrom={setFrom} setTo={setTo} current={{ from, to }} />
            <QuickRange label="آخر ٣٠ يوم" fromVal={addDaysKsa(today, -30)}  toVal={today} setFrom={setFrom} setTo={setTo} current={{ from, to }} />
            <QuickRange label="آخر ٩٠ يوم" fromVal={addDaysKsa(today, -90)}  toVal={today} setFrom={setFrom} setTo={setTo} current={{ from, to }} />
          </div>
          {invalidRange && (
            <span className="text-[11px] px-2 py-1 rounded bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400">
              «من» يجب أن يكون قبل أو يساوي «إلى».
            </span>
          )}
        </div>
      </div>

      {/* ============== Body branches ============== */}
      {invalidRange ? (
        <div className="card text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          عدِّل الفترة لتحميل التقرير.
        </div>
      ) : reportQuery.isLoading ? (
        <SkeletonPage />
      ) : reportQuery.isError ? (
        <ErrorCard
          message={reportQuery.error instanceof Error ? reportQuery.error.message : 'حاول التحديث.'}
          onRetry={() => reportQuery.refetch()}
        />
      ) : (
        <ReportBody data={reportQuery.data!} />
      )}

      {/* Print CSS — same pattern as VP operations-report */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          aside, nav, header { display: none !important; }
          body, main, .card { background: white !important; color: black !important; }
        }
      `}</style>
    </div>
  );
}

// =====================================================================
// QuickRange pill — sets both from + to in one click
// =====================================================================

function QuickRange({
  label, fromVal, toVal, setFrom, setTo, current,
}: {
  label:   string;
  fromVal: string;
  toVal:   string;
  setFrom: (_s: string) => void;
  setTo:   (_s: string) => void;
  current: { from: string; to: string };
}) {
  const active = current.from === fromVal && current.to === toVal;
  return (
    <button
      type="button"
      onClick={() => { setFrom(fromVal); setTo(toVal); }}
      className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
        active
          ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  );
}

// =====================================================================
// Error card
// =====================================================================

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            تعذّر تحميل التقرير
          </p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-1">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 text-xs px-3 py-1.5 rounded-md bg-red-100 hover:bg-red-200 dark:bg-red-500/20 dark:hover:bg-red-500/30 text-red-800 dark:text-red-300 transition-colors"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Body — assembles all the cards in two-column rows
// =====================================================================

function ReportBody({ data }: { data: OperationalReport }) {
  return (
    <div className="space-y-4">
      {/* Print-only banner (visible on paper) */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">تقرير العمليات</h1>
        <p className="text-sm">
          {data.range.from} → {data.range.to} • نطاق: {data.scope.mode === 'super_admin' ? 'المدرسة كاملة' : 'المرشد'}
        </p>
      </div>

      {/* Scope chip (screen) */}
      <div className="text-xs text-gray-600 dark:text-gray-300 no-print flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300">
          <UsersIcon className="w-3 h-3" />
          {data.scope.mode === 'super_admin' ? 'كل المدرسة' : 'نطاق المرشد'}
          {' • '}
          {data.scope.students_in_scope} طالب يُحسَب
        </span>
        <span>
          {data.range.from} → {data.range.to}
        </span>
      </div>

      {/* Row 1: Cases + Plans */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CasesCard cases={data.cases} />
        <PlansCard plans={data.plans} />
      </div>

      {/* Row 2: Sessions + Notes (yours) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SessionsCard sessions={data.sessions} />
        <NotesCard notes={data.notes} mode={data.scope.mode} />
      </div>

      {/* Row 3: Risk landscape — full width */}
      <RiskLandscapeCard risk={data.risk_landscape} />
    </div>
  );
}

// =====================================================================
// Cases card
// =====================================================================

function CasesCard({ cases }: { cases: ReportCases }) {
  const noActivity =
    cases.opened_in_range === 0 &&
    cases.resolved_in_range === 0 &&
    cases.closed_in_range === 0 &&
    cases.reopened_in_range === 0 &&
    cases.currently_active === 0;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen className="w-5 h-5 text-rose-500" />
        <h2 className="font-bold text-base">الحالات</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          (الفترة + الحالة الراهنة)
        </span>
      </div>

      {noActivity ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          لا نشاط على الحالات في هذه الفترة، ولا حالات نشطة الآن.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label="افتُتحت في الفترة"  value={cases.opened_in_range}  />
            <Stat label="حُلَّت في الفترة"   value={cases.resolved_in_range} tone={cases.resolved_in_range > 0 ? 'green' : 'gray'} />
            <Stat label="أُغلقت في الفترة"  value={cases.closed_in_range}   tone={cases.closed_in_range > 0   ? 'green' : 'gray'} />
            <Stat label="أُعيد فتحها"        value={cases.reopened_in_range} tone={cases.reopened_in_range > 0 ? 'amber' : 'gray'} />
            <Stat label="نشطة الآن"          value={cases.currently_active}  tone={cases.currently_active > 0  ? 'red'   : 'green'} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <BarBlock
              title="حسب النوع"
              entries={Object.entries(cases.by_type)}
              labelMap={CASE_TYPE_LABEL}
              barClass="bg-rose-400 dark:bg-rose-500"
            />
            <BarBlock
              title="حسب الخطورة"
              entries={Object.entries(cases.by_severity)}
              labelMap={SEVERITY_LABEL}
              tonePerKey={SEVERITY_TONE}
            />
          </div>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Plans card
// =====================================================================

function PlansCard({ plans }: { plans: ReportPlans }) {
  const noActivity =
    plans.created_in_range === 0 &&
    plans.completed_in_range === 0 &&
    plans.cancelled_in_range === 0 &&
    plans.currently_active === 0 &&
    plans.currently_on_hold === 0 &&
    plans.currently_overdue === 0;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-5 h-5 text-amber-500" />
        <h2 className="font-bold text-base">خطط المتابعة</h2>
      </div>

      {noActivity ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          لا خطط متابعة في هذه الفترة.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="أُنشئت في الفترة"  value={plans.created_in_range}   />
            <Stat label="اكتُملت"           value={plans.completed_in_range} tone={plans.completed_in_range > 0 ? 'green' : 'gray'} />
            <Stat label="أُلغيت"            value={plans.cancelled_in_range} tone={plans.cancelled_in_range > 0 ? 'amber' : 'gray'} />
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 mb-2">الحالة الراهنة</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="نشطة"     value={plans.currently_active}   tone={plans.currently_active > 0 ? 'amber' : 'gray'} />
            <Stat label="مُعلَّقة"  value={plans.currently_on_hold}  />
            <Stat label="متأخّرة"  value={plans.currently_overdue}  tone={plans.currently_overdue > 0 ? 'red' : 'gray'} />
          </div>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Sessions card
// =====================================================================

function SessionsCard({ sessions }: { sessions: ReportSessions }) {
  const hours = Math.floor(sessions.total_duration_minutes / 60);
  const mins  = sessions.total_duration_minutes % 60;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-5 h-5 text-teal-500" />
        <h2 className="font-bold text-base">جلسات الإرشاد</h2>
      </div>

      {sessions.held_in_range === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          لم تُعقد جلسات في هذه الفترة.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="عُقدت في الفترة" value={sessions.held_in_range} tone="green" />
            <div className="px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
              <p className="text-[11px] text-gray-600 dark:text-gray-400">إجمالي المدة</p>
              <p className="text-lg font-bold text-teal-700 dark:text-teal-400">
                {hours > 0 ? `${hours} س ` : ''}{mins} د
              </p>
            </div>
          </div>
          {Object.keys(sessions.by_type).length > 0 && (
            <div className="mt-4">
              <BarBlock
                title="حسب النوع"
                entries={Object.entries(sessions.by_type)}
                labelMap={SESSION_TYPE_LABEL}
                barClass="bg-teal-400 dark:bg-teal-500"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =====================================================================
// Notes card — "ملاحظاتك المسجلة" wording per م6.2 plan
// =====================================================================

function NotesCard({ notes, mode }: { notes: ReportNotes; mode: ReportScope['mode'] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="w-5 h-5 text-indigo-500" />
        <h2 className="font-bold text-base">ملاحظاتك المسجلة</h2>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
        {mode === 'super_admin'
          ? 'الملاحظات التي سجَّلتها أنت في هذه الفترة (وليس ملاحظات بقية الفريق).'
          : 'الملاحظات التي سجَّلتها أنت في هذه الفترة على طلاب نطاقك.'}
      </p>

      {notes.recorded_in_range === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          لا ملاحظات مسجَّلة منك في هذه الفترة.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="إجمالي"     value={notes.recorded_in_range} />
            <Stat label="سرية"       value={notes.confidential}      tone={notes.confidential > 0 ? 'purple' : 'gray'} />
            <Stat label="غير سرية"   value={notes.non_confidential}  />
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 mb-2">حسب النوع</p>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="موجبة"  value={notes.by_type.positive}  tone={notes.by_type.positive > 0  ? 'green' : 'gray'} />
            <Stat label="سالبة"  value={notes.by_type.negative}  tone={notes.by_type.negative > 0  ? 'red'   : 'gray'} />
          </div>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Risk landscape — full width, includes top_5 list
// =====================================================================

function RiskLandscapeCard({ risk }: { risk: ReportRisk }) {
  const noRisk = risk.students_scored === 0;
  const allStale = risk.students_scored > 0 && risk.stale_count === risk.students_scored;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-5 h-5 text-purple-500" />
        <h2 className="font-bold text-base">صورة المخاطر</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          (لحظية — مأخوذة من student_risk_scores)
        </span>
      </div>

      {noRisk ? (
        <div className="text-center py-6 text-gray-500 dark:text-gray-400">
          <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">لم تُحسب درجات مخاطر بعد على نطاقك.</p>
        </div>
      ) : (
        <>
          {/* Top stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label="يُحسَب لهم"    value={risk.students_scored} />
            <Stat label="مؤجَّل"         value={risk.stale_count}    tone={risk.stale_count > 0 ? 'amber' : 'gray'} />
            <div className="px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
              <p className="text-[11px] text-gray-600 dark:text-gray-400">المتوسط</p>
              <p className="text-lg font-bold text-purple-700 dark:text-purple-400">
                {risk.average_score === null ? '—' : risk.average_score}
              </p>
              {risk.average_score === null && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                  (أقل من ٢٠ طالبًا — لا يُحسَب متوسط)
                </p>
              )}
            </div>
            <Stat label="≥ ٥٠"  value={risk.above_50}  tone={risk.above_50 > 0 ? 'amber' : 'gray'} />
            <Stat label="≥ ٧٠"  value={risk.above_70}  tone={risk.above_70 > 0 ? 'red'   : 'gray'} />
          </div>

          {allStale && (
            <div className="mt-3 text-[11px] px-2 py-1.5 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300">
              كل الصفوف مؤجَّلة — الـ sweep لم يُجرَ بعد، الأرقام التي بالأعلى ستتغيّر بعد تشغيله.
            </div>
          )}

          {/* Top 5 list */}
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-4 mb-2">
            أعلى ٥ — مرتبة حسب الدرجة
          </p>
          {risk.top_5.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">
              —
            </p>
          ) : (
            <ul className="space-y-1.5">
              {risk.top_5.map((s, idx) => (
                <RiskRow key={s.student_id} rank={idx + 1} item={s} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function RiskRow({ rank, item }: { rank: number; item: RiskTopItem }) {
  const displayName = item.student_name ?? `طالب #${item.student_id}`;
  const tone = scoreTone(item.score);
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 w-4 text-end">
          {rank}
        </span>
        <span className="text-sm font-medium truncate">{displayName}</span>
        {item.is_stale && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
            مؤجَّل
          </span>
        )}
        {item.student_name === null && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300">
            بدون اسم
          </span>
        )}
      </div>
      <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded ${tone.bg} ${tone.text} border ${tone.border}`}>
        {item.score}
      </span>
    </li>
  );
}

function scoreTone(n: number): { bg: string; text: string; border: string } {
  if (n >= 70) return {
    bg: 'bg-red-100 dark:bg-red-500/20',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-300 dark:border-red-500/40',
  };
  if (n >= 40) return {
    bg: 'bg-amber-100 dark:bg-amber-500/20',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-300 dark:border-amber-500/40',
  };
  if (n >= 1) return {
    bg: 'bg-emerald-100 dark:bg-emerald-500/20',
    text: 'text-emerald-700 dark:text-emerald-400',
    border: 'border-emerald-300 dark:border-emerald-500/40',
  };
  return {
    bg: 'bg-gray-100 dark:bg-gray-700/40',
    text: 'text-gray-700 dark:text-gray-300',
    border: 'border-gray-200 dark:border-gray-600',
  };
}

// =====================================================================
// BarBlock — generic "label → simple horizontal bar" list
// =====================================================================

function BarBlock({
  title, entries, labelMap, barClass, tonePerKey,
}: {
  title:      string;
  entries:    Array<[string, number]>;
  labelMap:   Record<string, string>;
  barClass?:  string;
  tonePerKey?: Record<string, 'red' | 'amber' | 'indigo' | 'gray'>;
}) {
  if (entries.length === 0) {
    return (
      <div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">لا بيانات</p>
      </div>
    );
  }
  const sorted = [...entries].sort(([, a], [, b]) => b - a);
  const max = sorted.reduce((m, [, n]) => Math.max(m, n), 0);

  const TONE_BG: Record<'red' | 'amber' | 'indigo' | 'gray', string> = {
    red:    'bg-red-400 dark:bg-red-500',
    amber:  'bg-amber-400 dark:bg-amber-500',
    indigo: 'bg-indigo-400 dark:bg-indigo-500',
    gray:   'bg-gray-400 dark:bg-gray-500',
  };

  return (
    <div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{title}</p>
      <ul className="space-y-1.5">
        {sorted.map(([key, count]) => {
          const w = max > 0 ? Math.max(4, (count / max) * 100) : 0;
          const fill = tonePerKey?.[key]
            ? TONE_BG[tonePerKey[key]]
            : (barClass ?? 'bg-indigo-400 dark:bg-indigo-500');
          return (
            <li key={key} className="flex items-center gap-2">
              <span className="w-20 text-[11px] truncate text-gray-700 dark:text-gray-300" title={key}>
                {labelMap[key] ?? key}
              </span>
              <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                <div
                  className={`h-full flex items-center justify-end px-2 ${fill}`}
                  style={{ width: `${w}%` }}
                >
                  <span className="text-[10px] text-white font-bold">{count}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// =====================================================================
// Stat — small numeric cell, mirrors VP report shape
// =====================================================================

function Stat({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone?: 'green' | 'red' | 'amber' | 'purple' | 'gray';
}) {
  const valueCls = {
    green:  'text-green-700 dark:text-green-400',
    red:    'text-red-700 dark:text-red-400',
    amber:  'text-amber-700 dark:text-amber-400',
    purple: 'text-purple-700 dark:text-purple-400',
    gray:   'text-gray-700 dark:text-gray-400',
  }[tone ?? 'gray'];
  return (
    <div className="px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
      <p className="text-[11px] text-gray-600 dark:text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${valueCls}`}>{value}</p>
    </div>
  );
}
