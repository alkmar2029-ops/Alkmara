// VP teacher-leaves screen (م2.15 + م2.16).
//
// Tabs over a single endpoint:
//   - قيد البتّ (status=pending)
//   - مُعتمَدة  (status=approved)
//   - آخر 200 طلب (no status filter — the API caps at 200 ORDER BY
//     requested_at DESC; the tab label says so explicitly to set
//     the right expectation. Pagination is tech debt for later.)
//
// Filters apply to all tabs: date range (overlap semantics on the
// server). Teacher picker for filtering is deferred to a follow-up.
//
// Actions on pending rows: [اعتمد] / [ارفض] open a modal that shows
// the leave summary + an optional decision_note + an explicit
// approve-side warning (approval fans out to daily_teacher_absences,
// one row per day, which feeds today's substitution workflow).
//
// Create-leave (م2.16): "تسجيل طلب جديد" in the header opens
// CreateLeaveModal — teacher select reads /api/teachers (cached),
// date pickers with min/error guard + days preview, type + reason
// fields. POSTs to /api/vp/teacher-leaves and flips to pending tab.
//
// Gates (parity with the API):
//   - VIEW:   super_admin OR view_morning_dashboard
//   - WRITE (approve/reject + create): super_admin OR approve_teacher_leave
// View-only users see the table + filters; the action buttons appear
// but are disabled with tooltips.

'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertCircle, AlertTriangle, CheckCircle, ClipboardCheck, ClipboardX,
  Clock, FilePlus, FileText, Filter, RefreshCw, X, Eye,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';

// ============== Types ==============

type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
type LeaveType = 'sick' | 'personal' | 'official' | 'maternity' | 'pilgrimage' | 'other';

interface LeaveRow {
  id: number;
  teacher_user_id: string;
  teacher_name: string | null;
  start_date: string;
  end_date: string;
  leave_type: string;
  reason: string | null;
  status: string;
  requested_at: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  days_count: number;
}

type Tab = 'pending' | 'approved' | 'recent';

const TAB_LABELS: Record<Tab, string> = {
  pending: 'قيد البتّ',
  approved: 'مُعتمَدة',
  recent: 'آخر 200 طلب',
};

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  sick: 'مرضية',
  personal: 'شخصية',
  official: 'مأمورية',
  maternity: 'أمومة',
  pilgrimage: 'حج / عمرة',
  other: 'أخرى',
};

const STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'قيد البتّ',
  approved: 'مُعتمَدة',
  rejected: 'مرفوضة',
  cancelled: 'ملغاة',
};

const STATUS_TONE: Record<LeaveStatus, string> = {
  pending: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
  approved: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
  rejected: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
  cancelled: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};

// ============== Page ==============

export default function VpTeacherLeavesPage() {
  const { isSuperAdmin, isLoading: personaLoading, can } = usePersona();
  const canView = isSuperAdmin || can('view_morning_dashboard');
  const canDecide = isSuperAdmin || can('approve_teacher_leave');
  // Create gate matches POST /api/vp/teacher-leaves — same flag as
  // decide because admin entry is an approval-adjacent action.
  const canCreate = canDecide;

  const [tab, setTab] = useState<Tab>('pending');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [decisionTarget, setDecisionTarget] = useState<{
    leave: LeaveRow;
    mode: 'approved' | 'rejected';
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const queryClient = useQueryClient();

  // Query key includes the filters so cache slices stay separate per
  // (tab, from, to). When the user flips a tab we don't unnecessarily
  // re-query the previous slice.
  const leavesQuery = useQuery<LeaveRow[]>({
    queryKey: ['vp-leaves', tab, fromDate, toDate],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (tab === 'pending') qs.set('status', 'pending');
      else if (tab === 'approved') qs.set('status', 'approved');
      // 'recent' tab: no status filter → API returns ORDER BY
      // requested_at DESC LIMIT 200 across all statuses.
      if (fromDate) qs.set('start_date_from', fromDate);
      if (toDate) qs.set('end_date_to', toDate);

      const r = await fetch(`/api/vp/teacher-leaves?${qs}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل الإجازات');
      }
      return (await r.json()).data as LeaveRow[];
    },
    enabled: !personaLoading && canView,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async (vars: {
      teacher_user_id: string;
      start_date: string;
      end_date: string;
      leave_type: LeaveType;
      reason?: string;
    }) => {
      const r = await fetch('/api/vp/teacher-leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacher_user_id: vars.teacher_user_id,
          start_date: vars.start_date,
          end_date: vars.end_date,
          leave_type: vars.leave_type,
          ...(vars.reason ? { reason: vars.reason } : {}),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل تسجيل الطلب');
      return body.data as LeaveRow;
    },
    onSuccess: () => {
      toast.success('تم تسجيل طلب الإجازة');
      queryClient.invalidateQueries({ queryKey: ['vp-leaves'] });
      queryClient.invalidateQueries({ queryKey: ['vp-morning-summary'] });
      // The new request lives at status='pending' → flip to that tab so
      // the user sees their entry immediately without having to navigate.
      setTab('pending');
      setCreateOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل تسجيل الطلب');
    },
  });

  const decisionMutation = useMutation({
    mutationFn: async (vars: {
      leave_id: number;
      decision: 'approved' | 'rejected';
      decision_note?: string;
    }) => {
      const r = await fetch(`/api/vp/teacher-leaves/${vars.leave_id}/decision`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: vars.decision,
          ...(vars.decision_note ? { decision_note: vars.decision_note } : {}),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل تسجيل القرار');
      return body.data as LeaveRow;
    },
    onSuccess: (updated) => {
      const verb = updated.status === 'approved' ? 'تم اعتماد الطلب' : 'تم رفض الطلب';
      toast.success(verb);
      // Approval fans out to daily_teacher_absences → invalidate the
      // morning dashboard + absences/today queries too so VPs flipping
      // between screens see consistent state.
      queryClient.invalidateQueries({ queryKey: ['vp-leaves'] });
      queryClient.invalidateQueries({ queryKey: ['vp-morning-summary'] });
      queryClient.invalidateQueries({ queryKey: ['vp-absences-today'] });
      setDecisionTarget(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل تسجيل القرار');
    },
  });

  const counts = useMemo(() => {
    // The current query result only represents the active tab — we
    // can't compute "pending count" cheaply without a second query.
    // For the tab badge we render the count only when on that tab;
    // others show no number. A future micro-tweak could fire HEAD
    // count queries in parallel for the inactive tabs.
    const data = leavesQuery.data ?? [];
    return { current: data.length };
  }, [leavesQuery.data]);

  // ============== Render branches ==============

  if (personaLoading) return <SkeletonPage />;

  if (!canView) {
    return (
      <div className="card text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
        <p className="text-sm font-medium">لا تملك صلاحية عرض إجازات المعلمين</p>
        <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
          يلزم super_admin أو صلاحية view_morning_dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-500/10 dark:to-indigo-500/10 border-purple-200 dark:border-purple-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">إجازات المعلمين</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                مراجعة طلبات الإجازات واعتمادها أو رفضها
              </p>
              {!canDecide && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  وضع العرض فقط — البتّ يتطلب صلاحية approve_teacher_leave
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => leavesQuery.refetch()}
              disabled={leavesQuery.isFetching}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-500/30 hover:bg-purple-50 dark:hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${leavesQuery.isFetching ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              disabled={!canCreate}
              title={!canCreate ? 'يتطلب صلاحية approve_teacher_leave' : undefined}
              className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors ${
                canCreate
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 border border-gray-200 dark:border-gray-700 cursor-not-allowed'
              }`}
            >
              <FilePlus className="w-3.5 h-3.5" />
              تسجيل طلب جديد
            </button>
          </div>
        </div>
      </div>

      {/* ============== Tabs ============== */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
              tab === t
                ? 'border-purple-500 text-purple-700 dark:text-purple-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            {TAB_LABELS[t]}
            {tab === t && (
              <span className="ms-2 text-xs px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 font-mono">
                {counts.current}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ============== Filters bar ============== */}
      <div className="card">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <Filter className="w-3.5 h-3.5" />
            النطاق:
          </div>
          <DateField label="من" value={fromDate} onChange={setFromDate} />
          <DateField label="إلى" value={toDate} onChange={setToDate} />
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setFromDate(''); setToDate(''); }}
              className="text-xs px-2.5 py-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              مسح
            </button>
          )}
          <span className="text-[11px] text-gray-500 dark:text-gray-400 me-auto">
            تداخل: الإجازات التي تتقاطع مع النطاق المحدد
          </span>
        </div>
      </div>

      {/* ============== Body ============== */}
      {leavesQuery.isLoading ? (
        <SkeletonPage />
      ) : leavesQuery.isError ? (
        <div className="card border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                تعذّر تحميل الإجازات
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                {leavesQuery.error instanceof Error ? leavesQuery.error.message : 'حاول التحديث.'}
              </p>
              <button
                type="button"
                onClick={() => leavesQuery.refetch()}
                className="mt-3 text-xs px-3 py-1.5 rounded-md bg-red-100 hover:bg-red-200 dark:bg-red-500/20 dark:hover:bg-red-500/30 text-red-800 dark:text-red-300 transition-colors"
              >
                إعادة المحاولة
              </button>
            </div>
          </div>
        </div>
      ) : leavesQuery.data!.length === 0 ? (
        <EmptyState tab={tab} hasFilters={!!(fromDate || toDate)} />
      ) : (
        <LeavesTable
          rows={leavesQuery.data!}
          canDecide={canDecide}
          onDecide={(leave, mode) => setDecisionTarget({ leave, mode })}
        />
      )}

      {/* ============== Decision modal ============== */}
      {decisionTarget && (
        <DecisionModal
          target={decisionTarget}
          onCancel={() => setDecisionTarget(null)}
          onConfirm={(decision_note) =>
            decisionMutation.mutate({
              leave_id: decisionTarget.leave.id,
              decision: decisionTarget.mode,
              decision_note,
            })
          }
          isPending={decisionMutation.isPending}
        />
      )}

      {/* ============== Create modal ============== */}
      {createOpen && (
        <CreateLeaveModal
          onCancel={() => setCreateOpen(false)}
          onSubmit={(vars) => createMutation.mutate(vars)}
          isPending={createMutation.isPending}
        />
      )}
    </div>
  );
}

// ============== Sub-components ==============

function DateField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
      />
    </label>
  );
}

function EmptyState({ tab, hasFilters }: { tab: Tab; hasFilters: boolean }) {
  const messages: Record<Tab, { title: string; sub: string }> = {
    pending: {
      title: 'لا توجد طلبات تنتظر قرارك',
      sub: hasFilters
        ? 'حاول توسيع نطاق التاريخ أو مسح الفلاتر.'
        : 'كل الطلبات الحالية تمت معالجتها.',
    },
    approved: {
      title: 'لا توجد إجازات مُعتمَدة',
      sub: hasFilters
        ? 'لا إجازات معتمدة في النطاق المحدد.'
        : 'لم يُعتمَد أي طلب بعد.',
    },
    recent: {
      title: 'لا توجد طلبات في السجل',
      sub: hasFilters ? 'حاول توسيع نطاق التاريخ.' : 'لم يُقدَّم أي طلب بعد.',
    },
  };
  const { title, sub } = messages[tab];
  return (
    <div className="card text-center py-12">
      <ClipboardCheck className="w-12 h-12 mx-auto mb-3 text-gray-400 opacity-50" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">{sub}</p>
    </div>
  );
}

function LeavesTable({
  rows, canDecide, onDecide,
}: {
  rows: LeaveRow[];
  canDecide: boolean;
  onDecide: (leave: LeaveRow, mode: 'approved' | 'rejected') => void;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-600 dark:text-gray-400">
            <tr>
              <th className="text-start px-3 py-2 font-medium">المعلم</th>
              <th className="text-start px-3 py-2 font-medium">النوع</th>
              <th className="text-start px-3 py-2 font-medium">الفترة</th>
              <th className="text-start px-3 py-2 font-medium">الأيام</th>
              <th className="text-start px-3 py-2 font-medium">السبب</th>
              <th className="text-start px-3 py-2 font-medium">الحالة</th>
              <th className="text-start px-3 py-2 font-medium">تاريخ التقديم</th>
              <th className="text-end px-3 py-2 font-medium">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <LeaveRow
                key={r.id}
                row={r}
                canDecide={canDecide}
                onDecide={onDecide}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaveRow({
  row, canDecide, onDecide,
}: {
  row: LeaveRow;
  canDecide: boolean;
  onDecide: (leave: LeaveRow, mode: 'approved' | 'rejected') => void;
}) {
  const typeLabel = LEAVE_TYPE_LABELS[row.leave_type as LeaveType] ?? row.leave_type;
  const statusLabel = STATUS_LABELS[row.status as LeaveStatus] ?? row.status;
  const statusTone = STATUS_TONE[row.status as LeaveStatus] ?? STATUS_TONE.cancelled;
  const isPending = row.status === 'pending';

  return (
    <tr className="border-t border-gray-200 dark:border-gray-700/60 hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
      <td className="px-3 py-2 font-medium">{row.teacher_name ?? '—'}</td>
      <td className="px-3 py-2">{typeLabel}</td>
      <td className="px-3 py-2 font-mono text-xs">
        {row.start_date}
        {row.start_date !== row.end_date && (
          <>
            <span className="text-gray-400 mx-1">←</span>
            {row.end_date}
          </>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{row.days_count}</td>
      <td className="px-3 py-2 max-w-[200px]">
        <span
          className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2"
          title={row.reason ?? ''}
        >
          {row.reason || '—'}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusTone}`}>
          {statusLabel}
        </span>
        {row.decided_by_name && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
            بواسطة {row.decided_by_name}
          </p>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
        {formatDateTime(row.requested_at)}
      </td>
      <td className="px-3 py-2">
        {isPending ? (
          <div className="flex items-center gap-1 justify-end">
            <button
              type="button"
              onClick={() => onDecide(row, 'approved')}
              disabled={!canDecide}
              title={!canDecide ? 'يتطلب صلاحية approve_teacher_leave' : undefined}
              className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 ${
                canDecide
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
              }`}
            >
              <CheckCircle className="w-3 h-3" />
              اعتمد
            </button>
            <button
              type="button"
              onClick={() => onDecide(row, 'rejected')}
              disabled={!canDecide}
              title={!canDecide ? 'يتطلب صلاحية approve_teacher_leave' : undefined}
              className={`text-xs px-2 py-1 rounded-md flex items-center gap-1 ${
                canDecide
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
              }`}
            >
              <ClipboardX className="w-3 h-3" />
              ارفض
            </button>
          </div>
        ) : (
          <p
            className="text-[11px] text-gray-500 dark:text-gray-400 text-end line-clamp-2 max-w-[180px]"
            title={row.decision_note ?? ''}
          >
            {row.decision_note || '—'}
          </p>
        )}
      </td>
    </tr>
  );
}

function DecisionModal({
  target, onCancel, onConfirm, isPending,
}: {
  target: { leave: LeaveRow; mode: 'approved' | 'rejected' };
  onCancel: () => void;
  onConfirm: (decision_note: string) => void;
  isPending: boolean;
}) {
  const [note, setNote] = useState('');
  const isApprove = target.mode === 'approved';
  const { leave } = target;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className={`p-4 border-b border-gray-200 dark:border-gray-700 ${
          isApprove ? 'bg-green-50 dark:bg-green-500/10' : 'bg-red-50 dark:bg-red-500/10'
        }`}>
          <div className="flex items-center gap-2">
            {isApprove ? (
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            ) : (
              <ClipboardX className="w-5 h-5 text-red-600 dark:text-red-400" />
            )}
            <h2 className="font-bold text-base">
              {isApprove ? 'اعتماد طلب الإجازة' : 'رفض طلب الإجازة'}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <dl className="text-sm space-y-1.5">
            <SummaryRow label="المعلم" value={leave.teacher_name ?? '—'} />
            <SummaryRow
              label="النوع"
              value={LEAVE_TYPE_LABELS[leave.leave_type as LeaveType] ?? leave.leave_type}
            />
            <SummaryRow
              label="الفترة"
              value={
                leave.start_date === leave.end_date
                  ? leave.start_date
                  : `${leave.start_date} ← ${leave.end_date}`
              }
            />
            <SummaryRow label="عدد الأيام" value={String(leave.days_count)} />
            {leave.reason && <SummaryRow label="السبب" value={leave.reason} multiline />}
          </dl>

          {/* Approve warning — explicit about fan-out behaviour */}
          {isApprove && (
            <div className="px-3 py-2.5 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                  الاعتماد سيُنشئ <strong>{leave.days_count}</strong>{' '}
                  {leave.days_count === 1 ? 'يوم غياب فعلي' : 'أيام غياب فعلية'} ويؤثّر على حصص الانتظار في تلك الأيام.
                  {leave.days_count > 1 && (
                    <> أي تسجيل غياب يدوي سابق لنفس اليوم سيُحتفظ به (لا يُطمَس).</>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Decision note */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              ملاحظة القرار <span className="text-gray-400">(اختيارية)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={isApprove ? 'مثال: مُعتمَدة، عذر مقبول.' : 'مثال: تعارض مع امتحانات نهاية الفصل.'}
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            />
          </div>
        </div>

        {/* Footer */}
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
            onClick={() => onConfirm(note.trim())}
            disabled={isPending}
            className={`text-sm px-4 py-2 rounded-md text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors ${
              isApprove ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {isPending && <Clock className="w-3.5 h-3.5 animate-spin" />}
            {isApprove ? 'اعتماد' : 'رفض'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label, value, multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-gray-500 dark:text-gray-400 min-w-[80px]">{label}:</dt>
      <dd className={`flex-1 ${multiline ? '' : 'font-medium'}`}>{value}</dd>
    </div>
  );
}

// ============== Create-leave modal ==============

interface TeacherListItem {
  user_id: string;
  full_name: string | null;
  is_active: boolean;
}

function CreateLeaveModal({
  onCancel, onSubmit, isPending,
}: {
  onCancel: () => void;
  onSubmit: (vars: {
    teacher_user_id: string;
    start_date: string;
    end_date: string;
    leave_type: LeaveType;
    reason?: string;
  }) => void;
  isPending: boolean;
}) {
  const [teacherId, setTeacherId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('sick');
  const [reason, setReason] = useState('');

  // Teachers list — reuses the project's existing /api/teachers endpoint
  // (gated by requireRole(['admin']) so VPs pass). Cached for 5 minutes:
  // the teacher roster rarely changes within a session, and the same
  // dropdown is reused if the modal reopens. enabled=true on mount —
  // the modal is only mounted when canCreate is true (button enforces).
  const teachersQuery = useQuery<TeacherListItem[]>({
    queryKey: ['teachers-active'],
    queryFn: async () => {
      const r = await fetch('/api/teachers');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل المعلمين');
      }
      return ((await r.json()).data ?? []) as TeacherListItem[];
    },
    staleTime: 5 * 60_000,
  });

  // Filter + sort client-side. The endpoint returns ALL teachers (active
  // + inactive) and richer fields than we need — we just pick what's
  // safe to show in a dropdown.
  const teachers = useMemo(() => {
    const list = (teachersQuery.data ?? [])
      .filter((t) => t.is_active && t.full_name)
      .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ar'));
    return list;
  }, [teachersQuery.data]);

  // Client-side validation. The server validates again — these are just
  // for immediate UX (prevent obviously-bad submits).
  const dateOrderError =
    startDate && endDate && endDate < startDate
      ? 'تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية'
      : null;

  const canSubmit =
    !!teacherId && !!startDate && !!endDate && !dateOrderError && !isPending;

  // days_count preview matches the server's inclusive day math (see
  // teacher-leaves/route.ts). Pinned to noon (+03:00) so a UTC server
  // and a Riyadh client compute the same value (lib/dates/ksa rationale).
  const daysPreview = useMemo(() => {
    if (!startDate || !endDate || dateOrderError) return null;
    const a = new Date(`${startDate}T12:00:00+03:00`).getTime();
    const b = new Date(`${endDate}T12:00:00+03:00`).getTime();
    return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
  }, [startDate, endDate, dateOrderError]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-purple-50 dark:bg-purple-500/10">
          <div className="flex items-center gap-2">
            <FilePlus className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <h2 className="font-bold text-base">تسجيل طلب إجازة جديد</h2>
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1">
            الطلب يُحفظ بالحالة "قيد البتّ" — اعتماده لاحقًا يُنشئ غياب اليوم.
          </p>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {/* Teacher */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              المعلم <span className="text-red-500">*</span>
            </label>
            {teachersQuery.isLoading ? (
              <div className="h-9 bg-gray-100 dark:bg-gray-800 rounded-md animate-pulse" />
            ) : teachersQuery.isError ? (
              <div className="text-xs text-red-600 dark:text-red-400">
                {teachersQuery.error instanceof Error ? teachersQuery.error.message : 'تعذّر تحميل المعلمين'}
                <button
                  type="button"
                  onClick={() => teachersQuery.refetch()}
                  className="underline ms-2"
                >
                  أعد المحاولة
                </button>
              </div>
            ) : (
              <select
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30"
              >
                <option value="">— اختر معلمًا —</option>
                {teachers.map((t) => (
                  <option key={t.user_id} value={t.user_id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            )}
            {!teachersQuery.isLoading && teachers.length === 0 && !teachersQuery.isError && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                لا يوجد معلمون نشطون. يجب تنشيط المعلم قبل تسجيل إجازة له.
              </p>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                من <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                إلى <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30"
              />
            </div>
          </div>
          {dateOrderError && (
            <p className="text-[11px] text-red-600 dark:text-red-400 -mt-2">{dateOrderError}</p>
          )}
          {daysPreview !== null && (
            <p className="text-[11px] text-gray-600 dark:text-gray-400 -mt-2">
              المدة: <strong>{daysPreview}</strong> {daysPreview === 1 ? 'يوم' : 'أيام'}
            </p>
          )}

          {/* Leave type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              نوع الإجازة <span className="text-red-500">*</span>
            </label>
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            >
              {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => (
                <option key={t} value={t}>
                  {LEAVE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              السبب <span className="text-gray-400">(اختياري)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="مثال: مراجعة طبية في مستشفى الملك فيصل."
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            />
            <p className="text-[10px] text-gray-400 text-end mt-0.5">{reason.length} / 2000</p>
          </div>
        </div>

        {/* Footer */}
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
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                teacher_user_id: teacherId,
                start_date: startDate,
                end_date: endDate,
                leave_type: leaveType,
                reason: reason.trim() || undefined,
              })
            }
            className="text-sm px-4 py-2 rounded-md text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
          >
            {isPending && <Clock className="w-3.5 h-3.5 animate-spin" />}
            تسجيل الطلب
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  // Riyadh-local, day-month-year HH:MM. Stable across runtimes via Intl.
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return iso;
  }
}
