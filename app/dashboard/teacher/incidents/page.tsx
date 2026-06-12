// Teacher's "my incidents" list (م3.11).
//
// Three tabs filter by status group:
//   قيد المراجعة (active)   → submitted | under_review
//   تم البت (decided)        → dismissed | actioned | escalated
//   الكل                     → no filter (most-recent 200)
//
// Withdraw button appears only when:
//   status === 'submitted' AND age < 30 min
// (matches the م3.10 endpoint's eligibility — UI hides what the
// API would refuse.)
//
// Auto-refresh on the active tab so reviewer decisions appear
// without a manual reload. Decided / All tabs are static enough
// not to need it.

'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertCircle, AlertTriangle, BookOpen, CheckCircle, Clock,
  FileText, Pencil, Plus, RefreshCw, Trash2, X,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import {
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  type IncidentStatus,
  type IncidentType,
  type IncidentSeverity,
} from '@/lib/incidents/types';
import { todayInRiyadh } from '@/lib/dates/ksa';
import { usePersona } from '@/lib/hooks/usePersona';

// ============== Types (mirror /api/incidents/mine response) ==============

interface IncidentRow {
  id: number;
  student_id: number;
  student_name: string | null;
  incident_date: string;
  incident_type: string;
  severity: string;
  description: string;
  status: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  action_taken: string | null;
  parent_notified: boolean;
  parent_notified_at: string | null;
  case_id: number | null;
  escalated_to: string | null;
  escalated_to_name: string | null;
}

type Tab = 'active' | 'decided' | 'all';

const TAB_LABELS: Record<Tab, string> = {
  active: 'قيد المراجعة',
  decided: 'تم البت',
  all: 'الكل',
};

const STATUS_TONE: Record<IncidentStatus, string> = {
  submitted: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
  under_review: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
  dismissed: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  actioned: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
  escalated: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
};

const SEVERITY_TONE: Record<IncidentSeverity, string> = {
  low: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
  medium: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
  high: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
  critical: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
};

const WITHDRAW_WINDOW_MS = 30 * 60 * 1000;

// Edit shares the exact same eligibility window as withdraw — the API
// enforces the same rules (status='submitted' + 30 min + ownership).
function isWithdrawable(row: IncidentRow): boolean {
  if (row.status !== 'submitted') return false;
  const age = Date.now() - new Date(row.submitted_at).getTime();
  return age <= WITHDRAW_WINDOW_MS;
}

// ============== Page ==============

export default function TeacherIncidentsPage() {
  const [tab, setTab] = useState<Tab>('active');
  const [withdrawTarget, setWithdrawTarget] = useState<IncidentRow | null>(null);
  const [editTarget, setEditTarget] = useState<IncidentRow | null>(null);
  const queryClient = useQueryClient();
  const persona = usePersona();
  const role = persona.data?.role;
  const canAccess = role === 'teacher' || role === 'admin' || role === 'super_admin';

  const query = useQuery<IncidentRow[]>({
    queryKey: ['incidents-mine', tab],
    queryFn: async () => {
      // Tab → status filter mapping. The API accepts one status at a
      // time, so for "active" + "decided" (which span two/three
      // statuses) we fetch everything and filter client-side. With a
      // 200-row cap, the client filter is fine.
      const r = await fetch('/api/incidents/mine');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل المخالفات');
      }
      return ((await r.json()).data ?? []) as IncidentRow[];
    },
    // Active tab refreshes every minute — reviewer decisions land
    // visibly without a manual reload. Other tabs are stable.
    refetchInterval: tab === 'active' ? 60_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    enabled: !persona.isLoading && canAccess,
  });

  // Client-side tab filter on the cached list.
  const filtered = useMemo(() => {
    const all = query.data ?? [];
    if (tab === 'active') {
      return all.filter((r) => r.status === 'submitted' || r.status === 'under_review');
    }
    if (tab === 'decided') {
      return all.filter(
        (r) => r.status === 'dismissed' || r.status === 'actioned' || r.status === 'escalated',
      );
    }
    return all;
  }, [query.data, tab]);

  const withdrawMutation = useMutation({
    mutationFn: async (incidentId: number) => {
      const r = await fetch(`/api/incidents/${incidentId}/withdraw`, {
        method: 'DELETE',
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل سحب المخالفة');
      return body.data;
    },
    onSuccess: () => {
      toast.success('تم سحب المخالفة');
      queryClient.invalidateQueries({ queryKey: ['incidents-mine'] });
      setWithdrawTarget(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل سحب المخالفة');
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, unknown> }) => {
      const r = await fetch(`/api/incidents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل تعديل المخالفة');
      return body.data;
    },
    onSuccess: () => {
      toast.success('تم تعديل المخالفة');
      queryClient.invalidateQueries({ queryKey: ['incidents-mine'] });
      setEditTarget(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل تعديل المخالفة');
    },
  });

  // ============== Render ==============

  if (persona.isLoading || query.isLoading) return <SkeletonPage />;
  if (!canAccess) return <AccessDeniedCard />;

  return (
    <div className="space-y-4">
      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-500/10 dark:to-cyan-500/10 border-blue-200 dark:border-blue-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">مخالفاتي</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                المخالفات التي قدّمتها — يمكنك سحب أي طلب جديد خلال 30 دقيقة قبل بدء المراجعة.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <Link
              href="/dashboard/teacher/incidents/new"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              تسجيل مخالفة جديدة
            </Link>
          </div>
        </div>
      </div>

      {/* ============== Tabs ============== */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => {
          const count =
            t === tab
              ? filtered.length
              : (query.data ?? []).filter((r) => {
                  if (t === 'active') return r.status === 'submitted' || r.status === 'under_review';
                  if (t === 'decided') return r.status === 'dismissed' || r.status === 'actioned' || r.status === 'escalated';
                  return true;
                }).length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
                tab === t
                  ? 'border-blue-500 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {TAB_LABELS[t]}
              <span className="ms-2 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-mono">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ============== Body ============== */}
      {query.isError ? (
        <ErrorCard error={query.error} onRetry={() => query.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <IncidentCard
              key={row.id}
              row={row}
              onWithdraw={() => setWithdrawTarget(row)}
              onEdit={() => setEditTarget(row)}
            />
          ))}
        </div>
      )}

      {/* ============== Withdraw confirm modal ============== */}
      {withdrawTarget && (
        <WithdrawConfirmModal
          row={withdrawTarget}
          isPending={withdrawMutation.isPending}
          onCancel={() => setWithdrawTarget(null)}
          onConfirm={() => withdrawMutation.mutate(withdrawTarget.id)}
        />
      )}

      {/* ============== Edit modal ============== */}
      {editTarget && (
        <EditIncidentModal
          row={editTarget}
          isPending={editMutation.isPending}
          onCancel={() => setEditTarget(null)}
          onSave={(patch) => editMutation.mutate({ id: editTarget.id, patch })}
        />
      )}
    </div>
  );
}

// ============== Sub-components ==============

function AccessDeniedCard() {
  return (
    <div className="card border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            لا تملك صلاحية عرض هذه الصفحة
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
            هذه الصفحة مخصصة للمعلمين والإداريين المخولين بتقديم أو متابعة مخالفاتهم.
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="card border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            تعذّر تحميل المخالفات
          </p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-1">
            {error instanceof Error ? error.message : 'حاول تحديث الصفحة.'}
          </p>
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

function EmptyState({ tab }: { tab: Tab }) {
  const messages: Record<Tab, { title: string; sub: string }> = {
    active: {
      title: 'لا توجد مخالفات قيد المراجعة',
      sub: 'كل ما قدّمته تمت معالجته، أو أنك لم تقدّم شيئًا بعد.',
    },
    decided: {
      title: 'لا توجد مخالفات تم البت فيها',
      sub: 'ستظهر هنا المخالفات التي راجعها الوكيل أو المرشد.',
    },
    all: {
      title: 'لم تقدّم أي مخالفة بعد',
      sub: 'استخدم زر "تسجيل مخالفة جديدة" لبدء الإجراء.',
    },
  };
  const { title, sub } = messages[tab];
  return (
    <div className="card text-center py-12">
      <CheckCircle className="w-12 h-12 mx-auto mb-3 text-gray-400 opacity-50" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">{sub}</p>
    </div>
  );
}

function IncidentCard({
  row, onWithdraw, onEdit,
}: {
  row: IncidentRow;
  onWithdraw: () => void;
  onEdit: () => void;
}) {
  const statusLabel = INCIDENT_STATUS_LABELS[row.status as IncidentStatus] ?? row.status;
  const statusTone = STATUS_TONE[row.status as IncidentStatus] ?? STATUS_TONE.dismissed;
  const typeLabel = INCIDENT_TYPE_LABELS[row.incident_type as IncidentType] ?? row.incident_type;
  const severityLabel = INCIDENT_SEVERITY_LABELS[row.severity as IncidentSeverity] ?? row.severity;
  const severityTone = SEVERITY_TONE[row.severity as IncidentSeverity] ?? SEVERITY_TONE.medium;
  const withdrawable = isWithdrawable(row);

  // Decision payload (review_notes / action_taken) — what's shown
  // depends on which terminal state the reviewer flipped to.
  const decisionNote =
    row.status === 'dismissed' ? row.review_notes :
    row.status === 'actioned' ? row.action_taken :
    row.status === 'escalated' ? row.review_notes :
    null;
  const decisionLabel =
    row.status === 'dismissed' ? 'سبب الرفض' :
    row.status === 'actioned' ? 'الإجراء المتَّخذ' :
    row.status === 'escalated' ? 'سبب التصعيد' :
    null;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-bold">{row.student_name ?? '—'}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusTone}`}>
            {statusLabel}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${severityTone}`}>
            {severityLabel}
          </span>
        </div>
        {withdrawable && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              تعديل
            </button>
            <button
              type="button"
              onClick={onWithdraw}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20 text-red-700 dark:text-red-300 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              سحب
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-2 flex-wrap">
        <span className="flex items-center gap-1">
          <BookOpen className="w-3 h-3" />
          {typeLabel}
        </span>
        <span>•</span>
        <span className="font-mono">{row.incident_date}</span>
        <span>•</span>
        <span title={`قُدِّمت في ${row.submitted_at}`}>
          قُدِّمت {formatRelative(row.submitted_at)}
        </span>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
        {row.description}
      </p>

      {decisionNote && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-1">
            {decisionLabel}
            {row.reviewed_by_name && (
              <span className="ms-2 text-gray-500 dark:text-gray-500">
                — بواسطة {row.reviewed_by_name}
                {row.reviewed_at && ` · ${formatRelative(row.reviewed_at)}`}
              </span>
            )}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            {decisionNote}
          </p>
        </div>
      )}

      {row.status === 'actioned' && row.parent_notified && (
        <p className="mt-2 text-[11px] text-green-700 dark:text-green-400 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          تم إشعار ولي الأمر
        </p>
      )}
    </div>
  );
}

function WithdrawConfirmModal({
  row, isPending, onCancel, onConfirm,
}: {
  row: IncidentRow;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Recompute time remaining so the message stays honest if the
  // modal sits open for a while.
  const submittedMs = new Date(row.submitted_at).getTime();
  const remainingMs = WITHDRAW_WINDOW_MS - (Date.now() - submittedMs);
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60_000));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-red-50 dark:bg-red-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <h2 className="font-bold text-base">سحب المخالفة</h2>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            سيُحذف هذا الطلب نهائيًا، ولا يمكن استرجاعه. لو احتجت تسجيله لاحقًا، يلزم تقديمه من جديد.
          </p>
          <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">الطالب</p>
            <p className="text-sm font-medium">{row.student_name ?? '—'}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {row.incident_date} · {INCIDENT_TYPE_LABELS[row.incident_type as IncidentType] ?? row.incident_type}
            </p>
          </div>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {remainingMin > 0
              ? `الوقت المتبقّي للسحب: ${remainingMin} دقيقة`
              : 'مهلة السحب توشك على الانتهاء'}
          </p>
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="text-sm px-4 py-2 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="text-sm px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {isPending && <Clock className="w-3.5 h-3.5 animate-spin" />}
            تأكيد السحب
          </button>
        </div>
      </div>
    </div>
  );
}

function EditIncidentModal({
  row, isPending, onCancel, onSave,
}: {
  row: IncidentRow;
  isPending: boolean;
  onCancel: () => void;
  onSave: (_patch: Record<string, unknown>) => void;
}) {
  const [incidentType, setIncidentType] = useState<IncidentType>(row.incident_type as IncidentType);
  const [severity, setSeverity] = useState<IncidentSeverity>(row.severity as IncidentSeverity);
  const [incidentDate, setIncidentDate] = useState(row.incident_date);
  const [description, setDescription] = useState(row.description);

  // Same honesty as the withdraw modal — show how much of the 30-min
  // window remains.
  const submittedMs = new Date(row.submitted_at).getTime();
  const remainingMs = WITHDRAW_WINDOW_MS - (Date.now() - submittedMs);
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60_000));

  const descTooShort = description.trim().length < 20;

  const handleSave = () => {
    // Send only what actually changed — keeps the audit log's `fields`
    // meaningful.
    const patch: Record<string, unknown> = {};
    if (incidentType !== row.incident_type) patch.incident_type = incidentType;
    if (severity !== row.severity) patch.severity = severity;
    if (incidentDate !== row.incident_date) patch.incident_date = incidentDate;
    if (description.trim() !== row.description) patch.description = description.trim();
    if (Object.keys(patch).length === 0) {
      toast('لا توجد تغييرات للحفظ');
      return;
    }
    onSave(patch);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-500/10">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h2 className="font-bold text-base">تعديل المخالفة</h2>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="إغلاق"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">الطالب (لا يمكن تغييره — اسحب المخالفة وسجّل من جديد إذا أخطأت بالطالب)</p>
            <p className="text-sm font-medium">{row.student_name ?? '—'}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">نوع المخالفة</span>
              <select
                value={incidentType}
                onChange={(e) => setIncidentType(e.target.value as IncidentType)}
                className="input"
              >
                {INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الخطورة</span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                className="input"
              >
                {INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{INCIDENT_SEVERITY_LABELS[s]}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">تاريخ المخالفة</span>
            <input
              type="date"
              value={incidentDate}
              onChange={(e) => setIncidentDate(e.target.value)}
              max={todayInRiyadh()}
              className="input"
            />
          </label>

          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الوصف</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input min-h-[100px]"
              maxLength={2000}
            />
            <span className={`text-[11px] mt-1 block ${descTooShort ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {description.trim().length}/2000 — الحد الأدنى 20 حرفاً
            </span>
          </label>

          <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {remainingMin > 0
              ? `الوقت المتبقّي للتعديل: ${remainingMin} دقيقة`
              : 'مهلة التعديل توشك على الانتهاء'}
          </p>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="text-sm px-4 py-2 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || descTooShort}
            className="text-sm px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {isPending && <Clock className="w-3.5 h-3.5 animate-spin" />}
            حفظ التعديل
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'قبل لحظات';
  const min = Math.floor(sec / 60);
  if (min < 60) return `قبل ${min} دقيقة`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `قبل ${hr} ساعة`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `قبل ${day} يوم`;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
