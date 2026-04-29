'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Calendar, Clock, Search, Save, CheckCircle2, Loader2, AlertCircle,
  ChevronDown, Users, RefreshCw, ArrowRight,
} from 'lucide-react';
import { useClassSession } from '@/lib/hooks/useClassSession';
import type { PeriodAttendanceStatus } from '@/lib/types/database';

interface Student {
  id: number;
  student_id: string;
  first_name: string;
  father_name: string | null;
  last_name: string;
}

interface Period { id: number; number: number; name: string; }
interface Grade  { id: number; name: string; }
interface Section { id: number; name: string; grade_id: number; }

const STATUS_LABEL: Record<PeriodAttendanceStatus, string> = {
  present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'مستأذن',
};
const STATUS_TONE: Record<PeriodAttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/40',
  absent:  'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/40',
  late:    'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/40',
  excused: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/40',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function TeacherHomePage() {
  return (
    <Suspense fallback={<div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>}>
      <TeacherEntryPage />
    </Suspense>
  );
}

function TeacherEntryPage() {
  const qc = useQueryClient();
  // Edit-mode prefill from URL: /teacher?date=YYYY-MM-DD&period_id=N&section_id=N&grade_id=N
  const sp = useSearchParams();
  const urlDate = sp.get('date');
  const urlPeriodId = sp.get('period_id') ? Number(sp.get('period_id')) : null;
  const urlGradeId = sp.get('grade_id') ? Number(sp.get('grade_id')) : null;
  const urlSectionId = sp.get('section_id') ? Number(sp.get('section_id')) : null;
  const hasUrlPrefill = !!(urlDate || urlPeriodId || urlGradeId || urlSectionId);

  const { session, patch, loaded } = useClassSession();

  const [date, setDate] = useState(urlDate || todayStr());
  const [periodId, setPeriodId] = useState<number | null>(urlPeriodId);
  const [gradeId, setGradeId] = useState<number | null>(urlGradeId);
  const [sectionId, setSectionId] = useState<number | null>(urlSectionId);
  const [search, setSearch] = useState('');

  // Hydrate from class session if URL didn't prefill (URL wins).
  useEffect(() => {
    if (!loaded || hasUrlPrefill) return;
    if (session.date) setDate(session.date);
    if (session.gradeId) setGradeId(session.gradeId);
    if (session.sectionId) setSectionId(session.sectionId);
    if (session.periodId) setPeriodId(session.periodId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Persist on change.
  useEffect(() => {
    if (!loaded) return;
    patch({ date, gradeId, sectionId, periodId });
  }, [date, gradeId, sectionId, periodId, loaded, patch]);

  // status[student_id] — defaults to 'present', set explicitly for non-present.
  const [statuses, setStatuses] = useState<Record<number, PeriodAttendanceStatus>>({});

  // ---- Data ----
  const { data: periods = [] } = useQuery<Period[]>({
    queryKey: ['periods-active'],
    queryFn: async () => ((await (await fetch('/api/periods')).json()).data || []).filter((p: any) => p.is_active),
  });

  const { data: grades = [] } = useQuery<Grade[]>({
    queryKey: ['grades-all'],
    queryFn: async () => (await (await fetch('/api/grades')).json()).data,
  });

  const { data: sections = [] } = useQuery<Section[]>({
    queryKey: ['sections', gradeId],
    queryFn: async () => {
      if (!gradeId) return [];
      return (await (await fetch(`/api/sections?grade_id=${gradeId}`)).json()).data;
    },
    enabled: !!gradeId,
  });

  const { data: studentsResp, isLoading: studentsLoading } = useQuery<{ data: Student[] }>({
    queryKey: ['students-period', sectionId],
    queryFn: async () => {
      if (!sectionId) return { data: [] };
      const r = await fetch(`/api/students?section_id=${sectionId}&limit=500`);
      if (!r.ok) throw new Error('فشل تحميل الطلاب');
      return r.json();
    },
    enabled: !!sectionId,
  });
  const students = studentsResp?.data || [];

  // Auto-pick first period and grade when data lands.
  useEffect(() => { if (!periodId && periods.length > 0) setPeriodId(periods[0].id); }, [periods, periodId]);
  useEffect(() => { if (!gradeId && grades.length > 0) setGradeId(grades[0].id); }, [grades, gradeId]);

  // Reset section when grade changes — but skip the first run so URL-prefilled
  // section_id (edit mode) survives initial mount.
  const gradeChangeCount = useMemo(() => ({ count: 0 }), []);
  useEffect(() => {
    gradeChangeCount.count++;
    if (gradeChangeCount.count > 1) setSectionId(null);
  }, [gradeId, gradeChangeCount]);
  useEffect(() => { setStatuses({}); }, [sectionId, periodId, date]);

  // Pre-fill statuses from any saved session for this combination.
  const { data: existing, refetch: refetchExisting } = useQuery({
    queryKey: ['period-attendance', sectionId, periodId, date],
    queryFn: async () => {
      const params = new URLSearchParams({
        section_id: String(sectionId), period_id: String(periodId), date,
      });
      const r = await fetch(`/api/period-attendance?${params}`);
      if (!r.ok) return { session: null, absences: [] };
      return (await r.json()).data;
    },
    enabled: !!(sectionId && periodId && date),
  });

  useEffect(() => {
    if (!existing?.absences) return;
    const next: Record<number, PeriodAttendanceStatus> = {};
    for (const a of existing.absences as any[]) {
      next[a.student_id] = a.status;
    }
    setStatuses(next);
  }, [existing]);

  // ---- Search filter ----
  const visibleStudents = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.trim();
    return students.filter((s) => {
      const full = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ');
      return full.includes(q) || s.student_id.includes(q);
    });
  }, [students, search]);

  // ---- Counts ----
  const counts = useMemo(() => {
    let absent = 0, late = 0, excused = 0;
    for (const s of students) {
      const st = statuses[s.id];
      if (st === 'absent') absent++;
      else if (st === 'late') late++;
      else if (st === 'excused') excused++;
    }
    return { total: students.length, present: students.length - absent - late - excused, absent, late, excused };
  }, [students, statuses]);

  // ---- Cycle through statuses on tap (present → absent → late → excused → present) ----
  const cycleStatus = (id: number) => {
    setStatuses((prev) => {
      const cur = prev[id];
      const next = !cur ? 'absent' : cur === 'absent' ? 'late' : cur === 'late' ? 'excused' : null;
      const copy = { ...prev };
      if (next === null) delete copy[id]; else copy[id] = next;
      return copy;
    });
  };

  const setAllPresent = () => setStatuses({});
  const setAllAbsent = () => {
    const next: Record<number, PeriodAttendanceStatus> = {};
    for (const s of students) next[s.id] = 'absent';
    setStatuses(next);
  };

  // ---- Save ----
  const saveMut = useMutation({
    mutationFn: async () => {
      const absences = Object.entries(statuses)
        .filter(([, st]) => st !== 'present')
        .map(([sid, st]) => ({ student_id: Number(sid), status: st as 'absent'|'late'|'excused' }));

      const r = await fetch('/api/period-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section_id: sectionId, period_id: periodId, attendance_date: date, absences,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الحفظ');
      return d.data;
    },
    onSuccess: (data: { absent: number; late: number; excused: number; total: number }) => {
      qc.invalidateQueries({ queryKey: ['period-attendance', sectionId, periodId, date] });
      refetchExisting();

      // Numeric summary reassures the teacher they saved the right shape.
      // ("Did I really mark Ali absent? Did I miss anyone?") Showing the
      // counts inline turns the toast into a quick visual sanity-check.
      const present = Math.max(0, (data.total || 0) - data.absent - data.late - data.excused);
      const parts: string[] = [];
      if (data.absent > 0)  parts.push(`${data.absent} غياب`);
      if (data.late > 0)    parts.push(`${data.late} تأخّر`);
      if (data.excused > 0) parts.push(`${data.excused} استئذان`);
      const summary = parts.length > 0
        ? `${parts.join('، ')} • ${present} حاضر`
        : `كل الطلاب حاضرون (${present})`;

      toast.success(`✓ تم الحفظ — ${summary}`, { duration: 4000 });

      // Vibrate on supporting devices for tactile confirmation.
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(30);
    },
    onError: (e: any) => toast.error(e?.message || 'فشل الحفظ'),
  });

  const canSave = !!(sectionId && periodId && date && students.length > 0);

  return (
    <div className="space-y-3">
      {/* Filters card */}
      <div className="card">
        <div className="space-y-3">
          {/* Date */}
          <label className="block">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-1"><Calendar className="w-3 h-3" /> التاريخ</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
              max={todayStr()}
            />
          </label>

          {/* Periods — big tap targets */}
          <div>
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-1.5"><Clock className="w-3 h-3" /> الحصة</span>
            <div className="grid grid-cols-7 gap-1.5">
              {periods.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriodId(p.id)}
                  className={`py-3 rounded-lg border-2 font-bold transition-colors ${
                    periodId === p.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {p.number}
                </button>
              ))}
            </div>
          </div>

          {/* Grade + Section */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الصف</span>
              <div className="relative">
                <select
                  value={gradeId ?? ''}
                  onChange={(e) => setGradeId(e.target.value ? Number(e.target.value) : null)}
                  className="input appearance-none pe-8"
                >
                  <option value="">اختر</option>
                  {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الشعبة</span>
              <div className="relative">
                <select
                  value={sectionId ?? ''}
                  onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : null)}
                  className="input appearance-none pe-8"
                  disabled={!gradeId}
                >
                  <option value="">اختر</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <ChevronDown className="w-4 h-4 absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Existing-session indicator */}
      {existing?.session && (
        <div className="card border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-blue-800 dark:text-blue-300 text-sm flex items-start gap-2">
          <RefreshCw className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            تم تسجيل هذه الحصة سابقاً. يمكنك التعديل وإعادة الحفظ.
            <p className="text-xs opacity-80 mt-0.5">آخر حفظ: {new Date(existing.session.recorded_at).toLocaleString('ar-SA')}</p>
          </div>
        </div>
      )}

      {/* Students */}
      <div className="card">
        {!sectionId ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-12 text-sm">
            <Users className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
            اختر الصف والشعبة لعرض الطلاب
          </div>
        ) : studentsLoading ? (
          <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
        ) : students.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-12 text-sm">لا يوجد طلاب في هذه الشعبة</div>
        ) : (
          <>
            {/* Search */}
            {students.length > 12 && (
              <div className="relative mb-3">
                <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-gray-400 pointer-events-none" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input pe-9"
                  placeholder="بحث بالاسم أو الهوية..."
                />
              </div>
            )}

            {/* Quick actions */}
            <div className="flex items-center justify-between gap-2 mb-3 text-xs">
              <div className="flex gap-1.5">
                <button onClick={setAllPresent} className="px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-500/25">
                  الكل حاضر
                </button>
                <button onClick={setAllAbsent} className="px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/25">
                  الكل غائب
                </button>
              </div>
              <span className="text-gray-500 dark:text-gray-400">
                المعروض: {visibleStudents.length}
              </span>
            </div>

            {/* Legend */}
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 text-center">
              انقر مرة → غائب • مرتين → متأخر • ثلاث → مستأذن • أربع → حاضر
            </p>

            {/* List */}
            <ul className="space-y-1.5 max-h-[55vh] overflow-y-auto -mx-2 px-2">
              {visibleStudents.map((s) => {
                const st = statuses[s.id] || 'present';
                const tone = STATUS_TONE[st];
                const fullName = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ');
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => cycleStatus(s.id)}
                      className={`w-full text-right flex items-center gap-3 px-3 py-3 rounded-xl border-2 transition-colors ${tone}`}
                    >
                      <span className="text-xs font-bold w-14 text-center px-1.5 py-0.5 rounded bg-white/60 dark:bg-black/20 shrink-0">
                        {STATUS_LABEL[st]}
                      </span>
                      <div className="flex-1 min-w-0 text-right">
                        <p className="font-medium truncate">{fullName}</p>
                        <p className="text-[11px] opacity-70 font-mono" dir="ltr">{s.student_id}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Sticky save bar */}
      {sectionId && students.length > 0 && (
        <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-gradient-to-t from-white via-white dark:from-gray-950 dark:via-gray-950 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2 mb-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-green-600 dark:text-green-400">حاضر: {counts.present}</span>
            {counts.absent > 0 && <span className="text-red-600 dark:text-red-400">• غائب: {counts.absent}</span>}
            {counts.late > 0 && <span className="text-yellow-600 dark:text-yellow-400">• متأخر: {counts.late}</span>}
            {counts.excused > 0 && <span className="text-blue-600 dark:text-blue-400">• مستأذن: {counts.excused}</span>}
            <span className="ms-auto">من {counts.total}</span>
          </div>
          <button
            onClick={() => saveMut.mutate()}
            disabled={!canSave || saveMut.isPending}
            className="btn-primary w-full inline-flex items-center justify-center gap-2 py-3 text-base"
          >
            {saveMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saveMut.isPending ? 'جارٍ الحفظ...' : 'حفظ الحضور'}
          </button>
        </div>
      )}
    </div>
  );
}
