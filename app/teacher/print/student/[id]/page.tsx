'use client';

import { useEffect, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, Printer, ArrowRight, User } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'مستأذن',
};
const STATUS_COLOR: Record<string, string> = {
  present: '#22c55e', absent: '#ef4444', late: '#eab308', excused: '#3b82f6',
};

function formatDateAr(d: string): string {
  try {
    return new Date(d).toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return d; }
}

export default function TeacherStudentPrintPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <PrintBody />
    </Suspense>
  );
}

function PrintBody() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const studentId = params?.id;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data,
  });

  const { data, isLoading } = useQuery<any>({
    queryKey: ['student-print', studentId, from, to],
    queryFn: async () => {
      const p = new URLSearchParams({ student_id: String(studentId) });
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const r = await fetch(`/api/teacher/student-history?${p}`);
      return (await r.json()).data;
    },
    enabled: !!studentId,
  });

  useEffect(() => {
    if (data) document.title = `سجل الطالب — ${data.student.name}`;
    return () => { document.title = 'نظام الحضور'; };
  }, [data]);

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  if (!data) return <div className="text-center py-12 text-red-600 dark:text-red-400">تعذّر التحميل</div>;

  return (
    <>
      <style jsx global>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 -mx-4 -mt-4 px-4 py-3 mb-4 flex items-center justify-between">
        <Link href="/teacher/history" className="btn-secondary inline-flex items-center gap-1 text-sm">
          <ArrowRight className="w-4 h-4" /> رجوع
        </Link>
        <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1 text-sm">
          <Printer className="w-4 h-4" /> طباعة / حفظ PDF
        </button>
      </div>

      <div className="print-area bg-white text-black mx-auto max-w-[210mm] p-6">
        <div className="text-center pb-3 border-b-2 border-gray-800 mb-4">
          <p className="text-xs text-gray-600">المملكة العربية السعودية — وزارة التعليم</p>
          <h1 className="text-xl font-bold">{settings?.school_name || 'المدرسة'}</h1>
          <p className="text-sm font-semibold mt-2 inline-flex items-center gap-1.5">
            <User className="w-4 h-4" />
            سجل حضور الطالب
          </p>
          {(from || to) && (
            <p className="text-xs text-gray-600 mt-1">
              الفترة: {from && formatDateAr(from)} {to && `إلى ${formatDateAr(to)}`}
            </p>
          )}
        </div>

        <table className="w-full text-sm border-collapse mb-4">
          <tbody>
            <tr>
              <td className="border border-gray-300 px-3 py-1.5 font-semibold bg-gray-50 w-1/4">اسم الطالب:</td>
              <td className="border border-gray-300 px-3 py-1.5 font-bold" colSpan={3}>{data.student.name}</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-1.5 font-semibold bg-gray-50">رقم الهوية:</td>
              <td className="border border-gray-300 px-3 py-1.5 font-mono" dir="ltr">{data.student.student_code}</td>
              <td className="border border-gray-300 px-3 py-1.5 font-semibold bg-gray-50 w-1/4">الصف / الشعبة:</td>
              <td className="border border-gray-300 px-3 py-1.5">{data.student.grade} / {data.student.section}</td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-5 gap-2 mb-4">
          <Stat label="جلسات" value={data.summary.total} />
          <Stat label="معدل الحضور" value={`${data.summary.attendance_rate}%`} tone="green" />
          <Stat label="غياب" value={data.summary.absent} tone="red" />
          <Stat label="تأخر" value={data.summary.late} tone="yellow" />
          <Stat label="استئذان" value={data.summary.excused} tone="blue" />
        </div>

        {/* Heatmap of timeline */}
        <div className="mb-4">
          <h3 className="text-sm font-bold mb-2 bg-gray-100 px-2 py-1">الخط الزمني</h3>
          <div className="flex flex-wrap gap-0.5 p-2 border border-gray-300 rounded">
            {data.timeline.map((t: any) => (
              <div
                key={t.session_id}
                className="w-4 h-4 rounded-sm"
                style={{ backgroundColor: STATUS_COLOR[t.status] }}
                title={`${t.attendance_date} • حصة ${t.period_number} • ${STATUS_LABEL[t.status]}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-600">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{backgroundColor: STATUS_COLOR.present}} /> حاضر</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{backgroundColor: STATUS_COLOR.absent}} /> غائب</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{backgroundColor: STATUS_COLOR.late}} /> متأخر</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{backgroundColor: STATUS_COLOR.excused}} /> مستأذن</span>
          </div>
        </div>

        {/* Detailed timeline (only non-present rows by default to save paper) */}
        {data.timeline.filter((t: any) => t.status !== 'present').length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-bold mb-2 bg-red-50 px-2 py-1">سجل الغياب التفصيلي</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-2 py-1 w-10">#</th>
                  <th className="border border-gray-300 px-2 py-1">التاريخ</th>
                  <th className="border border-gray-300 px-2 py-1 w-20">الحصة</th>
                  <th className="border border-gray-300 px-2 py-1 w-20">الحالة</th>
                  <th className="border border-gray-300 px-2 py-1">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {data.timeline.filter((t: any) => t.status !== 'present').map((t: any, i: number) => (
                  <tr key={t.session_id}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
                    <td className="border border-gray-300 px-2 py-1">{formatDateAr(t.attendance_date)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{t.period_number}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{STATUS_LABEL[t.status]}</td>
                    <td className="border border-gray-300 px-2 py-1 text-[10px] text-gray-600">{t.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-2 gap-12 mt-12 pt-6 border-t border-gray-300 text-sm text-center">
          <div>
            <p className="font-semibold mb-12">المعلم / الموجّه الطلابي</p>
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
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
