// Reviewer queue (م3.13 — MVP scope).
//
// One page, one endpoint (GET /api/incidents/pending-review), inline
// modals for the two terminal decisions (dismiss / action). The
// dedicated detail page (م3.14) is deferred — the card on this list
// shows enough context for the common case, and the inline modal
// keeps reviewers fast.
//
// Gates (mirror the API):
//   - VIEW    super_admin OR review_teacher_incidents OR persona=counselor
//   - DECIDE  super_admin OR review_teacher_incidents
// Counselors see the queue (read-only); the action buttons are
// disabled with a tooltip explaining the flag requirement.
//
// Escalate (م3.9) creates a student_cases row from the incident via
// PATCH /api/incidents/[id]/escalate and links it back (case_id +
// status='escalated'). Surfaced through EscalateModal below — the
// case_type defaults from the incident type and the description is
// derived from the incident when the reviewer leaves it blank.

'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertCircle, AlertTriangle, ArrowUp, CheckCircle, ClipboardCheck,
  ClipboardX, Clock, Eye, FileText, Filter, RefreshCw, ShieldAlert,
  Users as UsersIcon, X,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPE_LABELS,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
} from '@/lib/incidents/types';

// ============== Types (mirror /api/incidents/pending-review response) ==============

interface PendingIncident {
  id: number;
  student_id: number;
  student_name: string | null;
  incident_date: string;
  incident_type: string;
  severity: string;
  description: string;
  status: string;
  submitted_by: string;
  submitted_by_name: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
}

const SEVERITY_TONE: Record<IncidentSeverity, string> = {
  low: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
  medium: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
  high: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
  critical: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
};

const STATUS_TONE: Record<IncidentStatus, string> = {
  submitted: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
  under_review: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
  dismissed: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  actioned: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300',
  escalated: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',
};

// ============== Page ==============

type DecisionMode = 'dismiss' | 'action';

export default function VpIncidentsReviewPage() {
  const { isSuperAdmin, isCounselor, isLoading: personaLoading, can } = usePersona();
  const canView = isSuperAdmin || can('review_teacher_incidents') || isCounselor;
  const canDecide = isSuperAdmin || can('review_teacher_incidents');

  const [minSeverity, setMinSeverity] = useState<IncidentSeverity | ''>('');
  const [decisionTarget, setDecisionTarget] = useState<
    { incident: PendingIncident; mode: DecisionMode } | null
  >(null);
  const [escalateTarget, setEscalateTarget] = useState<PendingIncident | null>(null);

  const queryClient = useQueryClient();

  const query = useQuery<PendingIncident[]>({
    queryKey: ['vp-incidents-pending', minSeverity],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (minSeverity) qs.set('min_severity', minSeverity);
      const path = qs.toString()
        ? `/api/incidents/pending-review?${qs}`
        : '/api/incidents/pending-review';
      const r = await fetch(path);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل قائمة المراجعة');
      }
      return ((await r.json()).data ?? []) as PendingIncident[];
    },
    enabled: !personaLoading && canView,
    // Queue refreshes every minute — new submissions appear without
    // a manual reload, decided rows drop off.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  // ============== Decision mutations ==============

  const dismissMutation = useMutation({
    mutationFn: async (vars: { incidentId: number; review_notes: string }) => {
      const r = await fetch(`/api/incidents/${vars.incidentId}/dismiss`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_notes: vars.review_notes }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل رفض المخالفة');
      return body.data;
    },
    onSuccess: () => {
      toast.success('تم رفض المخالفة');
      queryClient.invalidateQueries({ queryKey: ['vp-incidents-pending'] });
      setDecisionTarget(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل رفض المخالفة');
    },
  });

  const actionMutation = useMutation({
    mutationFn: async (vars: {
      incidentId: number;
      action_taken: string;
      parent_notified: boolean;
    }) => {
      const r = await fetch(`/api/incidents/${vars.incidentId}/action`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_taken: vars.action_taken,
          parent_notified: vars.parent_notified,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل تسجيل الإجراء');
      return body.data;
    },
    onSuccess: () => {
      toast.success('تم تسجيل الإجراء');
      queryClient.invalidateQueries({ queryKey: ['vp-incidents-pending'] });
      setDecisionTarget(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل تسجيل الإجراء');
    },
  });

  const escalateMutation = useMutation({
    mutationFn: async (vars: {
      incidentId: number;
      case_type?: string;
      description?: string;
    }) => {
      // Both fields optional — the endpoint derives case_type from the
      // incident type and description from the incident narrative when
      // omitted. We only send what the reviewer actually set.
      const payload: Record<string, unknown> = {};
      if (vars.case_type) payload.case_type = vars.case_type;
      if (vars.description) payload.description = vars.description;
      const r = await fetch(`/api/incidents/${vars.incidentId}/escalate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل تصعيد المخالفة');
      return body.data;
    },
    onSuccess: (data) => {
      const num = data?.case?.case_number;
      toast.success(num ? `تم التصعيد إلى الحالة ${num}` : 'تم تصعيد المخالفة إلى حالة');
      queryClient.invalidateQueries({ queryKey: ['vp-incidents-pending'] });
      setEscalateTarget(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل تصعيد المخالفة');
    },
  });

  const isPendingDecision = dismissMutation.isPending || actionMutation.isPending;

  // ============== Render branches ==============

  if (personaLoading) return <SkeletonPage />;

  if (!canView) {
    return (
      <div className="card text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
        <p className="text-sm font-medium">لا تملك صلاحية عرض قائمة المراجعة</p>
        <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
          يلزم super_admin أو صلاحية review_teacher_incidents أو دور المرشد.
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
              <ClipboardCheck className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">مراجعة المخالفات</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                المخالفات قيد المراجعة في نطاقك — مرتَّبة حسب الخطورة ثم تاريخ التقديم.
              </p>
              {!canDecide && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  وضع العرض فقط — البتّ يتطلب صلاحية review_teacher_incidents
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-500/30 hover:bg-purple-50 dark:hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      </div>

      {/* ============== Severity filter ============== */}
      <div className="card">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-600 dark:text-gray-400">الحد الأدنى للخطورة:</span>
          <button
            type="button"
            onClick={() => setMinSeverity('')}
            className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
              minSeverity === ''
                ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 font-medium'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            الكل
          </button>
          {INCIDENT_SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setMinSeverity(s)}
              className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
                minSeverity === s
                  ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {INCIDENT_SEVERITY_LABELS[s]} وأعلى
            </button>
          ))}
        </div>
      </div>

      {/* ============== Body ============== */}
      {query.isLoading ? (
        <SkeletonPage />
      ) : query.isError ? (
        <div className="card border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                تعذّر تحميل قائمة المراجعة
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                {query.error instanceof Error ? query.error.message : 'حاول التحديث.'}
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
      ) : (query.data ?? []).length === 0 ? (
        <div className="card text-center py-12">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-70" />
          <p className="text-sm font-medium">لا توجد مخالفات تنتظر مراجعتك</p>
          <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
            {minSeverity
              ? 'جرّب تخفيف فلتر الخطورة لعرض مخالفات أقل أهمية.'
              : 'كل المخالفات في نطاقك تمت معالجتها.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 px-1">
            {query.data!.length} مخالفة تنتظر القرار
          </p>
          {query.data!.map((incident) => (
            <IncidentReviewCard
              key={incident.id}
              incident={incident}
              canDecide={canDecide}
              onDismiss={() => setDecisionTarget({ incident, mode: 'dismiss' })}
              onAction={() => setDecisionTarget({ incident, mode: 'action' })}
              onEscalate={() => setEscalateTarget(incident)}
            />
          ))}
        </div>
      )}

      {/* ============== Decision modal ============== */}
      {decisionTarget && (
        <DecisionModal
          target={decisionTarget}
          isPending={isPendingDecision}
          onCancel={() => setDecisionTarget(null)}
          onConfirmDismiss={(notes) =>
            dismissMutation.mutate({ incidentId: decisionTarget.incident.id, review_notes: notes })
          }
          onConfirmAction={(action_taken, parent_notified) =>
            actionMutation.mutate({
              incidentId: decisionTarget.incident.id,
              action_taken,
              parent_notified,
            })
          }
        />
      )}

      {/* ============== Escalate modal ============== */}
      {escalateTarget && (
        <EscalateModal
          incident={escalateTarget}
          isPending={escalateMutation.isPending}
          onCancel={() => setEscalateTarget(null)}
          onConfirm={(case_type, description) =>
            escalateMutation.mutate({
              incidentId: escalateTarget.id,
              case_type,
              description,
            })
          }
        />
      )}
    </div>
  );
}

// ============== Card ==============

function IncidentReviewCard({
  incident, canDecide, onDismiss, onAction, onEscalate,
}: {
  incident: PendingIncident;
  canDecide: boolean;
  onDismiss: () => void;
  onAction: () => void;
  onEscalate: () => void;
}) {
  const typeLabel = INCIDENT_TYPE_LABELS[incident.incident_type as IncidentType] ?? incident.incident_type;
  const severityLabel = INCIDENT_SEVERITY_LABELS[incident.severity as IncidentSeverity] ?? incident.severity;
  const severityTone = SEVERITY_TONE[incident.severity as IncidentSeverity] ?? SEVERITY_TONE.medium;
  const statusLabel = INCIDENT_STATUS_LABELS[incident.status as IncidentStatus] ?? incident.status;
  const statusTone = STATUS_TONE[incident.status as IncidentStatus] ?? STATUS_TONE.submitted;
  const isCritical = incident.severity === 'critical';

  return (
    <div className={`card ${isCritical ? 'border-red-300 dark:border-red-500/40' : ''}`}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <UsersIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
        <span className="text-sm font-bold">{incident.student_name ?? '—'}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${severityTone}`}>
          {severityLabel}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusTone}`}>
          {statusLabel}
        </span>
        {isCritical && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-600 text-white flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" />
            عاجل
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-2 flex-wrap">
        <span>{typeLabel}</span>
        <span>•</span>
        <span className="font-mono">{incident.incident_date}</span>
        <span>•</span>
        <span>قدّمها {incident.submitted_by_name ?? '—'}</span>
        <span>•</span>
        <span title={`في ${incident.submitted_at}`}>{formatRelative(incident.submitted_at)}</span>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3 whitespace-pre-wrap">
        {incident.description}
      </p>

      {/* Actions row */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex-wrap">
        <button
          type="button"
          onClick={onAction}
          disabled={!canDecide}
          title={!canDecide ? 'يتطلب صلاحية review_teacher_incidents' : undefined}
          className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors ${
            canDecide
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
          }`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          سجّل إجراء
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={!canDecide}
          title={!canDecide ? 'يتطلب صلاحية review_teacher_incidents' : undefined}
          className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors ${
            canDecide
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
          }`}
        >
          <ClipboardX className="w-3.5 h-3.5" />
          ارفض
        </button>
        {/* Escalate — creates a student_cases row + links the incident. */}
        <button
          type="button"
          onClick={onEscalate}
          disabled={!canDecide}
          title={!canDecide ? 'يتطلب صلاحية review_teacher_incidents' : undefined}
          className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors ${
            canDecide
              ? 'bg-purple-600 hover:bg-purple-700 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
          }`}
        >
          <ArrowUp className="w-3.5 h-3.5" />
          صعِّد
        </button>
      </div>
    </div>
  );
}

// ============== Decision modal ==============

function DecisionModal({
  target, isPending, onCancel, onConfirmDismiss, onConfirmAction,
}: {
  target: { incident: PendingIncident; mode: DecisionMode };
  isPending: boolean;
  onCancel: () => void;
  onConfirmDismiss: (review_notes: string) => void;
  onConfirmAction: (action_taken: string, parent_notified: boolean) => void;
}) {
  const isDismiss = target.mode === 'dismiss';
  const [note, setNote] = useState('');
  const [parentNotified, setParentNotified] = useState(false);

  const noteTrimmed = note.trim();
  const noteShort = noteTrimmed.length < 10;
  const canSubmit = !noteShort && !isPending;

  const { incident } = target;
  const studentLabel = incident.student_name ?? '—';
  const typeLabel = INCIDENT_TYPE_LABELS[incident.incident_type as IncidentType] ?? incident.incident_type;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className={`p-4 border-b border-gray-200 dark:border-gray-700 ${
          isDismiss ? 'bg-red-50 dark:bg-red-500/10' : 'bg-green-50 dark:bg-green-500/10'
        }`}>
          <div className="flex items-center gap-2">
            {isDismiss ? (
              <ClipboardX className="w-5 h-5 text-red-600 dark:text-red-400" />
            ) : (
              <ClipboardCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
            )}
            <h2 className="font-bold text-base">
              {isDismiss ? 'رفض المخالفة' : 'تسجيل إجراء'}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">الطالب</p>
            <p className="text-sm font-medium">{studentLabel}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {typeLabel} · {incident.incident_date}
            </p>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-2 line-clamp-3">
              {incident.description}
            </p>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {isDismiss ? 'سبب الرفض' : 'الإجراء المتَّخذ'} <span className="text-red-500">*</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder={
                isDismiss
                  ? 'مثال: المخالفة بسيطة وعولجت مع المعلم مباشرة.'
                  : 'مثال: استدعاء ولي الأمر + إنذار خطي + متابعة لأسبوع.'
              }
              className={`w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 ${
                noteShort && noteTrimmed.length > 0
                  ? 'border-red-300 dark:border-red-500/50 focus:ring-red-500/30'
                  : 'border-gray-300 dark:border-gray-700 focus:ring-purple-500/30'
              }`}
            />
            <div className="flex items-center justify-between mt-0.5">
              <p className={`text-[11px] ${noteShort && noteTrimmed.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {noteShort && noteTrimmed.length > 0
                  ? `أضف ${10 - noteTrimmed.length} حرف على الأقل`
                  : '10 أحرف على الأقل'}
              </p>
              <p className="text-[10px] text-gray-400">{note.length} / 2000</p>
            </div>
          </div>

          {/* Action-only: parent notification checkbox */}
          {!isDismiss && (
            <label className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 cursor-pointer">
              <input
                type="checkbox"
                checked={parentNotified}
                onChange={(e) => setParentNotified(e.target.checked)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">إشعار ولي الأمر</p>
                <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">
                  يُسجَّل التوقيت الآن. إرسال الواتساب الفعلي يُفعَّل في م3.19.
                </p>
              </div>
            </label>
          )}
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
            onClick={() => {
              if (isDismiss) onConfirmDismiss(noteTrimmed);
              else onConfirmAction(noteTrimmed, parentNotified);
            }}
            className={`text-sm px-4 py-2 rounded-md text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors ${
              isDismiss ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {isPending && <Clock className="w-3.5 h-3.5 animate-spin" />}
            {isDismiss ? 'تأكيد الرفض' : 'تأكيد الإجراء'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== Escalate modal (م3.9) ==============

const CASE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'تلقائي (حسب نوع المخالفة)' },
  { value: 'behavioral', label: 'سلوكي' },
  { value: 'academic', label: 'أكاديمي' },
  { value: 'social', label: 'اجتماعي' },
  { value: 'health', label: 'صحي' },
  { value: 'family', label: 'عائلي' },
  { value: 'attendance', label: 'حضور' },
];

function EscalateModal({
  incident, isPending, onCancel, onConfirm,
}: {
  incident: PendingIncident;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (case_type: string | undefined, description: string | undefined) => void;
}) {
  const [caseType, setCaseType] = useState('');
  const [desc, setDesc] = useState('');

  const descTrimmed = desc.trim();
  // Description is optional — the endpoint derives one from the incident
  // when omitted. But if the reviewer types something, it must satisfy
  // the student_cases CHECK (≥20). So the rule is: empty OR ≥20.
  const descInvalid = descTrimmed.length > 0 && descTrimmed.length < 20;
  const canSubmit = !descInvalid && !isPending;

  const studentLabel = incident.student_name ?? '—';
  const typeLabel = INCIDENT_TYPE_LABELS[incident.incident_type as IncidentType] ?? incident.incident_type;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-purple-50 dark:bg-purple-500/10">
          <div className="flex items-center gap-2">
            <ArrowUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <h2 className="font-bold text-base">تصعيد إلى حالة إرشادية</h2>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">الطالب</p>
            <p className="text-sm font-medium">{studentLabel}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {typeLabel} · {incident.incident_date}
            </p>
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-400">
            سيتم إنشاء حالة إرشادية مرتبطة بهذه المخالفة، وتتحوّل حالة المخالفة إلى «صُعِّدت لحالة».
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              نوع الحالة
            </label>
            <select
              value={caseType}
              onChange={(e) => setCaseType(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            >
              {CASE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              وصف الحالة <span className="text-gray-400">(اختياري)</span>
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="يُشتق من نص المخالفة إن تُرك فارغًا. عند الكتابة: 20 حرفًا على الأقل."
              className={`w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 ${
                descInvalid
                  ? 'border-red-300 dark:border-red-500/50 focus:ring-red-500/30'
                  : 'border-gray-300 dark:border-gray-700 focus:ring-purple-500/30'
              }`}
            />
            {descInvalid && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                أضف {20 - descTrimmed.length} حرفًا أو اترك الحقل فارغًا.
              </p>
            )}
          </div>
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
            disabled={!canSubmit}
            onClick={() => onConfirm(caseType || undefined, descTrimmed || undefined)}
            className="text-sm px-4 py-2 rounded-md text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {isPending && <Clock className="w-3.5 h-3.5 animate-spin" />}
            تأكيد التصعيد
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== Helpers ==============

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
