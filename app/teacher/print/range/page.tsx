'use client';

import { useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, Printer, ArrowRight, ClipboardCheck } from 'lucide-react';

interface SessionRow {
  id: number;
  attendance_date: string;
  recorded_at: string;
  section_name: string | null;
  grade_name: string | null;
  period_number: number | null;
  absent_count: number;
  late_count: number;
  excused_count: number;
  total_count: number;
}

function formatDateAr(d: string): string {
  try {
    return new Date(d).toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return d; }
}

export default function TeacherRangePrintPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <RangeBody />
    </Suspense>
  );
}

function RangeBody() {
  const sp = useSearchParams();
  const from = sp.get('from') || '';
  const to = sp.get('to') || from;
  const isSingleDay = from === to;

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data,
  });

  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: p } = await supabase
        .from('user_profiles')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();
      return { full_name: p?.full_name as string || user.email };
    },
  });

  const { data: sessions = [], isLoading } = useQuery<SessionRow[]>({
    queryKey: ['my-range-print', from, to],
    queryFn: async () => {
      const p = new URLSearchParams({ mine: '1', from, to, limit: '500' });
      return (await (await fetch(`/api/period-attendance/history?${p}`)).json()).data;
    },
    enabled: !!from,
  });

  // Pull session details (with absences) for each session in parallel.
  const { data: details = {}, isLoading: detailsLoading } = useQuery<Record<number, any>>({
    queryKey: ['my-range-details', sessions.map((s) => s.id).join(',')],
    queryFn: async () => {
      if (sessions.length === 0) return {};
      const results = await Promise.all(
        sessions.map((s) => fetch(`/api/period-attendance/session/${s.id}`).then((r) => r.json()).then((j) => [s.id, j.data]))
      );
      return Object.fromEntries(results);
    },
    enabled: sessions.length > 0,
  });

  useEffect(() => {
    if (from && to) {
      document.title = isSingleDay
        ? `حصصي — ${formatDateAr(from)}`
        : `حصصي — ${from} إلى ${to}`;
    }
    return () => { document.title = 'نظام الحضور'; };
  }, [from, to, isSingleDay]);

  const totals = useMemo(() => sessions.reduce((acc, s) => {
    const present = s.total_count - s.absent_count - s.late_count - s.excused_count;
    return {
      sessions: acc.sessions + 1,
      present: acc.present + present,
      absent: acc.absent + s.absent_count,
      late: acc.late + s.late_count,
      excused: acc.excused + s.excused_count,
      total: acc.total + s.total_count,
    };
  }, { sessions: 0, present: 0, absent: 0, late: 0, excused: 0, total: 0 }), [sessions]);

  const allAbsences = useMemo(() => {
    const out: any[] = [];
    for (const s of sessions) {
      const detail = details[s.id];
      if (!detail) continue;
      for (const stu of detail.students) {
        if (stu.status === 'present') continue;
        out.push({
          date: s.attendance_date,
          period: s.period_number,
          grade: s.grade_name,
          section: s.section_name,
          name: stu.name,
          student_id: stu.student_id,
          status: stu.status,
          notes: stu.notes,
        });
      }
    }
    return out.sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      return d !== 0 ? d : (a.period || 0) - (b.period || 0);
    });
  }, [sessions, details]);

  const STATUS_LABEL: Record<string, string> = { absent: 'غائب', late: 'متأخر', excused: 'مستأذن' };

  if (!from) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">يجب تحديد التاريخ في الرابط (?from=YYYY-MM-DD)</div>;
  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  return (
    <>
      <style jsx global>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; }
          .no-print { display: none !important; }
          .pagebreak-before { page-break-before: always; break-before: page; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 -mx-4 -mt-4 px-4 py-3 mb-4 flex items-center justify-between">
        <div>
          <Link href="/teacher/history" className="btn-secondary inline-flex items-center gap-1 text-sm">
            <ArrowRight className="w-4 h-4" /> رجوع
          </Link>
        </div>
        <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1 text-sm">
          <Printer className="w-4 h-4" /> طباعة / حفظ PDF
        </button>
      </div>

      <div className="print-area bg-white text-black mx-auto max-w-[210mm] p-6">
        <div className="text-center pb-3 border-b-2 border-gray-800 mb-4">
          <p className="text-xs text-gray-600">المملكة العربية السعودية — وزارة التعليم</p>
          <h1 className="text-xl font-bold">{settings?.school_name || 'المدرسة'}</h1>
          <p className="text-sm font-semibold mt-2 inline-flex items-center gap-1.5">
            <ClipboardCheck className="w-4 h-4" />
            {isSingleDay ? 'تقرير حصص اليوم' : 'تقرير حصص الفترة'}
          </p>
          <p className="text-xs text-gray-700 mt-1">
            {isSingleDay ? formatDateAr(from) : `${formatDateAr(from)} إلى ${formatDateAr(to)}`}
          </p>
          {profile?.full_name && <p className="text-xs mt-1">المعلم: {profile.full_name}</p>}
        </div>

        {/* Totals */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          <Stat label="جلسات" value={totals.sessions} />
          <Stat label="حاضر" value={totals.present} tone="green" />
          <Stat label="غياب" value={totals.absent} tone="red" />
          <Stat label="تأخر" value={totals.late} tone="yellow" />
          <Stat label="استئذان" value={totals.excused} tone="blue" />
        </div>

        {/* Sessions list */}
        <h2 className="text-sm font-bold bg-gray-100 px-2 py-1 mb-2">قائمة الجلسات ({sessions.length})</h2>
        <table className="w-full text-xs border-collapse mb-4">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-300 px-2 py-1">#</th>
              <th className="border border-gray-300 px-2 py-1">التاريخ</th>
              <th className="border border-gray-300 px-2 py-1">الحصة</th>
              <th className="border border-gray-300 px-2 py-1">الصف/الشعبة</th>
              <th className="border border-gray-300 px-2 py-1">حاضر</th>
              <th className="border border-gray-300 px-2 py-1">غياب</th>
              <th className="border border-gray-300 px-2 py-1">تأخر</th>
              <th className="border border-gray-300 px-2 py-1">استئذان</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => {
              const present = s.total_count - s.absent_count - s.late_count - s.excused_count;
              return (
                <tr key={s.id}>
                  <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
                  <td className="border border-gray-300 px-2 py-1">{formatDateAr(s.attendance_date)}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{s.period_number}</td>
                  <td className="border border-gray-300 px-2 py-1">{s.grade_name} / {s.section_name}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center font-bold text-green-700">{present}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center text-red-700">{s.absent_count || '—'}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center text-yellow-700">{s.late_count || '—'}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center text-blue-700">{s.excused_count || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* All absences */}
        {!detailsLoading && allAbsences.length > 0 && (
          <div className="pagebreak-before">
            <h2 className="text-sm font-bold bg-red-50 border-b-2 border-red-300 px-2 py-1 mb-2">
              تفاصيل الغياب ({allAbsences.length})
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-2 py-1">#</th>
                  <th className="border border-gray-300 px-2 py-1">التاريخ</th>
                  <th className="border border-gray-300 px-2 py-1">الحصة</th>
                  <th className="border border-gray-300 px-2 py-1">الاسم</th>
                  <th className="border border-gray-300 px-2 py-1">الصف/الشعبة</th>
                  <th className="border border-gray-300 px-2 py-1">الحالة</th>
                  <th className="border border-gray-300 px-2 py-1">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {allAbsences.map((r, i) => (
                  <tr key={`${r.date}-${r.period}-${r.student_id}-${i}`}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
                    <td className="border border-gray-300 px-2 py-1">{new Date(r.date).toLocaleDateString('ar-SA')}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{r.period}</td>
                    <td className="border border-gray-300 px-2 py-1">{r.name}</td>
                    <td className="border border-gray-300 px-2 py-1">{r.grade} / {r.section}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{STATUS_LABEL[r.status] || r.status}</td>
                    <td className="border border-gray-300 px-2 py-1 text-[10px]">{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-2 gap-12 mt-12 pt-6 border-t border-gray-300 text-sm text-center">
          <div>
            <p className="font-semibold mb-12">المعلم</p>
            <div className="border-t border-gray-400 mx-6"><p className="text-xs text-gray-500 pt-1">التوقيع</p></div>
          </div>
          <div>
            <p className="font-semibold mb-12">{settings?.principal_name ? `المدير / ${settings.principal_name}` : 'مدير المدرسة'}</p>
            <div className="border-t border-gray-400 mx-6"><p className="text-xs text-gray-500 pt-1">التوقيع والختم</p></div>
          </div>
        </div>

        <div className="text-center text-[10px] text-gray-500 mt-3 pt-2 border-t border-gray-200">
          صدر هذا التقرير من نظام إدارة الحضور المدرسي • {new Date().toLocaleString('ar-SA')}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number | string; tone?: 'gray'|'green'|'red'|'yellow'|'blue' }) {
  const cls = {
    gray:   'bg-gray-50 text-gray-900 border-gray-300',
    green:  'bg-green-50 text-green-700 border-green-300',
    red:    'bg-red-50 text-red-700 border-red-300',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-300',
    blue:   'bg-blue-50 text-blue-700 border-blue-300',
  }[tone];
  return (
    <div className={`border ${cls} rounded px-2 py-2 text-center`}>
      <p className="text-[10px] font-medium">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
