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
  period_compare:    'مقارنة حصتين',
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
  const periodNumber = sp.get('period_number') ? Number(sp.get('period_number')) : null;
  const comparePeriodA = sp.get('compare_period_a') ? Number(sp.get('compare_period_a')) : null;
  const comparePeriodB = sp.get('compare_period_b') ? Number(sp.get('compare_period_b')) : null;

  const { data, isLoading, isError } = useQuery<any>({
    queryKey: ['report-builder', from, to, scope, scopeId, types.join(','), periodNumber, comparePeriodA, comparePeriodB],
    queryFn: async () => {
      const r = await fetch('/api/reports/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          types, from, to, scope,
          scope_id: scopeId ?? undefined,
          period_number: periodNumber ?? undefined,
          compare_period_a: comparePeriodA ?? undefined,
          compare_period_b: comparePeriodB ?? undefined,
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

        {/* Period attendance section — title reflects single-period filter */}
        {want('attendance_period') && data.sections.attendance_period && (
          <Section
            title={periodNumber ? `غياب الحصة ${periodNumber}` : 'غياب الحصص'}
            icon={Clock}
            bg="bg-orange-50"
          >
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

        {/* Period comparison — side-by-side with delta column + bar chart */}
        {want('period_compare') && data.sections.period_compare && (
          <PeriodCompareSection data={data.sections.period_compare} />
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

// ===================================================================
// Period comparison: side-by-side table + visual bar chart per section.
// Designed to be printable on A4 — every cell uses small text and the
// bars are pure CSS (no SVG) so they reproduce well on monochrome printers.
// ===================================================================
function PeriodCompareSection({ data }: { data: any }) {
  const { period_a, period_b, sections, totals } = data;
  // Largest absent count across both periods drives the bar-width scale so
  // both bars share the same axis and can be visually compared.
  const maxAbsent = Math.max(
    1,
    ...sections.map((s: any) => Math.max(s.period_a.absent, s.period_b.absent)),
  );
  const deltaPercent = totals.period_a.absent > 0
    ? Math.round(((totals.period_b.absent - totals.period_a.absent) / totals.period_a.absent) * 100)
    : null;

  return (
    <div className="bg-cyan-50 border-2 border-cyan-300 rounded-lg p-4 print:bg-white print:border-gray-300">
      <h3 className="text-lg font-bold text-cyan-900 mb-3 print:text-black">
        📊 مقارنة {period_a.name} و {period_b.name}
      </h3>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
        <div className="bg-white border border-cyan-200 rounded p-2 text-center print:border-gray-300">
          <p className="text-xs text-gray-600">{period_a.name}</p>
          <p className="text-2xl font-bold text-red-700">{totals.period_a.absent}</p>
          <p className="text-[10px] text-gray-500">إجمالي الغياب • {totals.period_a.sessions} جلسة</p>
        </div>
        <div className="bg-white border border-cyan-200 rounded p-2 text-center print:border-gray-300">
          <p className="text-xs text-gray-600">{period_b.name}</p>
          <p className="text-2xl font-bold text-red-700">{totals.period_b.absent}</p>
          <p className="text-[10px] text-gray-500">إجمالي الغياب • {totals.period_b.sessions} جلسة</p>
        </div>
        <div className="bg-white border-2 border-cyan-300 rounded p-2 text-center print:border-gray-400">
          <p className="text-xs text-gray-600">الفرق</p>
          <p className={`text-2xl font-bold ${
            totals.period_b.absent > totals.period_a.absent ? 'text-red-700' :
            totals.period_b.absent < totals.period_a.absent ? 'text-green-700' :
            'text-gray-600'
          }`}>
            {totals.period_b.absent > totals.period_a.absent && '↗'}
            {totals.period_b.absent < totals.period_a.absent && '↘'}
            {totals.period_b.absent === totals.period_a.absent && '➖'}
            {' '}{Math.abs(totals.period_b.absent - totals.period_a.absent)}
          </p>
          {deltaPercent !== null && (
            <p className="text-[10px] text-gray-500">{deltaPercent > 0 ? '+' : ''}{deltaPercent}%</p>
          )}
        </div>
      </div>

      {/* Per-section detail with mini bar chart */}
      {sections.length === 0 ? (
        <p className="text-center text-gray-500 py-6 text-sm">لا توجد بيانات للمقارنة</p>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead className="bg-cyan-100 print:bg-gray-100">
            <tr>
              <th className="border border-gray-300 px-2 py-1 text-right">الصف / الشعبة</th>
              <th className="border border-gray-300 px-2 py-1 text-center">{period_a.name}</th>
              <th className="border border-gray-300 px-2 py-1 text-center">{period_b.name}</th>
              <th className="border border-gray-300 px-2 py-1 text-center">الفرق</th>
              <th className="border border-gray-300 px-2 py-1 text-center min-w-[160px]">المقارنة المرئية</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s: any) => {
              const aWidth = (s.period_a.absent / maxAbsent) * 100;
              const bWidth = (s.period_b.absent / maxAbsent) * 100;
              return (
                <tr key={s.section_id} className="even:bg-cyan-50/40 print:even:bg-gray-50">
                  <td className="border border-gray-300 px-2 py-1 font-medium">
                    {s.grade_name} / {s.section_name}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-center">
                    <span className="font-bold text-red-700">{s.period_a.absent}</span>
                    <span className="text-gray-500 text-[10px]">/{s.period_a.total_students}</span>
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-center">
                    <span className="font-bold text-red-700">{s.period_b.absent}</span>
                    <span className="text-gray-500 text-[10px]">/{s.period_b.total_students}</span>
                  </td>
                  <td className={`border border-gray-300 px-2 py-1 text-center font-bold ${
                    s.delta_absent > 0 ? 'text-red-700' :
                    s.delta_absent < 0 ? 'text-green-700' :
                    'text-gray-500'
                  }`}>
                    {s.delta_absent > 0 && '↗ +'}
                    {s.delta_absent < 0 && '↘ '}
                    {s.delta_absent === 0 && '➖ '}
                    {s.delta_absent}
                  </td>
                  <td className="border border-gray-300 px-2 py-1">
                    {/* Two stacked horizontal bars, width proportional to maxAbsent */}
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-gray-500 w-4">أ</span>
                        <div className="flex-1 h-2.5 bg-gray-100 rounded-sm overflow-hidden print:bg-white print:border print:border-gray-200">
                          <div className="h-full bg-blue-500" style={{ width: `${aWidth}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-gray-500 w-4">ب</span>
                        <div className="flex-1 h-2.5 bg-gray-100 rounded-sm overflow-hidden print:bg-white print:border print:border-gray-200">
                          <div className="h-full bg-orange-500" style={{ width: `${bWidth}%` }} />
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-cyan-200 font-bold print:bg-gray-200">
              <td className="border border-gray-300 px-2 py-1">الإجمالي</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{totals.period_a.absent}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{totals.period_b.absent}</td>
              <td className={`border border-gray-300 px-2 py-1 text-center ${
                totals.period_b.absent > totals.period_a.absent ? 'text-red-700' :
                totals.period_b.absent < totals.period_a.absent ? 'text-green-700' :
                'text-gray-700'
              }`}>
                {totals.period_b.absent - totals.period_a.absent > 0 && '+'}
                {totals.period_b.absent - totals.period_a.absent}
              </td>
              <td className="border border-gray-300 px-2 py-1 text-center text-[10px] text-gray-700">
                المقياس: ٠ إلى {maxAbsent}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
