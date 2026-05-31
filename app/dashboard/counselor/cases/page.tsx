// Counselor case board (م4.19) — read-only Kanban over student_cases.
//
// Replaces the prior placeholder. Strictly READ-ONLY:
//   - No drag/drop. Cards don't even carry a grab cursor.
//   - No "edit", "close", "change status" buttons.
//   - No decryption — sessions / content live behind the case detail
//     screen (م4.20) and even there decrypt is deferred to the
//     key-management review.
// State-machine transitions go through a separate API contract that
// hasn't been drafted yet; until then this board reflects what's in
// student_cases and nothing more.
//
// Filters:
//   - severity dropdown (server-side: shrinks payload before transit)
//   - text search (client-side: case_number / title / student_name)
// Both filters are deliberately small. The user's "لا overbuild" rule.
//
// Layout:
//   4-column grid on lg+, 2 columns on sm/md, stacked on mobile.

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, FolderOpen, RefreshCw, Search, Shield,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';

interface CaseRow {
  id: number;
  case_number: string;
  title: string;
  severity: string;
  case_type: string;
  status: string;
  student_id: number;
  student_name: string | null;
  updated_at: string;
  created_at: string;
}

interface CasesResponse {
  cases: CaseRow[];
  cap_reached: boolean;
}

const COLUMNS: Array<{ id: string; label: string; tone: string }> = [
  { id: 'open',        label: 'مفتوحة',       tone: 'rose' },
  { id: 'in_progress', label: 'قيد المعالجة', tone: 'amber' },
  { id: 'resolved',    label: 'محلولة',       tone: 'teal' },
  { id: 'closed',      label: 'مغلقة',        tone: 'slate' },
];

const SEVERITY_LABEL: Record<string, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'مرتفعة',
  critical: 'حرجة',
};

const SEVERITY_CLASS: Record<string, string> = {
  low:      'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400 border-green-200 dark:border-green-500/30',
  medium:   'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  high:     'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border-orange-200 dark:border-orange-500/30',
  critical: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border-red-200 dark:border-red-500/30',
};

const CASE_TYPE_LABEL: Record<string, string> = {
  academic:    'أكاديمي',
  behavioral:  'سلوكي',
  social:      'اجتماعي',
  health:      'صحي',
  family:      'عائلي',
  attendance:  'حضور',
};

const COL_HEADER_CLASS: Record<string, string> = {
  rose:  'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',
  amber: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  teal:  'bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-500/30',
  slate: 'bg-slate-50 dark:bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30',
};

export default function CounselorCaseBoard() {
  // Client gate mirrors the API gate. The home redirect already routes
  // counselors here, but a direct hit from another persona must not
  // even fire a network request — we'd waste a 403 in their face.
  const { isSuperAdmin, isCounselor, isLoading: personaLoading } = usePersona();
  const canView = isSuperAdmin || isCounselor;

  const [severity, setSeverity] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const query = useQuery<CasesResponse>({
    queryKey: ['counselor-cases', severity || 'all'],
    queryFn: async () => {
      const url = severity
        ? `/api/counselor/cases?severity=${encodeURIComponent(severity)}`
        : '/api/counselor/cases';
      const r = await fetch(url);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل لوحة الحالات');
      }
      return (await r.json()).data as CasesResponse;
    },
    enabled: !personaLoading && canView,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  // Client-side filter — search across case_number / title / student_name.
  // Run after the server already shrank the set by severity, so even with
  // 500 rows this loop is trivial.
  const filtered = useMemo<CaseRow[]>(() => {
    const all = query.data?.cases ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => {
      const fields = [c.case_number, c.title, c.student_name ?? ''].join(' ').toLowerCase();
      return fields.includes(q);
    });
  }, [query.data, search]);

  // Bucket filtered into the 4 columns. Single pass.
  const grouped = useMemo(() => {
    const buckets: Record<string, CaseRow[]> = {
      open: [], in_progress: [], resolved: [], closed: [],
    };
    for (const c of filtered) {
      if (buckets[c.status]) buckets[c.status].push(c);
    }
    return buckets;
  }, [filtered]);

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
        فشل تحميل لوحة الحالات. حاول تحديث الصفحة.
        <button
          onClick={() => query.refetch()}
          className="block mx-auto mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const totalCount = query.data.cases.length;
  const filteredCount = filtered.length;
  const capReached = query.data.cap_reached;

  return (
    <div className="space-y-4">
      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-rose-50 to-orange-50 dark:from-rose-500/10 dark:to-orange-500/10 border-rose-200 dark:border-rose-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center flex-shrink-0">
              <FolderOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">لوحة الحالات — المرشد</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                عرض قراءة. تغيير الحالة + الإجراءات تأتي في م4.20 (تفاصيل الحالة).
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

      {/* ============== Cap banner ============== */}
      {capReached && (
        <div className="card border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10">
          <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">القائمة مقتطعة عند ٥٠٠ حالة.</p>
              <p className="mt-0.5 text-xs opacity-90">
                استخدم فلتر الخطورة لتضييق النطاق. الـ pagination ستُضاف لو
                هذا تكرر فعليًا.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ============== Filters ============== */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 dark:text-gray-400">الخطورة:</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
            >
              <option value="">كل المستويات</option>
              <option value="critical">حرجة</option>
              <option value="high">مرتفعة</option>
              <option value="medium">متوسطة</option>
              <option value="low">منخفضة</option>
            </select>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالرقم، العنوان، أو اسم الطالب…"
              className="flex-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5"
            />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 ms-auto">
            {search || severity
              ? `${filteredCount} من ${totalCount}`
              : `${totalCount} حالة`}
          </div>
        </div>
      </div>

      {/* ============== Kanban ============== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {COLUMNS.map((col) => {
          const items = grouped[col.id] ?? [];
          return (
            <div key={col.id} className="flex flex-col gap-2">
              <div
                className={`rounded-lg border px-3 py-2 flex items-center justify-between font-medium ${COL_HEADER_CLASS[col.tone]}`}
              >
                <span className="text-sm">{col.label}</span>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-white/60 dark:bg-white/10">
                  {items.length}
                </span>
              </div>
              <div className="flex flex-col gap-2 min-h-[80px]">
                {items.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">
                    لا حالات في هذا العمود.
                  </p>
                ) : (
                  items.map((c) => <CaseCard key={c.id} c={c} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center pt-1">
        التحديث التلقائي كل ٦٠ ثانية.
      </p>
    </div>
  );
}

// ============== Card ==============

function CaseCard({ c }: { c: CaseRow }) {
  return (
    <Link
      href={`/dashboard/counselor/cases/${c.id}`}
      className="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 hover:bg-gray-50 dark:hover:bg-gray-800/70 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap font-medium ${
            SEVERITY_CLASS[c.severity] ?? 'bg-gray-50 text-gray-700 border-gray-200'
          }`}
        >
          {SEVERITY_LABEL[c.severity] ?? c.severity}
        </span>
        <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">
          {c.case_number}
        </span>
      </div>
      <p className="text-sm font-medium line-clamp-2 mb-1">{c.title}</p>
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="line-clamp-1">{c.student_name ?? '—'}</span>
        <span className="font-mono whitespace-nowrap">
          {CASE_TYPE_LABEL[c.case_type] ?? c.case_type}
        </span>
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-mono">
        آخر تحديث {c.updated_at.slice(0, 10)}
      </p>
    </Link>
  );
}
