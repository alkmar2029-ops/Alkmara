// School aggregate report UI (م6.3d).
//
// Consumer of /api/admin/reports/school (м6.3c). Read-only.
//
// =====================================================================
// SCOPE / GATE
// =====================================================================
// Client gate: super_admin OR holders of `view_school_reports`. The API
// has the SAME check via requireSchoolReports(); this client guard just
// keeps non-eligible users from seeing an "Access denied" flash. The
// API is the security boundary.
//
// =====================================================================
// PRIVACY BOUNDARY (inherited from м6.3c)
// =====================================================================
// This page DOES NOT render — and the API DOES NOT return:
//   - student names / IDs
//   - case titles / descriptions / resolutions / reasons
//   - session content / topic / preview
//   - plan titles / milestones / progress notes
//   - note text / recorded_by
//   - top-N students
//   - average risk score
//   - per-section breakdowns
//   - by_type / by_severity inside a grade row (school-level only)
//   - notes by_type (positive/negative) at any level
//   - currently_active case count
//
// Per-grade rows with student_count < 5 are returned by the API with
// `suppressed: true` and all metric fields = null. The UI MUST display
// "—" for those cells AND a clear "محجوب (n<5)" badge so the principal
// understands the privacy decision rather than guessing "no data".

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
// Types — mirror /api/admin/reports/school exactly
// =====================================================================

interface ReportRange { from: string; to: string; }
interface ReportScope {
  mode: 'principal' | 'super_admin';
  k_threshold:           number;
  total_students:        number;
  suppressed_grade_count: number;
}
interface SchoolCases {
  opened_in_range:   number;
  resolved_in_range: number;
  closed_in_range:   number;
  reopened_in_range: number;
  by_type:           Record<string, number>;
  by_severity:       Record<string, number>;
}
interface SchoolPlans {
  created_in_range:   number;
  completed_in_range: number;
  cancelled_in_range: number;
  currently_overdue:  number;
}
interface SchoolSessions {
  held_in_range:          number;
  total_duration_minutes: number;
  by_type:                Record<string, number>;
}
interface SchoolNotes {
  recorded_in_range: number;
  confidential:      number;
  non_confidential:  number;
}
interface SchoolRisk {
  students_scored: number;
  stale_count:     number;
  buckets:         Record<'0-29' | '30-49' | '50-69' | '70+', number>;
}

interface GradeRow {
  grade_id:      number;
  grade_name:    string;
  student_count: number;
  suppressed:    boolean;
  cases:    { opened_in_range: number; resolved_in_range: number; closed_in_range: number; reopened_in_range: number } | null;
  plans:    { created_in_range: number; completed_in_range: number; cancelled_in_range: number; currently_overdue: number } | null;
  sessions: { held_in_range: number; total_duration_minutes: number } | null;
  notes:    { recorded_in_range: number; confidential: number; non_confidential: number } | null;
  risk_buckets: Record<'0-29' | '30-49' | '50-69' | '70+', number> | null;
}

interface SchoolReport {
  range:          ReportRange;
  scope:          ReportScope;
  cases:          SchoolCases;
  plans:          SchoolPlans;
  sessions:       SchoolSessions;
  notes:          SchoolNotes;
  risk_landscape: SchoolRisk;
  by_grade:       GradeRow[];
}

// =====================================================================
// Date helpers — duplicated from lib/dates/ksa (Zod-free client copy)
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
// Arabic labels for enum-ish columns (school-level by_type only)
// =====================================================================

const CASE_TYPE_LABEL: Record<string, string> = {
  academic:      'أكاديمي',
  behavioral:    'سلوكي',
  social:        'اجتماعي',
  family:        'أسري',
  psychological: 'نفسي',
  other:         'أخرى',
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
  critical: 'red', high: 'red', medium: 'amber', low: 'indigo',
};

// =====================================================================
// Page
// =====================================================================

export default function SchoolReportPage() {
  const { isSuperAdmin, isLoading: personaLoading, can } = usePersona();
  const canView = isSuperAdmin || can('view_school_reports');

  const today = useMemo(() => todayInRiyadh(), []);
  const [from, setFrom] = useState(() => addDaysKsa(todayInRiyadh(), -30));
  const [to,   setTo]   = useState(() => todayInRiyadh());

  const invalidRange = from > to;

  const reportQuery = useQuery<SchoolReport>({
    queryKey: ['school-report', from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      const r = await fetch(`/api/admin/reports/school?${params}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل التقرير');
      }
      return (await r.json()).data as SchoolReport;
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
          تقرير المدرسة الإجمالي متاح لمن لديه صلاحية <code>view_school_reports</code> أو super_admin فقط.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Next.js hoists this <title> from a client component into <head>. */}
      <title>تقرير المدرسة الإجمالي — لوحة الإدارة</title>

      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-500/10 dark:to-pink-500/10 border-purple-200 dark:border-purple-500/30 no-print">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center flex-shrink-0">
              <FileBarChart className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">تقرير المدرسة الإجمالي</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                aggregates عامة + توزيع حسب الصف. لا أسماء طلاب، لا محتوى ملاحظات، k≥5 لكل صف.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => reportQuery.refetch()}
              disabled={reportQuery.isFetching || invalidRange}
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
              type="date" value={from} max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className="px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-600 dark:text-gray-400">إلى</span>
            <input
              type="date" value={to} min={from} max={today}
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
// QuickRange pill
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
          ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 font-medium'
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
          <p className="text-sm font-medium text-red-800 dark:text-red-300">تعذّر تحميل التقرير</p>
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
// Body
// =====================================================================

function ReportBody({ data }: { data: SchoolReport }) {
  return (
    <div className="space-y-4">
      {/* Print-only banner */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">تقرير المدرسة الإجمالي</h1>
        <p className="text-sm">
          {data.range.from} → {data.range.to} • {data.scope.total_students} طالب نشط
        </p>
      </div>

      {/* Scope chip */}
      <div className="text-xs text-gray-600 dark:text-gray-300 no-print flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 text-purple-700 dark:text-purple-300">
          <UsersIcon className="w-3 h-3" />
          المدرسة كاملة • {data.scope.total_students} طالب نشط
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300">
          حد الخصوصية: {data.scope.k_threshold} طلاب لكل صف
          {data.scope.suppressed_grade_count > 0 && (
            <> • {data.scope.suppressed_grade_count} صف محجوب</>
          )}
        </span>
        <span>{data.range.from} → {data.range.to}</span>
      </div>

      {/* Row 1: Cases + Plans */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CasesCard cases={data.cases} />
        <PlansCard plans={data.plans} />
      </div>

      {/* Row 2: Sessions + Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SessionsCard sessions={data.sessions} />
        <NotesCard notes={data.notes} />
      </div>

      {/* Row 3: Risk buckets full-width */}
      <RiskCard risk={data.risk_landscape} />

      {/* Row 4: by_grade table */}
      <ByGradeTable rows={data.by_grade} kThreshold={data.scope.k_threshold} />
    </div>
  );
}

// =====================================================================
// School-totals cards
// =====================================================================

function CasesCard({ cases }: { cases: SchoolCases }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen className="w-5 h-5 text-rose-500" />
        <h2 className="font-bold text-base">الحالات</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="افتُتحت"   value={cases.opened_in_range}   />
        <Stat label="حُلَّت"    value={cases.resolved_in_range} tone={cases.resolved_in_range > 0 ? 'green' : 'gray'} />
        <Stat label="أُغلقت"    value={cases.closed_in_range}   tone={cases.closed_in_range > 0   ? 'green' : 'gray'} />
        <Stat label="أُعيد فتحها" value={cases.reopened_in_range} tone={cases.reopened_in_range > 0 ? 'amber' : 'gray'} />
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
    </div>
  );
}

function PlansCard({ plans }: { plans: SchoolPlans }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-5 h-5 text-amber-500" />
        <h2 className="font-bold text-base">خطط المتابعة</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="أُنشئت"   value={plans.created_in_range}   />
        <Stat label="اكتُملت" value={plans.completed_in_range} tone={plans.completed_in_range > 0 ? 'green' : 'gray'} />
        <Stat label="أُلغيت"  value={plans.cancelled_in_range} tone={plans.cancelled_in_range > 0 ? 'amber' : 'gray'} />
        <Stat label="متأخّرة" value={plans.currently_overdue}  tone={plans.currently_overdue > 0  ? 'red'   : 'gray'} />
      </div>
    </div>
  );
}

function SessionsCard({ sessions }: { sessions: SchoolSessions }) {
  const hours = Math.floor(sessions.total_duration_minutes / 60);
  const mins  = sessions.total_duration_minutes % 60;
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-5 h-5 text-teal-500" />
        <h2 className="font-bold text-base">جلسات الإرشاد</h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="عُقدت في الفترة" value={sessions.held_in_range} tone={sessions.held_in_range > 0 ? 'green' : 'gray'} />
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
    </div>
  );
}

function NotesCard({ notes }: { notes: SchoolNotes }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-5 h-5 text-indigo-500" />
        <h2 className="font-bold text-base">الملاحظات</h2>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
        جميع الملاحظات المسجَّلة في الفترة على مستوى المدرسة (بدون نسبتها لمن سجَّلها).
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="إجمالي"   value={notes.recorded_in_range} />
        <Stat label="سرية"     value={notes.confidential}      tone={notes.confidential > 0 ? 'purple' : 'gray'} />
        <Stat label="غير سرية" value={notes.non_confidential}  />
      </div>
    </div>
  );
}

function RiskCard({ risk }: { risk: SchoolRisk }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-5 h-5 text-purple-500" />
        <h2 className="font-bold text-base">توزيع المخاطر</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          (نطاقات فقط — لا متوسط، لا قائمة طلاب)
        </span>
      </div>
      {risk.students_scored === 0 ? (
        <div className="text-center py-6 text-gray-500 dark:text-gray-400">
          <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">لم تُحسب درجات مخاطر بعد.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <Stat label="يُحسَب لهم" value={risk.students_scored} />
            <Stat label="مؤجَّل"     value={risk.stale_count}     tone={risk.stale_count > 0 ? 'amber' : 'gray'} />
            <BucketStat label="0-29"  value={risk.buckets['0-29']}  tone="green" />
            <BucketStat label="30-49" value={risk.buckets['30-49']} tone="amber" />
            <BucketStat label="50-69" value={risk.buckets['50-69']} tone="amber" />
            <BucketStat label="70+"   value={risk.buckets['70+']}   tone="red"   />
          </div>
        </>
      )}
    </div>
  );
}

// =====================================================================
// By-grade table — wide, compact, with k-anonymity "—"
// =====================================================================

function ByGradeTable({ rows, kThreshold }: { rows: GradeRow[]; kThreshold: number }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <UsersIcon className="w-5 h-5 text-indigo-500" />
        <h2 className="font-bold text-base">توزيع حسب الصف</h2>
        <details className="text-xs">
          <summary className="cursor-pointer text-indigo-600 dark:text-indigo-400 hover:underline list-none">
            <span className="inline-flex items-center gap-1">
              <span className="text-[14px] leading-none">ℹ</span>
              ما معنى الصف «المحجوب»؟
            </span>
          </summary>
          <p className="mt-2 text-gray-600 dark:text-gray-300 max-w-prose leading-relaxed">
            الصفوف التي لديها أقل من <strong>{kThreshold} طلاب نشطين</strong> تُحجَب
            تفاصيلها (كل المقاييس تظهر «—») لحماية خصوصية الطلاب. هذا
            قرار سياسة، وليس خطأ في البيانات. تظل بيانات الصف
            (الاسم، عدد الطلاب) ظاهرة، فقط الـ aggregates التي قد
            تكشف معلومات شخصية يتم إخفاؤها.
          </p>
        </details>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          لا صفوف.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="text-start py-2 px-2 font-medium">الصف</th>
                <th className="text-end py-2 px-2 font-medium">طلاب</th>
                <th className="text-start py-2 px-2 font-medium">الحالات (افتُتحت/حُلَّت/أُغلقت/أُعيد فتحها)</th>
                <th className="text-start py-2 px-2 font-medium">الخطط (أُنشئت/اكتُملت/أُلغيت/متأخّرة)</th>
                <th className="text-start py-2 px-2 font-medium">الجلسات (عُقدت / دقائق)</th>
                <th className="text-start py-2 px-2 font-medium">الملاحظات (إجمالي/سرية/غير سرية)</th>
                <th className="text-start py-2 px-2 font-medium">درجات المخاطر (0-29/30-49/50-69/70+)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => <GradeTableRow key={row.grade_id} row={row} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GradeTableRow({ row }: { row: GradeRow }) {
  const dash = <span className="text-gray-400 dark:text-gray-500">—</span>;
  return (
    <tr className={`border-b border-gray-100 dark:border-gray-800 ${row.suppressed ? 'bg-amber-50/30 dark:bg-amber-500/5' : ''}`}>
      <td className="py-2 px-2 font-medium text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          {row.grade_name}
          {row.suppressed && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30"
              title="هذا الصف لديه أقل من 5 طلاب نشطين، وتفاصيله محجوبة لحماية الخصوصية."
            >
              محجوب — أقل من 5 طلاب
            </span>
          )}
        </div>
      </td>
      <td className="py-2 px-2 text-end font-mono">{row.student_count}</td>

      <td className="py-2 px-2">
        {row.cases === null
          ? dash
          : <CompactCounts items={[
              row.cases.opened_in_range,
              row.cases.resolved_in_range,
              row.cases.closed_in_range,
              row.cases.reopened_in_range,
            ]} labels={['افتُتحت', 'حُلَّت', 'أُغلقت', 'أُعيد فتحها']} />}
      </td>

      <td className="py-2 px-2">
        {row.plans === null
          ? dash
          : <CompactCounts items={[
              row.plans.created_in_range,
              row.plans.completed_in_range,
              row.plans.cancelled_in_range,
              row.plans.currently_overdue,
            ]} labels={['أُنشئت', 'اكتُملت', 'أُلغيت', 'متأخّرة']}
              highlightLast={(row.plans.currently_overdue ?? 0) > 0 ? 'red' : null} />}
      </td>

      <td className="py-2 px-2">
        {row.sessions === null
          ? dash
          : <CompactCounts items={[
              row.sessions.held_in_range,
              row.sessions.total_duration_minutes,
            ]} labels={['عُقدت', 'دقائق']} />}
      </td>

      <td className="py-2 px-2">
        {row.notes === null
          ? dash
          : <CompactCounts items={[
              row.notes.recorded_in_range,
              row.notes.confidential,
              row.notes.non_confidential,
            ]} labels={['إجمالي', 'سرية', 'غير سرية']} />}
      </td>

      <td className="py-2 px-2">
        {row.risk_buckets === null
          ? dash
          : <CompactCounts items={[
              row.risk_buckets['0-29'],
              row.risk_buckets['30-49'],
              row.risk_buckets['50-69'],
              row.risk_buckets['70+'],
            ]} labels={['0-29', '30-49', '50-69', '70+']}
              highlightLast={(row.risk_buckets['70+'] ?? 0) > 0 ? 'red' : null} />}
      </td>
    </tr>
  );
}

function CompactCounts({
  items, labels, highlightLast,
}: {
  items: number[];
  labels?: string[];                       // per-position labels — drives aria-label + title
  highlightLast?: 'red' | 'amber' | null;
}) {
  // Build an accessible description so screen readers + hover tooltips read
  // the labeled values, not "five slash zero slash zero". The header above
  // each column carries the same legend; this is the per-cell repetition for
  // a11y + mouse hover. (UX review م6.3d H1 / L6.)
  const description = labels
    ? items.map((n, i) => `${labels[i] ?? ''}: ${n}`).filter(Boolean).join('، ')
    : undefined;

  return (
    <span
      className="font-mono text-[11px] text-gray-700 dark:text-gray-300"
      aria-label={description}
      title={description}
    >
      {items.map((n, i) => (
        <span key={i}>
          {i > 0 && <span className="text-gray-300 dark:text-gray-600 mx-1">/</span>}
          <span
            className={
              i === items.length - 1 && highlightLast === 'red' && n > 0
                ? 'text-red-700 dark:text-red-400 font-bold'
                : i === items.length - 1 && highlightLast === 'amber' && n > 0
                ? 'text-amber-700 dark:text-amber-400 font-bold'
                : ''
            }
          >
            {n}
          </span>
        </span>
      ))}
    </span>
  );
}

// =====================================================================
// BarBlock — generic horizontal bars (reused from м6.2)
// =====================================================================

function BarBlock({
  title, entries, labelMap, barClass, tonePerKey,
}: {
  title:       string;
  entries:     Array<[string, number]>;
  labelMap:    Record<string, string>;
  barClass?:   string;
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
// Stats
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

function BucketStat({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone:  'green' | 'amber' | 'red';
}) {
  const valueCls = {
    green: 'text-green-700 dark:text-green-400',
    amber: 'text-amber-700 dark:text-amber-400',
    red:   'text-red-700 dark:text-red-400',
  }[tone];
  return (
    <div className="px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 text-center">
      <p className="text-[11px] text-gray-600 dark:text-gray-400">{label}</p>
      <p className={`text-lg font-bold font-mono ${valueCls}`}>{value}</p>
    </div>
  );
}
