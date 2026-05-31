// Teacher submission form (م3.12).
//
// One screen, one POST. The submit flow is:
//   1. Fill form (student + date + type + severity + description)
//   2. "تسجيل" → confirmation modal with the warning text
//   3. Confirm → POST /api/incidents → on success, redirect back
//      to the my-incidents list with a toast.
//
// Validation mirrors the API:
//   - student_id required
//   - description >= 20 chars (matches DB CHECK + Zod min)
//   - end-to-end errors surfaced as toasts (the server returns a
//     generic 403 if the student is outside scope, which is the
//     correct UX — see the م3.4 docstring for the privacy
//     rationale).
//
// Student picker: search-as-you-type against
// /api/incidents/students/search — a dedicated endpoint that
// scopes teachers via teacher_section_assignments EXPLICITLY
// (Codex Sprint 3 fifth review: don't trust the generic
// /api/students RLS for this sensitive picker — a stale policy
// would let a teacher see every student).

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertCircle, AlertTriangle, ArrowRight, Check,
  Clock, FilePlus, Search,
} from 'lucide-react';
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  type IncidentType,
  type IncidentSeverity,
} from '@/lib/incidents/types';
import { usePersona } from '@/lib/hooks/usePersona';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

interface StudentResult {
  id: number;
  first_name: string;
  father_name: string | null;
  last_name: string;
  grade_name?: string | null;
  section_name?: string | null;
}

function studentDisplayName(s: StudentResult): string {
  const parts = [s.first_name, s.father_name, s.last_name].filter(Boolean);
  return parts.join(' ');
}

function todayInRiyadh(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ============== Page ==============

export default function NewIncidentPage() {
  const router = useRouter();
  const persona = usePersona();
  const role = persona.data?.role;
  const canAccess = role === 'teacher' || role === 'admin' || role === 'super_admin';

  // Form state
  const [studentId, setStudentId] = useState<number | null>(null);
  const [studentDisplay, setStudentDisplay] = useState('');
  const [studentMeta, setStudentMeta] = useState<{ grade?: string; section?: string }>({});
  const [incidentDate, setIncidentDate] = useState(() => todayInRiyadh());
  const [incidentType, setIncidentType] = useState<IncidentType>('behavior');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [description, setDescription] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          incident_date: incidentDate,
          incident_type: incidentType,
          severity,
          description,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل تسجيل المخالفة');
      return body.data;
    },
    onSuccess: () => {
      toast.success('تم تسجيل المخالفة — ستُراجَع قريبًا');
      router.push('/dashboard/teacher/incidents');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'فشل تسجيل المخالفة');
      setConfirmOpen(false);
    },
  });

  // Client-side validation flags (mirror the API constraints).
  const descTrimmed = description.trim();
  const descShort = descTrimmed.length < 20;
  const studentError = submitAttempted && studentId === null;
  const dateError = submitAttempted && !incidentDate;
  const showDescError = (submitAttempted || descTrimmed.length > 0) && descShort;
  const studentErrorId = 'incident-student-error';
  const studentHelpId = 'incident-student-help';
  const dateErrorId = 'incident-date-error';
  const dateHelpId = 'incident-date-help';
  const descErrorId = 'incident-description-error';
  const descHelpId = 'incident-description-help';
  const descCountId = 'incident-description-count';
  const canSubmit =
    studentId !== null &&
    !!incidentDate &&
    !descShort &&
    !submitMutation.isPending;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitAttempted(true);
    if (canSubmit) setConfirmOpen(true);
  };

  if (persona.isLoading) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className="card">
          <p className="text-sm text-gray-600 dark:text-gray-400">جاري التحقق من الصلاحية...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className="card border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                لا تملك صلاحية تسجيل مخالفة
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                تسجيل المخالفات مخصص للمعلمين والإداريين المخولين.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* ============== Header ============== */}
      <div className="card bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-500/10 dark:to-cyan-500/10 border-blue-200 dark:border-blue-500/30">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
            <FilePlus className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">تسجيل مخالفة جديدة</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              املأ التفاصيل بدقة — سيراجعها الوكيل أو المرشد ويقرّر الإجراء المناسب.
            </p>
          </div>
        </div>
      </div>

      {/* ============== Form ============== */}
      <form onSubmit={handleSubmit} className="card space-y-4">
        {/* Student */}
        <div>
          <label htmlFor="incident-student-search" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            الطالب <span className="text-red-500">*</span>
          </label>
          {studentId !== null ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{studentDisplay}</p>
                {(studentMeta.grade || studentMeta.section) && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {studentMeta.grade ?? ''}
                    {studentMeta.grade && studentMeta.section && ' / '}
                    {studentMeta.section ?? ''}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setStudentId(null);
                  setStudentDisplay('');
                  setStudentMeta({});
                }}
                className="text-xs text-blue-700 dark:text-blue-400 underline flex-shrink-0"
              >
                تغيير
              </button>
            </div>
          ) : (
            <StudentPicker
              inputId="incident-student-search"
              invalid={studentError}
              describedBy={studentError ? `${studentErrorId} ${studentHelpId}` : studentHelpId}
              onSelect={(s) => {
                setStudentId(s.id);
                setStudentDisplay(studentDisplayName(s));
                setStudentMeta({
                  grade: s.grade_name ?? undefined,
                  section: s.section_name ?? undefined,
                });
              }}
            />
          )}
          {studentError && (
            <p id={studentErrorId} className="text-sm text-red-700 dark:text-red-400 mt-1" role="alert">
              اختر الطالب قبل تسجيل المخالفة.
            </p>
          )}
          <p id={studentHelpId} className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            البحث يقتصر على طلاب الشعب المسنَدة لك.
          </p>
        </div>

        {/* Date */}
        <div>
          <label htmlFor="incident-date" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            تاريخ المخالفة <span className="text-red-500">*</span>
          </label>
          <input
            id="incident-date"
            name="incident_date"
            type="date"
            value={incidentDate}
            onChange={(e) => setIncidentDate(e.target.value)}
            max={todayInRiyadh()}
            className={`w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 ${
              dateError
                ? 'border-red-300 dark:border-red-500/50 focus:ring-red-500/30'
                : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500/30'
            }`}
            aria-invalid={dateError}
            aria-describedby={dateError ? `${dateErrorId} ${dateHelpId}` : dateHelpId}
          />
          {dateError && (
            <p id={dateErrorId} className="text-sm text-red-700 dark:text-red-400 mt-1" role="alert">
              اختر تاريخ المخالفة.
            </p>
          )}
          <p id={dateHelpId} className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            افتراضيًا تاريخ اليوم. لا يمكن اختيار تاريخ في المستقبل.
          </p>
        </div>

        {/* Type */}
        <div>
          <label htmlFor="incident-type" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            نوع المخالفة <span className="text-red-500">*</span>
          </label>
          <select
            id="incident-type"
            name="incident_type"
            value={incidentType}
            onChange={(e) => setIncidentType(e.target.value as IncidentType)}
            className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {/* Severity */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            الخطورة <span className="text-red-500">*</span>
          </label>
          <input type="hidden" name="severity" value={severity} />
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="الخطورة">
            {INCIDENT_SEVERITIES.map((s) => {
              const isActive = severity === s;
              const tone = {
                low: isActive ? 'bg-gray-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
                medium: isActive ? 'bg-blue-600 text-white' : 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
                high: isActive ? 'bg-orange-600 text-white' : 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400',
                critical: isActive ? 'bg-red-600 text-white' : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
              }[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`text-xs px-2 py-2 rounded-md font-medium transition-colors ${tone}`}
                >
                  {INCIDENT_SEVERITY_LABELS[s]}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            الافتراضي &quot;متوسطة&quot;. اختر &quot;حرجة&quot; فقط للحالات الفورية (تهديد، أذى).
          </p>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="incident-description" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            وصف المخالفة <span className="text-red-500">*</span>
          </label>
          <textarea
            id="incident-description"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="مثال: تأخّر عن حصة الرياضيات الأولى بنحو 15 دقيقة دون إذن، وكرّر الأمر يومي الأحد والإثنين."
            className={`w-full px-3 py-2 rounded-md border bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 ${
              showDescError
                ? 'border-red-300 dark:border-red-500/50 focus:ring-red-500/30'
                : 'border-gray-300 dark:border-gray-700 focus:ring-blue-500/30'
            }`}
            aria-invalid={showDescError}
            aria-describedby={showDescError ? `${descErrorId} ${descCountId}` : `${descHelpId} ${descCountId}`}
          />
          <div className="flex items-center justify-between mt-1">
            <p
              id={showDescError ? descErrorId : descHelpId}
              className={`text-sm ${showDescError ? 'text-red-700 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}
              role={showDescError ? 'alert' : undefined}
            >
              {showDescError
                ? descTrimmed.length === 0
                  ? 'اكتب وصفًا واضحًا للمخالفة.'
                  : `أضف ${20 - descTrimmed.length} حرف على الأقل (المطلوب 20+)`
                : 'كن دقيقًا. الوصف المختصر يضعف فرص الإجراء العادل.'}
            </p>
            <p id={descCountId} className="text-xs text-gray-500 dark:text-gray-400">{description.length} / 2000</p>
          </div>
        </div>

        {/* Submit row */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <Link
            href="/dashboard/teacher/incidents"
            className="text-sm px-4 py-2 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
          >
            <ArrowRight className="w-4 h-4" />
            رجوع
          </Link>
          <button
            type="submit"
            disabled={submitMutation.isPending}
            className="text-sm px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            تسجيل المخالفة
          </button>
        </div>
      </form>

      {/* ============== Confirm modal ============== */}
      {confirmOpen && (
        <ConfirmModal
          studentName={studentDisplay}
          isPending={submitMutation.isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => submitMutation.mutate()}
        />
      )}
    </div>
  );
}

// ============== Student picker ==============

function StudentPicker({
  inputId,
  invalid,
  describedBy,
  onSelect,
}: {
  inputId: string;
  invalid?: boolean;
  describedBy?: string;
  onSelect: (_student: StudentResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 300ms — keeps requests sane while the user types.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Fire the search when the debounced query updates.
  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/incidents/students/search?q=${encodeURIComponent(debounced)}&limit=10`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || 'فشل البحث عن الطلاب');
        }
        return r.json();
      })
      .then((body) => {
        if (cancelled) return;
        setResults((body.data ?? []) as StudentResult[]);
        setOpen(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'خطأ في البحث');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          id={inputId}
          name="student_search"
          ref={inputRef}
          type="text"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="ابحث باسم الطالب أو رقمه..."
          className="w-full px-3 py-2 pe-9 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      </div>

      {error && (
        <p className="text-sm text-red-700 dark:text-red-400 mt-1" role="alert">{error}</p>
      )}

      {open && debounced.length >= 2 && (
        <div className="absolute z-10 top-full mt-1 inset-x-0 max-h-64 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {loading ? (
            <p className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 text-center">
              جاري البحث…
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 text-center">
              لا نتائج. تأكد من أن الطالب ضمن شعب مسنَدة لك.
            </p>
          ) : (
            <ul>
              {results.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(s);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="w-full text-start px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                  >
                    <p className="text-sm font-medium">{studentDisplayName(s)}</p>
                    {(s.grade_name || s.section_name) && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {s.grade_name ?? ''}
                        {s.grade_name && s.section_name && ' / '}
                        {s.section_name ?? ''}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ============== Confirm modal ==============

function ConfirmModal({
  studentName, isPending, onCancel, onConfirm,
}: {
  studentName: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onCancel);
  const titleId = 'incident-confirm-title';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 id={titleId} className="font-bold text-base">تأكيد تسجيل المخالفة</h2>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            ستُسجَّل في سجل الطالب <strong>{studentName}</strong> بعد مراجعتها واتخاذ القرار من الوكيل أو المرشد.
          </p>
          <div className="px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              يمكنك سحب الطلب خلال 30 دقيقة من الإرسال طالما لم يبدأ المراجع بالعمل عليه.
              بعد ذلك، إن أردت إلغاءه، تواصل مع الوكيل لرفضه رسميًا.
            </p>
          </div>
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="text-sm px-4 py-2 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            رجوع للتعديل
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="text-sm px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {isPending && <Clock className="w-3.5 h-3.5 animate-spin" />}
            تأكيد الإرسال
          </button>
        </div>
      </div>
    </div>
  );
}
