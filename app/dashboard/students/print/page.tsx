'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Printer, Loader2, ArrowRight, X } from 'lucide-react';

interface Student {
  id: number;
  student_id: string;
  first_name: string;
  father_name: string | null;
  last_name: string;
  phone: string | null;
  section_id: number;
  grade_id: number;
  is_active: boolean;
  grade_name?: string;
  section_name?: string;
  grades?: { name: string };
  sections?: { name: string };
}

interface SchoolInfo { school_name: string; principal_name: string; }

/**
 * Printable students roster. Reads scope from URL params:
 *   ?grade_id=N      → all students in that grade
 *   ?section_id=N    → only that section
 *   (none)           → entire school
 *
 * Layout is A4-friendly with the same hidden-print-area pattern as
 * the rest of the app's print views (period attendance, daily
 * attendance, dismissals).
 */
export default function StudentsPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">جاري التحميل...</div>}>
      <StudentsPrintInner />
    </Suspense>
  );
}

function StudentsPrintInner() {
  const searchParams = useSearchParams();
  const gradeId = searchParams.get('grade_id');
  const sectionId = searchParams.get('section_id');

  const [includeColumns, setIncludeColumns] = useState({
    phone: true,
    student_id: true,
    grade_section: true,
    signature: true,
  });

  const { data: school } = useQuery<SchoolInfo>({
    queryKey: ['school-info'],
    queryFn: async () => {
      const r = await fetch('/api/public/school-info');
      if (!r.ok) return { school_name: '', principal_name: '' };
      return (await r.json()).data;
    },
    staleTime: 5 * 60_000,
  });

  // Fetch ALL students matching the scope. Use a high limit so we get
  // them in one shot (max 2000 — plenty for any school size).
  const { data: students = [], isLoading, isError } = useQuery<Student[]>({
    queryKey: ['students-print', gradeId, sectionId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sectionId) params.set('section_id', sectionId);
      else if (gradeId) params.set('grade_id', gradeId);
      params.set('limit', '2000');
      const r = await fetch(`/api/students?${params}`);
      if (!r.ok) throw new Error('failed');
      const d = await r.json();
      return d.data || [];
    },
  });

  // Group rows by grade/section for cleaner page breaks. When the user
  // chose a single section there'll be only one group.
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; sortKey: string; rows: Student[] }>();
    for (const s of students) {
      const gName = s.grades?.name || s.grade_name || '—';
      const secName = s.sections?.name || s.section_name || '—';
      const label = `${gName} / ${secName}`;
      const cur = m.get(label) || { label, sortKey: `${gName}_${secName}`, rows: [] };
      cur.rows.push(s);
      m.set(label, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'ar'));
  }, [students]);

  const scopeLabel = useMemo(() => {
    if (sectionId && groups.length === 1) return `الصف ${groups[0].label}`;
    if (gradeId && groups.length > 0) {
      const gName = groups[0].rows[0]?.grades?.name || groups[0].rows[0]?.grade_name || '';
      return `طلاب ${gName}`;
    }
    return 'جميع طلاب المدرسة';
  }, [sectionId, gradeId, groups]);

  const printNow = () => setTimeout(() => window.print(), 80);

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-6 h-6 animate-spin inline text-gray-400" />
      </div>
    );
  }

  if (isError) {
    return <div className="card text-center py-12 text-red-500">فشل تحميل قائمة الطلاب</div>;
  }

  return (
    <div className="space-y-3">
      {/* Controls — hidden during print via .no-print */}
      <div className="card no-print">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h1 className="text-xl font-bold">معاينة الطباعة</h1>
          <a
            href="/dashboard/students"
            className="text-sm text-gray-600 dark:text-gray-300 hover:underline inline-flex items-center gap-1"
          >
            <ArrowRight className="w-4 h-4" /> رجوع
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <ColCheck label="رقم الهوية" v={includeColumns.student_id} on={(v) => setIncludeColumns({ ...includeColumns, student_id: v })} />
          <ColCheck label="الصف/الشعبة" v={includeColumns.grade_section} on={(v) => setIncludeColumns({ ...includeColumns, grade_section: v })} />
          <ColCheck label="رقم الجوال" v={includeColumns.phone} on={(v) => setIncludeColumns({ ...includeColumns, phone: v })} />
          <ColCheck label="عمود التوقيع" v={includeColumns.signature} on={(v) => setIncludeColumns({ ...includeColumns, signature: v })} />
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <strong className="text-gray-900 dark:text-gray-100">{students.length}</strong> طالب
            {' • '}
            <strong className="text-gray-900 dark:text-gray-100">{groups.length}</strong> شعبة
          </p>
          <button onClick={printNow} className="btn-primary inline-flex items-center gap-1">
            <Printer className="w-4 h-4" /> طباعة / حفظ PDF
          </button>
        </div>
      </div>

      {/* Print-only area */}
      <div className="students-print-area" aria-hidden>
        <div className="print-header">
          <p className="print-kingdom">المملكة العربية السعودية ـ وزارة التعليم</p>
          {school?.school_name && <h1>{school.school_name}</h1>}
          {school?.principal_name && <p className="print-principal">المدير: {school.principal_name}</p>}
          <hr />
          <h2>📋 قائمة الطلاب — {scopeLabel}</h2>
          <div className="print-meta">
            <p><strong>إجمالي الطلاب:</strong> {students.length}</p>
            <p><strong>عدد الشُّعب:</strong> {groups.length}</p>
            <p><strong>تاريخ الطباعة:</strong> {new Date().toLocaleDateString('ar-SA-u-ca-gregory')}</p>
          </div>
        </div>

        {groups.length === 0 && (
          <p style={{ textAlign: 'center', padding: '40pt 0', color: '#6b7280' }}>
            لا يوجد طلاب في هذا النطاق
          </p>
        )}

        {groups.map((g) => (
          <section key={g.label} className="print-section">
            {groups.length > 1 && (
              <h3>📚 {g.label} ({g.rows.length} طالب)</h3>
            )}
            <table>
              <thead>
                <tr>
                  <th style={{ width: '6%' }}>#</th>
                  <th>اسم الطالب</th>
                  {includeColumns.student_id && <th style={{ width: '14%' }}>رقم الهوية</th>}
                  {includeColumns.grade_section && groups.length === 1 && <th style={{ width: '12%' }}>الصف/الشعبة</th>}
                  {includeColumns.phone && <th style={{ width: '14%' }}>الجوال</th>}
                  {includeColumns.signature && <th style={{ width: '12%' }}>التوقيع</th>}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((s, i) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: 'center' }}>{i + 1}</td>
                    <td>{[s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ')}</td>
                    {includeColumns.student_id && (
                      <td style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace' }}>
                        {s.student_id}
                      </td>
                    )}
                    {includeColumns.grade_section && groups.length === 1 && (
                      <td style={{ textAlign: 'center' }}>
                        {s.grades?.name || s.grade_name || ''} / {s.sections?.name || s.section_name || ''}
                      </td>
                    )}
                    {includeColumns.phone && (
                      <td style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace' }}>
                        {s.phone || '—'}
                      </td>
                    )}
                    {includeColumns.signature && <td></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <div className="print-footer">
          <div className="print-signatures">
            <div>توقيع المعلم: ............................</div>
            <div>توقيع الإدارة: ............................</div>
          </div>
          <p className="print-stamp">طُبع في: {new Date().toLocaleString('ar-SA-u-ca-gregory', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>

      <style jsx global>{`
        .students-print-area { display: none; }
        @media print {
          body * { visibility: hidden !important; }
          .students-print-area, .students-print-area * { visibility: visible !important; }
          .students-print-area {
            display: block !important;
            position: absolute;
            inset: 0;
            background: white !important;
            color: black !important;
            padding: 6mm;
            font-family: 'Cairo', 'Tajawal', system-ui, sans-serif;
            font-size: 10.5pt;
          }
          @page { size: A4 portrait; margin: 8mm; }

          .students-print-area .print-header { text-align: center; border-bottom: 1.5pt solid #1f2937; padding-bottom: 6pt; margin-bottom: 10pt; }
          .students-print-area .print-header .print-kingdom { font-size: 9pt; color: #6b7280; margin: 0 0 2pt; }
          .students-print-area .print-header h1 { font-size: 17pt; font-weight: 800; margin: 2pt 0; }
          .students-print-area .print-header .print-principal { font-size: 10pt; margin: 2pt 0; color: #374151; }
          .students-print-area .print-header hr { border: 0; border-top: 0.5pt solid #d4d4d8; margin: 4pt 0; }
          .students-print-area .print-header h2 { font-size: 14pt; margin: 6pt 0 4pt; font-weight: 700; }
          .students-print-area .print-header .print-meta { display: flex; justify-content: space-around; flex-wrap: wrap; font-size: 9.5pt; margin-top: 6pt; gap: 6pt; }
          .students-print-area .print-header .print-meta p { margin: 0; }

          .students-print-area .print-section { margin-bottom: 14pt; }
          .students-print-area .print-section > h3 { font-size: 13pt; font-weight: 700; margin: 0 0 4pt; padding: 5pt 8pt; background: #f3f4f6; border-right: 4pt solid #2563eb; page-break-after: avoid; }
          .students-print-area .print-section table { width: 100%; border-collapse: collapse; }
          .students-print-area .print-section thead { display: table-header-group; }
          .students-print-area .print-section th, .students-print-area .print-section td { border: 0.5pt solid #9ca3af; padding: 4pt 6pt; font-size: 9.5pt; text-align: right; }
          .students-print-area .print-section th { background: #f9fafb; font-weight: 700; }
          .students-print-area .print-section tr { page-break-inside: avoid; }

          .students-print-area .print-footer { margin-top: 20pt; padding-top: 6pt; border-top: 0.5pt solid #d4d4d8; page-break-inside: avoid; }
          .students-print-area .print-footer .print-signatures { display: flex; justify-content: space-between; gap: 24pt; font-size: 10pt; margin-bottom: 10pt; }
          .students-print-area .print-footer .print-stamp { font-size: 8.5pt; color: #6b7280; text-align: center; margin: 0; }
        }
      `}</style>
    </div>
  );
}

function ColCheck({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/60 cursor-pointer">
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} className="w-4 h-4" />
      <span className="text-sm">{label}</span>
    </label>
  );
}
