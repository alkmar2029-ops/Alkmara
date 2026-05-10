'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer } from 'lucide-react';

interface TodayResponse {
  date: string;
  day_of_week: number;
  day_name: string;
  weekend?: boolean;
  assignments: Array<{
    location_id: number;
    location_name: string | null;
    full_name: string | null;
  }>;
}

export default function SupervisionPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>}>
      <PrintInner />
    </Suspense>
  );
}

function PrintInner() {
  const sp = useSearchParams();
  const date = sp.get('date') || undefined;

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (date) p.set('date', date);
    p.set('skip_reminder', '1');   // print page doesn't trigger reminders
    return `/api/supervision/today?${p.toString()}`;
  }, [date]);

  const { data, isLoading } = useQuery<TodayResponse>({
    queryKey: ['supervision-print', url],
    queryFn: async () => (await (await fetch(url)).json()).data,
  });

  const { data: school } = useQuery<{ school_name?: string; principal_name?: string; current_term?: string }>({
    queryKey: ['settings-supervision-print'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data || {},
  });

  // Fire print dialog automatically once data is loaded.
  useEffect(() => {
    if (!isLoading && data) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [isLoading, data]);

  if (isLoading) {
    return <div className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin inline text-gray-400" /></div>;
  }

  const items = data?.assignments || [];
  // Hijri year for the form header. Browser support is uneven; fall back.
  const hijriYear = (() => {
    try {
      return new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { year: 'numeric' }).format(new Date());
    } catch { return ''; }
  })();

  return (
    <div className="report-print-area">
      <div className="no-print sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-3 flex items-center justify-between z-10">
        <h1 className="font-bold text-base">طباعة جدول إشراف الفسحة</h1>
        <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1.5 text-sm">
          <Printer className="w-4 h-4" /> طباعة
        </button>
      </div>

      <div className="print-content p-6">
        {/* Top-row form metadata — matches form #8 layout */}
        <div className="flex justify-between items-start mb-2 text-[10pt]">
          <div>
            <span>رقم النموذج: (٨)</span>
            {' • '}
            <span>اسم النموذج: سجل الإشراف اليومي</span>
            {' • '}
            <span>رمز النموذج: (و.ت.ع.ن.٠١-٠٢)</span>
          </div>
        </div>

        {/* Centered title */}
        <h2 className="text-center text-lg font-extrabold mb-3">سجل الإشراف اليومي للفسحة</h2>

        {/* Year / semester / day strip */}
        <table className="w-full mb-3 text-[11pt] meta-table">
          <thead>
            <tr>
              <th>العام الدراسي</th>
              <th>الفصل الدراسي</th>
              <th>اليوم</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{hijriYear ? `${hijriYear} هـ` : '١٤٤٧ هـ'}</td>
              <td>{school?.current_term === 'second' ? '[ ] الأول   [✓] الثاني' : '[✓] الأول   [ ] الثاني'}</td>
              <td>{data?.day_name || '—'}</td>
              <td className="font-mono" dir="ltr">{data?.date || '—'}</td>
            </tr>
          </tbody>
        </table>

        {/* Main roster table */}
        <table className="report-table w-full">
          <thead>
            <tr>
              <th style={{ width: '6%' }}>الحصة</th>
              <th style={{ width: '32%' }}>اسم المعلم</th>
              <th style={{ width: '32%' }}>وقت الإشراف</th>
              <th style={{ width: '30%' }}>التوقيع</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center" style={{ padding: '20pt 0', color: '#6b7280' }}>
                  لا توجد تعيينات إشراف لهذا اليوم
                </td>
              </tr>
            ) : items.map((a, i) => (
              <tr key={a.location_id}>
                <td style={{ textAlign: 'center' }}>{i + 1}</td>
                <td>{a.full_name || '—'}</td>
                <td>{a.location_name || '—'}</td>
                <td>{/* signature space */}</td>
              </tr>
            ))}
            {/* Pad rows to a minimum of 12 so the form looks consistent */}
            {items.length > 0 && items.length < 12 && Array.from({ length: 12 - items.length }).map((_, i) => (
              <tr key={`pad-${i}`}>
                <td style={{ textAlign: 'center', color: '#cbd5e1' }}>{items.length + i + 1}</td>
                <td></td><td></td><td></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Tasks of the supervisor */}
        <div className="text-[10pt] mt-3" style={{ lineHeight: 1.7 }}>
          <p className="font-bold">أبرز مهام مشرف الفسحة:</p>
          <ul style={{ paddingInlineStart: '20pt', listStyle: 'disc' }}>
            <li>الإشراف على دخول الطلاب أثناء الطابور الصباحي.</li>
            <li>متابعة خروج ودخول الطلاب للفسحة.</li>
            <li>الإشراف على الفناء الخارجي والمقصف أثناء الفسحة.</li>
          </ul>
        </div>

        {/* Signature block */}
        <div className="mt-4 grid grid-cols-2 gap-4 text-[10.5pt]">
          <div>
            <p className="mb-1 font-semibold">مدير المدرسة:</p>
            <p>{school?.principal_name || '—'}</p>
            <p className="mt-3">التوقيع: ............................</p>
          </div>
          <div>
            <p className="mb-1 font-semibold">المشرف العام / وكيل الشؤون التعليمية:</p>
            <p>............................</p>
            <p className="mt-3">التوقيع: ............................</p>
          </div>
        </div>

        <p className="print-stamp text-center text-[8pt] text-gray-500 mt-4">
          طُبع في {new Date().toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'short', timeStyle: 'short' })}
        </p>
      </div>

      <style jsx global>{`
        /* Screen styles */
        .report-print-area { background: #fff; color: #111; font-family: 'Cairo', 'Tajawal', system-ui, sans-serif; }
        .report-print-area table.report-table {
          width: 100%; border-collapse: collapse; font-size: 11pt;
        }
        .report-print-area table.report-table th,
        .report-print-area table.report-table td {
          border: 1pt solid #475569; padding: 6pt 8pt; text-align: right; vertical-align: middle;
        }
        .report-print-area table.report-table thead {
          background: #e2e8f0; font-weight: 700;
        }
        .report-print-area table.meta-table {
          border-collapse: collapse;
        }
        .report-print-area table.meta-table th,
        .report-print-area table.meta-table td {
          border: 1pt solid #475569; padding: 4pt 8pt; text-align: center; font-size: 10pt;
        }
        .report-print-area table.meta-table thead {
          background: #f1f5f9;
        }

        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .report-print-area { color: black !important; background: white !important; }
          .print-content { padding: 6mm !important; }
          @page { size: A4 portrait; margin: 8mm; }
          table.report-table thead, table.meta-table thead {
            background: #e2e8f0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}
