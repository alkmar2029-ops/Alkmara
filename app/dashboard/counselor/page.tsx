// Counselor workspace home (م4.18).
//
// First real surface built on top of the م4.7 RLS policies. Read-only
// dashboard — counts + recent metadata for the caller's RLS-visible
// scope.
//
// Defense-in-depth gate via usePersona(): the home redirect already
// routes counselors here, but a direct URL hit from another persona
// must not show counts that an attacker could otherwise infer from
// silent network calls.
//
// =====================================================================
// CONTENT BOUNDARIES (deliberate)
// =====================================================================
//   - No counseling_sessions.content_encrypted is surfaced or
//     decrypted. The API explicitly omits the column.
//   - content_preview IS shown (plaintext, counselor-authored summary)
//     with a small label clarifying it is NOT decrypted content.
//   - Quick actions follow the "honest UI" rule: only routes that
//     exist or have placeholders are enabled. The rest are disabled
//     with a tooltip so the user can see what's coming without
//     finding broken affordances.

'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, BookOpen, Calendar, ClipboardList,
  Eye, FolderOpen, RefreshCw, Shield, ShieldAlert,
  Users as UsersIcon,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';

interface RecentCase {
  id: number;
  case_number: string;
  title: string;
  severity: string;
  status: string;
  student_id: number;
  student_name: string | null;
  updated_at: string;
}

interface RecentSession {
  id: number;
  session_date: string;
  session_type: string;
  topic: string;
  duration_minutes: number | null;
  content_preview: string | null;
  student_id: number;
  student_name: string | null;
}

interface WorkspaceSummary {
  user: { name: string };
  scope: {
    mode: 'counselor' | 'super_admin';
    sections_count: number;
    grades_count: number;
  };
  counts: {
    active_cases: number;
    total_cases: number;
    active_plans: number;
    sessions_last_7d: number;
    confidential_notes_last_7d: number;
  };
  recent_cases: RecentCase[];
  recent_sessions: RecentSession[];
}

const SEVERITY_LABEL: Record<string, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'مرتفعة',
  critical: 'حرجة',
};

const SEVERITY_CLASS: Record<string, string> = {
  low: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400 border-green-200 dark:border-green-500/30',
  medium: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  high: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border-orange-200 dark:border-orange-500/30',
  critical: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border-red-200 dark:border-red-500/30',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'مفتوحة',
  in_progress: 'قيد المعالجة',
  resolved: 'محلولة',
  closed: 'مغلقة',
};

const SESSION_TYPE_LABEL: Record<string, string> = {
  individual: 'جلسة فردية',
  group: 'جلسة جماعية',
  family: 'جلسة عائلية',
  parent: 'لقاء ولي أمر',
  assessment: 'تقييم',
  follow_up: 'متابعة',
  emergency: 'طارئة',
};

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

export default function CounselorWorkspaceShell() {
  // Mirror the API gate (super_admin OR persona='counselor'). The home
  // page redirect already sends counselors here, but a direct URL hit
  // from another persona must hit the same guard the server enforces.
  const { isSuperAdmin, isCounselor, isLoading: personaLoading } = usePersona();
  const canView = isSuperAdmin || isCounselor;

  const query = useQuery<WorkspaceSummary>({
    queryKey: ['counselor-workspace-summary'],
    queryFn: async () => {
      const r = await fetch('/api/counselor/workspace-summary');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل لوحة المرشد');
      }
      return (await r.json()).data as WorkspaceSummary;
    },
    // Hold until persona resolves AND the user is allowed — same
    // pattern as the VP morning dashboard, prevents a flash of an
    // unnecessary 403 in the network panel for non-counselors.
    enabled: !personaLoading && canView,
    refetchInterval: 60_000, // 1 minute — slower than VP morning
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  if (personaLoading) return <SkeletonPage />;

  if (!canView) {
    return (
      <div className="card text-center py-12 border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/5">
        <Shield className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
        <p className="text-sm text-red-700 dark:text-red-400 font-medium">
          هذه الشاشة متاحة للمرشدين الطلابيين فقط.
        </p>
      </div>
    );
  }

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) {
    return (
      <div className="card text-center py-12 text-red-500">
        فشل تحميل لوحة المرشد. حاول تحديث الصفحة.
        <button
          onClick={() => query.refetch()}
          className="block mx-auto mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const data = query.data;
  const firstName = data.user.name?.split(' ').slice(0, 2).join(' ') ?? '';

  return (
    <div className="space-y-4">
      {/* ============== Welcome header ============== */}
      <div className="card bg-gradient-to-br from-teal-50 to-indigo-50 dark:from-teal-500/10 dark:to-indigo-500/10 border-teal-200 dark:border-teal-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-indigo-500 flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">
                {arabicGreeting()}{firstName ? `، ${firstName}` : ''}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                لوحة عمل المرشد الطلابي
              </p>
              <ScopeBadge scope={data.scope} />
            </div>
          </div>
          <button
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50"
            title="تحديث"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      </div>

      {/* ============== KPI grid (5 cards) ============== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="حالات نشطة"
          value={data.counts.active_cases}
          sub={`من ${data.counts.total_cases} إجمالًا`}
          tone="rose"
          icon={FolderOpen}
        />
        <KpiCard
          label="خطط متابعة نشطة"
          value={data.counts.active_plans}
          tone="amber"
          icon={ClipboardList}
        />
        <KpiCard
          label="جلسات آخر ٧ أيام"
          value={data.counts.sessions_last_7d}
          tone="teal"
          icon={Calendar}
        />
        <KpiCard
          label="ملاحظات سرية آخر ٧ أيام"
          value={data.counts.confidential_notes_last_7d}
          tone="indigo"
          icon={ShieldAlert}
        />
        <KpiCard
          label="إجمالي الحالات"
          value={data.counts.total_cases}
          sub="(تاريخي)"
          tone="slate"
          icon={Activity}
        />
      </div>

      {/* ============== Two-column area: recent cases + recent sessions ============== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Recent cases */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-rose-500" />
              <h2 className="font-bold text-base">آخر الحالات النشطة</h2>
            </div>
            <Link
              href="/dashboard/counselor/cases"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              لوحة الحالات ←
            </Link>
          </div>
          {data.recent_cases.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
              لا توجد حالات نشطة حاليًا.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.recent_cases.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/counselor/cases/${c.id}`}
                    className="flex items-start gap-2 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                  >
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap font-medium ${
                        SEVERITY_CLASS[c.severity] ?? 'bg-gray-50 text-gray-700 border-gray-200'
                      }`}
                    >
                      {SEVERITY_LABEL[c.severity] ?? c.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-1">{c.title}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        <span className="font-mono">{c.case_number}</span>
                        {c.student_name && <> • {c.student_name}</>}
                        <> • {STATUS_LABEL[c.status] ?? c.status}</>
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent sessions — metadata only, no decrypted content */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-teal-500" />
              <h2 className="font-bold text-base">آخر الجلسات (Metadata)</h2>
            </div>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-400 font-medium"
              title="لا يُعرض محتوى الجلسات المشفّر — انتظار مراجعة إدارة المفاتيح."
            >
              بدون فك تشفير
            </span>
          </div>
          {data.recent_sessions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
              لا توجد جلسات مسجَّلة بعد.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.recent_sessions.map((s) => (
                <li
                  key={s.id}
                  className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-1">{s.topic}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        <span className="font-mono">{s.session_date}</span>
                        <> • {SESSION_TYPE_LABEL[s.session_type] ?? s.session_type}</>
                        {s.duration_minutes != null && <> • {s.duration_minutes} د</>}
                        {s.student_name && <> • {s.student_name}</>}
                      </p>
                    </div>
                  </div>
                  {s.content_preview && (
                    <div className="mt-2 p-2 rounded bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50">
                      <div className="flex items-center gap-1 mb-1">
                        <Eye className="w-3 h-3 text-gray-400" />
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                          ملخص غير مشفّر كتبه المرشد
                        </span>
                      </div>
                      <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2">
                        {s.content_preview}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ============== Quick actions ============== */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-5 h-5 text-blue-500" />
          <h2 className="font-bold text-base">إجراءات سريعة</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Enabled — has placeholder route */}
          <QuickAction
            href="/dashboard/counselor/cases"
            icon={FolderOpen}
            label="لوحة الحالات"
            tone="rose"
          />
          {/* The rest are visual-only until the corresponding APIs/screens
              land in م4.21+. Disabled with a tooltip — honest UI per
              user feedback: no decorative buttons. */}
          <QuickActionDisabled
            icon={Calendar}
            label="جلسة جديدة"
            tooltip="متاح بعد تنفيذ م4.21 — تسجيل جلسة"
          />
          <QuickActionDisabled
            icon={ShieldAlert}
            label="ملاحظة سرية جديدة"
            tooltip="متاح بعد تنفيذ م4.22 — تسجيل ملاحظة"
          />
          <QuickActionDisabled
            icon={ClipboardList}
            label="خطة متابعة جديدة"
            tooltip="متاح بعد تنفيذ م4.23 — لوحة الخطط"
          />
        </div>
      </div>

      <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center pt-1">
        التحديث التلقائي كل ٦٠ ثانية.
      </p>
    </div>
  );
}

// ============== Helper sub-components ==============

function ScopeBadge({ scope }: { scope: WorkspaceSummary['scope'] }) {
  if (scope.mode === 'super_admin') {
    return (
      <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 font-medium">
        <UsersIcon className="w-3 h-3" />
        نطاق الإشراف الأعلى — كل المدرسة
      </span>
    );
  }
  const parts: string[] = [];
  if (scope.sections_count > 0) parts.push(`${scope.sections_count} شعبة`);
  if (scope.grades_count > 0) parts.push(`${scope.grades_count} صف`);
  if (parts.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 font-medium">
        <AlertTriangle className="w-3 h-3" />
        لم تُسنَد لك شعب أو صفوف بعد
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-500/20 text-teal-800 dark:text-teal-300 font-medium">
      <UsersIcon className="w-3 h-3" />
      تشرف على {parts.join(' + ')}
    </span>
  );
}

function KpiCard({
  label, value, sub, tone, icon: Icon,
}: {
  label: string;
  value: number;
  sub?: string;
  tone: 'rose' | 'amber' | 'teal' | 'indigo' | 'slate';
  icon: any;
}) {
  const cls: Record<string, string> = {
    rose:   'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',
    amber:  'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
    teal:   'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400 border-teal-200 dark:border-teal-500/30',
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30',
    slate:  'bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:border-slate-500/30',
  };
  return (
    <div className={`card border ${cls[tone]}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs opacity-90">{label}</p>
        <Icon className="w-4 h-4 opacity-60" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-[10px] mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

function QuickAction({
  href, icon: Icon, label, tone,
}: {
  href: string;
  icon: any;
  label: string;
  tone: 'rose' | 'teal' | 'indigo' | 'amber';
}) {
  const cls: Record<string, string> = {
    rose:   'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/25',
    teal:   'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-500/25',
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/25',
    amber:  'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/25',
  };
  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl transition-colors ${cls[tone]}`}
    >
      <Icon className="w-6 h-6" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}

function QuickActionDisabled({
  icon: Icon, label, tooltip,
}: {
  icon: any;
  label: string;
  tooltip: string;
}) {
  return (
    <div
      title={tooltip}
      className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 text-gray-400 dark:text-gray-500 cursor-not-allowed border border-dashed border-gray-200 dark:border-gray-700"
    >
      <Icon className="w-6 h-6" />
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[9px] opacity-70">قريبًا</span>
    </div>
  );
}
