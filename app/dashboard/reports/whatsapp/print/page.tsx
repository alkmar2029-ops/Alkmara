'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer } from 'lucide-react';

interface Msg {
  id: number;
  recipient_phone: string;
  recipient_name: string | null;
  recipient_type: string;
  context_type: string | null;
  message_body: string;
  status: 'success' | 'failed';
  error_message: string | null;
  sender_name: string | null;
  sender_role: string | null;
  sent_at: string;
}

const RECIPIENT_LABEL: Record<string, string> = {
  parent: 'ولي أمر', teacher: 'معلم', admin: 'إدارة', unknown: 'غير محدد',
};
const CONTEXT_LABEL: Record<string, string> = {
  note: 'ملاحظة', late: 'تأخير', teacher_credentials: 'بيانات دخول', manual: 'يدوي',
  dismissal: 'استئذان', daily_attendance: 'غياب يومي', bulk_remind: 'تذكير جماعي',
};
const SENDER_ROLE_LABEL: Record<string, string> = {
  super_admin: 'المدير العام', admin: 'الإدارة', staff: 'الإدارة', teacher: 'معلم',
};

export default function WhatsappReportPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>}>
      <PrintInner />
    </Suspense>
  );
}

function PrintInner() {
  const sp = useSearchParams();
  const groupBy = (sp.get('group_by') || 'none') as 'none' | 'day' | 'sender' | 'grade';

  // Re-fetch messages with the same filters as the report page passed in.
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    sp.forEach((v, k) => {
      if (k === 'group_by') return;
      p.set(k, v);
    });
    p.set('limit', '500');
    return p.toString();
  }, [sp]);

  const { data, isLoading } = useQuery<{ data: Msg[]; total: number; stats: { success: number; failed: number; today: number } }>({
    queryKey: ['wa-report-print', queryString],
    queryFn: async () => (await fetch(`/api/whatsapp/messages?${queryString}`)).json(),
  });

  const { data: school } = useQuery<{ school_name?: string; principal_name?: string }>({
    queryKey: ['settings-print'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data || {},
  });

  const messages = data?.data || [];

  // Auto-trigger the print dialog once data is loaded.
  useEffect(() => {
    if (!isLoading && messages.length >= 0) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [isLoading, messages.length]);

  const grouped = useMemo(() => {
    if (groupBy === 'none') return null;
    const map = new Map<string, Msg[]>();
    for (const m of messages) {
      let key = '—';
      if (groupBy === 'day') key = m.sent_at.slice(0, 10);
      else if (groupBy === 'sender') key = m.sender_name || (m.sender_role ? SENDER_ROLE_LABEL[m.sender_role] : 'النظام');
      else if (groupBy === 'grade') key = RECIPIENT_LABEL[m.recipient_type] || 'غير محدد';
      const arr = map.get(key) || [];
      arr.push(m);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [groupBy, messages]);

  const stats = data?.stats || { success: 0, failed: 0, today: 0 };

  // Human-readable list of active filters for the report header.
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    const from = sp.get('from'), to = sp.get('to');
    if (from && to) parts.push(from === to ? `📅 ${from}` : `📅 ${from} → ${to}`);
    else if (from) parts.push(`📅 من ${from}`);
    else if (to) parts.push(`📅 إلى ${to}`);
    if (sp.get('sender_role')) parts.push(`👤 ${sp.get('sender_role') === 'teacher' ? 'المعلمون' : 'الإدارة'}`);
    if (sp.get('type')) parts.push(`→ ${RECIPIENT_LABEL[sp.get('type')!] || sp.get('type')}`);
    if (sp.get('status')) parts.push(sp.get('status') === 'success' ? '✅ ناجحة' : '❌ فاشلة');
    if (sp.get('context')) parts.push(CONTEXT_LABEL[sp.get('context')!] || sp.get('context')!);
    if (sp.get('student_id')) parts.push('👤 طالب محدد');
    if (sp.get('grade_id')) parts.push('🏫 صف محدد');
    if (sp.get('section_id')) parts.push('/ شعبة محددة');
    return parts;
  }, [sp]);

  if (isLoading) {
    return <div className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin inline text-gray-400" /></div>;
  }

  return (
    <div className="report-print-area">
      {/* Re-print button — hidden in @media print */}
      <div className="no-print sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-3 flex items-center justify-between z-10">
        <h1 className="font-bold text-base">تقرير رسائل الواتساب</h1>
        <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1.5 text-sm">
          <Printer className="w-4 h-4" /> طباعة
        </button>
      </div>

      <div className="print-content p-6">
        {/* Header */}
        <header className="print-header text-center border-b-2 border-gray-800 pb-3 mb-4">
          <p className="text-xs text-gray-600 mb-1">المملكة العربية السعودية — وزارة التعليم</p>
          <h1 className="text-xl font-extrabold mb-1">{school?.school_name || 'مدرسة'}</h1>
          {school?.principal_name && (
            <p className="text-sm text-gray-700">مدير المدرسة: {school.principal_name}</p>
          )}
          <hr className="my-2" />
          <h2 className="text-lg font-bold">📱 تقرير رسائل الواتساب الصادرة</h2>
          {filterSummary.length > 0 && (
            <p className="text-xs text-gray-700 mt-2 leading-relaxed">
              {filterSummary.join(' • ')}
            </p>
          )}
        </header>

        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          <StatPrint label="إجمالي" value={messages.length} />
          <StatPrint label="ناجحة" value={stats.success} />
          <StatPrint label="فاشلة" value={stats.failed} />
        </div>

        {/* Body — grouped or flat */}
        {messages.length === 0 ? (
          <p className="text-center text-gray-500 py-8 text-sm">لا توجد رسائل ضمن النطاق المحدد.</p>
        ) : groupBy === 'none' ? (
          <ReportTable messages={messages} />
        ) : (
          grouped!.map(([key, items]) => (
            <section key={key} className="mb-5 group-section">
              <h3 className="font-bold text-sm bg-gray-100 px-2 py-1 rounded mb-1 flex items-center justify-between">
                <span>{key}</span>
                <span className="text-xs font-normal text-gray-600">{items.length} رسالة</span>
              </h3>
              <ReportTable messages={items} />
            </section>
          ))
        )}

        {/* Footer */}
        <footer className="print-footer mt-6 pt-3 border-t border-gray-300">
          <div className="flex justify-between text-sm gap-6 mb-2">
            <div>توقيع وكيل المدرسة: ............................</div>
            <div>توقيع المدير: ............................</div>
          </div>
          <p className="text-[10px] text-gray-500 text-center">
            طُبع في {new Date().toLocaleString('ar-SA-u-ca-gregory', {
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit',
            })}
            {' '}• إجمالي السجلات: {messages.length}
          </p>
        </footer>
      </div>

      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .report-print-area {
            color: black !important;
            background: white !important;
          }
          .print-content {
            padding: 6mm !important;
          }
          @page { size: A4 portrait; margin: 8mm; }

          .group-section {
            page-break-inside: avoid;
          }

          table.report-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5pt;
          }
          table.report-table th,
          table.report-table td {
            border: 0.5pt solid #cbd5e1;
            padding: 3pt 4pt;
            vertical-align: top;
            text-align: right;
          }
          table.report-table thead {
            background: #f1f5f9 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          table.report-table .status-failed {
            color: #b91c1c;
            font-weight: 600;
          }
          table.report-table .status-success {
            color: #047857;
            font-weight: 600;
          }
          .stat-card-print {
            border: 1pt solid #cbd5e1;
            padding: 4pt;
            border-radius: 4pt;
            background: #f8fafc !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }

        /* Screen styles — keep readable when previewing without printing */
        .report-print-area { background: #fff; color: #111; }
        .report-print-area table.report-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .report-print-area table.report-table th,
        .report-print-area table.report-table td {
          border: 1px solid #e5e7eb; padding: 4px 6px; text-align: right; vertical-align: top;
        }
        .report-print-area table.report-table thead { background: #f3f4f6; }
        .report-print-area table.report-table .status-failed { color: #b91c1c; font-weight: 600; }
        .report-print-area table.report-table .status-success { color: #047857; font-weight: 600; }
        .report-print-area .stat-card-print {
          border: 1px solid #e5e7eb; padding: 8px; border-radius: 6px; background: #f9fafb;
        }
      `}</style>
    </div>
  );
}

function StatPrint({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card-print">
      <p className="text-[11px] text-gray-600">{label}</p>
      <p className="text-xl font-bold">{value.toLocaleString('ar-SA')}</p>
    </div>
  );
}

function ReportTable({ messages }: { messages: Msg[] }) {
  return (
    <table className="report-table">
      <thead>
        <tr>
          <th style={{ width: '10%' }}>التاريخ</th>
          <th style={{ width: '8%' }}>الوقت</th>
          <th style={{ width: '18%' }}>المُرسِل</th>
          <th style={{ width: '20%' }}>المُستقبِل</th>
          <th style={{ width: '12%' }}>النوع</th>
          <th style={{ width: '8%' }}>الحالة</th>
          <th style={{ width: '24%' }}>المحتوى (مختصر)</th>
        </tr>
      </thead>
      <tbody>
        {messages.map((m) => {
          const dt = new Date(m.sent_at);
          const preview = m.message_body.slice(0, 120) + (m.message_body.length > 120 ? '…' : '');
          return (
            <tr key={m.id}>
              <td>{dt.toLocaleDateString('ar-SA-u-ca-gregory')}</td>
              <td>{dt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</td>
              <td>
                {m.sender_name || (m.sender_role ? SENDER_ROLE_LABEL[m.sender_role] : 'النظام')}
                {m.sender_role && (
                  <div style={{ fontSize: '8pt', color: '#6b7280' }}>{SENDER_ROLE_LABEL[m.sender_role] || m.sender_role}</div>
                )}
              </td>
              <td>
                {m.recipient_name || '—'}
                <div style={{ fontSize: '8pt', color: '#6b7280', direction: 'ltr', fontFamily: 'monospace' }}>{m.recipient_phone}</div>
              </td>
              <td>
                {RECIPIENT_LABEL[m.recipient_type]}
                {m.context_type && (
                  <div style={{ fontSize: '8pt', color: '#6b7280' }}>{CONTEXT_LABEL[m.context_type] || m.context_type}</div>
                )}
              </td>
              <td className={m.status === 'success' ? 'status-success' : 'status-failed'}>
                {m.status === 'success' ? '✓ ناجحة' : '✗ فاشلة'}
              </td>
              <td style={{ fontSize: '9pt' }}>{preview}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
