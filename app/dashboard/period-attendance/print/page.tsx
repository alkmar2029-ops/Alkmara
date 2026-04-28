'use client';

import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer, ArrowRight, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';

interface Row {
  id: number;
  section_id: number;
  section_name: string | null;
  grade_name: string | null;
  period_number: number | null;
  period_name: string | null;
  teacher_name: string | null;
  recorded_at: string;
  absent_count: number;
  late_count: number;
  excused_count: number;
  total_count: number;
  present_count: number;
  notes: string | null;
  absences: Array<{
    student_id: number;
    student_code: string;
    name: string;
    status: 'absent' | 'late' | 'excused';
    notes: string | null;
  }>;
}

interface ReportData {
  date: string;
  grade: string | null;
  school_name: string;
  principal_name: string;
  totals: { sessions: number; present: number; absent: number; late: number; excused: number };
  rows: Row[];
}

const STATUS_LABEL: Record<string, string> = {
  absent: 'غائب', late: 'متأخر', excused: 'مستأذن',
};

function formatDateAr(d: string): string {
  try {
    return new Date(d).toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return d; }
}

export default function PeriodAttendancePrintPage() {
  const sp = useSearchParams();
  const date = sp.get('date') || '';
  const grade = sp.get('grade') || '';

  const { data, isLoading, isError } = useQuery<ReportData>({
    queryKey: ['period-report', date, grade],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (grade) params.set('grade', grade);
      const r = await fetch(`/api/period-attendance/report?${params}`);
      if (!r.ok) throw new Error('فشل جلب التقرير');
      return (await r.json()).data;
    },
    enabled: !!date,
  });

  // Cleaner page title for the saved PDF.
  useEffect(() => {
    if (data) document.title = `تقرير حضور الحصص — ${formatDateAr(data.date)}`;
    return () => { document.title = 'نظام الحضور'; };
  }, [data]);

  const { rowsByGrade, periodNumbers } = useMemo(() => {
    if (!data) return { rowsByGrade: new Map<string, Row[]>(), periodNumbers: [] as number[] };
    const m = new Map<string, Row[]>();
    const ps = new Set<number>();
    for (const r of data.rows) {
      const key = r.grade_name || '—';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
      if (r.period_number) ps.add(r.period_number);
    }
    return {
      rowsByGrade: m,
      periodNumbers: Array.from(ps).sort((a, b) => a - b),
    };
  }, [data]);

  const allAbsences = useMemo(() => {
    if (!data) return [] as Array<Row & { student: Row['absences'][number] }>;
    const out: any[] = [];
    for (const r of data.rows) {
      for (const a of r.absences) out.push({ ...r, student: a });
    }
    return out;
  }, [data]);

  if (!date) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">يجب تحديد التاريخ في الرابط (?date=YYYY-MM-DD)</div>;
  }
  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }
  if (isError || !data) {
    return <div className="text-center py-12 text-red-600 dark:text-red-400">فشل تحميل التقرير</div>;
  }

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

      {/* Toolbar */}
      <div className="no-print sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 -mx-4 -mt-4 px-4 py-3 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              معاينة تقرير حضور الحصص
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatDateAr(data.date)} • {data.totals.sessions} جلسة • {data.totals.absent} غياب
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard/period-attendance" className="btn-secondary inline-flex items-center gap-1 text-sm">
              <ArrowRight className="w-4 h-4" /> رجوع
            </Link>
            <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1 text-sm">
              <Printer className="w-4 h-4" /> طباعة / حفظ PDF
            </button>
          </div>
        </div>
      </div>

      <div className="print-area bg-white text-black mx-auto max-w-[210mm] p-6">
        {/* Header */}
        <div className="text-center pb-4 border-b-2 border-gray-800">
          <p className="text-xs text-gray-600 mb-1">المملكة العربية السعودية — وزارة التعليم</p>
          <h1 className="text-2xl font-bold">{data.school_name || 'المدرسة'}</h1>
          <p className="text-sm mt-2 font-semibold">تقرير حضور الحصص اليومي</p>
          <p className="text-sm">{formatDateAr(data.date)}</p>
          {data.grade && <p className="text-xs mt-1">الصف: {data.grade}</p>}
        </div>

        {/* Totals */}
        <div className="grid grid-cols-5 gap-2 my-4">
          <Stat label="جلسات" value={data.totals.sessions} />
          <Stat label="حاضر" value={data.totals.present} tone="green" />
          <Stat label="غياب" value={data.totals.absent} tone="red" />
          <Stat label="تأخر" value={data.totals.late} tone="yellow" />
          <Stat label="استئذان" value={data.totals.excused} tone="blue" />
        </div>

        {/* Matrix per grade */}
        {Array.from(rowsByGrade.entries()).map(([gradeName, rows], idx) => {
          // Group rows by section
          const bySection = new Map<string, Map<number, Row>>();
          for (const r of rows) {
            const k = r.section_name || '—';
            if (!bySection.has(k)) bySection.set(k, new Map());
            bySection.get(k)!.set(r.period_number || 0, r);
          }
          const sectionList = Array.from(bySection.keys()).sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));

          return (
            <div key={gradeName} className={idx > 0 ? 'mt-6' : ''}>
              <h3 className="text-base font-bold mb-2 bg-gray-100 px-3 py-1.5 rounded">
                صف: {gradeName}
              </h3>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-300 px-2 py-1.5 font-semibold w-20">الشعبة</th>
                    {periodNumbers.map((n) => (
                      <th key={n} className="border border-gray-300 px-2 py-1.5 font-semibold">حصة {n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sectionList.map((sec) => (
                    <tr key={sec}>
                      <td className="border border-gray-300 px-2 py-1.5 font-bold text-center bg-gray-50">{sec}</td>
                      {periodNumbers.map((n) => {
                        const r = bySection.get(sec)?.get(n);
                        if (!r) {
                          return <td key={n} className="border border-gray-300 px-1 py-1.5 text-center text-gray-400">—</td>;
                        }
                        const issues = r.absent_count + r.late_count + r.excused_count;
                        return (
                          <td key={n} className="border border-gray-300 px-1 py-1 text-center align-top">
                            <div className="text-[10px] truncate">{r.teacher_name || '—'}</div>
                            <div className="font-bold">{r.present_count}/{r.total_count}</div>
                            {issues > 0 && (
                              <div className="text-[9px] text-gray-600">
                                {r.absent_count > 0 && <span>غ{r.absent_count} </span>}
                                {r.late_count > 0 && <span>ت{r.late_count} </span>}
                                {r.excused_count > 0 && <span>س{r.excused_count}</span>}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}

        {/* Absences detail */}
        {allAbsences.length > 0 && (
          <div className="pagebreak-before mt-6">
            <h2 className="text-lg font-bold mb-3 bg-red-50 border-b-2 border-red-300 pb-1.5 px-2">
              تفاصيل الغياب ({allAbsences.length})
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-2 py-1.5 font-semibold">#</th>
                  <th className="border border-gray-300 px-2 py-1.5 font-semibold">الاسم</th>
                  <th className="border border-gray-300 px-2 py-1.5 font-semibold">رقم الهوية</th>
                  <th className="border border-gray-300 px-2 py-1.5 font-semibold">الصف/الشعبة</th>
                  <th className="border border-gray-300 px-2 py-1.5 font-semibold">الحصة</th>
                  <th className="border border-gray-300 px-2 py-1.5 font-semibold">الحالة</th>
                  <th className="border border-gray-300 px-2 py-1.5 font-semibold">المعلم</th>
                </tr>
              </thead>
              <tbody>
                {allAbsences.map((row, i) => (
                  <tr key={`${row.id}-${row.student.student_id}-${i}`}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
                    <td className="border border-gray-300 px-2 py-1">{row.student.name}</td>
                    <td className="border border-gray-300 px-2 py-1 font-mono text-[10px]" dir="ltr">{row.student.student_code}</td>
                    <td className="border border-gray-300 px-2 py-1">{row.grade_name} / {row.section_name}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{row.period_number}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      {STATUS_LABEL[row.student.status] || row.student.status}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-[10px]">{row.teacher_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-12 mt-12 pt-6 border-t border-gray-300 text-sm text-center">
          <div>
            <p className="font-semibold mb-12">الوكيل / المسؤول</p>
            <div className="border-t border-gray-400 mx-6">
              <p className="text-xs text-gray-500 pt-1">التوقيع</p>
            </div>
          </div>
          <div>
            <p className="font-semibold mb-12">{data.principal_name ? `المدير / ${data.principal_name}` : 'المدير'}</p>
            <div className="border-t border-gray-400 mx-6">
              <p className="text-xs text-gray-500 pt-1">التوقيع والختم</p>
            </div>
          </div>
        </div>

        <div className="text-center text-[10px] text-gray-500 mt-4 pt-2 border-t border-gray-200">
          صدر هذا التقرير من نظام إدارة الحضور المدرسي • {new Date().toLocaleString('ar-SA')}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray'|'green'|'red'|'yellow'|'blue' }) {
  const cls = {
    gray:   'bg-gray-50 text-gray-900 border-gray-300',
    green:  'bg-green-50 text-green-700 border-green-300',
    red:    'bg-red-50 text-red-700 border-red-300',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-300',
    blue:   'bg-blue-50 text-blue-700 border-blue-300',
  }[tone];
  return (
    <div className={`rounded border ${cls} px-2 py-2 text-center`}>
      <p className="text-[10px] font-medium">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
