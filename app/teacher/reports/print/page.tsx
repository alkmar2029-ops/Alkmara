'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Loader2, Printer, ArrowRight, FileText, ClipboardList, Clock,
  BadgeCheck, MessageSquarePlus, AlertTriangle,
} from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  attendance_period: 'غياب الحصص', late: 'التأخر', excused: 'الاستئذان',
  notes: 'الملاحظات', comprehensive: 'تقرير شامل',
};
const STATUS_LABEL: Record<string, string> = {
  absent: 'غائب', late: 'متأخر', excused: 'مستأذن',
};

function formatDateAr(d?: string): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return d; }
}

export default function TeacherReportPrintPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <PrintBody />
    </Suspense>
  );
}

function PrintBody() {
  const sp = useSearchParams();
  const from = sp.get('from') || '';
  const to = sp.get('to') || from;
  const scope = (sp.get('scope') || 'mine') as 'mine' | 'grade' | 'section' | 'student';
  const scopeId = sp.get('scope_id') ? Number(sp.get('scope_id')) : null;
  const types = (sp.get('types') || 'comprehensive').split(',');

  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ['teacher-report', from, to, scope, scopeId, types.join(',')],
    queryFn: async () => {
      const r = await fetch('/api/teacher/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ types, from, to, scope, scope_id: scopeId ?? undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل التوليد');
      return d.data;
    },
    enabled: !!from && !!to,
  });

  useEffect(() => {
    if (data) document.title = `تقرير المعلم — ${formatDateAr(data.meta.from)}`;
    return () => { document.title = 'نظام الحضور'; };
  }, [data]);

  if (!from) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">معاملات الرابط ناقصة</div>;
  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  if (isError || !data) return <div className="text-center py-12 text-red-600 dark:text-red-400">فشل توليد التقرير</div>;

  const dateRange = data.meta.from === data.meta.to
    ? formatDateAr(data.meta.from)
    : `${formatDateAr(data.meta.from)} إلى ${formatDateAr(data.meta.to)}`;
  const isComprehensive = types.includes('comprehensive');
  const want = (t: string) => isComprehensive || types.includes(t);

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
        <Link href="/teacher/reports" className="btn-secondary inline-flex items-center gap-1 text-sm">
          <ArrowRight className="w-4 h-4" /> رجوع
        </Link>
        <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1 text-sm">
          <Printer className="w-4 h-4" /> طباعة / حفظ PDF
        </button>
      </div>

      <div className="print-area bg-white text-black mx-auto max-w-[210mm] p-6">
        <div className="text-center pb-3 border-b-2 border-gray-800 mb-4">
          <p className="text-xs text-gray-600">المملكة العربية السعودية — وزارة التعليم</p>
          <h1 className="text-xl font-bold">{data.meta.school_name || 'المدرسة'}</h1>
          <p className="text-sm font-semibold mt-2 inline-flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            {types.map((t: string) => TYPE_LABELS[t] || t).join(' • ')}
          </p>
          <p className="text-xs text-gray-700 mt-1">المعلم: {data.meta.teacher_name}</p>
          <p className="text-xs text-gray-700">الفترة: {dateRange}</p>
          <p className="text-xs text-gray-700">النطاق: {data.meta.scope_label}</p>
        </div>

        {data.sections.top_concerns?.length > 0 && (
          <div className="mb-4">
            <h2 className="text-sm font-bold bg-yellow-50 border-b-2 border-yellow-300 px-2 py-1.5 mb-2 inline-flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              الطلاب الأكثر إثارة للقلق ({data.sections.top_concerns.length})
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-2 py-1">#</th>
                  <th className="border border-gray-300 px-2 py-1">الاسم</th>
                  <th className="border border-gray-300 px-2 py-1">الصف/الشعبة</th>
                  <th className="border border-gray-300 px-2 py-1">غياب</th>
                  <th className="border border-gray-300 px-2 py-1">تأخر</th>
                  <th className="border border-gray-300 px-2 py-1">استئذان</th>
                  <th className="border border-gray-300 px-2 py-1">ملاحظات سلبية</th>
                </tr>
              </thead>
              <tbody>
                {data.sections.top_concerns.map((s: any, i: number) => (
                  <tr key={i}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
                    <td className="border border-gray-300 px-2 py-1">{s.name}</td>
                    <td className="border border-gray-300 px-2 py-1">{s.grade} / {s.section}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center text-red-700">{s.absent}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center text-yellow-700">{s.late}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center text-blue-700">{s.excused}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center text-purple-700">{s.notes_neg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {want('attendance_period') && data.sections.attendance_period && (
          <Section title="غياب الحصص" icon={ClipboardList} bg="bg-orange-50">
            <p className="text-xs text-gray-600 mb-2">
              عدد الجلسات: {data.sections.attendance_period.counts.sessions} •
              إجمالي الغياب: {data.sections.attendance_period.counts.absent}
            </p>
            <PeriodTable rows={data.sections.attendance_period.absences} />
          </Section>
        )}

        {want('late') && data.sections.late && (
          <Section title="التأخر" icon={Clock} bg="bg-yellow-50">
            <p className="text-xs text-gray-600 mb-2">إجمالي: {data.sections.late.count}</p>
            <PeriodTable rows={data.sections.late.rows} withNotes />
          </Section>
        )}

        {want('excused') && data.sections.excused && (
          <Section title="الاستئذان" icon={BadgeCheck} bg="bg-blue-50">
            <p className="text-xs text-gray-600 mb-2">إجمالي: {data.sections.excused.count}</p>
            <PeriodTable rows={data.sections.excused.rows} withNotes />
          </Section>
        )}

        {want('notes') && data.sections.notes && (
          <Section title="ملاحظاتي" icon={MessageSquarePlus} bg="bg-purple-50">
            <p className="text-xs text-gray-600 mb-2">
              إجمالي: {data.sections.notes.counts.total} •
              إيجابية: {data.sections.notes.counts.positive} •
              سلبية: {data.sections.notes.counts.negative}
            </p>
            <NotesTable rows={data.sections.notes.rows} />
          </Section>
        )}

        <div className="grid grid-cols-2 gap-12 mt-12 pt-6 border-t border-gray-300 text-sm text-center">
          <div>
            <p className="font-semibold mb-12">المعلم / {data.meta.teacher_name}</p>
            <div className="border-t border-gray-400 mx-6"><p className="text-xs text-gray-500 pt-1">التوقيع</p></div>
          </div>
          <div>
            <p className="font-semibold mb-12">{data.meta.principal_name ? `المدير / ${data.meta.principal_name}` : 'مدير المدرسة'}</p>
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

function Section({ title, icon: Icon, bg, children }: { title: string; icon: any; bg: string; children: React.ReactNode }) {
  return (
    <div className="pagebreak-before mb-4">
      <h2 className={`text-sm font-bold ${bg} px-2 py-1.5 mb-2 inline-flex items-center gap-1`}>
        <Icon className="w-3.5 h-3.5" />
        {title}
      </h2>
      {children}
    </div>
  );
}

function PeriodTable({ rows, withNotes = false }: { rows: any[]; withNotes?: boolean }) {
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-gray-500 italic py-2 text-center">لا توجد بيانات</p>;
  }
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-gray-50">
          <th className="border border-gray-300 px-2 py-1 w-8">#</th>
          <th className="border border-gray-300 px-2 py-1">التاريخ</th>
          <th className="border border-gray-300 px-2 py-1 w-12">الحصة</th>
          <th className="border border-gray-300 px-2 py-1">الاسم</th>
          <th className="border border-gray-300 px-2 py-1">الصف/الشعبة</th>
          <th className="border border-gray-300 px-2 py-1 w-16">الحالة</th>
          {withNotes && <th className="border border-gray-300 px-2 py-1">ملاحظة</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r: any, i: number) => (
          <tr key={i}>
            <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
            <td className="border border-gray-300 px-2 py-1">{r.attendance_date ? new Date(r.attendance_date).toLocaleDateString('ar-SA') : '—'}</td>
            <td className="border border-gray-300 px-2 py-1 text-center">{r.period_number}</td>
            <td className="border border-gray-300 px-2 py-1">{r.student_name}</td>
            <td className="border border-gray-300 px-2 py-1">{r.grade_name} / {r.section_name}</td>
            <td className="border border-gray-300 px-2 py-1 text-center">{STATUS_LABEL[r.status] || r.status}</td>
            {withNotes && <td className="border border-gray-300 px-2 py-1 text-[10px] text-gray-600">{r.notes || '—'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NotesTable({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-gray-500 italic py-2 text-center">لا توجد ملاحظات</p>;
  }
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-gray-50">
          <th className="border border-gray-300 px-2 py-1 w-8">#</th>
          <th className="border border-gray-300 px-2 py-1">التاريخ</th>
          <th className="border border-gray-300 px-2 py-1">الاسم</th>
          <th className="border border-gray-300 px-2 py-1">الصف/الشعبة</th>
          <th className="border border-gray-300 px-2 py-1 w-16">النوع</th>
          <th className="border border-gray-300 px-2 py-1">النص</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r: any, i: number) => (
          <tr key={i}>
            <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
            <td className="border border-gray-300 px-2 py-1">{r.recorded_at ? new Date(r.recorded_at).toLocaleDateString('ar-SA') : '—'}</td>
            <td className="border border-gray-300 px-2 py-1">{r.student_name}</td>
            <td className="border border-gray-300 px-2 py-1">{r.grade_name} / {r.section_name}</td>
            <td className="border border-gray-300 px-2 py-1 text-center">
              {r.type === 'positive' ? '🌟' : '⚠'}
            </td>
            <td className="border border-gray-300 px-2 py-1">{r.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
