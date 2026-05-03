'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Calendar, Search, AlertTriangle, AlertCircle, BadgeCheck, CheckSquare, Square,
  Send, Loader2, RefreshCw, BarChart3, MapPin, Filter, MessageCircle, X,
  CheckCircle2, XCircle,
} from 'lucide-react';

interface DetectionRow {
  student_id: number;
  student_code: string;
  student_name: string;
  phone: string | null;
  section_id: number;
  section_name: string;
  grade_name: string;
  expected_periods: number;
  absent_periods: number[];
  category?: 'full_absence' | 'escape_after_first' | 'mid_day_departure' | 'selective_skip';
}

interface DismissalRow {
  student_id: number;
  student_code: string;
  student_name: string;
  phone: string | null;
}

interface IncompleteSection {
  section_id: number;
  section_name: string;
  grade_name: string;
  missing_periods: number[];
}

interface DetectionResult {
  date: string;
  range: { from: number; to: number; max_period: number };
  stats: {
    total_students: number;
    full_absences: number;
    escapes: number;                  // total of the three escape sub-categories
    escape_after_first: number;
    mid_day_departure: number;
    selective_skip: number;
    dismissals: number;
    incomplete_sections: number;
  };
  full_absences: DetectionRow[];
  escape_after_first: DetectionRow[];
  mid_day_departure: DetectionRow[];
  selective_skip: DetectionRow[];
  // legacy union — kept by the API for old callers; we don't read it here
  escapes: DetectionRow[];
  dismissals: DismissalRow[];
  incomplete_sections: IncompleteSection[];
}

interface SendResult {
  requested: number;
  sent: number;
  failed: number;
  skipped: number;
  outcomes: Array<{ student_id: number; student_name: string; phone: string | null; ok: boolean; error: string | null }>;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function DailyAttendancePage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [fromPeriod, setFromPeriod] = useState(1);
  const [toPeriod, setToPeriod] = useState(7);
  const [shouldRun, setShouldRun] = useState(true);

  const [selectedAbsences, setSelectedAbsences] = useState<Set<number>>(new Set());
  const [selectedEscapeFirst, setSelectedEscapeFirst] = useState<Set<number>>(new Set());
  const [selectedMidDay, setSelectedMidDay] = useState<Set<number>>(new Set());
  const [selectedSelective, setSelectedSelective] = useState<Set<number>>(new Set());
  const [showResult, setShowResult] = useState<{ result: SendResult; type: 'absence' | 'escape' } | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<DetectionResult>({
    queryKey: ['daily-attendance', date, fromPeriod, toPeriod],
    queryFn: async () => {
      const params = new URLSearchParams({
        date,
        from_period: String(fromPeriod),
        to_period: String(toPeriod),
      });
      const r = await fetch(`/api/daily-attendance/detect?${params}`);
      if (!r.ok) throw new Error('فشل التحليل');
      return (await r.json()).data;
    },
    enabled: shouldRun,
  });

  // When data lands, auto-select all rows that have a phone — that's the
  // common "send to everyone" intent. Admin can untick individuals.
  useMemo(() => {
    if (!data) return;
    const withPhone = (rows: DetectionRow[]) =>
      new Set(rows.filter((r) => !!r.phone).map((r) => r.student_id));
    setSelectedAbsences(withPhone(data.full_absences));
    setSelectedEscapeFirst(withPhone(data.escape_after_first || []));
    setSelectedMidDay(withPhone(data.mid_day_departure || []));
    setSelectedSelective(withPhone(data.selective_skip || []));
  }, [data]);

  const sendMut = useMutation({
    mutationFn: async (input: { type: 'absence' | 'escape'; recipients: any[] }) => {
      const r = await fetch('/api/daily-attendance/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, type: input.type, recipients: input.recipients }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإرسال');
      return { result: d.data as SendResult, type: input.type };
    },
    onSuccess: ({ result, type }) => {
      qc.invalidateQueries({ queryKey: ['whatsapp-messages'] });
      setShowResult({ result, type });
      const ok = result.sent;
      const fail = result.failed;
      if (fail === 0) toast.success(`✓ أُرسلت ${ok} رسالة`);
      else toast(`أُرسلت ${ok} • فشلت ${fail}`, { icon: '⚠️', duration: 5000 });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const sendAbsences = () => {
    if (!data) return;
    const recipients = data.full_absences
      .filter((r) => selectedAbsences.has(r.student_id))
      .map((r) => ({
        student_id: r.student_id,
        student_name: r.student_name,
        phone: r.phone,
        grade_name: r.grade_name,
        section_name: r.section_name,
      }));
    if (recipients.length === 0) {
      toast.error('لم تختر أحداً للإرسال');
      return;
    }
    const minutes = Math.ceil((recipients.length * 5.5) / 60);
    if (confirm(`سيتم إرسال ${recipients.length} رسالة غياب • مدة متوقّعة ~${minutes} دقيقة`)) {
      sendMut.mutate({ type: 'absence', recipients });
    }
  };

  // All three escape sub-categories share the same send endpoint
  // (type='escape'); only the visible bucket and pre-selection differ.
  const sendEscapeBucket = (
    rows: DetectionRow[],
    selected: Set<number>,
    label: string,
  ) => {
    const recipients = rows
      .filter((r) => selected.has(r.student_id))
      .map((r) => ({
        student_id: r.student_id,
        student_name: r.student_name,
        phone: r.phone,
        grade_name: r.grade_name,
        section_name: r.section_name,
        absent_periods: r.absent_periods,
      }));
    if (recipients.length === 0) {
      toast.error('لم تختر أحداً للإرسال');
      return;
    }
    const minutes = Math.ceil((recipients.length * 5.5) / 60);
    if (confirm(`سيتم إرسال ${recipients.length} رسالة "${label}" • مدة متوقّعة ~${minutes} دقيقة`)) {
      sendMut.mutate({ type: 'escape', recipients });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-orange-600 rounded-xl flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">كشف الغياب والهروب</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            تحليل ذكي لتصنيف غياب الطلاب في يوم محدد + إرسال إشعارات لأولياء الأمور
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> التاريخ</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" max={todayStr()} />
          </div>
          <div>
            <label className="label">من الحصة</label>
            <select value={fromPeriod} onChange={(e) => setFromPeriod(parseInt(e.target.value, 10))} className="input">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>الحصة {n}</option>)}
            </select>
          </div>
          <div>
            <label className="label">إلى الحصة</label>
            <select value={toPeriod} onChange={(e) => setToPeriod(parseInt(e.target.value, 10))} className="input">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n} disabled={n < fromPeriod}>الحصة {n}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { setShouldRun(true); refetch(); }}
              disabled={isFetching}
              className="btn-primary w-full inline-flex items-center justify-center gap-1"
            >
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              {isFetching ? 'يحلّل...' : 'تحليل'}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          💡 اختر الحصص حسب طبيعة اليوم — مثلاً {' '}
          <span className="font-mono">1-5</span> ليوم خميس، {' '}
          <span className="font-mono">1-7</span> للأيام العادية.
        </p>
      </div>

      {!data ? (
        isLoading ? (
          <div className="card text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
        ) : null
      ) : (
        <>
          {/* Stats — 6 categories laid out wide */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <Stat label="إجمالي الطلاب" value={data.stats.total_students} tone="gray" />
            <Stat label="🔴 غياب كامل" value={data.stats.full_absences} tone="red" />
            <Stat label="🟠 هروب بعد التحضير" value={data.stats.escape_after_first ?? 0} tone="orange" />
            <Stat label="🔵 انصراف منتصف اليوم" value={data.stats.mid_day_departure ?? 0} tone="cyan" />
            <Stat label="🟡 تهرّب من حصة" value={data.stats.selective_skip ?? 0} tone="yellow" />
            <Stat label="🟣 استئذان" value={data.stats.dismissals} tone="purple" />
            <Stat label="⏸ غير مكتمل" value={data.stats.incomplete_sections} tone="amber" />
          </div>

          {/* Range info */}
          <div className="card bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 text-sm text-blue-900 dark:text-blue-200">
            تم التحليل على الحصص <strong>{data.range.from} → {data.range.to}</strong>
            {' '}في تاريخ <strong>{data.date}</strong>
          </div>

          {/* Incomplete sections warning */}
          {data.incomplete_sections.length > 0 && (
            <div className="card bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    ⚠️ شعب لم تُسجّل كل الحصص في النطاق المختار
                  </p>
                  <details className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    <summary className="cursor-pointer hover:underline">
                      عرض القائمة ({data.incomplete_sections.length} شعبة)
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {data.incomplete_sections.map((s) => (
                        <li key={s.section_id}>
                          📚 {s.grade_name} / {s.section_name} — لم تُسجّل: {s.missing_periods.join('، ')}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              </div>
            </div>
          )}

          {/* 🔴 Full absences */}
          <BucketCard
            title="🔴 الغياب الكامل"
            description="الطلاب الذين تغيّبوا عن كل الحصص في النطاق — لم يأتوا للمدرسة"
            tone="red"
            rows={data.full_absences}
            selected={selectedAbsences}
            setSelected={setSelectedAbsences}
            onSend={sendAbsences}
            sending={sendMut.isPending && sendMut.variables?.type === 'absence'}
            sendLabel="إرسال إشعار غياب"
            showPeriods={false}
          />

          {/* 🟠 Escape after first period */}
          <BucketCard
            title="🟠 هروب بعد التحضير"
            description="حضر الحصة الأولى للتحضير، ثم غاب من باقي الحصص — حالة مشبوهة"
            tone="orange"
            rows={data.escape_after_first || []}
            selected={selectedEscapeFirst}
            setSelected={setSelectedEscapeFirst}
            onSend={() => sendEscapeBucket(data.escape_after_first || [], selectedEscapeFirst, 'هروب بعد التحضير')}
            sending={sendMut.isPending && sendMut.variables?.type === 'escape'}
            sendLabel="إرسال إشعار"
            showPeriods={true}
          />

          {/* 🔵 Mid-day departure */}
          <BucketCard
            title="🔵 انصراف منتصف اليوم"
            description="حضر بداية اليوم، ثم غاب من حصص لاحقة — قد يكون انصرف فعلًا"
            tone="cyan"
            rows={data.mid_day_departure || []}
            selected={selectedMidDay}
            setSelected={setSelectedMidDay}
            onSend={() => sendEscapeBucket(data.mid_day_departure || [], selectedMidDay, 'انصراف منتصف اليوم')}
            sending={sendMut.isPending && sendMut.variables?.type === 'escape'}
            sendLabel="إرسال إشعار"
            showPeriods={true}
          />

          {/* 🟡 Selective skip */}
          <BucketCard
            title="🟡 تهرّب من حصص محددة"
            description="حاضر معظم الحصص، غائب من حصة أو حصتين بعينها — راجع المعلم المعنيّ"
            tone="yellow"
            rows={data.selective_skip || []}
            selected={selectedSelective}
            setSelected={setSelectedSelective}
            onSend={() => sendEscapeBucket(data.selective_skip || [], selectedSelective, 'تهرّب من حصص')}
            sending={sendMut.isPending && sendMut.variables?.type === 'escape'}
            sendLabel="إرسال إشعار"
            showPeriods={true}
          />

          {/* Dismissals — info only, no send */}
          {data.dismissals.length > 0 && (
            <div className="card">
              <h2 className="font-semibold flex items-center gap-2 mb-3">
                <BadgeCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                🟣 المستأذنون اليوم ({data.dismissals.length})
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                هؤلاء الطلاب لديهم استئذانات مسجَّلة — تم إشعار الأهالي مسبقاً ولا يحتاجون رسالة جديدة.
              </p>
              <ul className="divide-y divide-gray-200 dark:divide-gray-800 text-sm">
                {data.dismissals.map((d) => (
                  <li key={d.student_id} className="py-2 flex items-center gap-2">
                    <BadgeCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>{d.student_name}</span>
                    <span className="font-mono text-xs text-gray-500" dir="ltr">{d.student_code}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Send result modal */}
      {showResult && (
        <SendResultModal
          result={showResult.result}
          type={showResult.type}
          onClose={() => setShowResult(null)}
        />
      )}
    </div>
  );
}

function BucketCard({
  title, description, tone, rows, selected, setSelected, onSend, sending, sendLabel, showPeriods,
}: {
  title: string;
  description: string;
  tone: 'red' | 'orange' | 'cyan' | 'yellow';
  rows: DetectionRow[];
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  onSend: () => void;
  sending: boolean;
  sendLabel: string;
  showPeriods: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <h2 className="font-semibold mb-2">{title}</h2>
        <p className="text-center text-green-600 dark:text-green-400 py-6 text-sm">✓ لا يوجد طلاب في هذه الفئة</p>
      </div>
    );
  }

  const allSelected = rows.every((r) => selected.has(r.student_id));
  const withPhone = rows.filter((r) => !!r.phone).length;
  const cls = {
    red:    { bg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-200 dark:border-red-500/30', btn: 'bg-red-600 hover:bg-red-700' },
    orange: { bg: 'bg-orange-50 dark:bg-orange-500/10', border: 'border-orange-200 dark:border-orange-500/30', btn: 'bg-orange-600 hover:bg-orange-700' },
    cyan:   { bg: 'bg-cyan-50 dark:bg-cyan-500/10', border: 'border-cyan-200 dark:border-cyan-500/30', btn: 'bg-cyan-600 hover:bg-cyan-700' },
    yellow: { bg: 'bg-yellow-50 dark:bg-yellow-500/10', border: 'border-yellow-200 dark:border-yellow-500/30', btn: 'bg-yellow-600 hover:bg-yellow-700' },
  }[tone];

  return (
    <div className={`card ${cls.bg} border ${cls.border}`}>
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="font-bold text-lg">{title} ({rows.length})</h2>
          <p className="text-xs text-gray-600 dark:text-gray-300">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (allSelected) setSelected(new Set());
              else setSelected(new Set(rows.filter((r) => !!r.phone).map((r) => r.student_id)));
            }}
            className="text-xs underline"
          >
            {allSelected ? 'إلغاء التحديد' : 'تحديد الكل (مع جوال)'}
          </button>
          <button
            onClick={onSend}
            disabled={sending || selected.size === 0}
            className={`text-white text-sm px-4 py-2 rounded-lg inline-flex items-center gap-1 ${cls.btn} disabled:opacity-50`}
          >
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الإرسال...</> : <><Send className="w-4 h-4" /> {sendLabel} ({selected.size})</>}
          </button>
        </div>
      </div>
      <ul className="divide-y divide-gray-200 dark:divide-gray-800 max-h-96 overflow-y-auto">
        {rows.map((r) => {
          const checked = selected.has(r.student_id);
          const noPhone = !r.phone;
          return (
            <li key={r.student_id} className={`py-2 flex items-center gap-2 ${noPhone ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={noPhone}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(r.student_id)) next.delete(r.student_id);
                  else next.add(r.student_id);
                  setSelected(next);
                }}
                className="w-4 h-4"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{r.student_name}</p>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 border text-gray-600 dark:text-gray-300">
                    {r.grade_name} / {r.section_name}
                  </span>
                  {showPeriods && r.absent_periods.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-orange-200 dark:bg-orange-500/30 text-orange-900 dark:text-orange-200 font-bold">
                      حصص: {r.absent_periods.join(' • ')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-mono" dir="ltr">{r.student_code}</span>
                  {r.phone ? <> • <span className="font-mono" dir="ltr">{r.phone}</span></> : ' • بدون جوال'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {withPhone < rows.length && (
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
          ⚠️ {rows.length - withPhone} طالب بدون رقم جوال — لن يصلهم إشعار
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'gray' | 'red' | 'orange' | 'blue' | 'amber' | 'cyan' | 'yellow' | 'purple' }) {
  const cls = {
    gray:   'text-gray-900 dark:text-gray-100',
    red:    'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
    orange: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10',
    blue:   'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10',
    amber:  'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10',
    cyan:   'text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10',
    yellow: 'text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-500/10',
    purple: 'text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10',
  }[tone];
  return (
    <div className={`card text-center py-3 ${cls.includes('bg-') ? cls.split(' ').filter(c => c.startsWith('bg-')).join(' ') : ''}`}>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${cls.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>{value}</p>
    </div>
  );
}

function SendResultModal({ result, type, onClose }: { result: SendResult; type: 'absence' | 'escape'; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`p-4 ${result.failed === 0 ? 'bg-green-50 dark:bg-green-500/10' : 'bg-amber-50 dark:bg-amber-500/10'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {result.failed === 0
                ? <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                : <AlertCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />}
              <div>
                <h3 className="font-bold text-lg">نتيجة الإرسال</h3>
                <p className="text-sm">
                  ✓ <strong className="text-green-700 dark:text-green-400">{result.sent}</strong> /
                  ✗ <strong className="text-red-700 dark:text-red-400">{result.failed}</strong>
                  {result.skipped > 0 && <> • تخطّي <strong>{result.skipped}</strong></>}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {result.outcomes.map((o) => (
              <li key={o.student_id} className="py-2 flex items-center gap-2">
                {o.ok
                  ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-600 shrink-0" />}
                <span className="flex-1 text-sm">{o.student_name}</span>
                <span className="font-mono text-xs text-gray-500" dir="ltr">{o.phone || '—'}</span>
                {o.error && <span className="text-xs text-red-600 dark:text-red-400 truncate max-w-[40%]" title={o.error}>{o.error}</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex justify-end">
          <button onClick={onClose} className="btn-primary text-sm">إغلاق</button>
        </div>
      </div>
    </div>
  );
}
