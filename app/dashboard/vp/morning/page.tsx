// VP morning dashboard (م2.12).
//
// Single endpoint: GET /api/vp/morning-summary. Read-only. Auto-refresh
// every 5 minutes + manual refresh button. Defense-in-depth gate via
// usePersona() — the home page already redirects VPs here, but a direct
// URL hit from a non-VP must not show metrics for someone who can't
// otherwise see them.
//
// Quick Actions and the weekly trend chart from the original spec are
// intentionally OUT of scope: no destinations exist for the actions
// until م2.13+ ships, and the weekly chart needs a backend that we
// haven't built. Both land in a follow-up once the substitutions /
// operations-report screens exist.
//
// Sprint 3/4 placeholder cards (pending_incidents / open_cases) render
// dimmed so the layout doesn't shift when those tables come online —
// the backend already returns 0 for them today.

'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, AlertTriangle, CheckCircle, Clock, FileText,
  RefreshCw, Users as UsersIcon, LogOut, Activity, FolderOpen,
  Calendar,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';

interface AbsentTeacherSummary {
  user_id: string;
  full_name: string | null;
  reason: string | null;
}

interface MorningSummary {
  date: string;
  day_of_week: number;
  teachers: {
    absent_today: number;
    absent_list: AbsentTeacherSummary[];
  };
  substitutions: {
    total_needed: number;
    assigned: number;
    pending: number;
  };
  leaves: { pending_requests: number };
  dismissals: { today_total: number };
  supervision: { empty_posts_today: number };
  pending_incidents: number; // Sprint 3 placeholder
  open_cases: number;        // Sprint 4 placeholder
}

const ARABIC_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function arabicGreeting(): string {
  const h = parseInt(
    new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      timeZone: 'Asia/Riyadh',
    }),
    10,
  );
  if (h < 5) return 'تصبح على خير';
  if (h < 12) return 'صباح الخير';
  if (h < 18) return 'مساء الخير';
  return 'مساء النور';
}

export default function VpMorningDashboard() {
  // Mirror the API gate (requireVpDashboard = super_admin OR
  // view_morning_dashboard flag). The previous (isVicePrincipal ||
  // isSuperAdmin) check was narrower than the server: a principal or
  // general_admin granted view_morning_dashboard would pass the API but
  // be blocked here, contradicting the page's own error text. Codex
  // smoke-then-review caught this gap (م2.12 follow-up).
  const { isSuperAdmin, isLoading: personaLoading, can } = usePersona();
  const canView = isSuperAdmin || can('view_morning_dashboard');

  const query = useQuery<MorningSummary>({
    queryKey: ['vp-morning-summary'],
    queryFn: async () => {
      const r = await fetch('/api/vp/morning-summary');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل لوحة الصباح');
      }
      return (await r.json()).data as MorningSummary;
    },
    // Skip until persona resolves AND user is authorized. Otherwise a
    // non-VP loading the URL directly would briefly fire the request
    // before the gate kicks in — wasted round-trip + a noisy 403 in
    // network panel.
    enabled: !personaLoading && canView,
    refetchInterval: 5 * 60_000, // 5 minutes
    refetchIntervalInBackground: false,
    staleTime: 60_000, // don't thrash for navigation back-and-forth
  });

  if (personaLoading) return <SkeletonPage />;

  // Defense-in-depth gate. The redirect in /dashboard/page.tsx already
  // sends non-VPs elsewhere; this catches direct URL navigation and
  // edge cases where the persona finished loading but the redirect
  // hasn't fired yet.
  if (!canView) {
    return (
      <div className="card text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
        <p className="text-sm font-medium">لا تملك صلاحية لوحة الصباح</p>
        <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
          يلزم دور الوكيل أو صلاحية view_morning_dashboard.
        </p>
      </div>
    );
  }

  if (query.isLoading) return <SkeletonPage />;

  if (query.isError) {
    return (
      <div className="card border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              تعذّر تحميل لوحة الصباح
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
              {query.error instanceof Error ? query.error.message : 'حاول تحديث الصفحة.'}
            </p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-3 text-xs px-3 py-1.5 rounded-md bg-red-100 hover:bg-red-200 dark:bg-red-500/20 dark:hover:bg-red-500/30 text-red-800 dark:text-red-300 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        </div>
      </div>
    );
  }

  const data = query.data!;
  const weekday = ARABIC_WEEKDAYS[new Date(`${data.date}T12:00:00+03:00`).getUTCDay()];
  const coveragePct =
    data.substitutions.total_needed > 0
      ? Math.round((data.substitutions.assigned / data.substitutions.total_needed) * 100)
      : null;

  return (
    <div className="space-y-4">
      {/* ============== Welcome header ============== */}
      <div className="card bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-500/10 dark:to-indigo-500/10 border-purple-200 dark:border-purple-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">
                {arabicGreeting()} — لوحة الوكيل
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {weekday} • {data.date}
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                التحديث التلقائي كل 5 دقائق
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-500/30 hover:bg-purple-50 dark:hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
            {query.isFetching ? 'يحدّث الآن…' : 'تحديث'}
          </button>
        </div>
      </div>

      {/* ============== Pulse cards — 6 metrics ============== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <PulseCard
          label="غياب المعلمين"
          value={data.teachers.absent_today}
          sub={data.teachers.absent_today > 0 ? 'يحتاج إجراء' : 'لا غياب'}
          tone={data.teachers.absent_today > 0 ? 'red' : 'green'}
          icon={AlertCircle}
        />
        <PulseCard
          label="حصص متبقّية"
          value={data.substitutions.pending}
          sub={data.substitutions.pending > 0 ? 'تحتاج بديلًا' : 'مغطّاة بالكامل'}
          tone={data.substitutions.pending > 0 ? 'amber' : 'green'}
          icon={Clock}
        />
        <PulseCard
          label="حصص مُسنَدة"
          value={data.substitutions.assigned}
          sub={
            data.substitutions.total_needed > 0
              ? `من أصل ${data.substitutions.total_needed}`
              : 'لا حصص اليوم'
          }
          tone="blue"
          icon={CheckCircle}
        />
        <PulseCard
          label="إجازات بانتظار البتّ"
          value={data.leaves.pending_requests}
          sub={data.leaves.pending_requests > 0 ? 'بانتظار قرارك' : 'لا طلبات'}
          tone={data.leaves.pending_requests > 0 ? 'purple' : 'green'}
          icon={FileText}
        />
        <PulseCard
          label="نقاط إشراف شاغرة"
          value={data.supervision.empty_posts_today}
          sub={data.supervision.empty_posts_today > 0 ? 'بدون مشرف' : 'كلها مغطّاة'}
          tone={data.supervision.empty_posts_today > 0 ? 'orange' : 'green'}
          icon={UsersIcon}
        />
        <PulseCard
          label="استئذان اليوم"
          value={data.dismissals.today_total}
          sub="مغادرة مبكرة"
          tone="indigo"
          icon={LogOut}
        />
      </div>

      {/* ============== Substitution coverage bar ============== */}
      {data.substitutions.total_needed > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-500" />
              <h2 className="font-bold text-base">تغطية حصص الانتظار</h2>
            </div>
            <span
              className={`text-sm font-mono font-bold ${
                coveragePct === 100
                  ? 'text-green-700 dark:text-green-400'
                  : coveragePct! >= 50
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {coveragePct}%
            </span>
          </div>
          <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                coveragePct === 100
                  ? 'bg-green-500'
                  : coveragePct! >= 50
                  ? 'bg-amber-500'
                  : 'bg-red-500'
              }`}
              style={{ width: `${coveragePct}%` }}
            />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
            {data.substitutions.assigned} مُسنَدة • {data.substitutions.pending} متبقّية •
            {' '}
            {data.substitutions.total_needed} الإجمالي
          </p>
        </div>
      )}

      {/* ============== Absent teachers ribbon ============== */}
      {data.teachers.absent_today > 0 && (
        <div className="card border-red-200 dark:border-red-500/30 bg-red-50/40 dark:bg-red-500/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <h2 className="font-bold text-base">المعلمون الغائبون اليوم</h2>
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-200 dark:bg-red-500/30 text-red-800 dark:text-red-300 font-mono">
              {data.teachers.absent_today}
            </span>
          </div>
          <ul className="space-y-1.5">
            {data.teachers.absent_list.map((t) => (
              <li
                key={t.user_id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800/40 border border-red-100 dark:border-red-500/20"
              >
                <span className="flex-1 text-sm font-medium">
                  {t.full_name ?? '—'}
                </span>
                {t.reason && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">
                    {t.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {data.teachers.absent_today > data.teachers.absent_list.length && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 text-center">
              يُعرض أول {data.teachers.absent_list.length} من {data.teachers.absent_today} —
              {' '}
              القائمة الكاملة في شاشة البدلاء (قريبًا).
            </p>
          )}
        </div>
      )}

      {/* ============== Sprint 3/4 placeholders ============== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PlaceholderCard
          icon={AlertTriangle}
          label="مخالفات بانتظار المراجعة"
          value={data.pending_incidents}
          note="يُفعَّل مع المرحلة 3 (تدفّق المخالفات)"
        />
        <PlaceholderCard
          icon={FolderOpen}
          label="حالات إرشاد مفتوحة"
          value={data.open_cases}
          note="يُفعَّل مع المرحلة 4 (الحالات والجلسات)"
        />
      </div>
    </div>
  );
}

// ============== Sub-components ==============

function PulseCard({
  label, value, sub, tone, icon: Icon,
}: {
  label: string;
  value: number;
  sub?: string;
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
      {sub && <p className="text-[10px] mt-0.5 opacity-80">{sub}</p>}
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
