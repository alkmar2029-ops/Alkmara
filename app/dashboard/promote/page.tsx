'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Archive, ArrowUp, CalendarCheck, CheckCircle2,
  Fingerprint, GraduationCap, History, RotateCcw, ShieldCheck,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import {
  getDefaultAcademicYearDates, getNextAcademicYearName, rolloverConfirmation,
} from '@/lib/academic-years';

type PreviewItem = {
  grade_id: number;
  grade_name: string;
  student_count: number;
  action: 'graduate' | 'promote';
  next_grade_name: string | null;
};

type AcademicYear = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: 'planned' | 'open' | 'closed' | 'cancelled';
  opened_at: string | null;
  closed_at: string | null;
};

type RolloverHistory = {
  id: string;
  status: 'running' | 'completed' | 'reversed' | 'failed';
  promoted_count: number;
  graduated_count: number;
  unassigned_section_count: number;
  completed_at: string | null;
  can_rollback?: boolean;
};

type AcademicYearsData = {
  current_year: AcademicYear | null;
  preview: PreviewItem[];
  total_students: number;
  promoted_count: number;
  graduated_count: number;
  devices_to_resync: number;
  years: AcademicYear[];
  rollovers: RolloverHistory[];
  rollback: RolloverHistory | null;
};

type RolloverResult = {
  rollover_id: string;
  from_year: string;
  to_year: string;
  promoted: number;
  graduated: number;
  unassigned_sections: number;
};

async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'حدث خطأ غير متوقع');
  return result.data as T;
}
export default function PromotePage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ newYearName: '', startDate: '', endDate: '', confirmation: '' });
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [result, setResult] = useState<RolloverResult | null>(null);
  const [rollbackConfirmation, setRollbackConfirmation] = useState('');

  const query = useQuery<AcademicYearsData>({
    queryKey: ['academic-years'],
    queryFn: async () => readJson<AcademicYearsData>(await fetch('/api/academic-years')),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const currentName = query.data?.current_year?.name || '';
  useEffect(() => {
    if (!currentName || initializedFor === currentName) return;
    const nextName = getNextAcademicYearName(currentName);
    const dates = getDefaultAcademicYearDates(nextName);
    setForm({ newYearName: nextName, startDate: dates.startDate, endDate: dates.endDate, confirmation: '' });
    setInitializedFor(currentName);
  }, [currentName, initializedFor]);

  const expectedConfirmation = useMemo(() => rolloverConfirmation(form.newYearName), [form.newYearName]);

  const rolloverMutation = useMutation({
    mutationFn: async () => readJson<RolloverResult>(await fetch('/api/academic-years', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rollover',
        new_year_name: form.newYearName,
        start_date: form.startDate,
        end_date: form.endDate,
        confirmation: form.confirmation,
        idempotency_key: crypto.randomUUID(),
      }),
    })),
    onSuccess: async (data) => {
      setResult(data);
      setForm((previous) => ({ ...previous, confirmation: '' }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['academic-years'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['students'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast.success(`تم فتح العام الدراسي ${data.to_year} بنجاح`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rollbackMutation = useMutation({
    mutationFn: async () => {
      const rolloverId = query.data?.rollback?.id;
      if (!rolloverId) throw new Error('لا توجد عملية قابلة للتراجع');
      return readJson<{ restored_students: number; current_year: string }>(await fetch('/api/academic-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', rollover_id: rolloverId, confirmation: rollbackConfirmation }),
      }));
    },
    onSuccess: async (data) => {
      setResult(null);
      setRollbackConfirmation('');
      setInitializedFor(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['academic-years'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['students'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast.success(`تمت استعادة ${data.restored_students} طالب والعودة إلى ${data.current_year}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changeYearName = (name: string) => {
    const dates = getDefaultAcademicYearDates(name);
    setForm((previous) => ({
      ...previous,
      newYearName: name,
      startDate: dates.startDate || previous.startDate,
      endDate: dates.endDate || previous.endDate,
      confirmation: '',
    }));
  };

  if (query.isLoading) return <SkeletonPage />;
  if (query.isError || !query.data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300">
        {(query.error as Error)?.message || 'تعذر تحميل بيانات العام الدراسي'}
      </div>
    );
  }

  const data = query.data;
  const canSubmit = Boolean(
    form.newYearName && form.startDate && form.endDate && form.endDate > form.startDate
      && form.confirmation === expectedConfirmation && !rolloverMutation.isPending,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-100 p-2.5 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          <CalendarCheck className="h-7 w-7" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">إغلاق وفتح عام دراسي</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">أرشفة العام الحالي وترقية الطلاب مع الاحتفاظ بجميع السجلات التاريخية.</p>
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/15">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h3 className="font-bold text-emerald-900 dark:text-emerald-100">تم افتتاح {result.to_year}</h3>
              <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                رُقّي {result.promoted} طالب، وأُرشف {result.graduated} خريج.
                {result.unassigned_sections > 0 && ` يوجد ${result.unassigned_sections} طالب يحتاج تعيين شعبة.`}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="العام الحالي" value={data.current_year?.name || 'غير محدد'} icon={<Archive className="h-5 w-5" />} />
        <StatCard label="سيتم ترقيتهم" value={data.promoted_count} icon={<ArrowUp className="h-5 w-5" />} />
        <StatCard label="سيتم تخريجهم" value={data.graduated_count} icon={<GraduationCap className="h-5 w-5" />} />
        <StatCard label="أجهزة تحتاج مزامنة" value={data.devices_to_resync} icon={<Fingerprint className="h-5 w-5" />} />
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-500/30 dark:bg-blue-500/10">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" />
          <div className="text-sm text-blue-900 dark:text-blue-100">
            <p className="font-semibold">ما الذي سيبقى محفوظاً؟</p>
            <p className="mt-1 leading-6">لن يُحذف الحضور أو الملاحظات أو الحالات أو التقارير. سيُحفظ صف وشعبة كل طالب في العام الحالي، ثم يُفتح قيد جديد للعام القادم. الخريجون يتحولون إلى مؤرشفين غير نشطين.</p>
          </div>
        </div>
      </div>

      <section className="card">
        <h3 className="mb-4 text-lg font-semibold">معاينة انتقال الطلاب</h3>
        <div className="space-y-3">
          {data.preview.map((item) => (
            <div key={item.grade_id} className={`flex items-center gap-4 rounded-xl border p-4 ${item.action === 'graduate' ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10' : 'border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10'}`}>
              <div className={`rounded-full p-2 ${item.action === 'graduate' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'}`}>
                {item.action === 'graduate' ? <GraduationCap className="h-5 w-5" /> : <ArrowUp className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.grade_name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{item.action === 'graduate' ? 'تخريج وأرشفة' : `ترقية إلى ${item.next_grade_name || 'الصف التالي'}`}</p>
              </div>
              <div className="text-center"><p className="text-2xl font-bold">{item.student_count}</p><p className="text-xs text-gray-500">طالب</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-5">
        <div><h3 className="text-lg font-semibold">بيانات العام الدراسي الجديد</h3><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">راجع الاسم والتواريخ قبل التنفيذ.</p></div>
        <div className="grid gap-4 md:grid-cols-3">
          <div><label className="label">العام الدراسي</label><input className="input" dir="ltr" value={form.newYearName} onChange={(event) => changeYearName(event.target.value)} placeholder="2026-2027" /></div>
          <div><label className="label">تاريخ البداية</label><input type="date" className="input" value={form.startDate} onChange={(event) => setForm((previous) => ({ ...previous, startDate: event.target.value }))} /></div>
          <div><label className="label">تاريخ النهاية</label><input type="date" className="input" value={form.endDate} onChange={(event) => setForm((previous) => ({ ...previous, endDate: event.target.value }))} /></div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="text-sm text-amber-900 dark:text-amber-100">
              <p className="font-semibold">بعد التنفيذ</p>
              <ul className="mt-2 list-inside list-disc space-y-1 leading-6"><li>أضف الطلاب المستجدين وراجع الطلاب الذين لم تُطابق شعبهم.</li><li>راجع إسنادات المعلمين والجداول والإشراف.</li><li>أعد إرسال الطلاب إلى أجهزة البصمة ثم نفّذ تجربة حضور.</li></ul>
            </div>
          </div>
        </div>

        <div><label className="label">للتأكيد اكتب: <span className="font-bold text-red-600">{expectedConfirmation}</span></label><input className="input" value={form.confirmation} onChange={(event) => setForm((previous) => ({ ...previous, confirmation: event.target.value }))} autoComplete="off" /></div>
        <button type="button" className="btn-danger flex w-full items-center justify-center gap-2" disabled={!canSubmit} onClick={() => rolloverMutation.mutate()}>
          <CalendarCheck className="h-5 w-5" />{rolloverMutation.isPending ? 'جاري أرشفة العام وفتح العام الجديد...' : `إغلاق ${currentName} وفتح ${form.newYearName}`}
        </button>
      </section>

      {data.rollback?.can_rollback && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-start gap-3">
            <RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-gray-600 dark:text-gray-300" />
            <div className="flex-1"><h3 className="font-semibold">التراجع الآمن</h3><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">متاح خلال 24 ساعة فقط، ويتوقف تلقائياً عند تسجيل حضور أو إضافة بيانات في العام الجديد.</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row"><input className="input flex-1" placeholder="اكتب: تراجع" value={rollbackConfirmation} onChange={(event) => setRollbackConfirmation(event.target.value)} /><button type="button" className="btn-secondary flex items-center justify-center gap-2" disabled={rollbackConfirmation !== 'تراجع' || rollbackMutation.isPending} onClick={() => rollbackMutation.mutate()}><RotateCcw className="h-4 w-4" />{rollbackMutation.isPending ? 'جاري الاستعادة...' : 'التراجع عن افتتاح العام'}</button></div>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="mb-4 flex items-center gap-2"><History className="h-5 w-5 text-gray-500" /><h3 className="text-lg font-semibold">سجل السنوات الدراسية</h3></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-gray-200 text-gray-500 dark:border-gray-800 dark:text-gray-400"><th className="px-3 py-3 text-start">العام</th><th className="px-3 py-3 text-start">البداية</th><th className="px-3 py-3 text-start">النهاية</th><th className="px-3 py-3 text-start">الحالة</th></tr></thead><tbody>
          {data.years.map((year) => <tr key={year.id} className="border-b border-gray-100 dark:border-gray-900"><td className="px-3 py-3 font-medium" dir="ltr">{year.name}</td><td className="px-3 py-3" dir="ltr">{year.start_date}</td><td className="px-3 py-3" dir="ltr">{year.end_date}</td><td className="px-3 py-3"><YearStatus status={year.status} /></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return <div className="card flex items-center gap-3 p-4"><div className="rounded-lg bg-gray-100 p-2 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{icon}</div><div><p className="text-xs text-gray-500 dark:text-gray-400">{label}</p><p className="mt-0.5 text-xl font-bold" dir={typeof value === 'string' ? 'ltr' : undefined}>{value}</p></div></div>;
}

function YearStatus({ status }: { status: AcademicYear['status'] }) {
  const labels: Record<AcademicYear['status'], string> = { open: 'مفتوح', closed: 'مؤرشف', planned: 'مخطط', cancelled: 'ملغي' };
  const styles: Record<AcademicYear['status'], string> = {
    open: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    closed: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    planned: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    cancelled: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>{labels[status]}</span>;
}
