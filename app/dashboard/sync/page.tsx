'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Download, RefreshCw, CheckCircle2, XCircle, AlertCircle, Wifi, WifiOff, Loader2, ChevronRight, Activity,
  Eye, Save, Plus, RotateCcw, MinusCircle, HelpCircle, Clock,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import CloudDeploymentBanner from '@/components/ui/CloudDeploymentBanner';

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

type ChangeKind = 'new' | 'replaces' | 'unchanged' | 'unmatched';

interface DiffRow {
  kind: ChangeKind;
  student_id: number | null;
  student_code: string | null;
  student_name: string | null;
  grade_name: string | null;
  section_name: string | null;
  device_id: number;
  device_name: string;
  punch_time: string;
  punch_local: string;
  minutes_late: number;
  old_punch_time?: string | null;
  old_minutes_late?: number | null;
  old_source?: string | null;
}

interface UnmatchedRow {
  device_id: number;
  device_name: string;
  user_id: string;
  uid: number;
  punch_time: string;
  punch_local: string;
}

interface SyncEvent {
  type: 'started' | 'device-start' | 'device-time' | 'device-progress' | 'device-error' | 'device-done' | 'aggregating' | 'comparing' | 'preview' | 'writing' | 'done' | 'error';
  device_id?: number;
  device_name?: string;
  message?: string;
  fetched?: number;
  matched?: number;
  device_time?: string;
  server_time?: string;
  drift_seconds?: number;
  drift_warning?: boolean;
  school_start_time?: string;
  total_students_late?: number;
  written?: number;
  errors?: number;
  device_results?: Array<{
    device_id: number; name: string; ok: boolean; fetched: number; matched: number;
    error?: string; device_time?: string; drift_seconds?: number;
  }>;
  dry_run?: boolean;
  diff?: { new: DiffRow[]; replaces: DiffRow[]; unchanged: DiffRow[]; unmatched: UnmatchedRow[] };
}

export default function SyncPage() {
  const [date, setDate] = useState(todayStr());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [pingStatus, setPingStatus] = useState<Record<number, 'ok' | 'fail' | 'checking'>>({});
  const abortRef = useRef<AbortController | null>(null);
  // Post-pull filters: 'all' means no filter on that axis.
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  // Show only "late" rows (minutes_late > school grace) when true.
  const [onlyLate, setOnlyLate] = useState<boolean>(false);

  const { data: devices, isLoading, refetch } = useQuery({
    queryKey: ['devices-list-sync'],
    queryFn: async () => {
      const r = await fetch('/api/devices');
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل تحميل الأجهزة');
      }
      return ((await r.json()).data || []) as any[];
    },
  });

  const allChecked = (devices || []).length > 0 && (devices || []).every((d: any) => selected.has(d.id));
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set((devices || []).map((d: any) => d.id)));
  };
  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const finalEvent = useMemo(
    () => [...events].reverse().find((e) => e.type === 'done' || e.type === 'error'),
    [events],
  );

  // Extract latest device-time per device so we can render a clock-drift panel.
  const deviceTimes = useMemo(() => {
    const m = new Map<number, SyncEvent>();
    for (const e of events) {
      if (e.type === 'device-time' && e.device_id !== undefined) m.set(e.device_id, e);
    }
    return Array.from(m.values());
  }, [events]);
  const hasDriftWarning = deviceTimes.some((e) => e.drift_warning);

  // School start time emitted by the runner (used as the lateness baseline).
  const schoolStartTime = useMemo(
    () => events.find((e) => e.type === 'started' && e.school_start_time)?.school_start_time,
    [events],
  );

  // The preview event captured during the run (last 'preview' event).
  const previewEvent = useMemo(
    () => [...events].reverse().find((e) => e.type === 'preview'),
    [events],
  );
  const previewDiff = previewEvent?.diff;
  const lastWasDryRun = !!previewEvent?.dry_run;
  const canCommit = !!previewDiff && lastWasDryRun && !running && (previewDiff.new.length + previewDiff.replaces.length) > 0;

  // Combined diff rows (new + replaces + unchanged) — what the table renders.
  const allDiffRows = useMemo<DiffRow[]>(() => {
    if (!previewDiff) return [];
    return [...previewDiff.new, ...previewDiff.replaces, ...previewDiff.unchanged];
  }, [previewDiff]);

  // Build dropdown options from the actually-pulled rows so the user only sees
  // grades/sections that have data this run.
  const gradeOptions = useMemo(() => {
    const s = new Set<string>();
    allDiffRows.forEach((r) => { if (r.grade_name) s.add(r.grade_name); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [allDiffRows]);

  const sectionOptions = useMemo(() => {
    const s = new Set<string>();
    allDiffRows.forEach((r) => {
      // Cascade: only show sections of the chosen grade, otherwise show all.
      if (r.section_name && (filterGrade === 'all' || r.grade_name === filterGrade)) {
        s.add(r.section_name);
      }
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));
  }, [allDiffRows, filterGrade]);

  // Apply filters → final rows shown in the table.
  const filteredRows = useMemo(() => {
    return allDiffRows.filter((r) => {
      if (filterGrade !== 'all' && r.grade_name !== filterGrade) return false;
      if (filterSection !== 'all' && r.section_name !== filterSection) return false;
      if (onlyLate && r.minutes_late <= 0) return false;
      return true;
    });
  }, [allDiffRows, filterGrade, filterSection, onlyLate]);

  // Per-section counts for the picked grade — useful summary above the table.
  const sectionCounts = useMemo(() => {
    const m = new Map<string, number>();
    filteredRows.forEach((r) => {
      const k = `${r.grade_name || '—'} / ${r.section_name || '—'}`;
      m.set(k, (m.get(k) || 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ar', { numeric: true }));
  }, [filteredRows]);

  // Reset section filter when grade changes (otherwise it might point at a
  // section that no longer exists under the new grade).
  useEffect(() => {
    if (filterGrade === 'all') return;
    if (filterSection !== 'all' && !sectionOptions.includes(filterSection)) {
      setFilterSection('all');
    }
  }, [filterGrade, filterSection, sectionOptions]);

  const pingMutation = useMutation({
    mutationFn: async (id: number) => {
      setPingStatus((s) => ({ ...s, [id]: 'checking' }));
      const r = await fetch(`/api/devices/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect' }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل الاتصال');
      }
      return id;
    },
    onSuccess: (id) => { setPingStatus((s) => ({ ...s, [id]: 'ok' })); toast.success('متصل'); },
    onError: (err: any, id) => { setPingStatus((s) => ({ ...s, [id]: 'fail' })); toast.error(err?.message || 'فشل الاتصال'); },
  });

  const runStream = async (dryRun: boolean) => {
    if (selected.size === 0) { toast.error('اختر جهازاً واحداً على الأقل'); return; }
    setEvents([]);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/devices/sync-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_ids: Array.from(selected), date, dry_run: dryRun }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || (dryRun ? 'فشل بدء المعاينة' : 'فشل الحفظ'));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const evt: SyncEvent = JSON.parse(line);
            setEvents((prev) => [...prev, evt]);
          } catch { /* ignore malformed line */ }
        }
      }
      if (buffer.trim()) {
        try { setEvents((prev) => [...prev, JSON.parse(buffer.trim())]); } catch { /* ignore */ }
      }
      toast.success(dryRun ? 'اكتملت المعاينة' : 'تم الحفظ');
    } catch (e: any) {
      if (e?.name === 'AbortError') toast('تم إلغاء العملية', { icon: '⚠️' });
      else toast.error(e?.message || 'حدث خطأ');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const startPreview = () => runStream(true);
  const startCommit = () => runStream(false);

  const cancel = () => {
    abortRef.current?.abort();
  };

  if (isLoading) return <SkeletonPage />;

  return (
    <div className="space-y-6">
      <CloudDeploymentBanner feature="سحب البصمات من الأجهزة" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">سحب البيانات من الأجهزة</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">سحب بصمات التأخر من جهاز أو أكثر للتاريخ المحدد</p>
          </div>
        </div>
        <button onClick={() => refetch()} className="btn-secondary inline-flex items-center justify-center gap-2 w-full sm:w-auto">
          <RefreshCw className="w-4 h-4" />
          تحديث القائمة
        </button>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="label">التاريخ</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" disabled={running} />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">يُسحب البصمات لهذا اليوم فقط؛ ما قبله يُتجاهل.</p>
          </div>
          <div className="flex items-end">
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              <strong className="block text-gray-900 dark:text-gray-100 mb-1">المنطق:</strong>
              كل بصمة تُحفَظ كتأخير. الطلاب الذين لم يبصموا = حاضرون (لا يُسجَّل غياب تلقائياً).
              لو الطالب بصم في عدة أجهزة، تُحفَظ <strong>أبكر بصمة</strong>.
            </div>
          </div>
        </div>

        {/* Device list */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">الأجهزة ({(devices || []).length})</h2>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={running} />
              اختيار الكل
            </label>
          </div>

          {(devices || []).length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">لا توجد أجهزة مسجلة</p>
          ) : (
            <ul className="space-y-2">
              {(devices || []).map((d: any) => {
                const ping = pingStatus[d.id];
                const isOnline = d.is_online;
                return (
                  <li
                    key={d.id}
                    className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border transition-colors ${
                      selected.has(d.id)
                        ? 'border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900'
                    }`}
                  >
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={() => toggleOne(d.id)}
                        disabled={running}
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{d.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">
                          {d.ip_address}:{d.port}
                          {d.section_name ? ` · ${d.section_name}` : ''}
                        </p>
                      </div>
                    </label>

                    <div className="flex items-center gap-2 shrink-0">
                      {isOnline ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400">
                          <Wifi className="w-3 h-3" />
                          متصل
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          <WifiOff className="w-3 h-3" />
                          غير متصل
                        </span>
                      )}
                      <button
                        onClick={() => pingMutation.mutate(d.id)}
                        disabled={running || ping === 'checking'}
                        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                      >
                        {ping === 'checking' ? '...' : ping === 'ok' ? '✓' : ping === 'fail' ? '✗' : 'اختبار'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={startPreview}
            disabled={running || selected.size === 0}
            className="btn-secondary inline-flex items-center justify-center gap-2 w-full sm:w-auto"
            title="جلب البيانات ومقارنتها بدون حفظ"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {running ? 'جارٍ المعاينة...' : `معاينة (${selected.size})`}
          </button>
          <button
            onClick={startCommit}
            disabled={!canCommit}
            className="btn-primary inline-flex items-center justify-center gap-2 w-full sm:w-auto"
            title={canCommit ? 'حفظ التغييرات المعروضة' : 'اعرض المعاينة أولاً'}
          >
            <Save className="w-4 h-4" />
            تأكيد الحفظ
            {previewDiff && ` (${previewDiff.new.length + previewDiff.replaces.length})`}
          </button>
          {running && (
            <button onClick={cancel} className="btn-danger inline-flex items-center justify-center gap-2 w-full sm:w-auto">
              <XCircle className="w-4 h-4" />
              إلغاء
            </button>
          )}
        </div>
      </div>

      {/* School start time banner (shown after the run starts) */}
      {schoolStartTime && (
        <div className="card border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-gray-700 dark:text-gray-200">
              وقت الدوام المعتمد:
              <strong className="font-mono ms-2 text-blue-700 dark:text-blue-300" dir="ltr">{schoolStartTime}</strong>
              <span className="text-xs text-gray-500 dark:text-gray-400 ms-2">— يحتسب التأخير من هذا الوقت</span>
            </span>
            <a href="/dashboard/settings" className="ms-auto text-xs text-blue-600 dark:text-blue-400 hover:underline">
              تعديل من الإعدادات ←
            </a>
          </div>
        </div>
      )}

      {/* Device clocks (shown after the run starts pulling) */}
      {deviceTimes.length > 0 && (
        <div className={`card ${hasDriftWarning ? 'border-yellow-300 dark:border-yellow-500/40' : ''}`}>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">فحص ساعات الأجهزة</h2>
            {hasDriftWarning && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400">
                <AlertCircle className="w-3 h-3" /> فرق كبير
              </span>
            )}
          </div>
          {hasDriftWarning && (
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-3">
              ساعة جهاز أو أكثر تختلف عن الخادم بأكثر من دقيقتين — تواريخ البصمات قد لا تطابق التاريخ المختار.
              استخدم زر «مزامنة» في صفحة الأجهزة لضبط الساعة.
            </p>
          )}
          <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الجهاز</th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">ساعة الجهاز</th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">ساعة الخادم</th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الفرق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {deviceTimes.map((e) => {
                  const drift = e.drift_seconds;
                  const driftLabel = drift === undefined
                    ? '—'
                    : Math.abs(drift) < 60
                      ? `${drift > 0 ? '+' : ''}${drift} ث`
                      : Math.abs(drift) < 3600
                        ? `${drift > 0 ? '+' : ''}${Math.round(drift / 60)} د`
                        : `${drift > 0 ? '+' : ''}${(drift / 3600).toFixed(1)} س`;
                  const tone = drift === undefined
                    ? 'text-gray-500 dark:text-gray-400'
                    : Math.abs(drift) <= 60
                      ? 'text-green-600 dark:text-green-400'
                      : Math.abs(drift) <= 600
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-red-600 dark:text-red-400';
                  return (
                    <tr key={e.device_id}>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{e.device_name}</td>
                      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300" dir="ltr">
                        {e.device_time ? new Date(e.device_time).toLocaleString('ar-SA', { hour12: false }) : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300" dir="ltr">
                        {e.server_time ? new Date(e.server_time).toLocaleString('ar-SA', { hour12: false }) : '—'}
                      </td>
                      <td className={`px-3 py-2 font-mono ${tone}`} dir="ltr">{driftLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Comparison / Diff */}
      {previewDiff && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              {lastWasDryRun ? 'معاينة المقارنة' : 'نتيجة المقارنة'}
            </h2>
            <div className="flex flex-wrap gap-2 text-xs">
              <DiffBadge tone="green" Icon={Plus} label="جديد" count={previewDiff.new.length} />
              <DiffBadge tone="blue" Icon={RotateCcw} label="استبدال" count={previewDiff.replaces.length} />
              <DiffBadge tone="gray" Icon={MinusCircle} label="بلا تغيير" count={previewDiff.unchanged.length} />
              <DiffBadge tone="yellow" Icon={HelpCircle} label="بصمات بلا طالب" count={previewDiff.unmatched.length} />
            </div>
          </div>

          {allDiffRows.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">لا توجد بصمات لطلاب لهذا التاريخ</p>
          ) : (
            <>
              {/* Filters: grade / section / only-late */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <label className="label">الصف</label>
                  <select
                    value={filterGrade}
                    onChange={(e) => setFilterGrade(e.target.value)}
                    className="input"
                  >
                    <option value="all">كل الصفوف ({gradeOptions.length})</option>
                    {gradeOptions.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-0">
                  <label className="label">الشعبة</label>
                  <select
                    value={filterSection}
                    onChange={(e) => setFilterSection(e.target.value)}
                    className="input"
                    disabled={sectionOptions.length === 0}
                  >
                    <option value="all">كل الشُعب ({sectionOptions.length})</option>
                    {sectionOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 sm:pb-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyLate}
                      onChange={(e) => setOnlyLate(e.target.checked)}
                    />
                    المتأخرون فقط
                  </label>
                  {(filterGrade !== 'all' || filterSection !== 'all' || onlyLate) && (
                    <button
                      onClick={() => { setFilterGrade('all'); setFilterSection('all'); setOnlyLate(false); }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                    >
                      مسح الفلاتر
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                المعروض: <strong className="text-gray-900 dark:text-gray-100">{filteredRows.length}</strong> من {allDiffRows.length}
                {sectionCounts.length > 1 && filteredRows.length > 0 && (
                  <span className="ms-3 inline-flex flex-wrap gap-1.5">
                    {sectionCounts.slice(0, 8).map(([k, v]) => (
                      <span key={k} className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                        {k}: <strong>{v}</strong>
                      </span>
                    ))}
                    {sectionCounts.length > 8 && (
                      <span className="text-gray-500 dark:text-gray-400">+{sectionCounts.length - 8} أخرى</span>
                    )}
                  </span>
                )}
              </div>

              {filteredRows.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">لا توجد نتائج بعد تطبيق الفلاتر</p>
              ) : (
                <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-gray-200 dark:border-gray-800">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr className="text-right">
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الحالة</th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">رقم الهوية</th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الاسم</th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الصف</th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الشعبة</th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الجهاز</th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">وقت البصمة</th>
                        <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">دقائق التأخير</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {filteredRows.map((r, idx) => (
                        <DiffRow key={`${r.kind}-${r.student_id}-${idx}`} row={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {previewDiff.unmatched.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-yellow-700 dark:text-yellow-400 font-medium">
                {previewDiff.unmatched.length} بصمة لم تُطابق أي طالب — انقر للتفاصيل
              </summary>
              <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto text-xs text-gray-600 dark:text-gray-400 font-mono">
                {previewDiff.unmatched.map((u, i) => (
                  <li key={i} dir="ltr">
                    [{u.device_name}] uid={u.uid} userId={`"${u.user_id}"`} — {u.punch_local}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Live progress log */}
      {events.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            سجل العملية
          </h2>
          <div className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-800">
            {events.map((e, i) => <ProgressLine key={i} e={e} />)}
          </div>
        </div>
      )}

      {/* Final summary */}
      {finalEvent && (
        <div className={`card ${finalEvent.type === 'error' ? 'border-red-200 dark:border-red-500/30' : 'border-green-200 dark:border-green-500/30'}`}>
          <div className="flex items-center gap-2 mb-3">
            {finalEvent.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            )}
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              {finalEvent.type === 'error' ? 'فشل السحب' : 'اكتمل السحب'}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <Stat label="عدد الطلاب المتأخرين" value={finalEvent.total_students_late ?? 0} />
            <Stat label="السجلات المكتوبة" value={finalEvent.written ?? 0} />
            <Stat label="أجهزة فاشلة" value={finalEvent.errors ?? 0} tone={finalEvent.errors ? 'red' : 'gray'} />
          </div>

          {finalEvent.message && (
            <p className={`text-sm ${finalEvent.type === 'error' ? 'text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
              {finalEvent.message}
            </p>
          )}

          {(finalEvent.device_results?.length ?? 0) > 0 && (
            <div className="mt-3 overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[480px]">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr className="text-right">
                    <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الجهاز</th>
                    <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الحالة</th>
                    <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">سجلات الجهاز</th>
                    <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">طلاب مطابقون</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {finalEvent.device_results!.map((r) => (
                    <tr key={r.device_id}>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{r.name}</td>
                      <td className="px-3 py-2">
                        {r.ok ? (
                          <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> نجاح
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                            <XCircle className="w-3.5 h-3.5" /> {r.error || 'فشل'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{r.fetched}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{r.matched}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffBadge({ Icon, label, count, tone }: { Icon: any; label: string; count: number; tone: 'green' | 'blue' | 'gray' | 'yellow' }) {
  const cls =
    tone === 'green' ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' :
    tone === 'blue' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' :
    tone === 'yellow' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400' :
    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${cls}`}>
      <Icon className="w-3 h-3" />
      {label}: <strong>{count}</strong>
    </span>
  );
}

function DiffRow({ row }: { row: DiffRow }) {
  const kindMeta: Record<ChangeKind, { label: string; cls: string }> = {
    new:        { label: 'جديد',     cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' },
    replaces:   { label: 'استبدال',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
    unchanged:  { label: 'بلا تغيير', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
    unmatched:  { label: 'بلا طالب', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400' },
  };
  const m = kindMeta[row.kind];
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
      <td className="px-3 py-2">
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${m.cls}`}>{m.label}</span>
      </td>
      <td className="px-3 py-2 font-mono text-gray-900 dark:text-gray-100" dir="ltr">{row.student_code || '—'}</td>
      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{row.student_name || '—'}</td>
      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.grade_name || '—'}</td>
      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.section_name || '—'}</td>
      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.device_name}</td>
      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300" dir="ltr">
        {row.punch_local}
        {row.kind === 'replaces' && row.old_punch_time && (
          <span className="block text-xs text-gray-400 line-through">
            {new Date(row.old_punch_time).toLocaleTimeString('ar-SA', { hour12: false })}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
        {row.minutes_late}
        {row.kind === 'replaces' && row.old_minutes_late != null && row.old_minutes_late !== row.minutes_late && (
          <span className="text-xs text-gray-400 line-through ms-2">{row.old_minutes_late}</span>
        )}
      </td>
    </tr>
  );
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'red' | 'green' }) {
  const cls =
    tone === 'red'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'green'
      ? 'text-green-600 dark:text-green-400'
      : 'text-gray-900 dark:text-gray-100';
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50 dark:bg-gray-900">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
    </div>
  );
}

function ProgressLine({ e }: { e: SyncEvent }) {
  const base = 'flex items-start gap-2 py-0.5';
  switch (e.type) {
    case 'started':
      return <div className={`${base} text-blue-600 dark:text-blue-400`}><ChevronRight className="w-3 h-3 mt-0.5" /><span>{e.message}</span></div>;
    case 'device-start':
      return <div className={`${base} text-gray-700 dark:text-gray-300`}><Loader2 className="w-3 h-3 mt-0.5 animate-spin" /><span>الاتصال بـ{e.device_name}...</span></div>;
    case 'device-time':
      return (
        <div className={`${base} ${e.drift_warning ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
          {e.drift_warning ? <AlertCircle className="w-3 h-3 mt-0.5" /> : <ChevronRight className="w-3 h-3 mt-0.5" />}
          <span>{e.device_name}: {e.message}</span>
        </div>
      );
    case 'device-done':
      return <div className={`${base} text-green-600 dark:text-green-400`}><CheckCircle2 className="w-3 h-3 mt-0.5" /><span>{e.device_name}: جلب {e.fetched} سجل، طابق {e.matched} طالب</span></div>;
    case 'device-error':
      return <div className={`${base} text-red-600 dark:text-red-400`}><XCircle className="w-3 h-3 mt-0.5" /><span>{e.device_name}: {e.message}</span></div>;
    case 'aggregating':
      return <div className={`${base} text-purple-600 dark:text-purple-400`}><ChevronRight className="w-3 h-3 mt-0.5" /><span>تجميع وحذف المكررات ({e.total_students_late} طالب)</span></div>;
    case 'comparing':
      return <div className={`${base} text-blue-600 dark:text-blue-400`}><ChevronRight className="w-3 h-3 mt-0.5" /><span>{e.message}</span></div>;
    case 'preview':
      return <div className={`${base} text-blue-700 dark:text-blue-300`}><Eye className="w-3 h-3 mt-0.5" /><span>المعاينة: {e.diff?.new.length} جديد، {e.diff?.replaces.length} استبدال، {e.diff?.unchanged.length} بلا تغيير</span></div>;
    case 'writing':
      return <div className={`${base} text-blue-600 dark:text-blue-400`}><ChevronRight className="w-3 h-3 mt-0.5" /><span>{e.message}</span></div>;
    case 'done':
      return <div className={`${base} text-green-700 dark:text-green-300 font-semibold`}><CheckCircle2 className="w-3 h-3 mt-0.5" /><span>{e.message}</span></div>;
    case 'error':
      return <div className={`${base} text-red-700 dark:text-red-300 font-semibold`}><AlertCircle className="w-3 h-3 mt-0.5" /><span>{e.message}</span></div>;
    default:
      return null;
  }
}
