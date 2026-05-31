// VP substitutions screen (م2.13 — MVP scope).
//
// Three-column flow:
//   1. Left   — today's absent teachers (selectable cards)
//   2. Middle — the selected teacher's periods for today
//   3. Right  — top-N substitute candidates for the selected period
//
// Single-assign only: clicking "اختر" on a candidate fires POST
// /api/vp/substitutions/assign immediately. Bulk "اعتمد الكل" is
// deferred (explicit user decision — keeps the optimistic single
// path from competing with a pending draft set).
//
// Gates (match the API exactly):
//   - VIEW:  super_admin OR view_morning_dashboard
//   - WRITE: super_admin OR manage_substitutions
// VPs with view-only see candidates but every "اختر" / re-pick button
// is disabled with an inline reason. Mirrors requireManageSubstitutions
// server-side.
//
// Re-pick UX: when a slot already has a substitute, opening the panel
// surfaces an inline warning that picking again resets whatsapp_sent_at
// + acknowledged_at on the assignment row (per م2.8 logic). The
// endpoint does the reset; this UI just sets expectations.

'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertCircle, AlertTriangle, CheckCircle, Clock, Users as UsersIcon,
  RefreshCw, UserCheck, BookOpen, Eye, Coffee, ArrowLeft,
  Star, Shield, Calendar,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { usePersona } from '@/lib/hooks/usePersona';

// ============== Types (mirror API response shapes) ==============

interface PeriodSlot {
  day_of_week: number;
  period_number: number;
  section_id: number | null;
  section_name: string | null;
  grade_name: string | null;
  subject: string | null;
  duty_type: string; // 'class' | 'monitoring' | 'free'
  slot_assignable: boolean;
  substitute: {
    assignment_id: number;
    user_id: string;
    name: string | null;
  } | null;
}

interface AbsenceDetail {
  absence_id: number;
  teacher_user_id: string;
  teacher_name: string | null;
  reason: string | null;
  expected_return: string | null;
  reported_at: string;
  periods: PeriodSlot[];
  stats: {
    total_periods: number;
    class_periods: number;
    assigned: number;
    pending: number;
  };
}

interface AbsencesTodayResponse {
  date: string;
  day_of_week: number;
  absences: AbsenceDetail[];
}

interface SuggestCandidate {
  user_id: string;
  full_name: string | null;
  periods_today: number;
  substitutions_this_week: number;
  has_supervision_today: boolean;
  score: number;
  reasoning: string;
}

interface SuggestResponse {
  date: string;
  day_of_week: number;
  period_number: number;
  count: number;
  candidates: SuggestCandidate[];
}

// ============== Page ==============

export default function VpSubstitutionsPage() {
  const { isSuperAdmin, isLoading: personaLoading, can } = usePersona();
  const canView = isSuperAdmin || can('view_morning_dashboard');
  const canManage = isSuperAdmin || can('manage_substitutions');

  const [selectedAbsenceId, setSelectedAbsenceId] = useState<number | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);

  const queryClient = useQueryClient();

  const absencesQuery = useQuery<AbsencesTodayResponse>({
    queryKey: ['vp-absences-today'],
    queryFn: async () => {
      const r = await fetch('/api/vp/absences/today');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل تحميل الغياب');
      }
      return (await r.json()).data as AbsencesTodayResponse;
    },
    enabled: !personaLoading && canView,
    staleTime: 30_000,
  });

  // Derived: which absence is selected, and its day_of_week (for the
  // suggester query). Memoised so the suggestion query's deps stay
  // stable across renders that don't change the selection.
  const { selectedAbsence, dow } = useMemo(() => {
    const data = absencesQuery.data;
    if (!data || selectedAbsenceId === null) {
      return { selectedAbsence: null as AbsenceDetail | null, dow: null as number | null };
    }
    return {
      selectedAbsence: data.absences.find((a) => a.absence_id === selectedAbsenceId) ?? null,
      dow: data.day_of_week,
    };
  }, [absencesQuery.data, selectedAbsenceId]);

  // The selected period's PeriodSlot — drives the "re-pick" warning
  // when there's an existing substitute.
  const selectedSlot = useMemo<PeriodSlot | null>(() => {
    if (!selectedAbsence || selectedPeriod === null) return null;
    return selectedAbsence.periods.find((p) => p.period_number === selectedPeriod) ?? null;
  }, [selectedAbsence, selectedPeriod]);

  const suggestionsQuery = useQuery<SuggestResponse>({
    queryKey: [
      'vp-suggestions',
      selectedAbsence?.teacher_user_id ?? null,
      selectedPeriod,
      dow,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({
        day_of_week: String(dow!),
        period_number: String(selectedPeriod!),
        original_teacher_id: selectedAbsence!.teacher_user_id,
        limit: '5',
      });
      const r = await fetch(`/api/vp/substitutions/suggest?${qs}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error || 'فشل اقتراح البدلاء');
      }
      return (await r.json()).data as SuggestResponse;
    },
    enabled: !!selectedAbsence && selectedPeriod !== null && dow !== null,
    staleTime: 60_000,
  });

  const assignMutation = useMutation({
    mutationFn: async (vars: {
      absence_id: number;
      substitute_user_id: string;
      period_number: number;
    }) => {
      const r = await fetch('/api/vp/substitutions/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل إسناد البديل');
      return body.data;
    },
    onSuccess: () => {
      toast.success('تم إسناد البديل');
      // Both queries can be stale now:
      //  - absences/today carries the new substitute on the slot
      //  - suggestions: the picked teacher is now booked at this slot,
      //    so subsequent suggester runs at the same date+period would
      //    exclude them (bookedSet logic in suggester.ts).
      queryClient.invalidateQueries({ queryKey: ['vp-absences-today'] });
      queryClient.invalidateQueries({ queryKey: ['vp-suggestions'] });
      setSelectedPeriod(null); // close the right column — decision made
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل إسناد البديل');
    },
  });

  // ============== Render branches ==============

  if (personaLoading) return <SkeletonPage />;

  if (!canView) {
    return (
      <div className="card text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
        <p className="text-sm font-medium">لا تملك صلاحية عرض حصص الانتظار</p>
        <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
          يلزم دور super_admin أو صلاحية view_morning_dashboard.
        </p>
      </div>
    );
  }

  if (absencesQuery.isLoading) return <SkeletonPage />;

  if (absencesQuery.isError) {
    return (
      <div className="card border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              تعذّر تحميل قائمة الغياب
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
              {absencesQuery.error instanceof Error ? absencesQuery.error.message : 'حاول تحديث الصفحة.'}
            </p>
            <button
              type="button"
              onClick={() => absencesQuery.refetch()}
              className="mt-3 text-xs px-3 py-1.5 rounded-md bg-red-100 hover:bg-red-200 dark:bg-red-500/20 dark:hover:bg-red-500/30 text-red-800 dark:text-red-300 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        </div>
      </div>
    );
  }

  const data = absencesQuery.data!;

  return (
    <div className="space-y-4">
      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-500/10 dark:to-indigo-500/10 border-purple-200 dark:border-purple-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <UserCheck className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">حصص الانتظار</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                توزيع البدلاء على الحصص الفائتة اليوم — {data.date}
              </p>
              {!canManage && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  وضع العرض فقط — يتطلب الإسناد صلاحية manage_substitutions
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => absencesQuery.refetch()}
            disabled={absencesQuery.isFetching}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-500/30 hover:bg-purple-50 dark:hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${absencesQuery.isFetching ? 'animate-spin' : ''}`} />
            {absencesQuery.isFetching ? 'يحدّث الآن…' : 'تحديث'}
          </button>
        </div>
      </div>

      {/* ============== Empty state — no absences ============== */}
      {data.absences.length === 0 ? (
        <div className="card text-center py-16">
          <CheckCircle className="w-14 h-14 mx-auto mb-4 text-green-500 opacity-70" />
          <p className="text-base font-medium">لا يوجد معلمون غائبون اليوم</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            استمتع بيومك. شاشة الإسناد ستكون نشطة فور تسجيل أول حالة غياب.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* ============== Column 1: absent teachers ============== */}
          <AbsentColumn
            absences={data.absences}
            selectedId={selectedAbsenceId}
            onSelect={(id) => {
              setSelectedAbsenceId(id);
              setSelectedPeriod(null);
            }}
          />

          {/* ============== Column 2: periods of selected teacher ============== */}
          <PeriodsColumn
            absence={selectedAbsence}
            selectedPeriod={selectedPeriod}
            onPickPeriod={setSelectedPeriod}
            canManage={canManage}
          />

          {/* ============== Column 3: suggestions ============== */}
          <SuggestionsColumn
            slot={selectedSlot}
            periodNumber={selectedPeriod}
            suggestionsQuery={suggestionsQuery}
            absence={selectedAbsence}
            canManage={canManage}
            isAssigning={assignMutation.isPending}
            onPick={(substitute_user_id) =>
              assignMutation.mutate({
                absence_id: selectedAbsence!.absence_id,
                substitute_user_id,
                period_number: selectedPeriod!,
              })
            }
          />
        </div>
      )}
    </div>
  );
}

// ============== Column 1: absent teachers ==============

function AbsentColumn({
  absences, selectedId, onSelect,
}: {
  absences: AbsenceDetail[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-5 h-5 text-red-500" />
        <h2 className="font-bold text-base">الغائبون اليوم</h2>
        <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 font-mono">
          {absences.length}
        </span>
      </div>
      <ul className="space-y-2">
        {absences.map((a) => {
          const isSelected = a.absence_id === selectedId;
          const fullyCovered = a.stats.class_periods > 0 && a.stats.pending === 0;
          return (
            <li key={a.absence_id}>
              <button
                type="button"
                onClick={() => onSelect(a.absence_id)}
                aria-pressed={isSelected}
                className={`w-full text-start px-3 py-2.5 rounded-lg border transition-colors ${
                  isSelected
                    ? 'border-purple-400 dark:border-purple-500/60 bg-purple-50 dark:bg-purple-500/15'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {a.teacher_name ?? '—'}
                    </p>
                    {a.reason && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {a.reason}
                      </p>
                    )}
                  </div>
                  <div className="text-end flex-shrink-0">
                    <span
                      className={`text-xs font-mono font-bold ${
                        fullyCovered
                          ? 'text-green-700 dark:text-green-400'
                          : a.stats.pending > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {a.stats.assigned}/{a.stats.class_periods}
                    </span>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">حصص</p>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============== Column 2: periods of selected teacher ==============

function PeriodsColumn({
  absence, selectedPeriod, onPickPeriod, canManage,
}: {
  absence: AbsenceDetail | null;
  selectedPeriod: number | null;
  onPickPeriod: (period: number) => void;
  canManage: boolean;
}) {
  if (!absence) {
    return (
      <div className="card text-center py-12 text-gray-500 dark:text-gray-400">
        <UsersIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">اختر معلمًا غائبًا لعرض حصصه</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Calendar className="w-5 h-5 text-indigo-500 flex-shrink-0" />
          <h2 className="font-bold text-base truncate">
            حصص {absence.teacher_name ?? '—'}
          </h2>
        </div>
        <PeriodsStatsPill stats={absence.stats} />
      </div>

      {absence.periods.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          لا توجد حصص مجدولة لهذا المعلم اليوم
        </p>
      ) : (
        <ul className="space-y-1.5">
          {absence.periods.map((p) => (
            <PeriodRow
              key={p.period_number}
              period={p}
              isSelected={selectedPeriod === p.period_number}
              onPick={() => p.slot_assignable && onPickPeriod(p.period_number)}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PeriodsStatsPill({ stats }: { stats: AbsenceDetail['stats'] }) {
  const tone =
    stats.class_periods === 0
      ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
      : stats.pending === 0
      ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
      : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300';
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono ${tone}`}>
      {stats.assigned}/{stats.class_periods} حصة
    </span>
  );
}

function PeriodRow({
  period, isSelected, onPick, canManage,
}: {
  period: PeriodSlot;
  isSelected: boolean;
  onPick: () => void;
  canManage: boolean;
}) {
  // Visual differentiator by duty_type. Class is the only actionable
  // row — monitoring/free render in a muted style so the eye lands on
  // the actionable rows.
  const isClass = period.duty_type === 'class';
  const isMonitoring = period.duty_type === 'monitoring';
  const Icon = isClass ? BookOpen : isMonitoring ? Shield : Coffee;
  const label =
    isClass
      ? `${period.grade_name ?? ''} / ${period.section_name ?? ''}`
      : isMonitoring
      ? 'إشراف'
      : 'حصة فراغ';

  const hasSub = period.substitute !== null;
  const subStateLabel = hasSub
    ? `بديل: ${period.substitute!.name ?? '—'}`
    : 'بحاجة لبديل';

  // For monitoring/free rows: show the row but disable selection. For
  // class rows: actionable iff canManage (write gate) — view-only
  // VPs can still see the candidates by selecting, but the actual
  // "اختر" button on candidates is disabled. We keep selection open
  // for them so they can preview the suggester output.
  const actionable = isClass;

  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={!actionable}
        aria-pressed={isSelected}
        className={`w-full text-start px-3 py-2 rounded-lg border transition-colors ${
          !actionable
            ? 'border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 opacity-70 cursor-not-allowed'
            : isSelected
            ? 'border-purple-400 dark:border-purple-500/60 bg-purple-50 dark:bg-purple-500/15'
            : hasSub
            ? 'border-green-200 dark:border-green-500/30 bg-green-50/40 dark:bg-green-500/10 hover:bg-green-50 dark:hover:bg-green-500/15'
            : 'border-amber-200 dark:border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/10 hover:bg-amber-50 dark:hover:bg-amber-500/15'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold w-6 text-center text-gray-500 dark:text-gray-400">
            {period.period_number}
          </span>
          <Icon className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">
              {label}
              {period.subject && isClass && (
                <span className="text-[11px] text-gray-500 dark:text-gray-400 me-2">
                  · {period.subject}
                </span>
              )}
            </p>
            {isClass && (
              <p
                className={`text-[11px] mt-0.5 ${
                  hasSub
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {subStateLabel}
              </p>
            )}
          </div>
          {isClass && (
            <ArrowLeft
              className={`w-4 h-4 text-gray-400 flex-shrink-0 ${
                isSelected ? 'opacity-100' : 'opacity-40'
              }`}
            />
          )}
        </div>
      </button>
    </li>
  );
}

// ============== Column 3: suggestions ==============

function SuggestionsColumn({
  slot, periodNumber, suggestionsQuery, absence, canManage, isAssigning, onPick,
}: {
  slot: PeriodSlot | null;
  periodNumber: number | null;
  suggestionsQuery: ReturnType<typeof useQuery<SuggestResponse>>;
  absence: AbsenceDetail | null;
  canManage: boolean;
  isAssigning: boolean;
  onPick: (substitute_user_id: string) => void;
}) {
  if (!slot || periodNumber === null || !absence) {
    return (
      <div className="card text-center py-12 text-gray-500 dark:text-gray-400">
        <Star className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">اختر حصة من العمود الأوسط لعرض البدلاء المقترحين</p>
      </div>
    );
  }

  const hasExistingSub = slot.substitute !== null;
  const currentSubId = slot.substitute?.user_id ?? null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Star className="w-5 h-5 text-amber-500" />
        <h2 className="font-bold text-base">
          البدلاء المقترحون — الحصة {periodNumber}
        </h2>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
        {slot.grade_name ?? ''} / {slot.section_name ?? ''}
        {slot.subject && ` · ${slot.subject}`}
      </p>

      {hasExistingSub && (
        <div className="mb-3 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10">
          <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
            <strong>البديل الحالي:</strong> {slot.substitute!.name ?? '—'}.
            {' '}
            تغيير البديل سيُعيد حالة إشعار الواتساب والاستلام إلى البداية.
          </p>
        </div>
      )}

      {suggestionsQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : suggestionsQuery.isError ? (
        <div className="text-center py-6 text-red-600 dark:text-red-400">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-60" />
          <p className="text-sm">
            {suggestionsQuery.error instanceof Error
              ? suggestionsQuery.error.message
              : 'تعذّر اقتراح البدلاء'}
          </p>
          <button
            type="button"
            onClick={() => suggestionsQuery.refetch()}
            className="mt-2 text-xs underline"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : (suggestionsQuery.data?.candidates.length ?? 0) === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">لا يوجد بدلاء متاحون لهذه الحصة</p>
          <p className="text-[11px] mt-1">
            كل المعلمين النشطين إما مشغولون أو غائبون أو مُسنَدون لحصص أخرى الآن.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {suggestionsQuery.data!.candidates.map((c, i) => (
            <SuggestionCard
              key={c.user_id}
              rank={i + 1}
              candidate={c}
              isCurrent={c.user_id === currentSubId}
              canManage={canManage}
              isAssigning={isAssigning}
              onPick={() => onPick(c.user_id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionCard({
  rank, candidate, isCurrent, canManage, isAssigning, onPick,
}: {
  rank: number;
  candidate: SuggestCandidate;
  isCurrent: boolean;
  canManage: boolean;
  isAssigning: boolean;
  onPick: () => void;
}) {
  const disabled = !canManage || isAssigning || isCurrent;
  return (
    <li
      className={`px-3 py-2.5 rounded-lg border ${
        isCurrent
          ? 'border-green-300 dark:border-green-500/40 bg-green-50/50 dark:bg-green-500/10'
          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-[11px] font-bold w-5 text-center text-gray-500 dark:text-gray-400 mt-1">
          #{rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate flex-1 min-w-0">
              {candidate.full_name ?? '—'}
            </p>
            {isCurrent && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-200 dark:bg-green-500/30 text-green-800 dark:text-green-300 flex-shrink-0">
                البديل الحالي
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-mono flex-shrink-0">
              نقاط {candidate.score}
            </span>
          </div>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
            {candidate.reasoning}
          </p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <BookOpen className="w-3 h-3" />
              {candidate.periods_today} حصص اليوم
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {candidate.substitutions_this_week} انتظار هذا الأسبوع
            </span>
            {candidate.has_supervision_today && (
              <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <Shield className="w-3 h-3" />
                له إشراف اليوم
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          title={
            !canManage
              ? 'يتطلب صلاحية manage_substitutions'
              : isCurrent
              ? 'هذا البديل مُسنَد بالفعل'
              : undefined
          }
          className={`text-xs px-3 py-1.5 rounded-md transition-colors flex-shrink-0 ${
            disabled
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
              : 'bg-purple-600 hover:bg-purple-700 text-white'
          }`}
        >
          {isAssigning ? '...' : isCurrent ? 'مُسنَد' : 'اختر'}
        </button>
      </div>
    </li>
  );
}
