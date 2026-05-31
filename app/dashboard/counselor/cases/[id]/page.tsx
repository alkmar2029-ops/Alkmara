// Counselor case detail (م4.20) — read-only timeline.
//
// Replaces the prior placeholder. The screen merges four artefact streams
// — case_history, student_followup_plans, student_notes (linked by
// case_id), counseling_sessions (linked by case_id) — into one
// chronologically-sorted feed.
//
// Strictly READ-ONLY (per the user's standing rule):
//   - No "edit" / "update status" / "close case" buttons.
//   - No status-transition affordances; state-machine endpoints aren't
//     drafted yet.
//   - Decryption of counseling_sessions content is available to the
//     in-scope counselor via the per-session reveal button (م4.21.4);
//     every reveal calls decrypt_session_content, which logs an
//     action='decrypt' row to confidential_access_log. The plaintext is
//     fetched on demand (plain fetch, NOT react-query — so it isn't
//     cached) and dropped from memory on "hide".
//
// Content boundaries (echoes the API):
//   - content_encrypted is never requested.
//   - content_preview is shown with the same "ملخص غير مشفّر كتبه
//     المرشد" label as on the workspace shell.

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Activity, ArrowRight, ArrowRightCircle, Calendar, CheckCircle,
  ClipboardList, Eye, FileText, FolderOpen, KeyRound, Loader2, Lock,
  Plus, RefreshCw, RotateCcw, Shield, ShieldAlert, X,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';
import {
  allowedNextStatuses,
  isReopen,
  type CaseStatus,
} from '@/lib/cases/state-machine';
import {
  allowedNextPlanStatuses,
  type PlanStatus,
} from '@/lib/plans/state-machine';

// =====================================================================
// Types — mirror the API response shape
// =====================================================================

interface CaseCore {
  id: number;
  case_number: string;
  title: string;
  description: string;
  case_type: string;
  severity: string;
  status: string;
  resolution: string | null;
  close_reason: string | null;
  reopen_count: number;
  is_reopened: boolean;
  related_case_id: number | null;
  student_id: number;
  student_name: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface HistoryEntry {
  id: number;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

interface PlanEntry {
  id: number;
  title: string;
  description: string;
  status: string;
  milestones: unknown;
  progress_notes: string | null;
  target_date: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface NoteEntry {
  id: number;
  text: string;
  type: string;
  source: string;
  is_confidential: boolean;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
}

interface SessionEntry {
  id: number;
  session_date: string;
  session_type: string;
  topic: string;
  duration_minutes: number | null;
  content_preview: string | null;
  counselor_user_id: string;
  counselor_name: string | null;
  created_at: string;
  updated_at: string;
}

interface CaseDetailResponse {
  case: CaseCore;
  history: HistoryEntry[];
  plans: PlanEntry[];
  notes: NoteEntry[];
  sessions: SessionEntry[];
}

// =====================================================================
// Labels + tones
// =====================================================================

const SEVERITY_LABEL: Record<string, string> = {
  low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة', critical: 'حرجة',
};
const SEVERITY_CLASS: Record<string, string> = {
  low:      'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400 border-green-200 dark:border-green-500/30',
  medium:   'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  high:     'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border-orange-200 dark:border-orange-500/30',
  critical: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border-red-200 dark:border-red-500/30',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'محلولة', closed: 'مغلقة',
};
const STATUS_CLASS: Record<string, string> = {
  open:        'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',
  in_progress: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  resolved:    'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400 border-teal-200 dark:border-teal-500/30',
  closed:      'bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:border-slate-500/30',
};

const CASE_TYPE_LABEL: Record<string, string> = {
  academic: 'أكاديمي', behavioral: 'سلوكي', social: 'اجتماعي',
  health: 'صحي', family: 'عائلي', attendance: 'حضور',
};

const SESSION_TYPE_LABEL: Record<string, string> = {
  individual: 'جلسة فردية', group: 'جلسة جماعية', family: 'جلسة عائلية',
  parent: 'لقاء ولي أمر',  assessment: 'تقييم', follow_up: 'متابعة',
  emergency: 'طارئة',
};

const PLAN_STATUS_LABEL: Record<string, string> = {
  active: 'نشطة', on_hold: 'متوقفة', completed: 'مكتملة', cancelled: 'ملغاة',
};

// =====================================================================
// Merged-timeline event types
// =====================================================================

type EventKind = 'session' | 'plan' | 'note' | 'history';
interface TimelineEvent {
  kind: EventKind;
  at: string; // ISO timestamp used for sort
  payload: SessionEntry | PlanEntry | NoteEntry | HistoryEntry;
}

function mergeTimeline(data: CaseDetailResponse): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  // session_date is a DATE (no time) — append a midday Riyadh time so the
  // sort is stable against created_at of same-day events.
  for (const s of data.sessions) {
    events.push({ kind: 'session', at: `${s.session_date}T12:00:00+03:00`, payload: s });
  }
  for (const p of data.plans) {
    events.push({ kind: 'plan', at: p.created_at, payload: p });
  }
  for (const n of data.notes) {
    events.push({ kind: 'note', at: n.recorded_at, payload: n });
  }
  for (const h of data.history) {
    events.push({ kind: 'history', at: h.changed_at, payload: h });
  }
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events;
}

// =====================================================================
// Page
// =====================================================================

export default function CounselorCaseDetail({ params }: { params: { id: string } }) {
  const { isSuperAdmin, isCounselor, isLoading: personaLoading } = usePersona();
  const canView = isSuperAdmin || isCounselor;
  const caseId = params.id;

  const query = useQuery<CaseDetailResponse>({
    queryKey: ['counselor-case-detail', caseId],
    queryFn: async () => {
      const r = await fetch(`/api/counselor/cases/${encodeURIComponent(caseId)}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const err = new Error(body?.error || 'فشل تحميل تفاصيل الحالة');
        (err as any).status = r.status;
        throw err;
      }
      return (await r.json()).data as CaseDetailResponse;
    },
    enabled: !personaLoading && canView,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: (count, err) => ((err as any)?.status === 404 ? false : count < 2),
  });

  const events = useMemo(() => (query.data ? mergeTimeline(query.data) : []), [query.data]);

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
    const status = (query.error as any)?.status;
    const msg = status === 404
      ? 'الحالة غير موجودة أو خارج نطاقك.'
      : 'فشل تحميل تفاصيل الحالة. حاول التحديث.';
    return (
      <div className="space-y-3">
        <div className="card text-center py-12 text-red-500">
          <p className="text-sm">{msg}</p>
          <Link
            href="/dashboard/counselor/cases"
            className="inline-flex items-center gap-1 mt-4 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
            العودة إلى لوحة الحالات
          </Link>
        </div>
      </div>
    );
  }

  const c = query.data.case;

  return (
    <div className="space-y-4">
      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-500/10 dark:to-purple-500/10 border-indigo-200 dark:border-indigo-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
              <FolderOpen className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{c.case_number}</span>
                <Badge tone={SEVERITY_CLASS[c.severity]}>{SEVERITY_LABEL[c.severity] ?? c.severity}</Badge>
                <Badge tone={STATUS_CLASS[c.status]}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                <Badge tone="bg-gray-50 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300 border-gray-200 dark:border-gray-600">
                  {CASE_TYPE_LABEL[c.case_type] ?? c.case_type}
                </Badge>
                {c.is_reopened && (
                  <Badge tone="bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border-orange-200 dark:border-orange-500/30">
                    أُعيد فتحها ({c.reopen_count})
                  </Badge>
                )}
              </div>
              <h1 className="text-xl font-bold mb-1 leading-snug">{c.title}</h1>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {c.student_name ?? '—'}
                <> · أنشأها {c.created_by_name ?? '—'}</>
                <> · {c.created_at.slice(0, 10)}</>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <Link
              href="/dashboard/counselor/cases"
              className="text-xs px-2.5 py-1.5 rounded-lg bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 flex items-center gap-1.5"
            >
              <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              اللوحة
            </Link>
          </div>
        </div>

        <p className="mt-3 text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-line">
          {c.description}
        </p>

        {/* status-specific extras */}
        {(c.resolution || c.close_reason) && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {c.resolution && (
              <div className="p-2 rounded bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30">
                <p className="font-medium text-teal-800 dark:text-teal-300 mb-0.5">قرار الحل</p>
                <p className="text-teal-900 dark:text-teal-200 whitespace-pre-line">{c.resolution}</p>
              </div>
            )}
            {c.close_reason && (
              <div className="p-2 rounded bg-slate-50 dark:bg-slate-500/10 border border-slate-200 dark:border-slate-500/30">
                <p className="font-medium text-slate-800 dark:text-slate-300 mb-0.5">سبب الإغلاق</p>
                <p className="text-slate-900 dark:text-slate-200 whitespace-pre-line">{c.close_reason}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============== Confidential-access notice ============== */}
      <div className="card border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5">
        <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <KeyRound className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            عرض محتوى الجلسات المشفّر متاح للمرشد المختصّ — وكل عملية فكّ تشفير تُسجَّل في سجلّ الوصول السرّي باسمك ووقتها.
          </span>
        </p>
      </div>

      {/* ============== State-machine status bar (م4.22) ============== */}
      <CaseStatusBar caseId={caseId} currentStatus={c.status as CaseStatus} />

      {/* ============== Summary chips ============== */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryChip icon={Calendar}      label="جلسات"    count={query.data.sessions.length} tone="teal" />
        <SummaryChip icon={ClipboardList} label="خطط متابعة" count={query.data.plans.length}    tone="amber" />
        <SummaryChip icon={FileText}      label="ملاحظات"   count={query.data.notes.length}    tone="indigo" />
        <SummaryChip icon={Activity}      label="سجل الحالة" count={query.data.history.length} tone="slate" />
      </div>

      {/* ============== Add-note form (م4.21.1) ============== */}
      <AddNoteCard caseId={caseId} />

      {/* ============== Add-plan form (م4.21.2) ============== */}
      <AddPlanCard caseId={caseId} />

      {/* ============== Add-session form (م4.21.3) ============== */}
      <AddSessionCard caseId={caseId} />

      {/* ============== Merged timeline ============== */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-base">السجل الزمني الموحَّد</h2>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {events.length} حدث
          </span>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
            لا توجد أنشطة مرتبطة بهذه الحالة بعد.
          </p>
        ) : (
          <ol className="space-y-3 relative ps-6 before:absolute before:top-0 before:bottom-0 before:start-2 before:w-px before:bg-gray-200 dark:before:bg-gray-700">
            {events.map((e, i) => (
              <EventRow key={`${e.kind}-${i}`} event={e} caseId={caseId} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap font-medium ${tone}`}>
      {children}
    </span>
  );
}

function SummaryChip({
  icon: Icon, label, count, tone,
}: {
  icon: any; label: string; count: number; tone: 'teal' | 'amber' | 'indigo' | 'slate';
}) {
  const cls: Record<string, string> = {
    teal:   'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400 border-teal-200 dark:border-teal-500/30',
    amber:  'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30',
    slate:  'bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:border-slate-500/30',
  };
  return (
    <div className={`card border ${cls[tone]} flex items-center justify-between !p-2.5`}>
      <span className="text-xs flex items-center gap-1.5">
        <Icon className="w-4 h-4 opacity-70" />
        {label}
      </span>
      <span className="font-bold text-lg">{count}</span>
    </div>
  );
}

// =====================================================================
// Event row — switch on kind
// =====================================================================

function EventRow({ event, caseId }: { event: TimelineEvent; caseId: string }) {
  switch (event.kind) {
    case 'session':
      return <SessionRow s={event.payload as SessionEntry} caseId={caseId} />;
    case 'plan':
      return <PlanRow p={event.payload as PlanEntry} caseId={caseId} />;
    case 'note':
      return <NoteRow n={event.payload as NoteEntry} />;
    case 'history':
      return <HistoryRow h={event.payload as HistoryEntry} />;
  }
}

function TimelineDot({
  icon: Icon, tone,
}: { icon: any; tone: 'teal' | 'amber' | 'indigo' | 'slate' }) {
  const cls: Record<string, string> = {
    teal:   'bg-teal-500',
    amber:  'bg-amber-500',
    indigo: 'bg-indigo-500',
    slate:  'bg-slate-500',
  };
  return (
    <span className={`absolute -start-1.5 top-0 w-5 h-5 rounded-full flex items-center justify-center ${cls[tone]}`}>
      <Icon className="w-3 h-3 text-white" />
    </span>
  );
}

function SessionRow({ s, caseId }: { s: SessionEntry; caseId: string }) {
  // Encrypted content is fetched ON DEMAND via a plain fetch (NOT
  // react-query) so the decrypted plaintext is never cached — it lives
  // only in this component's state while revealed, and is dropped on
  // "hide". Each reveal logs an action='decrypt' audit row server-side.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reveal = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/counselor/cases/${encodeURIComponent(caseId)}/sessions/${encodeURIComponent(String(s.id))}`,
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل فكّ تشفير المحتوى');
      }
      const body = await r.json();
      setRevealed(String(body?.data?.content ?? ''));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل فكّ تشفير المحتوى');
    } finally {
      setLoading(false);
    }
  };

  const hide = () => {
    setRevealed(null);
    setErr(null);
  };

  return (
    <li className="relative pb-1">
      <TimelineDot icon={Calendar} tone="teal" />
      <div className="ms-4 p-3 rounded-lg border border-teal-200 dark:border-teal-500/30 bg-teal-50/40 dark:bg-teal-500/5">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <Badge tone="bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400 border-teal-200 dark:border-teal-500/30">
              جلسة
            </Badge>
            <span className="text-xs font-medium">{SESSION_TYPE_LABEL[s.session_type] ?? s.session_type}</span>
          </div>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{s.session_date}</span>
        </div>
        <p className="text-sm font-medium">{s.topic}</p>
        {s.duration_minutes != null && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            المدة: {s.duration_minutes} دقيقة
          </p>
        )}
        {s.content_preview && (
          <div className="mt-2 p-2 rounded bg-white/70 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/40">
            <div className="flex items-center gap-1 mb-1">
              <Eye className="w-3 h-3 text-gray-400" />
              <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                ملخص غير مشفّر كتبه المرشد
              </span>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line">{s.content_preview}</p>
          </div>
        )}

        {/* Decrypted content (م4.21.4) — only present while revealed. */}
        {revealed !== null && (
          <div className="mt-2 p-2 rounded bg-rose-50/70 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] text-rose-700 dark:text-rose-400 font-medium flex items-center gap-1">
                <Lock className="w-3 h-3" />
                المحتوى المشفّر — سُجِّل وصولك إليه
              </span>
              <button
                type="button"
                onClick={hide}
                className="text-[10px] px-2 py-0.5 rounded text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/15 inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                إخفاء
              </button>
            </div>
            <p className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-line leading-relaxed">
              {revealed || '(لا محتوى)'}
            </p>
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
          {revealed === null ? (
            <button
              type="button"
              onClick={reveal}
              disabled={loading}
              title="فكّ تشفير محتوى الجلسة — يُسجَّل في سجلّ الوصول السرّي"
              className="text-[11px] px-2 py-1 rounded border border-teal-300 dark:border-teal-500/40 text-teal-700 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-500/15 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
              {loading ? 'جارٍ فكّ التشفير…' : 'عرض محتوى الجلسة المشفّر'}
            </button>
          ) : (
            <span />
          )}
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            بقلم {s.counselor_name ?? '—'}
          </span>
        </div>
        {err && (
          <p className="mt-1 text-[10px] text-red-700 dark:text-red-400">{err}</p>
        )}
      </div>
    </li>
  );
}

function PlanRow({ p, caseId }: { p: PlanEntry; caseId: string }) {
  const milestoneCount = Array.isArray(p.milestones) ? p.milestones.length : 0;
  return (
    <li className="relative pb-1">
      <TimelineDot icon={ClipboardList} tone="amber" />
      <div className="ms-4 p-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/5">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <Badge tone="bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30">
              خطة متابعة
            </Badge>
            <Badge tone="bg-gray-50 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300 border-gray-200 dark:border-gray-600">
              {PLAN_STATUS_LABEL[p.status] ?? p.status}
            </Badge>
            {milestoneCount > 0 && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{milestoneCount} معالم</span>
            )}
          </div>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{p.created_at.slice(0, 10)}</span>
        </div>
        <p className="text-sm font-medium mb-1">{p.title}</p>
        <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line">{p.description}</p>
        {p.target_date && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">الموعد المستهدف: {p.target_date}</p>
        )}
        {p.progress_notes && (
          <div className="mt-2 p-2 rounded bg-white/70 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/40">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">ملاحظات التقدم (غير مشفّرة):</p>
            <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line">{p.progress_notes}</p>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
          <PlanTransitionBar planId={p.id} caseId={caseId} currentStatus={p.status as PlanStatus} />
          <span className="text-[10px] text-gray-400 dark:text-gray-500">بقلم {p.created_by_name ?? '—'}</span>
        </div>
      </div>
    </li>
  );
}

// =====================================================================
// PlanTransitionBar — inline lifecycle buttons inside PlanRow
// =====================================================================
// Renders only the chips for `allowedNextPlanStatuses(currentStatus)`.
// Terminal plans (completed/cancelled) render nothing — the terminal
// lock is enforced both client-side (no buttons) and server-side (RPC
// 422). No reason text required for any plan transition.

function PlanTransitionBar({
  planId, caseId, currentStatus,
}: {
  planId: number;
  caseId: string;
  currentStatus: PlanStatus;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<PlanStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const nexts = allowedNextPlanStatuses(currentStatus);
  if (nexts.length === 0) {
    // Terminal — no actions. (Empty render keeps the spec strict.)
    return null;
  }

  const TONE: Record<string, string> = {
    active:    'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/25',
    on_hold:   'bg-slate-50 dark:bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30 hover:bg-slate-100 dark:hover:bg-slate-500/25',
    completed: 'bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-500/30 hover:bg-teal-100 dark:hover:bg-teal-500/25',
    cancelled: 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30 hover:bg-rose-100 dark:hover:bg-rose-500/25',
  };
  const LABEL: Record<string, string> = {
    active:    'استئناف',
    on_hold:   'تعليق',
    completed: 'إكمال',
    cancelled: 'إلغاء',
  };

  const mutate = async (to: PlanStatus) => {
    setBusy(to);
    setErr(null);
    try {
      const r = await fetch(
        `/api/counselor/cases/${encodeURIComponent(caseId)}/plans/${encodeURIComponent(String(planId))}/transition`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_status: to }),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحويل الخطة');
      }
      toast.success('تم تحويل الخطة');
      queryClient.invalidateQueries({ queryKey: ['counselor-case-detail', caseId] });
      queryClient.invalidateQueries({ queryKey: ['counselor-workspace-summary'] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل تحويل الخطة');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {nexts.map((to) => (
        <button
          key={to}
          onClick={() => mutate(to)}
          disabled={busy !== null}
          className={`text-[11px] px-2 py-1 rounded border flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${TONE[to]}`}
        >
          {busy === to && <Loader2 className="w-3 h-3 animate-spin" />}
          {LABEL[to]}
        </button>
      ))}
      {err && (
        <span className="text-[10px] text-red-700 dark:text-red-400 ms-2">{err}</span>
      )}
    </div>
  );
}

function NoteRow({ n }: { n: NoteEntry }) {
  return (
    <li className="relative pb-1">
      <TimelineDot icon={n.is_confidential ? ShieldAlert : FileText} tone="indigo" />
      <div className={`ms-4 p-3 rounded-lg border ${
        n.is_confidential
          ? 'border-rose-200 dark:border-rose-500/30 bg-rose-50/40 dark:bg-rose-500/5'
          : 'border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/40 dark:bg-indigo-500/5'
      }`}>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <Badge tone={n.is_confidential
              ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200 dark:border-rose-500/30'
              : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30'}>
              {n.is_confidential ? 'ملاحظة سرية' : 'ملاحظة'}
            </Badge>
            <Badge tone="bg-gray-50 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300 border-gray-200 dark:border-gray-600">
              {n.type === 'positive' ? 'إيجابية' : 'سلبية'}
            </Badge>
          </div>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{n.recorded_at.slice(0, 10)}</span>
        </div>
        <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line">{n.text}</p>
        <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">بقلم {n.recorded_by_name ?? '—'}</p>
      </div>
    </li>
  );
}

// =====================================================================
// CaseStatusBar — state-machine transitions (م4.22)
// =====================================================================
// Renders ONLY the buttons for transitions allowed from the current
// status (per `allowedNextStatuses`). Clicking a button expands an
// inline panel:
//   - resolved      → textarea for `resolution`   (min 20)
//   - closed        → textarea for `close_reason` (min 5)
//   - open (reopen) → textarea for `reopen_reason` (min 10)
//   - open (rollback from in_progress) → no reason textarea
//   - in_progress   → no reason textarea
//
// On success: invalidate the three React Query keys the case touches
// (case detail, the parent case list, and the workspace summary).
// The DB's case_history trigger writes the timeline row automatically,
// so the refetched detail picks it up.

interface TransitionDef {
  to: CaseStatus;
  label: string;
  // Tailwind utility bag for the button surface.
  btnClass: string;
  // The textarea label and validation rule. null = no reason needed.
  reasonField: 'resolution' | 'close_reason' | 'reopen_reason' | null;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonMin?: number;
  icon: React.ComponentType<{ className?: string }>;
}

function buildTransitions(from: CaseStatus): TransitionDef[] {
  const nexts = allowedNextStatuses(from);
  return nexts.map<TransitionDef>((to) => {
    if (to === 'in_progress') {
      return {
        to, label: 'بدء المعالجة', icon: ArrowRightCircle,
        btnClass: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/25 border-amber-200 dark:border-amber-500/30',
        reasonField: null,
      };
    }
    if (to === 'resolved') {
      return {
        to, label: 'حل الحالة', icon: CheckCircle,
        btnClass: 'bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-500/25 border-teal-200 dark:border-teal-500/30',
        reasonField: 'resolution',
        reasonLabel: 'قرار الحل',
        reasonPlaceholder: 'كيف حُلَّت الحالة؟ (20 حرفًا على الأقل)',
        reasonMin: 20,
      };
    }
    if (to === 'closed') {
      return {
        to, label: 'إغلاق الحالة', icon: Lock,
        btnClass: 'bg-slate-50 dark:bg-slate-500/15 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-500/25 border-slate-200 dark:border-slate-500/30',
        reasonField: 'close_reason',
        reasonLabel: 'سبب الإغلاق',
        reasonPlaceholder: 'لماذا تُغلق هذه الحالة؟ (5 أحرف على الأقل)',
        reasonMin: 5,
      };
    }
    // to === 'open' — distinguish reopen vs rollback by source
    if (isReopen(from, to)) {
      return {
        to, label: 'إعادة فتح', icon: RotateCcw,
        btnClass: 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/25 border-rose-200 dark:border-rose-500/30',
        reasonField: 'reopen_reason',
        reasonLabel: 'سبب إعادة الفتح',
        reasonPlaceholder: 'لماذا تُعاد الحالة للمتابعة؟ (10 أحرف على الأقل)',
        reasonMin: 10,
      };
    }
    // in_progress → open (rollback, no reason required)
    return {
      to, label: 'إرجاع للمفتوحة', icon: ArrowRight,
      btnClass: 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 border-indigo-200 dark:border-indigo-500/30',
      reasonField: null,
    };
  });
}

function CaseStatusBar({ caseId, currentStatus }: { caseId: string; currentStatus: CaseStatus }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<TransitionDef | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [serverErr, setServerErr] = useState<string | null>(null);

  const transitions = useMemo(() => buildTransitions(currentStatus), [currentStatus]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!pending) throw new Error('لا انتقال محدَّد');
      const body: Record<string, unknown> = { to_status: pending.to };
      if (pending.reasonField) {
        body[pending.reasonField] = reasonText.trim();
      }
      const r = await fetch(`/api/counselor/cases/${encodeURIComponent(caseId)}/transition`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error(errBody?.error || 'فشل تنفيذ التحويل');
      }
      return (await r.json()).data;
    },
    onSuccess: () => {
      toast.success('تم تحويل حالة الحالة');
      // Invalidate the 3 queries the new state touches.
      queryClient.invalidateQueries({ queryKey: ['counselor-case-detail', caseId] });
      queryClient.invalidateQueries({ queryKey: ['counselor-cases'] });
      queryClient.invalidateQueries({ queryKey: ['counselor-workspace-summary'] });
      setPending(null);
      setReasonText('');
      setServerErr(null);
    },
    onError: (err: unknown) => {
      setServerErr(err instanceof Error ? err.message : 'فشل تنفيذ التحويل');
    },
  });

  if (transitions.length === 0) {
    // Should not happen for our 4 statuses, but defensive.
    return null;
  }

  // Closed state — show the action row.
  if (!pending) {
    return (
      <div className="card !p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-600 dark:text-gray-400 me-1">تغيير الحالة:</span>
          {transitions.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.to}
                onClick={() => { setPending(t); setReasonText(''); setServerErr(null); }}
                className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1.5 font-medium ${t.btnClass}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Expanded — show the (optional) reason textarea + confirm.
  const submitting = mutation.isPending;
  const reasonOk = pending.reasonField == null
    || (reasonText.trim().length >= (pending.reasonMin ?? 0));
  const canSubmit = reasonOk && !submitting;

  return (
    <div className="card border-2 border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <pending.icon className="w-5 h-5 opacity-70" />
          <h2 className="font-bold text-base">{pending.label}</h2>
        </div>
        <button
          onClick={() => { setPending(null); setReasonText(''); setServerErr(null); }}
          disabled={submitting}
          className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1"
        >
          <X className="w-3.5 h-3.5" />
          إلغاء
        </button>
      </div>

      {pending.reasonField && (
        <div>
          <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
            {pending.reasonLabel} <span className="text-rose-500">*</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 ms-1">
              ({pending.reasonMin} حرفًا على الأقل)
            </span>
          </label>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            disabled={submitting}
            placeholder={pending.reasonPlaceholder}
            rows={3}
            maxLength={2000}
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60"
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {reasonText.length}/2000
          </p>
        </div>
      )}

      {!pending.reasonField && (
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
          سيتم التحويل مباشرة بدون نص إضافي.
        </p>
      )}

      {serverErr && (
        <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/30 mt-2">
          {serverErr}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          onClick={() => mutation.mutate()}
          disabled={!canSubmit}
          className="text-sm px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {submitting ? 'جاري التحويل…' : 'تأكيد التحويل'}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// AddNoteCard — first write affordance on the case detail (م4.21.1)
// =====================================================================
// Toggle a small inline form to POST a case-linked note. Defaults to
// is_confidential=TRUE — counselor's primary use is private notes.
// Honest UI: closed state shows ONLY the "+ إضافة ملاحظة" button so
// the timeline keeps the read-only feel; the form expands only when
// the counselor wants to write.
//
// On success: react-hot-toast confirmation + invalidate the case-detail
// query so the new note appears in the merged timeline + reset form.

function AddNoteCard({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [type, setType] = useState<'positive' | 'negative'>('negative');
  const [isConfidential, setIsConfidential] = useState(true);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/counselor/cases/${encodeURIComponent(caseId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          type,
          is_confidential: isConfidential,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل إضافة الملاحظة');
      }
      return (await r.json()).data;
    },
    onSuccess: () => {
      toast.success('تمت إضافة الملاحظة');
      // Invalidate the case-detail query so the new note appears in
      // the merged timeline without a manual refresh.
      queryClient.invalidateQueries({ queryKey: ['counselor-case-detail', caseId] });
      // Also nudge the workspace summary (note count + recent list).
      queryClient.invalidateQueries({ queryKey: ['counselor-workspace-summary'] });
      // Reset + close
      setText('');
      setType('negative');
      setIsConfidential(true);
      setServerErr(null);
      setOpen(false);
    },
    onError: (err: unknown) => {
      setServerErr(err instanceof Error ? err.message : 'فشل إضافة الملاحظة');
    },
  });

  if (!open) {
    return (
      <div className="card !p-3 flex items-center justify-between gap-3 border-dashed border-gray-300 dark:border-gray-700">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          سجِّل ملاحظة قصيرة على الحالة. الإجراءات الكبرى (جلسة / خطة) تأتي في م4.21.2+.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/25 flex items-center gap-1.5 font-medium"
        >
          <Plus className="w-3.5 h-3.5" />
          إضافة ملاحظة
        </button>
      </div>
    );
  }

  const submitting = mutation.isPending;
  const canSubmit = text.trim().length > 0 && !submitting;

  return (
    <div className="card border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/30 dark:bg-indigo-500/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-500" />
          <h2 className="font-bold text-base">ملاحظة جديدة</h2>
        </div>
        <button
          onClick={() => { setOpen(false); setServerErr(null); }}
          disabled={submitting}
          className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1"
        >
          <X className="w-3.5 h-3.5" />
          إلغاء
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
            النص <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting}
            placeholder="اكتب الملاحظة هنا — تجنّب الأسرار التي تستحق جلسة مشفّرة."
            rows={4}
            maxLength={2000}
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60"
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {text.length}/2000
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <fieldset className="flex items-center gap-3">
            <span className="text-xs text-gray-700 dark:text-gray-300">النوع:</span>
            <label className="text-xs flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="note-type"
                checked={type === 'negative'}
                onChange={() => setType('negative')}
                disabled={submitting}
              />
              سلبية
            </label>
            <label className="text-xs flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="note-type"
                checked={type === 'positive'}
                onChange={() => setType('positive')}
                disabled={submitting}
              />
              إيجابية
            </label>
          </fieldset>

          <label className="text-xs flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isConfidential}
              onChange={(e) => setIsConfidential(e.target.checked)}
              disabled={submitting}
            />
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
            سرية (تُحجَب عن غير المرشدين)
          </label>
        </div>

        {serverErr && (
          <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/30">
            {serverErr}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="text-sm px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'جاري الحفظ…' : 'حفظ الملاحظة'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// AddPlanCard — second write affordance (م4.21.2)
// =====================================================================
// Mirrors AddNoteCard structurally: closed-by-default button, inline
// form on expand. The form holds:
//   - title (≥10 chars, matches the DB CHECK)
//   - description (≥20 chars, matches the DB CHECK)
//   - target_date (optional)
//   - milestones (dynamic rows: date + description; status defaults
//     server-side to 'pending'. No status picker yet — the lifecycle
//     UI lands when the state-machine endpoint exists.)
// New plans always go in at status='active' (DB default). Lifecycle
// transitions are NOT exposed here.

interface PlanFormMilestone {
  date: string;
  description: string;
}

function AddPlanCard({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [milestones, setMilestones] = useState<PlanFormMilestone[]>([]);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      // Filter out empty milestone rows — the user may have added a
      // blank row by mistake. Sending them would fail the Zod min(1)
      // check, so we drop them client-side too.
      const cleanedMilestones = milestones
        .map((m) => ({ date: m.date.trim(), description: m.description.trim() }))
        .filter((m) => m.date && m.description);

      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        milestones: cleanedMilestones,
      };
      if (targetDate) payload.target_date = targetDate;

      const r = await fetch(
        `/api/counselor/cases/${encodeURIComponent(caseId)}/plans`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل إضافة الخطة');
      }
      return (await r.json()).data;
    },
    onSuccess: () => {
      toast.success('تمت إضافة الخطة');
      queryClient.invalidateQueries({ queryKey: ['counselor-case-detail', caseId] });
      queryClient.invalidateQueries({ queryKey: ['counselor-workspace-summary'] });
      setTitle('');
      setDescription('');
      setTargetDate('');
      setMilestones([]);
      setServerErr(null);
      setOpen(false);
    },
    onError: (err: unknown) => {
      setServerErr(err instanceof Error ? err.message : 'فشل إضافة الخطة');
    },
  });

  if (!open) {
    return (
      <div className="card !p-3 flex items-center justify-between gap-3 border-dashed border-gray-300 dark:border-gray-700">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          أنشئ خطة متابعة. الـ status يبدأ نشطة؛ التحويلات (تعليق/إكمال/إلغاء) في م4.21.4+.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/25 flex items-center gap-1.5 font-medium"
        >
          <Plus className="w-3.5 h-3.5" />
          إضافة خطة متابعة
        </button>
      </div>
    );
  }

  const submitting = mutation.isPending;
  const canSubmit =
    title.trim().length >= 10 &&
    description.trim().length >= 20 &&
    !submitting;

  return (
    <div className="card border-amber-200 dark:border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-amber-500" />
          <h2 className="font-bold text-base">خطة متابعة جديدة</h2>
        </div>
        <button
          onClick={() => { setOpen(false); setServerErr(null); }}
          disabled={submitting}
          className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1"
        >
          <X className="w-3.5 h-3.5" />
          إلغاء
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
            العنوان <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            placeholder="عنوان مختصر للخطة (≥10 أحرف)"
            maxLength={200}
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-60"
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {title.length}/200 · الحد الأدنى 10
          </p>
        </div>

        <div>
          <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
            الوصف <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            placeholder="وصف الخطة وأهدافها (≥20 حرفًا). تجنّب الأسرار التي تستحق جلسة مشفّرة."
            rows={3}
            maxLength={2000}
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-60"
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {description.length}/2000 · الحد الأدنى 20
          </p>
        </div>

        <div>
          <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
            الموعد المستهدف
          </label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            disabled={submitting}
            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-60"
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            اختياري — تاريخ إنجاز الخطة المتوقع.
          </p>
        </div>

        {/* Milestones */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-700 dark:text-gray-300">
              المعالم
              <span className="text-[10px] text-gray-400 dark:text-gray-500 ms-1">
                (اختياري — حتى 20)
              </span>
            </label>
            {milestones.length < 20 && (
              <button
                type="button"
                onClick={() => setMilestones([...milestones, { date: '', description: '' }])}
                disabled={submitting}
                className="text-[11px] px-2 py-1 rounded bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/25 disabled:opacity-50 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                إضافة معلَم
              </button>
            )}
          </div>
          {milestones.length === 0 ? (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 py-2">
              لا معالم بعد. تبدأ الخطة بدون معالم — يمكن إضافتها لاحقًا.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {milestones.map((m, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={m.date}
                    onChange={(e) => {
                      const next = [...milestones];
                      next[i] = { ...next[i], date: e.target.value };
                      setMilestones(next);
                    }}
                    disabled={submitting}
                    className="text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 disabled:opacity-60"
                  />
                  <input
                    type="text"
                    value={m.description}
                    onChange={(e) => {
                      const next = [...milestones];
                      next[i] = { ...next[i], description: e.target.value };
                      setMilestones(next);
                    }}
                    disabled={submitting}
                    placeholder="وصف المعلَم"
                    maxLength={200}
                    className="flex-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setMilestones(milestones.filter((_, j) => j !== i))}
                    disabled={submitting}
                    className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/15 rounded p-1 disabled:opacity-50"
                    title="حذف هذا المعلَم"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {serverErr && (
          <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/30">
            {serverErr}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="text-sm px-4 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'جاري الحفظ…' : 'حفظ الخطة'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// AddSessionCard — third write affordance (م4.21.3)
// =====================================================================
// THE encrypted write surface. Sends plaintext content + content_preview
// to /api/counselor/cases/[id]/sessions, which:
//   - reads COUNSELING_SESSION_KEY server-side
//   - calls create_counseling_session RPC via service-role admin client
//   - RPC encrypts content inline with pgp_sym_encrypt + writes the
//     confidential_access_log audit row in the same transaction
//   - returns only {id} — never the plaintext or ciphertext
// The UI mirrors that: only "تمت إضافة الجلسة" toast on success, then
// invalidate the case detail query so the new session metadata shows
// in the timeline. The response is never inspected for content.
//
// UI hierarchy:
//   - session_type select + session_date input (header row)
//   - topic input (the searchable plaintext label)
//   - duration_minutes (optional)
//   - CONTENT textarea (encrypted on the wire to the DB)
//   - WARNING banner: content_preview is plaintext-by-design
//   - content_preview textarea (≤160, optional)
// The warning is visually loud (rose border + AlertTriangle) so a
// counselor can't accidentally treat preview as a private continuation
// of content.

interface SessionFormState {
  session_date: string;
  session_type: string;
  topic: string;
  duration_minutes: string;  // string so the input stays empty when blank
  content: string;
  content_preview: string;
}

const SESSION_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'individual', label: 'جلسة فردية' },
  { value: 'group',      label: 'جلسة جماعية' },
  { value: 'family',     label: 'جلسة عائلية' },
  { value: 'parent',     label: 'لقاء ولي أمر' },
  { value: 'assessment', label: 'تقييم' },
  { value: 'follow_up',  label: 'متابعة' },
  { value: 'emergency',  label: 'طارئة' },
];

function todayInRiyadhClient(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function AddSessionCard({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SessionFormState>(() => ({
    session_date: todayInRiyadhClient(),
    session_type: 'individual',
    topic: '',
    duration_minutes: '',
    content: '',
    content_preview: '',
  }));
  const [serverErr, setServerErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        session_date: form.session_date,
        session_type: form.session_type,
        topic: form.topic.trim(),
        content: form.content.trim(),
      };
      if (form.content_preview.trim()) payload.content_preview = form.content_preview.trim();
      if (form.duration_minutes.trim()) {
        const n = parseInt(form.duration_minutes, 10);
        if (Number.isFinite(n)) payload.duration_minutes = n;
      }
      const r = await fetch(
        `/api/counselor/cases/${encodeURIComponent(caseId)}/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل إنشاء الجلسة');
      }
      return (await r.json()).data;
    },
    onSuccess: () => {
      toast.success('تمت إضافة الجلسة');
      queryClient.invalidateQueries({ queryKey: ['counselor-case-detail', caseId] });
      queryClient.invalidateQueries({ queryKey: ['counselor-workspace-summary'] });
      // Reset entire form state (especially clearing content from memory ASAP).
      setForm({
        session_date: todayInRiyadhClient(),
        session_type: 'individual',
        topic: '',
        duration_minutes: '',
        content: '',
        content_preview: '',
      });
      setServerErr(null);
      setOpen(false);
    },
    onError: (err: unknown) => {
      setServerErr(err instanceof Error ? err.message : 'فشل إنشاء الجلسة');
    },
  });

  if (!open) {
    return (
      <div className="card !p-3 flex items-center justify-between gap-3 border-dashed border-gray-300 dark:border-gray-700">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          سجِّل جلسة استشارية. المحتوى يُشفَّر تلقائيًا قبل الحفظ، ولا يُسترَد في هذه الشاشة.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-500/25 flex items-center gap-1.5 font-medium"
        >
          <Plus className="w-3.5 h-3.5" />
          تسجيل جلسة جديدة
        </button>
      </div>
    );
  }

  const submitting = mutation.isPending;
  const canSubmit =
    form.topic.trim().length > 0 &&
    form.content.trim().length > 0 &&
    !submitting;

  const setField = (k: keyof SessionFormState, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  return (
    <div className="card border-teal-200 dark:border-teal-500/30 bg-teal-50/30 dark:bg-teal-500/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-teal-500" />
          <h2 className="font-bold text-base">جلسة جديدة</h2>
        </div>
        <button
          onClick={() => { setOpen(false); setServerErr(null); }}
          disabled={submitting}
          className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1"
        >
          <X className="w-3.5 h-3.5" />
          إلغاء
        </button>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
              النوع <span className="text-rose-500">*</span>
            </label>
            <select
              value={form.session_type}
              onChange={(e) => setField('session_type', e.target.value)}
              disabled={submitting}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-60"
            >
              {SESSION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
              التاريخ <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              value={form.session_date}
              onChange={(e) => setField('session_date', e.target.value)}
              disabled={submitting}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
              المدة (دقيقة)
            </label>
            <input
              type="number"
              min={1}
              max={240}
              value={form.duration_minutes}
              onChange={(e) => setField('duration_minutes', e.target.value)}
              disabled={submitting}
              placeholder="1-240"
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-60"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
            الموضوع <span className="text-rose-500">*</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 ms-1">
              (مرئي للجميع في نطاق الرؤية — لا تكتب أسرارًا)
            </span>
          </label>
          <input
            type="text"
            value={form.topic}
            onChange={(e) => setField('topic', e.target.value)}
            disabled={submitting}
            placeholder="عنوان موجز للجلسة"
            maxLength={200}
            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-60"
          />
        </div>

        <div>
          <label className="text-xs text-gray-700 dark:text-gray-300 block mb-1">
            <span className="inline-flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              محتوى الجلسة <span className="text-rose-500">*</span>
            </span>
            <span className="text-[10px] text-teal-700 dark:text-teal-400 ms-1 font-medium">
              (يُشفَّر تلقائيًا قبل الحفظ — pgp_sym_encrypt)
            </span>
          </label>
          <textarea
            value={form.content}
            onChange={(e) => setField('content', e.target.value)}
            disabled={submitting}
            placeholder="السرد التفصيلي للجلسة. يُشفَّر تلقائيًا قبل الحفظ ولا يُسترَد في هذه الشاشة."
            rows={6}
            maxLength={20000}
            className="w-full text-sm rounded-lg border-2 border-teal-300 dark:border-teal-500/40 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-60"
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {form.content.length}/20000
          </p>
        </div>

        {/* ============== WARNING for content_preview ============== */}
        <div className="rounded-lg border-2 border-rose-400 dark:border-rose-500/60 bg-rose-50 dark:bg-rose-500/10 p-3">
          <div className="flex items-start gap-2 mb-2">
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-rose-800 dark:text-rose-300">
                ⚠ ملخص غير مشفّر
              </p>
              <p className="text-xs text-rose-700 dark:text-rose-400 mt-0.5">
                هذا الحقل يُخزَّن نصًا عاديًا في قاعدة البيانات (يظهر في القوائم بدون فك تشفير).
                <strong className="block mt-1">
                  لا تكتب فيه أسرارًا أو تفاصيل حساسة — اكتفِ بكلمة أو سطر يصف نوع الموضوع
                  فقط (مثلًا: «قلق امتحان»، «خلاف عائلي»). التفاصيل تذهب في «محتوى الجلسة» المُشفَّر أعلاه.
                </strong>
              </p>
            </div>
          </div>
          <textarea
            value={form.content_preview}
            onChange={(e) => setField('content_preview', e.target.value)}
            disabled={submitting}
            placeholder="ملخص قصير (اختياري) ≤ 160 حرفًا"
            rows={2}
            maxLength={160}
            className="w-full text-sm rounded-lg border border-rose-300 dark:border-rose-500/40 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-500/40 disabled:opacity-60"
          />
          <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5 font-mono">
            {form.content_preview.length}/160
          </p>
        </div>

        {serverErr && (
          <div className="text-xs p-2 rounded bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/30">
            {serverErr}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="text-sm px-4 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'جاري التشفير والحفظ…' : 'حفظ الجلسة'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ h }: { h: HistoryEntry }) {
  return (
    <li className="relative pb-1">
      <TimelineDot icon={Activity} tone="slate" />
      <div className="ms-4 p-3 rounded-lg border border-slate-200 dark:border-slate-500/30 bg-slate-50/40 dark:bg-slate-500/5">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <Badge tone="bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:border-slate-500/30">
              تغيير حالة
            </Badge>
            <span className="text-xs">
              {h.from_status ? (
                <>
                  <span className="text-gray-500 dark:text-gray-400">{STATUS_LABEL[h.from_status] ?? h.from_status}</span>
                  <span className="mx-1.5 text-gray-400">←</span>
                </>
              ) : (
                <span className="text-gray-500 dark:text-gray-400">إنشاء</span>
                )}
              <span className="font-medium">{STATUS_LABEL[h.to_status] ?? h.to_status}</span>
            </span>
          </div>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
            {h.changed_at.slice(0, 16).replace('T', ' ')}
          </span>
        </div>
        {h.reason && (
          <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line mt-1">{h.reason}</p>
        )}
        <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">بواسطة {h.changed_by_name ?? 'النظام'}</p>
      </div>
    </li>
  );
}
