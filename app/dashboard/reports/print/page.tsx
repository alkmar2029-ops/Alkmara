'use client';

import { useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Loader2, Printer, ArrowRight, FileText, ClipboardList, Clock,
  BadgeCheck, MessageSquarePlus, AlertTriangle,
} from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  attendance_daily:  'الغياب اليومي',
  attendance_period: 'غياب الحصص',
  late:              'التأخر',
  excused:           'الاستئذان',
  notes:             'الملاحظات',
  comprehensive:     'تقرير شامل',
};

const STATUS_LABEL: Record<string, string> = {
  present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'مستأذن',
};

function formatDateAr(d?: string): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return d; }
}

export default function ReportPrintPage() {
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
  const scope = (sp.get('scope') || 'school') as 'school' | 'grade' | 'section' | 'student';
  const scopeId = sp.get('scope_id') ? Number(sp.get('scope_id')) : null;
  const types = (sp.get('types') || 'comprehensive').split(',');

  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ['report-builder', from, to, scope, scopeId, types.join(',')],
    queryFn: async () => {
      const r = await fetch('/api/reports/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          types, from, to, scope,
          scope_id: scopeId ?? undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل التوليد');
      return d.data;
    },
    enabled: !!from && !!to,
  });

  useEffect(() => {
    if (data) document.title = `تقرير — ${formatDateAr(data.meta.from)}`;
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
        <Link href="/dashboard/reports/builder" className="btn-secondary inline-flex items-center gap-1 text-sm">
          <ArrowRight className="w-4 h-4" /> رجوع
        </Link>
        <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1 text-sm">
          <Printer className="w-4 h-4" /> طباعة / حفظ PDF
        </button>
      </div>

      <div className="print-area bg-white text-black mx-auto max-w-[210mm] p-6">
        {/* Header */}
        <div className="text-center pb-3 border-b-2 border-gray-800 mb-4">
          <p className="text-xs text-gray-600">المملكة العربية السعودية — وزارة التعليم</p>
          <h1 className="text-xl font-bold">{data.meta.school_name || 'المدرسة'}</h1>
          <p className="text-sm font-semibold mt-2 inline-flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            {types.map((t: string) => TYPE_LABELS[t] || t).join(' • ')}
          </p>
          <p className="text-xs text-gray-700 mt-1">الفترة: {dateRange}</p>
          <p className="text-xs text-gray-700">النطاق: {data.meta.scope_label}</p>
        </div>

        {/* Top concerns — always shown when populated */}
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

        {/* Daily attendance section (fingerprint records) */}
        {want('attendance_daily') && data.sections.attendance_daily && (
          <Section title="الغياب اليومي (البصمة)" icon={ClipboardList} bg="bg-red-50">
            <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
              <Stat label="إجمالي" value={data.sections.attendance_daily.counts.total} />
              <Stat label="حاضر" value={data.sections.attendance_daily.counts.present} tone="green" />
              <Stat label="متأخر" value={data.sections.attendance_daily.counts.late} tone="yellow" />
              <Stat label="غائب" value={data.sections.attendance_daily.counts.absent} tone="red" />
            </div>
            {data.sections.attendance_daily.rows.length > 0 && (
              <RowsTable
                rows={data.sections.attendance_daily.rows}
                cols={['attendance_date', 'period_or_punch', 'student', 'class', 'status', 'minutes_late']}
                special="daily"
              />
            )}
          </Section>
        )}

        {/* Period attendance section */}
        {want('attendance_period') && data.sections.attendance_period && (
          <Section title="غياب الحصص" icon={Clock} bg="bg-orange-50">
            <p className="text-xs text-gray-600 mb-2">
              عدد الجلسات: {data.sections.attendance_period.counts.sessions} •
              إجمالي الغياب: {data.sections.attendance_period.counts.absent}
            </p>
            <RowsTable
              rows={data.sections.attendance_period.absences}
              cols={['attendance_date', 'period', 'student', 'class', 'teacher']}
              special="period"
            />
          </Section>
        )}

        {/* Late */}
        {want('late') && data.sections.late && (
          <Section title="التأخر" icon={Clock} bg="bg-yellow-50">
            <p className="text-xs text-gray-600 mb-2">إجمالي: {data.sections.late.count}</p>
            <RowsTable
              rows={data.sections.late.rows}
              cols={['attendance_date', 'period', 'student', 'class', 'teacher', 'notes']}
              special="period"
            />
          </Section>
        )}

        {/* Excused */}
        {want('excused') && data.sections.excused && (
          <Section title="الاستئذان" icon={BadgeCheck} bg="bg-blue-50">
            <p className="text-xs text-gray-600 mb-2">إجمالي: {data.sections.excused.count}</p>
            <RowsTable
              rows={data.sections.excused.rows}
              cols={['attendance_date', 'period', 'student', 'class', 'teacher', 'notes']}
              special="period"
            />
          </Section>
        )}

        {/* Notes */}
        {want('notes') && data.sections.notes && (
          <Section title="ملاحظات الطلاب" icon={MessageSquarePlus} bg="bg-purple-50">
            <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
              <Stat label="الإجمالي" value={data.sections.notes.counts.total} />
              <Stat label="إيجابية" value={data.sections.notes.counts.positive} tone="green" />
              <Stat label="سلبية" value={data.sections.notes.counts.negative} tone="red" />
            </div>
            <RowsTable
              rows={data.sections.notes.rows}
              cols={['recorded_at', 'student', 'class', 'note_type', 'note_text']}
              special="notes"
            />
          </Section>
        )}

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-12 mt-12 pt-6 border-t border-gray-300 text-sm text-center">
          <div>
            <p className="font-semibold mb-12">الوكيل</p>
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

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray'|'green'|'red'|'yellow' }) {
  const cls = {
    gray:   'bg-gray-50 text-gray-900 border-gray-300',
    green:  'bg-green-50 text-green-700 border-green-300',
    red:    'bg-red-50 text-red-700 border-red-300',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  }[tone];
  return (
    <div className={`border ${cls} rounded px-2 py-1 text-center`}>
      <p className="text-[9px]">{label}</p>
      <p className="text-base font-bold">{value}</p>
    </div>
  );
}

function RowsTable({ rows, cols, special }: { rows: any[]; cols: string[]; special: 'daily' | 'period' | 'notes' }) {
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-gray-500 italic py-2 text-center">لا توجد بيانات</p>;
  }
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-gray-50">
          <th className="border border-gray-300 px-2 py-1 w-8">#</th>
          {special === 'daily' && <>
            <th className="border border-gray-300 px-2 py-1">التاريخ</th>
            <th className="border border-gray-300 px-2 py-1">وقت البصمة</th>
            <th className="border border-gray-300 px-2 py-1">الطالب</th>
            <th className="border border-gray-300 px-2 py-1">الصف/الشعبة</th>
            <th className="border border-gray-300 px-2 py-1">الحالة</th>
            <th className="border border-gray-300 px-2 py-1">دقائق التأخر</th>
          </>}
          {special === 'period' && <>
            <th className="border border-gray-300 px-2 py-1">التاريخ</th>
            <th className="border border-gray-300 px-2 py-1">الحصة</th>
            <th className="border border-gray-300 px-2 py-1">الطالب</th>
            <th className="border border-gray-300 px-2 py-1">الصف/الشعبة</th>
            <th className="border border-gray-300 px-2 py-1">المعلم</th>
            {cols.includes('notes') && <th className="border border-gray-300 px-2 py-1">ملاحظة</th>}
          </>}
          {special === 'notes' && <>
            <th className="border border-gray-300 px-2 py-1">التاريخ</th>
            <th className="border border-gray-300 px-2 py-1">الطالب</th>
            <th className="border border-gray-300 px-2 py-1">الصف/الشعبة</th>
            <th className="border border-gray-300 px-2 py-1">النوع</th>
            <th className="border border-gray-300 px-2 py-1">النص</th>
          </>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r: any, i: number) => (
          <tr key={i}>
            <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
            {special === 'daily' && <>
              <td className="border border-gray-300 px-2 py-1">{r.attendance_date ? new Date(r.attendance_date).toLocaleDateString('ar-SA') : '—'}</td>
              <td className="border border-gray-300 px-2 py-1 font-mono text-[10px]" dir="ltr">{r.punch_time ? new Date(r.punch_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              <td className="border border-gray-300 px-2 py-1">{r.student_name}</td>
              <td className="border border-gray-300 px-2 py-1">{r.grade_name} / {r.section_name}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{STATUS_LABEL[r.status] || r.status}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{r.minutes_late ?? '—'}</td>
            </>}
            {special === 'period' && <>
              <td className="border border-gray-300 px-2 py-1">{r.attendance_date ? new Date(r.attendance_date).toLocaleDateString('ar-SA') : '—'}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{r.period_number}</td>
              <td className="border border-gray-300 px-2 py-1">{r.student_name}</td>
              <td className="border border-gray-300 px-2 py-1">{r.grade_name} / {r.section_name}</td>
              <td className="border border-gray-300 px-2 py-1 text-[10px]">{r.teacher_name || '—'}</td>
              {cols.includes('notes') && <td className="border border-gray-300 px-2 py-1 text-[10px]">{r.notes || '—'}</td>}
            </>}
            {special === 'notes' && <>
              <td className="border border-gray-300 px-2 py-1">{r.recorded_at ? new Date(r.recorded_at).toLocaleDateString('ar-SA') : '—'}</td>
              <td className="border border-gray-300 px-2 py-1">{r.student_name}</td>
              <td className="border border-gray-300 px-2 py-1">{r.grade_name} / {r.section_name}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{r.type === 'positive' ? '🌟 إيجابية' : '⚠ سلبية'}</td>
              <td className="border border-gray-300 px-2 py-1">{r.text}</td>
            </>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
