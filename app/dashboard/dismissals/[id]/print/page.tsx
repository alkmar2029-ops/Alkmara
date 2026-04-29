'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Loader2, Printer, ArrowRight } from 'lucide-react';
import Link from 'next/link';

const REASON_LABELS: Record<string, string> = {
  medical: 'مراجعة طبية',
  family: 'ظرف عائلي',
  emergency: 'حالة طارئة',
  other: 'استئذان',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  father: 'الوالد',
  mother: 'الوالدة',
  guardian: 'ولي الأمر',
  relative: 'قريب',
  other: 'مفوَّض',
};

interface Dismissal {
  id: number;
  student_code: string;
  student_name: string;
  grade_name: string;
  section_name: string;
  dismissal_date: string;
  dismissal_time: string;
  reason: string;
  reason_details: string | null;
  pickup_person_name: string;
  pickup_person_relationship: string;
  pickup_person_id_number: string | null;
  pickup_person_phone: string | null;
  approved_by_name: string | null;
  notes: string | null;
}

export default function ExitPassPrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data,
  });

  const { data, isLoading, isError } = useQuery<Dismissal>({
    queryKey: ['dismissal', id],
    queryFn: async () => (await (await fetch(`/api/dismissals/${id}`)).json()).data,
    enabled: !!id,
  });

  useEffect(() => {
    if (data) document.title = `تصريح خروج — ${data.student_name}`;
    return () => { document.title = 'نظام الحضور'; };
  }, [data]);

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }
  if (isError || !data) {
    return <div className="text-center py-20 text-red-600 dark:text-red-400">الاستئذان غير موجود</div>;
  }

  const dateStr = (() => {
    try {
      return new Date(data.dismissal_date).toLocaleDateString('ar-SA-u-ca-gregory', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch { return data.dismissal_date; }
  })();

  return (
    <>
      <style jsx global>{`
        @page { size: A5 portrait; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 -mx-4 -mt-4 px-4 py-3 mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-bold">تصريح خروج طالب</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">معاينة قبل الطباعة</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/dismissals" className="btn-secondary inline-flex items-center gap-1 text-sm">
            <ArrowRight className="w-4 h-4" /> رجوع
          </Link>
          <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1 text-sm">
            <Printer className="w-4 h-4" /> طباعة
          </button>
        </div>
      </div>

      {/* Pass — A5 portrait */}
      <div className="print-area max-w-[148mm] mx-auto bg-white text-black border-4 border-double border-gray-800 p-6 print:border-2 print:p-4">
        {/* Header */}
        <div className="text-center pb-3 border-b-2 border-gray-800">
          <p className="text-xs text-gray-700">المملكة العربية السعودية — وزارة التعليم</p>
          <h1 className="text-xl font-bold mt-1">{settings?.school_name || 'المدرسة'}</h1>
          {settings?.principal_name && (
            <p className="text-xs text-gray-700 mt-0.5">المدير: {settings.principal_name}</p>
          )}
        </div>

        {/* Title */}
        <div className="text-center my-4">
          <h2 className="text-3xl font-bold border-2 border-gray-800 inline-block px-6 py-2">
            🚪 تصريح خروج
          </h2>
          <p className="text-xs text-gray-600 mt-1">يُسلَّم لحارس المدرسة عند الخروج</p>
        </div>

        {/* Body table */}
        <table className="w-full text-sm border-collapse">
          <tbody>
            <tr className="border-b border-gray-300">
              <td className="py-2 px-3 font-bold bg-gray-100 w-1/3">اسم الطالب:</td>
              <td className="py-2 px-3">{data.student_name}</td>
            </tr>
            <tr className="border-b border-gray-300">
              <td className="py-2 px-3 font-bold bg-gray-100">رقم الهوية:</td>
              <td className="py-2 px-3 font-mono" dir="ltr">{data.student_code}</td>
            </tr>
            <tr className="border-b border-gray-300">
              <td className="py-2 px-3 font-bold bg-gray-100">الصف / الشعبة:</td>
              <td className="py-2 px-3">{data.grade_name} — {data.section_name}</td>
            </tr>
            <tr className="border-b border-gray-300">
              <td className="py-2 px-3 font-bold bg-gray-100">التاريخ:</td>
              <td className="py-2 px-3">{dateStr}</td>
            </tr>
            <tr className="border-b border-gray-300">
              <td className="py-2 px-3 font-bold bg-gray-100">وقت الخروج:</td>
              <td className="py-2 px-3 font-mono text-base font-bold" dir="ltr">{data.dismissal_time.slice(0, 5)}</td>
            </tr>
            <tr className="border-b border-gray-300">
              <td className="py-2 px-3 font-bold bg-gray-100">سبب الاستئذان:</td>
              <td className="py-2 px-3">
                {REASON_LABELS[data.reason] || data.reason}
                {data.reason_details && <span className="text-gray-600"> — {data.reason_details}</span>}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Pickup person */}
        <div className="mt-4 border-2 border-gray-700 bg-gray-50 p-3">
          <h3 className="text-sm font-bold mb-2 text-center">📋 بيانات المُستلِم</h3>
          <table className="w-full text-sm border-collapse">
            <tbody>
              <tr><td className="py-1 px-2 font-semibold w-1/3">الاسم:</td><td className="py-1 px-2">{data.pickup_person_name}</td></tr>
              <tr><td className="py-1 px-2 font-semibold">صلة القرابة:</td><td className="py-1 px-2">{RELATIONSHIP_LABELS[data.pickup_person_relationship] || data.pickup_person_relationship}</td></tr>
              {data.pickup_person_id_number && (
                <tr><td className="py-1 px-2 font-semibold">رقم الهوية:</td><td className="py-1 px-2 font-mono" dir="ltr">{data.pickup_person_id_number}</td></tr>
              )}
              {data.pickup_person_phone && (
                <tr><td className="py-1 px-2 font-semibold">رقم الجوال:</td><td className="py-1 px-2 font-mono" dir="ltr">{data.pickup_person_phone}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t-2 border-gray-700 text-center text-sm">
          <div>
            <p className="font-bold mb-12">{data.approved_by_name || 'الوكيل / الإدارة'}</p>
            <div className="border-t border-gray-700 mx-2"><p className="text-xs text-gray-600 pt-1">التوقيع والختم</p></div>
          </div>
          <div>
            <p className="font-bold mb-12">{RELATIONSHIP_LABELS[data.pickup_person_relationship] || 'المُستلِم'}</p>
            <div className="border-t border-gray-700 mx-2"><p className="text-xs text-gray-600 pt-1">التوقيع</p></div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-[10px] text-gray-500 mt-3 pt-2 border-t border-gray-300">
          صدر هذا التصريح من نظام إدارة الحضور المدرسي • #{data.id}
        </div>
      </div>
    </>
  );
}
