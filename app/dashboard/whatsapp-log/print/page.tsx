'use client';

import { useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Loader2, Printer, ArrowRight, MessageCircle, CheckCircle2, XCircle,
  TrendingUp,
} from 'lucide-react';

interface WaMessage {
  id: number;
  recipient_phone: string;
  recipient_name: string | null;
  recipient_type: 'parent' | 'teacher' | 'admin' | 'unknown';
  template_name: string | null;
  context_type: string | null;
  message_body: string;
  status: 'success' | 'failed';
  http_status: number | null;
  error_message: string | null;
  msg_id: number | null;
  sent_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  parent: 'ولي أمر', teacher: 'معلم', admin: 'إدارة', unknown: 'غير محدد',
};
const CONTEXT_LABEL: Record<string, string> = {
  note: 'ملاحظة', late: 'تأخير', teacher_credentials: 'بيانات دخول', manual: 'يدوي',
};

function formatDateAr(d?: string): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return d; }
}

export default function WhatsappLogPrintPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <PrintBody />
    </Suspense>
  );
}

function PrintBody() {
  const sp = useSearchParams();
  // Reuse the live log filters via query string — same shape as the main
  // /dashboard/whatsapp-log page reads them.
  const status = sp.get('status') || '';
  const context = sp.get('context') || '';
  const type = sp.get('type') || '';
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const q = sp.get('q') || '';

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data,
  });

  const { data, isLoading } = useQuery<{ data: WaMessage[]; total: number; stats: any }>({
    queryKey: ['whatsapp-log-print', status, context, type, from, to, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (context) p.set('context', context);
      if (type) p.set('type', type);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (q) p.set('q', q);
      p.set('limit', '500');  // print-time max
      return (await (await fetch(`/api/whatsapp/messages?${p}`)).json());
    },
  });

  useEffect(() => {
    document.title = `تقرير الواتساب — ${from || 'الكل'}`;
    return () => { document.title = 'نظام الحضور'; };
  }, [from]);

  const messages = data?.data || [];

  // Group counts for the summary header.
  const groups = useMemo(() => {
    const byContext = new Map<string, { success: number; failed: number }>();
    const byType = new Map<string, { success: number; failed: number }>();
    const byRecipient = new Map<string, { name: string; phone: string; success: number; failed: number }>();
    for (const m of messages) {
      const c = m.context_type || 'unknown';
      const cur = byContext.get(c) || { success: 0, failed: 0 };
      cur[m.status]++;
      byContext.set(c, cur);

      const t = m.recipient_type;
      const tCur = byType.get(t) || { success: 0, failed: 0 };
      tCur[m.status]++;
      byType.set(t, tCur);

      const key = m.recipient_phone;
      const rCur = byRecipient.get(key) || { name: m.recipient_name || '', phone: m.recipient_phone, success: 0, failed: 0 };
      rCur[m.status]++;
      if (!rCur.name && m.recipient_name) rCur.name = m.recipient_name;
      byRecipient.set(key, rCur);
    }
    return {
      byContext: Array.from(byContext.entries()).sort((a, b) => (b[1].success + b[1].failed) - (a[1].success + a[1].failed)),
      byType: Array.from(byType.entries()),
      topRecipients: Array.from(byRecipient.values())
        .sort((a, b) => (b.success + b.failed) - (a.success + a.failed))
        .slice(0, 10),
    };
  }, [messages]);

  const total = messages.length;
  const successCount = messages.filter((m) => m.status === 'success').length;
  const failedCount = messages.filter((m) => m.status === 'failed').length;
  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  // Build a human-readable scope label from the active filters.
  const scopeLabel = useMemo(() => {
    const parts: string[] = [];
    if (status === 'success') parts.push('الناجحة فقط');
    else if (status === 'failed') parts.push('الفاشلة فقط');
    if (context) parts.push(`السياق: ${CONTEXT_LABEL[context] || context}`);
    if (type) parts.push(`المستلم: ${TYPE_LABEL[type] || type}`);
    if (q) parts.push(`بحث: "${q}"`);
    return parts.length > 0 ? parts.join(' • ') : 'كل الرسائل';
  }, [status, context, type, q]);

  const dateRange = from && to
    ? (from === to ? formatDateAr(from) : `${formatDateAr(from)} إلى ${formatDateAr(to)}`)
    : (from ? `من ${formatDateAr(from)}` : (to ? `حتى ${formatDateAr(to)}` : 'كل الفترات'));

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

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
        <Link href="/dashboard/whatsapp-log" className="btn-secondary inline-flex items-center gap-1 text-sm">
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
          <h1 className="text-xl font-bold">{settings?.school_name || 'المدرسة'}</h1>
          <p className="text-sm font-semibold mt-2 inline-flex items-center gap-1.5">
            <MessageCircle className="w-4 h-4" />
            تقرير رسائل الواتساب
          </p>
          <p className="text-xs text-gray-700 mt-1">{dateRange}</p>
          <p className="text-xs text-gray-700">{scopeLabel}</p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Stat label="الإجمالي" value={total} />
          <Stat label="ناجحة" value={successCount} tone="green" />
          <Stat label="فاشلة" value={failedCount} tone="red" />
          <Stat label="نسبة النجاح" value={`${successRate}%`} tone={successRate >= 90 ? 'green' : successRate >= 70 ? 'yellow' : 'red'} />
        </div>

        {/* Empty state */}
        {messages.length === 0 ? (
          <p className="text-center text-gray-500 italic py-12">لا توجد رسائل في هذا النطاق</p>
        ) : (
          <>
            {/* By context */}
            {groups.byContext.length > 0 && (
              <div className="mb-4">
                <h2 className="text-sm font-bold bg-blue-50 px-2 py-1.5 mb-2 inline-flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  حسب التصنيف
                </h2>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-300 px-2 py-1">التصنيف</th>
                      <th className="border border-gray-300 px-2 py-1">ناجحة</th>
                      <th className="border border-gray-300 px-2 py-1">فاشلة</th>
                      <th className="border border-gray-300 px-2 py-1">الإجمالي</th>
                      <th className="border border-gray-300 px-2 py-1">نسبة النجاح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.byContext.map(([ctx, c]) => {
                      const tot = c.success + c.failed;
                      const rate = tot > 0 ? Math.round((c.success / tot) * 100) : 0;
                      return (
                        <tr key={ctx}>
                          <td className="border border-gray-300 px-2 py-1">{CONTEXT_LABEL[ctx] || ctx}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center text-green-700">{c.success}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center text-red-700">{c.failed}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center font-bold">{tot}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center">{rate}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Top recipients */}
            {groups.topRecipients.length > 1 && (
              <div className="mb-4">
                <h2 className="text-sm font-bold bg-purple-50 px-2 py-1.5 mb-2">أكثر المستلمين ({groups.topRecipients.length})</h2>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-300 px-2 py-1">#</th>
                      <th className="border border-gray-300 px-2 py-1">الاسم</th>
                      <th className="border border-gray-300 px-2 py-1">الجوال</th>
                      <th className="border border-gray-300 px-2 py-1">ناجحة</th>
                      <th className="border border-gray-300 px-2 py-1">فاشلة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.topRecipients.map((r, i) => (
                      <tr key={r.phone}>
                        <td className="border border-gray-300 px-2 py-1 text-center">{i + 1}</td>
                        <td className="border border-gray-300 px-2 py-1">{r.name || '—'}</td>
                        <td className="border border-gray-300 px-2 py-1 font-mono text-[10px]" dir="ltr">{r.phone}</td>
                        <td className="border border-gray-300 px-2 py-1 text-center text-green-700">{r.success}</td>
                        <td className="border border-gray-300 px-2 py-1 text-center text-red-700">{r.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Detail table */}
            <div className="pagebreak-before">
              <h2 className="text-sm font-bold bg-gray-100 px-2 py-1.5 mb-2">التفاصيل ({messages.length})</h2>
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-300 px-1.5 py-1 w-8">#</th>
                    <th className="border border-gray-300 px-1.5 py-1">التاريخ والوقت</th>
                    <th className="border border-gray-300 px-1.5 py-1">المستلم</th>
                    <th className="border border-gray-300 px-1.5 py-1">الجوال</th>
                    <th className="border border-gray-300 px-1.5 py-1">التصنيف</th>
                    <th className="border border-gray-300 px-1.5 py-1">الحالة</th>
                    <th className="border border-gray-300 px-1.5 py-1">ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m, i) => (
                    <tr key={m.id}>
                      <td className="border border-gray-300 px-1.5 py-1 text-center">{i + 1}</td>
                      <td className="border border-gray-300 px-1.5 py-1 whitespace-nowrap">
                        {new Date(m.sent_at).toLocaleDateString('ar-SA')}
                        <br/>
                        <span className="font-mono text-[9px]" dir="ltr">{new Date(m.sent_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1">{m.recipient_name || '—'}</td>
                      <td className="border border-gray-300 px-1.5 py-1 font-mono text-[9px]" dir="ltr">{m.recipient_phone}</td>
                      <td className="border border-gray-300 px-1.5 py-1 text-center">
                        {CONTEXT_LABEL[m.context_type || ''] || '—'}
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1 text-center">
                        {m.status === 'success'
                          ? <CheckCircle2 className="w-3 h-3 text-green-600 inline" />
                          : <XCircle className="w-3 h-3 text-red-600 inline" />}
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1 text-[9px]">{m.error_message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-12 mt-12 pt-6 border-t border-gray-300 text-sm text-center">
          <div>
            <p className="font-semibold mb-12">المسؤول</p>
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

function Stat({ label, value, tone = 'gray' }: { label: string; value: number | string; tone?: 'gray'|'green'|'red'|'yellow' }) {
  const cls = {
    gray:   'bg-gray-50 text-gray-900 border-gray-300',
    green:  'bg-green-50 text-green-700 border-green-300',
    red:    'bg-red-50 text-red-700 border-red-300',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  }[tone];
  return (
    <div className={`border ${cls} rounded px-2 py-2 text-center`}>
      <p className="text-[10px] font-medium">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
