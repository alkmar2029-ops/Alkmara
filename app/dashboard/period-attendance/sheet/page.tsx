'use client';

import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, Printer, ArrowRight, ClipboardCheck } from 'lucide-react';

// Blank weekly absence sheet (كشف غياب أسبوعي) for manual marking — pick a
// grade + section, get the alphabetically-ordered roster in a days × periods
// grid, print on A4 landscape. Roster comes from /api/period-attendance/roster
// (names + ids only), so no sensitive student data is fetched.

interface Grade { id: number; name: string; }
interface Section { id: number; name: string; }
interface RosterStudent { id: number; student_id: string; first_name: string; father_name: string | null; last_name: string; }

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

export default function WeeklyAbsenceSheetPage() {
  const [gradeId, setGradeId] = useState<number | null>(null);
  const [sectionId, setSectionId] = useState<number | null>(null);

  // School identity for the header.
  const { data: settings } = useQuery<{ school_name?: string; principal_name?: string; stage?: string }>({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then((r) => r.json()).then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // Grades, scoped to the school stage (same convention as the students page).
  const { data: grades = [] } = useQuery<Grade[]>({
    queryKey: ['grades-sheet', settings?.stage],
    queryFn: () => fetch(`/api/grades${settings?.stage ? `?stage=${settings.stage}` : ''}`).then((r) => r.json()).then((r) => r.data || []),
    enabled: !!settings,
  });

  // Sections for the chosen grade.
  const { data: sections = [] } = useQuery<Section[]>({
    queryKey: ['sections-sheet', gradeId],
    queryFn: () => fetch(`/api/sections?grade_id=${gradeId}`).then((r) => r.json()).then((r) => r.data || []),
    enabled: !!gradeId,
  });

  // Alphabetical roster — names + ids only (no health/social).
  const { data: roster = [], isLoading: loadingRoster } = useQuery<RosterStudent[]>({
    queryKey: ['sheet-roster', sectionId],
    queryFn: async () => {
      const r = await fetch(`/api/period-attendance/roster?section_id=${sectionId}`);
      if (!r.ok) throw new Error('فشل تحميل الطلاب');
      return (await r.json()).data || [];
    },
    enabled: !!sectionId,
  });

  const gradeName = useMemo(() => grades.find((g) => g.id === gradeId)?.name || '', [grades, gradeId]);
  const sectionName = useMemo(() => sections.find((s) => s.id === sectionId)?.name || '', [sections, sectionId]);
  const ready = !!sectionId && !loadingRoster && roster.length > 0;

  return (
    <>
      <style jsx global>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; padding: 0 !important; }
          .no-print { display: none !important; }
          /* Keep a student row whole instead of splitting it across the
             bottom margin / page break. */
          tr { break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 -mx-4 -mt-4 px-4 py-3 mb-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              كشف غياب أسبوعي
            </h1>
            <div className="flex gap-2">
              <Link href="/dashboard/period-attendance" className="btn-secondary inline-flex items-center gap-1 text-sm">
                <ArrowRight className="w-4 h-4" /> رجوع
              </Link>
              <button
                onClick={() => window.print()}
                disabled={!ready}
                className="btn-primary inline-flex items-center gap-1 text-sm disabled:opacity-50"
                title={ready ? '' : 'اختر الصف والشعبة أولاً'}
              >
                <Printer className="w-4 h-4" /> طباعة / حفظ PDF
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الصف</span>
              <select
                value={gradeId ?? ''}
                onChange={(e) => { setGradeId(e.target.value ? Number(e.target.value) : null); setSectionId(null); }}
                className="input"
              >
                <option value="">اختر الصف</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الشعبة</span>
              <select
                value={sectionId ?? ''}
                onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : null)}
                className="input"
                disabled={!gradeId}
              >
                <option value="">اختر الشعبة</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* States */}
      {!sectionId ? (
        <div className="no-print text-center py-16 text-gray-500 dark:text-gray-400 text-sm">
          اختر الصف والشعبة لعرض الكشف.
        </div>
      ) : loadingRoster ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : roster.length === 0 ? (
        <div className="no-print text-center py-16 text-gray-500 dark:text-gray-400 text-sm">لا يوجد طلاب في هذه الشعبة.</div>
      ) : (
        <div className="print-area bg-white text-black mx-auto p-4" dir="rtl">
          {/* Header */}
          <div className="flex items-start justify-between mb-2 text-xs">
            <div className="text-right leading-relaxed">
              <p>المملكة العربية السعودية</p>
              <p>وزارة التعليم</p>
              <p className="font-semibold">{settings?.school_name || 'المدرسة'}</p>
            </div>
            <div className="text-center pt-1">
              <h2 className="text-lg font-bold border-2 border-gray-800 rounded px-6 py-1">كشف غياب أسبوعي</h2>
            </div>
            <div className="text-left leading-relaxed">
              <p>الصف: {gradeName}</p>
              <p>الشعبة: {sectionName}</p>
              <p>عدد الطلاب: {roster.length}</p>
            </div>
          </div>

          {/* Grid */}
          <table className="w-full border-collapse text-center" style={{ fontSize: '7px', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th rowSpan={2} className="border border-gray-700 px-1 py-1 w-6">م</th>
                <th rowSpan={2} className="border border-gray-700 px-1 py-1 text-right" style={{ width: '25mm' }}>اسم الطالب</th>
                {DAYS.map((d) => (
                  <th key={d} colSpan={7} className="border border-gray-700 px-0.5 py-1">
                    {d}
                    <div className="font-normal" style={{ fontSize: '6px' }}>__ / __</div>
                  </th>
                ))}
              </tr>
              <tr>
                {DAYS.map((d) => (
                  <Fragment key={`h-${d}`}>
                    {PERIODS.map((p) => (
                      <th key={`h-${d}-${p}`} className="border border-gray-700 py-0.5 font-normal" style={{ width: '4mm' }}>{p}</th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((s, i) => {
                const name = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ');
                return (
                  <tr key={s.id}>
                    <td className="border border-gray-700 py-1">{i + 1}</td>
                    <td className="border border-gray-700 px-1 py-0.5 text-right leading-tight" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</td>
                    {DAYS.map((d) => (
                      <Fragment key={`${s.id}-${d}`}>
                        {PERIODS.map((p) => (
                          <td key={`${s.id}-${d}-${p}`} className="border border-gray-400" style={{ height: '5mm' }}></td>
                        ))}
                      </Fragment>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Legend + signatures */}
          <p className="text-[9px] text-gray-600 mt-1">ملاحظة: ضع علامة في خانة الحصة التي تغيّب فيها الطالب. الأرقام ١–٧ تمثّل الحصص.</p>
          <div className="flex justify-between mt-8 text-sm">
            <div className="text-center">
              <p className="font-semibold mb-8">توقيع معلم الحصة</p>
              <p className="border-t border-gray-500 px-10 pt-1 text-xs text-gray-600">التوقيع</p>
            </div>
            <div className="text-center">
              <p className="font-semibold mb-8">مدير المدرسة{settings?.principal_name ? ` / ${settings.principal_name}` : ''}</p>
              <p className="border-t border-gray-500 px-10 pt-1 text-xs text-gray-600">التوقيع والختم</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
