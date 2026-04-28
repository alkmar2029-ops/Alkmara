'use client';

import { useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, Printer, ArrowRight, ClipboardCheck } from 'lucide-react';

interface SessionDetail {
  session: {
    id: number;
    attendance_date: string;
    recorded_at: string;
    teacher_name: string | null;
    section_name: string | null;
    grade_name: string | null;
    period_number: number | null;
    period_name: string | null;
    notes: string | null;
  };
  summary: { total: number; present: number; absent: number; late: number; excused: number };
  students: Array<{
    id: number;
    student_id: string;
    name: string;
    status: 'present' | 'absent' | 'late' | 'excused';
    notes: string | null;
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'مستأذن',
};

function formatDateAr(d: string): string {
  try {
    return new Date(d).toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return d; }
}

export default function TeacherSessionPrintPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data,
  });

  const { data, isLoading } = useQuery<SessionDetail>({
    queryKey: ['session-detail', sessionId],
    queryFn: async () => (await (await fetch(`/api/period-attendance/session/${sessionId}`)).json()).data,
    enabled: !!sessionId,
  });

  useEffect(() => {
    if (data) document.title = `حصة — ${data.session.section_name} • ${formatDateAr(data.session.attendance_date)}`;
    return () => { document.title = 'نظام الحضور'; };
  }, [data]);

  const grouped = useMemo(() => {
    if (!data) return { absent: [], late: [], excused: [], present: [] };
    return {
      present: data.students.filter((s) => s.status === 'present'),
      absent:  data.students.filter((s) => s.status === 'absent'),
      late:    data.students.filter((s) => s.status === 'late'),
      excused: data.students.filter((s) => s.status === 'excused'),
    };
  }, [data]);

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  if (!data) return <div className="text-center py-12 text-red-600 dark:text-red-400">لم يُعثر على الجلسة</div>;

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
            <ClipboardCheck className="w-4 h-4" />
            تقرير حضور حصة
          </p>
        </div>

        <table className="w-full text-sm border-collapse mb-4">
          <tbody>
            <tr>
              <td className="border border-gray-300 px-3 py-1.5 font-semibold bg-gray-50 w-1/4">التاريخ:</td>
              <td className="border border-gray-300 px-3 py-1.5">{formatDateAr(data.session.attendance_date)}</td>
              <td className="border border-gray-300 px-3 py-1.5 font-semibold bg-gray-50 w-1/4">الحصة:</td>
              <td className="border border-gray-300 px-3 py-1.5">{data.session.period_name} (رقم {data.session.period_number})</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-3 py-1.5 font-semibold bg-gray-50">الصف / الشعبة:</td>
              <td className="border border-gray-300 px-3 py-1.5">{data.session.grade_name} / {data.session.section_name}</td>
              <td className="border border-gray-300 px-3 py-1.5 font-semibold bg-gray-50">المعلم:</td>
              <td className="border border-gray-300 px-3 py-1.5">{data.session.teacher_name || '—'}</td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-4 gap-2 mb-4">
          <Stat label="حاضر" value={data.summary.present} tone="green" />
          <Stat label="غائب" value={data.summary.absent} tone="red" />
          <Stat label="متأخر" value={data.summary.late} tone="yellow" />
          <Stat label="مستأذن" value={data.summary.excused} tone="blue" />
        </div>

        {grouped.absent.length > 0 && <StudentTable title="الغائبون" students={grouped.absent} bg="bg-red-50" />}
        {grouped.late.length > 0    && <StudentTable title="المتأخرون" students={grouped.late} bg="bg-yellow-50" />}
        {grouped.excused.length > 0 && <StudentTable title="المستأذنون" students={grouped.excused} bg="bg-blue-50" />}

        {/* Compact present list */}
        <details className="mb-4">
          <summary className="text-sm font-semibold cursor-pointer mb-2">عرض الحاضرين ({grouped.present.length})</summary>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
            {grouped.present.map((s) => <span key={s.id}>• {s.name}</span>)}
          </div>
        </details>

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

function StudentTable({ title, students, bg }: {
  title: string;
  students: Array<{ id: number; student_id: string; name: string; notes: string | null; status: string }>;
  bg: string;
}) {
  return (
    <div className="mb-4">
      <h3 className={`text-sm font-bold ${bg} px-2 py-1 mb-1.5`}>{title} ({students.length})</h3>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="border border-gray-300 px-2 py-1 w-10">#</th>
            <th className="border border-gray-300 px-2 py-1">الاسم</th>
            <th className="border border-gray-300 px-2 py-1 w-32">رقم الهوية</th>
            <th className="border border-gray-300 px-2 py-1 w-20">الحالة</th>
            <th className="border border-gray-300 px-2 py-1">ملاحظة</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s, i) => (
            <tr key={s.id}>
              <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
              <td className="border border-gray-300 px-2 py-1">{s.name}</td>
              <td className="border border-gray-300 px-2 py-1 font-mono text-[10px]" dir="ltr">{s.student_id}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{STATUS_LABEL[s.status] || s.status}</td>
              <td className="border border-gray-300 px-2 py-1 text-[10px] text-gray-600">{s.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'green'|'red'|'yellow'|'blue' }) {
  const cls = {
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
