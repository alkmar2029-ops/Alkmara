// Counselor watchlist (م5.7). Replaces the م5 placeholder.
//
// Read-only surface over /api/counselor/watchlist. Same client gate
// pattern as the workspace shell — super_admin OR persona='counselor';
// view_confidential_notes flag holders are blocked here AND on the API
// (the privacy decision is enforced top-to-bottom — see م5.2 header).
//
// =====================================================================
// WHAT THIS PAGE DOES NOT DO
// =====================================================================
//   - No compute button (the sweep is super-admin-only — м5.5).
//   - No card → student/case link in v1 (no clean per-student
//     destination yet; cases are linked by case_id, not student_id).
//     A future iteration can add "view cases for this student" when
//     the case-board filter supports it.

'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Clock, Filter, RefreshCw, Shield, ShieldAlert, Sparkles,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';

// =====================================================================
// Types — mirror /api/counselor/watchlist
// =====================================================================

interface Subscores {
  behavior:   number;
  engagement: number;
  attendance: number;
  velocity:   number;
}

interface Signals {
  incidents_90d_low?:      number;
  incidents_90d_medium?:   number;
  incidents_90d_high?:     number;
  incidents_90d_critical?: number;
  incidents_90d_weighted?: number;
  recent_incident_7d?:     boolean;
  active_cases?:           number;
  reopen_count_sum?:       number;
  active_plans?:           number;
  plan_overdue?:           boolean;
  sessions_30d?:           number;
  last_session_days_ago?:  number | null;
  conf_notes_30d?:         number;
  absences_30d?:           number;
  late_count_30d?:         number;
  inactive?:               boolean;
}

interface WatchlistItem {
  student_id:    number;
  student_name:  string | null;
  grade_name:    string | null;
  section_name:  string | null;
  score:         number;
  subscores:     Subscores;
  signals:       Signals;
  computed_at:   string | null;
  is_stale:      boolean;
}

interface WatchlistResponse {
  total: number;
  items: WatchlistItem[];
}

const LIMIT_OPTIONS = [50, 100, 200] as const;

// =====================================================================
// Signal → human chip extraction
// =====================================================================
// Rank signals by their contribution to the total score so the chips
// the counselor sees first are the ones actually moving the needle.
// Weights mirror the compute RPC (м5.4); they don't have to match
// exactly — the order is what matters here.

function topSignals(signals: Signals, max = 4): Array<{ label: string; tone: 'rose' | 'amber' | 'indigo' | 'slate' }> {
  const chips: Array<{ label: string; weight: number; tone: 'rose' | 'amber' | 'indigo' | 'slate' }> = [];

  if (signals.recent_incident_7d) {
    chips.push({ label: '⚠ مخالفة جديدة آخر ٧ أيام', weight: 50, tone: 'rose' });
  }
  if ((signals.incidents_90d_weighted ?? 0) > 0) {
    const total =
      (signals.incidents_90d_low ?? 0) +
      (signals.incidents_90d_medium ?? 0) +
      (signals.incidents_90d_high ?? 0) +
      (signals.incidents_90d_critical ?? 0);
    chips.push({ label: `${total} مخالفة آخر ٩٠ يوم`, weight: signals.incidents_90d_weighted ?? 0, tone: 'rose' });
  }
  if ((signals.active_cases ?? 0) > 0) {
    chips.push({ label: `${signals.active_cases} حالة نشطة`, weight: (signals.active_cases ?? 0) * 15, tone: 'amber' });
  }
  if ((signals.reopen_count_sum ?? 0) > 0) {
    chips.push({ label: `${signals.reopen_count_sum} إعادة فتح`, weight: (signals.reopen_count_sum ?? 0) * 10, tone: 'amber' });
  }
  if ((signals.absences_30d ?? 0) > 0) {
    chips.push({ label: `${signals.absences_30d} غياب آخر ٣٠ يوم`, weight: (signals.absences_30d ?? 0) * 12, tone: 'indigo' });
  }
  if ((signals.late_count_30d ?? 0) > 0) {
    chips.push({ label: `${signals.late_count_30d} تأخّر`, weight: (signals.late_count_30d ?? 0) * 4, tone: 'indigo' });
  }
  if (signals.plan_overdue) {
    chips.push({ label: '⏰ خطة متابعة متأخرة', weight: 30, tone: 'amber' });
  }
  if (signals.last_session_days_ago == null || signals.last_session_days_ago > 30) {
    chips.push({ label: signals.last_session_days_ago == null ? 'لا جلسات سابقة' : `لا جلسات منذ ${signals.last_session_days_ago} يوم`, weight: 25, tone: 'slate' });
  }
  if ((signals.conf_notes_30d ?? 0) > 0) {
    chips.push({ label: `${signals.conf_notes_30d} ملاحظة سرية`, weight: (signals.conf_notes_30d ?? 0) * 5, tone: 'slate' });
  }

  return chips.sort((a, b) => b.weight - a.weight).slice(0, max);
}

// =====================================================================
// Page
// =====================================================================

export default function CounselorWatchlistPage() {
  const { isSuperAdmin, isCounselor, isLoading: personaLoading } = usePersona();
  const canView = isSuperAdmin || isCounselor;

  const [minScore, setMinScore] = useState<number>(50);
  const [includeStale, setIncludeStale] = useState<boolean>(false);
  const [limit, setLimit] = useState<(typeof LIMIT_OPTIONS)[number]>(100);

  const query = useQuery<WatchlistResponse>({
    queryKey: ['counselor-watchlist', minScore, includeStale, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        min_score: String(minScore),
        include_stale: includeStale ? 'true' : 'false',
        limit: String(limit),
      });
      const r = await fetch(`/api/counselor/watchlist?${params}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل قائمة المتابعة');
      }
      return (await r.json()).data as WatchlistResponse;
    },
    enabled: !personaLoading && canView,
    refetchInterval: 5 * 60_000,    // 5 minutes — slow refresh; the sweep cron is the freshness driver
    refetchIntervalInBackground: false,
    staleTime: 60_000,
  });

  if (personaLoading) return <SkeletonPage />;

  if (!canView) {
    return (
      <div className="card text-center py-12 border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/5">
        <Shield className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
        <p className="text-sm text-red-700 dark:text-red-400 font-medium">
          قائمة المتابعة متاحة للمرشدين الطلابيين فقط.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-rose-50 to-amber-50 dark:from-rose-500/10 dark:to-amber-500/10 border-rose-200 dark:border-rose-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-amber-500 flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">قائمة المتابعة — الطلاب الأعلى احتياجًا</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                درجة المخاطر تُحسَب من المخالفات + الحالات + الجلسات + الملاحظات + الحضور آخر ٣٠/٩٠ يوم.
              </p>
            </div>
          </div>
          <button
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      </div>

      {/* ============== Filters ============== */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-bold">عوامل التصفية</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
              عتبة الدرجة (الحد الأدنى)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="flex-1"
              />
              <span className="font-mono text-sm w-10 text-end">{minScore}</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
              عدد النتائج
            </label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) as (typeof LIMIT_OPTIONS)[number])}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            >
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <label className="text-xs flex items-center gap-2 cursor-pointer py-2">
            <input
              type="checkbox"
              checked={includeStale}
              onChange={(e) => setIncludeStale(e.target.checked)}
            />
            <Clock className="w-3.5 h-3.5 text-gray-500" />
            تضمين الصفوف المؤجَّلة (is_stale)
          </label>
        </div>
      </div>

      {/* ============== Results ============== */}
      {query.isLoading ? (
        <SkeletonPage />
      ) : query.isError || !query.data ? (
        <div className="card text-center py-12 text-red-500">
          فشل تحميل قائمة المتابعة. حاول التحديث.
        </div>
      ) : query.data.items.length === 0 ? (
        <EmptyState minScore={minScore} includeStale={includeStale} total={query.data.total} />
      ) : (
        <>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {query.data.items.length === query.data.total
              ? `${query.data.total} طالب`
              : `${query.data.items.length} من ${query.data.total} طالب`}
          </div>
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {query.data.items.map((item) => (
              <WatchlistCard key={item.student_id} item={item} />
            ))}
          </ul>
        </>
      )}

      <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center pt-1">
        التحديث التلقائي كل ٥ دقائق. الـ sweep الفعلي يجريه فريق التشغيل.
      </p>
    </div>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

function EmptyState({
  minScore, includeStale, total,
}: { minScore: number; includeStale: boolean; total: number }) {
  // total === 0 with both filters minimal → genuinely no scores yet.
  const noComputedAtAll = total === 0 && minScore === 0 && includeStale === true;
  return (
    <div className="card text-center py-12 text-gray-500 dark:text-gray-400">
      {noComputedAtAll ? (
        <>
          <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">لم تُحسب الدرجات بعد على نطاقك.</p>
          <p className="text-xs mt-1">سيظهر الطلاب فور انتهاء أول sweep من فريق التشغيل.</p>
        </>
      ) : total === 0 ? (
        <>
          <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">لا توجد حالات أعلى من العتبة الحالية ({minScore}).</p>
          <p className="text-xs mt-1">جرّب تخفيض العتبة{includeStale ? '' : ' أو تفعيل «تضمين الصفوف المؤجَّلة»'}.</p>
        </>
      ) : (
        <>
          <Filter className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">لا حالات تطابق الفلاتر الحالية ({total} إجمالي قبل الفلتر).</p>
        </>
      )}
    </div>
  );
}

function scoreTone(n: number): { bg: string; text: string; border: string } {
  // 70+ critical, 40-69 elevated, 1-39 low, 0 = none
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

const CHIP_TONE: Record<string, string> = {
  rose:   'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',
  amber:  'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30',
  slate:  'bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:border-slate-500/30',
};

function WatchlistCard({ item }: { item: WatchlistItem }) {
  const tone = scoreTone(item.score);
  const chips = useMemo(() => topSignals(item.signals), [item.signals]);
  const inactive = item.signals?.inactive === true;

  return (
    <li className={`card border-2 ${tone.border}`}>
      {/* Top row: name + grade/section + stale badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold line-clamp-1">{item.student_name ?? `طالب #${item.student_id}`}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {item.grade_name ? `${item.grade_name} / ${item.section_name ?? '—'}` : 'بدون قسم'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {item.is_stale && (
            <span
              title="الـ signals تغيرت منذ آخر حساب — انتظار sweep"
              className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-400 font-medium inline-flex items-center gap-0.5"
            >
              <Clock className="w-2.5 h-2.5" />
              مؤجَّل
            </span>
          )}
          {inactive && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/40 text-slate-700 dark:text-slate-300 font-medium">
              غير نشط
            </span>
          )}
        </div>
      </div>

      {/* Score + 4 subscore bars side by side */}
      <div className="flex items-stretch gap-3 mb-3">
        <div className={`flex flex-col items-center justify-center px-3 py-2 rounded-xl border-2 ${tone.border} ${tone.bg}`}>
          <span className="text-[9px] opacity-70">الدرجة</span>
          <span className={`text-3xl font-bold ${tone.text} leading-none`}>{item.score}</span>
        </div>
        <div className="flex-1 grid grid-cols-1 gap-1">
          <SubscoreBar label="السلوك"  value={item.subscores.behavior}   tone="rose" />
          <SubscoreBar label="التفاعل" value={item.subscores.engagement} tone="amber" />
          <SubscoreBar label="الحضور"  value={item.subscores.attendance} tone="indigo" />
          <SubscoreBar label="الزخم"   value={item.subscores.velocity}   tone="slate" />
        </div>
      </div>

      {/* Top signals as chips */}
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {chips.map((c, i) => (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${CHIP_TONE[c.tone]}`}>
              {c.label}
            </span>
          ))}
        </div>
      ) : (
        !inactive && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2">
            لا إشارات مهمة آخر ٣٠/٩٠ يوم.
          </p>
        )
      )}

      {/* Footer: computed_at */}
      <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-1 pt-2 border-t border-gray-100 dark:border-gray-800">
        <span>
          {item.computed_at
            ? `آخر حساب: ${item.computed_at.slice(0, 16).replace('T', ' ')}`
            : 'لم تُحسب بعد'}
        </span>
        <span className="font-mono">#{item.student_id}</span>
      </div>
    </li>
  );
}

function SubscoreBar({
  label, value, tone,
}: { label: string; value: number; tone: 'rose' | 'amber' | 'indigo' | 'slate' }) {
  const fillCls: Record<string, string> = {
    rose:   'bg-rose-500',
    amber:  'bg-amber-500',
    indigo: 'bg-indigo-500',
    slate:  'bg-slate-500',
  };
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="w-12 text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${fillCls[tone]}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="w-7 text-end font-mono text-gray-700 dark:text-gray-300">{value}</span>
    </div>
  );
}
