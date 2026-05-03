'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Calendar, Search, AlertTriangle, AlertCircle, BadgeCheck, CheckSquare, Square,
  Send, Loader2, RefreshCw, BarChart3, MapPin, Filter, MessageCircle, X,
  CheckCircle2, XCircle, Printer, TrendingUp, Users, Rocket,
} from 'lucide-react';
import CampaignProgressPanel from '@/components/daily-attendance/CampaignProgressPanel';

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

  // Active background-send campaign id. Auto-attached on page load if
  // the user already has one running, otherwise set when they click
  // "Send All". `null` hides the progress panel.
  const [activeCampaignId, setActiveCampaignId] = useState<number | null>(null);

  // Resume any in-flight campaign on page load — this is what makes
  // the "keeps running in background" UX work end-to-end. The user
  // can close the tab, come back hours later, and the panel reappears
  // showing live progress.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/daily-attendance/campaigns/active');
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && d?.data?.id) setActiveCampaignId(d.data.id);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Print dialog state. The 8 toggles map to the 8 sections of the
  // printable A4 sheet. Defaults to "everything on" because that's the
  // most common admin intent when they hit "طباعة".
  const [printOpen, setPrintOpen] = useState(false);
  const [printOpts, setPrintOpts] = useState({
    header: true,
    stats: true,
    incomplete: true,
    fullAbsence: true,
    escapeAfterFirst: true,
    midDayDeparture: true,
    selectiveSkip: true,
    dismissals: true,
  });

  // School identity for the print header. Public endpoint, lightly cached.
  const { data: schoolInfo } = useQuery<{ school_name: string; principal_name: string }>({
    queryKey: ['school-info'],
    queryFn: async () => {
      const r = await fetch('/api/public/school-info');
      if (!r.ok) return { school_name: '', principal_name: '' };
      return (await r.json()).data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fires window.print after the dialog state is committed and the
  // print-area DOM is fresh.
  const triggerPrint = () => {
    setPrintOpen(false);
    setTimeout(() => window.print(), 80);
  };

  // Quick-print: temporarily switches the print options to a single
  // category, prints, then restores the old options on `afterprint`.
  const quickPrintCategory = (
    cat: 'fullAbsence' | 'escapeAfterFirst' | 'midDayDeparture' | 'selectiveSkip' | 'dismissals',
  ) => {
    const saved = { ...printOpts };
    const restore = () => {
      setPrintOpts(saved);
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setPrintOpts({
      header: true,
      stats: false,
      incomplete: false,
      fullAbsence: cat === 'fullAbsence',
      escapeAfterFirst: cat === 'escapeAfterFirst',
      midDayDeparture: cat === 'midDayDeparture',
      selectiveSkip: cat === 'selectiveSkip',
      dismissals: cat === 'dismissals',
    });
    setTimeout(() => window.print(), 80);
  };

  const allPrintSelected =
    printOpts.header && printOpts.stats && printOpts.incomplete &&
    printOpts.fullAbsence && printOpts.escapeAfterFirst &&
    printOpts.midDayDeparture && printOpts.selectiveSkip && printOpts.dismissals;
  const noPrintSelected =
    !printOpts.fullAbsence && !printOpts.escapeAfterFirst &&
    !printOpts.midDayDeparture && !printOpts.selectiveSkip && !printOpts.dismissals;
  const togglePrintAll = () => {
    const v = !allPrintSelected;
    setPrintOpts({
      header: v, stats: v, incomplete: v,
      fullAbsence: v, escapeAfterFirst: v,
      midDayDeparture: v, selectiveSkip: v, dismissals: v,
    });
  };

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

  // Create a multi-phase background campaign that sends notifications
  // to every category sequentially. Returns immediately; the worker
  // drains the queue server-side. UX-wise this is what the admin
  // wants — fire-and-forget, comes back later to see the result.
  const startCampaignMut = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('لا توجد بيانات للإرسال');
      const phases = [
        { key: 'absence' as const, rows: data.full_absences },
        { key: 'escape_after_first' as const, rows: data.escape_after_first || [] },
        { key: 'mid_day_departure' as const, rows: data.mid_day_departure || [] },
        { key: 'selective_skip' as const, rows: data.selective_skip || [] },
      ];
      const payload = {
        attendance_date: date,
        phases: phases
          .filter((p) => p.rows.length > 0)
          .map((p) => ({
            key: p.key,
            recipients: p.rows
              .filter((r) => !!r.phone)
              .map((r) => ({
                student_id: r.student_id,
                student_name: r.student_name,
                phone: r.phone,
                grade_name: r.grade_name,
                section_name: r.section_name,
                absent_periods: r.absent_periods,
              })),
          })),
      };
      const total = payload.phases.reduce((acc, p) => acc + p.recipients.length, 0);
      if (total === 0) throw new Error('لا يوجد طلاب لديهم أرقام جوال للإرسال');
      const r = await fetch('/api/daily-attendance/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل بدء الحملة');
      return d.data as { id: number; total: number };
    },
    onSuccess: (d) => {
      toast.success(`📤 بدأت الحملة (${d.total} رسالة) — تكمل في الخلفية`);
      setActiveCampaignId(d.id);
    },
    onError: (e: any) => toast.error(e.message),
  });

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
          <div className="flex items-end gap-2">
            <button
              onClick={() => { setShouldRun(true); refetch(); }}
              disabled={isFetching}
              className="btn-primary flex-1 inline-flex items-center justify-center gap-1"
            >
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              {isFetching ? 'يحلّل...' : 'تحليل'}
            </button>
            <button
              onClick={() => setPrintOpen(true)}
              disabled={!data}
              className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center justify-center gap-1 text-sm disabled:opacity-50"
              title="طباعة الكشف"
            >
              <Printer className="w-4 h-4" />
              <span className="hidden sm:inline">طباعة</span>
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
          {/* Live progress panel for an in-flight background campaign.
              Hidden when no campaign is active. Auto-attaches on page
              load via the /campaigns/active query. */}
          {activeCampaignId && (
            <CampaignProgressPanel
              campaignId={activeCampaignId}
              onDismiss={() => setActiveCampaignId(null)}
            />
          )}

          {/* "Send everything" — single-click campaign for all categories */}
          {!activeCampaignId && (data.full_absences.length + (data.escape_after_first?.length || 0) + (data.mid_day_departure?.length || 0) + (data.selective_skip?.length || 0)) > 0 && (
            <div className="card border-blue-200 dark:border-blue-500/30 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shrink-0">
                    <Rocket className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base">إرسال إشعارات أولياء الأمور — حملة واحدة</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                      🔴 {data.full_absences.length} •
                      🟠 {data.escape_after_first?.length || 0} •
                      🔵 {data.mid_day_departure?.length || 0} •
                      🟡 {data.selective_skip?.length || 0}
                      {' = '}
                      <strong>{data.full_absences.length + (data.escape_after_first?.length || 0) + (data.mid_day_departure?.length || 0) + (data.selective_skip?.length || 0)}</strong> طالب
                      {' • '}
                      تكمل في الخلفية حتى لو أغلقت التبويب
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!confirm('بدء حملة الإرسال؟ ستُرسل تلقائيًّا للفئات الأربع على التوالي.')) return;
                    startCampaignMut.mutate();
                  }}
                  disabled={startCampaignMut.isPending}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 shrink-0"
                >
                  {startCampaignMut.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ البدء...</>
                    : <><Send className="w-4 h-4" /> بدء الإرسال للجميع</>}
                </button>
              </div>
            </div>
          )}

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
            onPrint={() => quickPrintCategory('fullAbsence')}
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
            onPrint={() => quickPrintCategory('escapeAfterFirst')}
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
            onPrint={() => quickPrintCategory('midDayDeparture')}
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
            onPrint={() => quickPrintCategory('selectiveSkip')}
          />

          {/* Teacher skip-rate analytics — 30-day window. Hidden until
              expanded to keep the page from getting overwhelming. */}
          <TeacherSkipStats />


          {/* Dismissals — info only, no send */}
          {data.dismissals.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <BadgeCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  🟣 المستأذنون اليوم ({data.dismissals.length})
                </h2>
                <button
                  onClick={() => quickPrintCategory('dismissals')}
                  className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
                  title="طباعة هذه الفئة"
                >
                  <Printer className="w-4 h-4" />
                </button>
              </div>
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

      {/* Print options dialog — 8 toggles + master "all" */}
      {printOpen && data && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setPrintOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Printer className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                ماذا تطبع؟
              </h3>
              <button
                onClick={() => setPrintOpen(false)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 mb-1">
              <input type="checkbox" checked={allPrintSelected} onChange={togglePrintAll} className="w-4 h-4" />
              <span className="font-medium">الجميع</span>
            </label>
            <div className="border-t border-gray-200 dark:border-gray-700 my-2" />

            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 mt-2">عناصر علوية</p>
            <div className="space-y-0.5">
              <PrintCheck label="ترويسة المدرسة" checked={printOpts.header} onChange={(v) => setPrintOpts({ ...printOpts, header: v })} />
              <PrintCheck label="صف الإحصائيات" checked={printOpts.stats} onChange={(v) => setPrintOpts({ ...printOpts, stats: v })} />
              <PrintCheck label="الشعب غير المكتملة" checked={printOpts.incomplete} onChange={(v) => setPrintOpts({ ...printOpts, incomplete: v })} />
            </div>

            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 mt-3">الفئات</p>
            <div className="space-y-0.5">
              <PrintCheck label="🔴 الغياب الكامل" count={data.full_absences.length} checked={printOpts.fullAbsence} onChange={(v) => setPrintOpts({ ...printOpts, fullAbsence: v })} />
              <PrintCheck label="🟠 هروب بعد التحضير" count={(data.escape_after_first || []).length} checked={printOpts.escapeAfterFirst} onChange={(v) => setPrintOpts({ ...printOpts, escapeAfterFirst: v })} />
              <PrintCheck label="🔵 انصراف منتصف اليوم" count={(data.mid_day_departure || []).length} checked={printOpts.midDayDeparture} onChange={(v) => setPrintOpts({ ...printOpts, midDayDeparture: v })} />
              <PrintCheck label="🟡 تهرّب من حصص" count={(data.selective_skip || []).length} checked={printOpts.selectiveSkip} onChange={(v) => setPrintOpts({ ...printOpts, selectiveSkip: v })} />
              <PrintCheck label="🟣 المستأذنون" count={data.dismissals.length} checked={printOpts.dismissals} onChange={(v) => setPrintOpts({ ...printOpts, dismissals: v })} />
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setPrintOpen(false)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                إلغاء
              </button>
              <button
                onClick={triggerPrint}
                disabled={noPrintSelected}
                className="flex-1 btn-primary inline-flex items-center justify-center gap-1 text-sm disabled:opacity-50"
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print-only area — hidden on screen, becomes the printed sheet. */}
      {data && (
        <div className="report-print-area" aria-hidden>
          {printOpts.header && (
            <div className="print-header">
              <p className="print-kingdom">المملكة العربية السعودية ـ وزارة التعليم</p>
              {schoolInfo?.school_name && (
                <h1>{schoolInfo.school_name}</h1>
              )}
              {schoolInfo?.principal_name && (
                <p className="print-principal">المدير: {schoolInfo.principal_name}</p>
              )}
              <hr />
              <h2>📋 كشف الغياب والتهرّب اليومي</h2>
              <div className="print-meta">
                <p><strong>التاريخ:</strong> {data.date}</p>
                <p><strong>نطاق الحصص:</strong> {data.range.from} → {data.range.to}</p>
                <p><strong>وقت الطباعة:</strong> {new Date().toLocaleString('ar-SA-u-ca-gregory', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </div>
          )}

          {printOpts.stats && (
            <table className="print-stats">
              <thead>
                <tr>
                  <th>الإجمالي</th>
                  <th>غياب كامل</th>
                  <th>هروب بعد التحضير</th>
                  <th>انصراف منتصف اليوم</th>
                  <th>تهرّب من حصص</th>
                  <th>استئذان</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{data.stats.total_students}</td>
                  <td>{data.stats.full_absences}</td>
                  <td>{data.stats.escape_after_first ?? 0}</td>
                  <td>{data.stats.mid_day_departure ?? 0}</td>
                  <td>{data.stats.selective_skip ?? 0}</td>
                  <td>{data.stats.dismissals}</td>
                </tr>
              </tbody>
            </table>
          )}

          {printOpts.incomplete && data.incomplete_sections.length > 0 && (
            <section className="print-section print-incomplete">
              <h3>⏸ شعب لم تُسجَّل كل حصصها</h3>
              <ul>
                {data.incomplete_sections.map((s) => (
                  <li key={s.section_id}>
                    📚 {s.grade_name} / {s.section_name} — لم تُسجَّل: {s.missing_periods.join('، ')}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {printOpts.fullAbsence && data.full_absences.length > 0 && (
            <PrintReportSection
              emoji="🔴"
              title="الغياب الكامل"
              students={data.full_absences}
              showPeriods={false}
            />
          )}

          {printOpts.escapeAfterFirst && (data.escape_after_first || []).length > 0 && (
            <PrintReportSection
              emoji="🟠"
              title="هروب بعد التحضير"
              students={data.escape_after_first || []}
              showPeriods={true}
            />
          )}

          {printOpts.midDayDeparture && (data.mid_day_departure || []).length > 0 && (
            <PrintReportSection
              emoji="🔵"
              title="انصراف منتصف اليوم"
              students={data.mid_day_departure || []}
              showPeriods={true}
            />
          )}

          {printOpts.selectiveSkip && (data.selective_skip || []).length > 0 && (
            <PrintReportSection
              emoji="🟡"
              title="تهرّب من حصص محددة"
              students={data.selective_skip || []}
              showPeriods={true}
            />
          )}

          {printOpts.dismissals && data.dismissals.length > 0 && (
            <PrintDismissalSection students={data.dismissals} />
          )}

          <div className="print-footer">
            <div className="print-signatures">
              <div>توقيع وكيل الطلاب: ............................</div>
              <div>توقيع المدير: ............................</div>
            </div>
            <p className="print-stamp">
              طُبع في: {new Date().toLocaleString('ar-SA-u-ca-gregory', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      )}

      {/* Print stylesheet — scoped to .report-print-area. */}
      <style jsx global>{`
        .report-print-area { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          .report-print-area, .report-print-area * { visibility: visible !important; }
          .report-print-area {
            display: block !important;
            position: absolute;
            inset: 0;
            background: white !important;
            color: black !important;
            padding: 6mm;
            font-family: 'Cairo', 'Tajawal', system-ui, sans-serif;
            font-size: 10.5pt;
          }
          @page { size: A4 portrait; margin: 8mm; }

          .report-print-area .print-header {
            text-align: center;
            border-bottom: 1.5pt solid #1f2937;
            padding-bottom: 6pt;
            margin-bottom: 10pt;
          }
          .report-print-area .print-header .print-kingdom {
            font-size: 9pt; color: #6b7280; margin: 0 0 2pt;
          }
          .report-print-area .print-header h1 {
            font-size: 17pt; font-weight: 800; margin: 2pt 0;
          }
          .report-print-area .print-header .print-principal {
            font-size: 10pt; margin: 2pt 0; color: #374151;
          }
          .report-print-area .print-header hr {
            border: 0; border-top: 0.5pt solid #d4d4d8; margin: 4pt 0;
          }
          .report-print-area .print-header h2 {
            font-size: 14pt; margin: 6pt 0 4pt; font-weight: 700;
          }
          .report-print-area .print-header .print-meta {
            display: flex; justify-content: space-around; flex-wrap: wrap;
            font-size: 9.5pt; margin-top: 6pt; gap: 6pt;
          }
          .report-print-area .print-header .print-meta p { margin: 0; }

          .report-print-area .print-stats {
            width: 100%; border-collapse: collapse; margin-bottom: 12pt;
          }
          .report-print-area .print-stats th,
          .report-print-area .print-stats td {
            border: 0.5pt solid #6b7280; padding: 5pt 4pt;
            text-align: center; font-size: 9pt;
          }
          .report-print-area .print-stats th {
            background: #e5e7eb; font-weight: 700;
          }
          .report-print-area .print-stats td { font-weight: 700; font-size: 11pt; }

          .report-print-area .print-incomplete {
            margin-bottom: 12pt; padding: 6pt 8pt;
            background: #fef3c7; border-right: 4pt solid #f59e0b;
          }
          .report-print-area .print-incomplete h3 {
            font-size: 11pt; margin: 0 0 4pt; color: #92400e;
          }
          .report-print-area .print-incomplete ul {
            margin: 0; padding-right: 16pt; font-size: 9pt;
          }
          .report-print-area .print-incomplete li { margin: 1pt 0; }

          .report-print-area .print-section {
            margin-bottom: 14pt;
          }
          .report-print-area .print-section > h3 {
            font-size: 13pt; font-weight: 700; margin: 0 0 4pt;
            padding: 5pt 8pt; background: #f3f4f6;
            border-right: 4pt solid #2563eb;
            page-break-after: avoid;
          }
          .report-print-area .print-section table {
            width: 100%; border-collapse: collapse;
          }
          .report-print-area .print-section thead { display: table-header-group; }
          .report-print-area .print-section th,
          .report-print-area .print-section td {
            border: 0.5pt solid #9ca3af; padding: 4pt 6pt;
            font-size: 9.5pt; text-align: right;
          }
          .report-print-area .print-section th {
            background: #f9fafb; font-weight: 700;
          }
          .report-print-area .print-section tr { page-break-inside: avoid; }

          .report-print-area .print-footer {
            margin-top: 20pt; padding-top: 6pt;
            border-top: 0.5pt solid #d4d4d8;
            page-break-inside: avoid;
          }
          .report-print-area .print-footer .print-signatures {
            display: flex; justify-content: space-between; gap: 24pt;
            font-size: 10pt; margin-bottom: 10pt;
          }
          .report-print-area .print-footer .print-stamp {
            font-size: 8.5pt; color: #6b7280;
            text-align: center; margin: 0;
          }
        }
      `}</style>
    </div>
  );
}

// Single checkbox row in the print options dialog.
function PrintCheck({
  label, count, checked, onChange,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4"
      />
      <span className="flex-1 text-sm">{label}</span>
      {typeof count === 'number' && (
        <span className="text-xs text-gray-500 font-mono">{count}</span>
      )}
    </label>
  );
}

// Per-category section in the printed report. Renders a colored heading
// and a table with row numbers, name, grade/section, student id, missed
// periods (when applicable), phone, and a blank signature column.
function PrintReportSection({
  emoji, title, students, showPeriods,
}: {
  emoji: string;
  title: string;
  students: DetectionRow[];
  showPeriods: boolean;
}) {
  return (
    <section className="print-section">
      <h3>{emoji} {title} ({students.length})</h3>
      <table>
        <thead>
          <tr>
            <th style={{ width: '6%' }}>#</th>
            <th>اسم الطالب</th>
            <th style={{ width: '14%' }}>الصف/الشعبة</th>
            <th style={{ width: '15%' }}>رقم الهوية</th>
            {showPeriods && <th style={{ width: '14%' }}>غاب من حصص</th>}
            <th style={{ width: '14%' }}>الجوال</th>
            <th style={{ width: '12%' }}>التوقيع</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s, i) => (
            <tr key={s.student_id}>
              <td style={{ textAlign: 'center' }}>{i + 1}</td>
              <td>{s.student_name}</td>
              <td style={{ textAlign: 'center' }}>{s.grade_name}/{s.section_name}</td>
              <td style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace' }}>
                {s.student_code}
              </td>
              {showPeriods && (
                <td style={{ textAlign: 'center' }}>
                  {s.absent_periods.join('، ')}
                </td>
              )}
              <td style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace' }}>
                {s.phone || '—'}
              </td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// Dismissal section — fewer columns since dismissals aren't actionable
// from this report (they were already approved by the deputy).
function PrintDismissalSection({ students }: { students: DismissalRow[] }) {
  return (
    <section className="print-section">
      <h3>🟣 المستأذنون ({students.length})</h3>
      <table>
        <thead>
          <tr>
            <th style={{ width: '8%' }}>#</th>
            <th>اسم الطالب</th>
            <th style={{ width: '20%' }}>رقم الهوية</th>
            <th style={{ width: '20%' }}>الجوال</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s, i) => (
            <tr key={s.student_id}>
              <td style={{ textAlign: 'center' }}>{i + 1}</td>
              <td>{s.student_name}</td>
              <td style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace' }}>
                {s.student_code}
              </td>
              <td style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace' }}>
                {s.phone || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// =============== Teacher skip-rate analytics ===============
// Collapsible card that pulls /api/daily-attendance/teacher-skip-stats.
// Defaults to a 30-day window. Shown at the bottom of the report so it
// doesn't push the actionable "send WhatsApp" buckets below the fold.
function TeacherSkipStats() {
  const [expanded, setExpanded] = useState(false);
  const today = todayStr();
  const thirtyDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();
  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);

  type TeacherStat = {
    teacher_user_id: string | null;
    teacher_name: string;
    subject: string | null;
    total_periods_taught: number;
    total_student_periods: number;
    total_absences: number;
    skip_rate_percent: number;
    top_students: Array<{ student_id: number; name: string; count: number }>;
  };

  const { data, isLoading, refetch, isFetching } = useQuery<{
    from: string;
    to: string;
    school_average_percent: number;
    teachers: TeacherStat[];
  }>({
    queryKey: ['teacher-skip-stats', from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      const r = await fetch(`/api/daily-attendance/teacher-skip-stats?${params}`);
      if (!r.ok) throw new Error('فشل تحميل الإحصائيات');
      return (await r.json()).data;
    },
    enabled: expanded,
  });

  return (
    <div className="card">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-start"
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <h2 className="font-semibold">📊 تحليل التهرّب لكل معلم</h2>
          <span className="text-xs text-gray-500">(يستخدم الجدول الذكي)</span>
        </div>
        <span className="text-xs text-gray-500">{expanded ? '▲ إخفاء' : '▼ عرض'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="label">من</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to} className="input" />
            </div>
            <div>
              <label className="label">إلى</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} max={today} min={from} className="input" />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="btn-primary w-full inline-flex items-center justify-center gap-1 text-sm"
              >
                {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                تحديث
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin inline text-gray-400" /></div>
          ) : !data || data.teachers.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
              لا توجد بيانات في هذه الفترة. تأكد أن الجدول الذكي مرفوع وأن هناك حضورًا مسجَّلًا.
            </p>
          ) : (
            <>
              <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-2 text-sm flex items-center gap-2">
                <span className="text-blue-700 dark:text-blue-300">المتوسط العام للمدرسة:</span>
                <span className="font-bold text-blue-900 dark:text-blue-200">{data.school_average_percent}٪</span>
              </div>

              <div className="space-y-2">
                {data.teachers.map((t, idx) => {
                  const isAbove = t.skip_rate_percent > data.school_average_percent;
                  const tone = idx < 3 && isAbove
                    ? 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10'
                    : t.skip_rate_percent <= data.school_average_percent / 2
                    ? 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10'
                    : 'border-gray-200 dark:border-gray-700';
                  return (
                    <div key={(t.teacher_user_id || t.teacher_name) + idx} className={`border rounded-lg p-3 ${tone}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{t.teacher_name}</span>
                          {t.subject && <span className="text-xs px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 border text-gray-600 dark:text-gray-300">{t.subject}</span>}
                        </div>
                        <div className="text-end">
                          <p className={`text-xl font-bold ${
                            isAbove ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'
                          }`}>{t.skip_rate_percent}٪</p>
                          <p className="text-[10px] text-gray-500">
                            {t.total_absences} غياب / {t.total_student_periods} طالب-حصة
                          </p>
                        </div>
                      </div>
                      {t.top_students.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 inline-flex items-center gap-1">
                            <Users className="w-3 h-3" /> الأكثر تهرّبًا من حصصه:
                          </p>
                          <ul className="text-xs space-y-0.5">
                            {t.top_students.map((s) => (
                              <li key={s.student_id} className="flex items-center gap-1">
                                <span>•</span>
                                <span className="flex-1 truncate">{s.name}</span>
                                <span className="text-gray-500">{s.count} مرة</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BucketCard({
  title, description, tone, rows, selected, setSelected, onSend, sending, sendLabel, showPeriods, onPrint,
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
  /** Optional quick-print handler — renders a small printer icon next to "send". */
  onPrint?: () => void;
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
          {onPrint && (
            <button
              onClick={onPrint}
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
              title="طباعة هذه الفئة"
            >
              <Printer className="w-4 h-4" />
            </button>
          )}
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
