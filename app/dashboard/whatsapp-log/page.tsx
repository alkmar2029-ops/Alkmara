'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageCircle, Search, RefreshCw, CheckCircle2, XCircle, Calendar,
  Filter, ChevronDown, ChevronUp, Phone, User, Loader2, Printer, Send,
} from 'lucide-react';
import Link from 'next/link';
import { SkeletonTable } from '@/components/ui/Skeleton';

interface WaMessage {
  id: number;
  recipient_phone: string;
  recipient_name: string | null;
  recipient_type: 'parent' | 'teacher' | 'admin' | 'unknown';
  template_name: string | null;
  context_type: string | null;
  context_id: string | null;
  message_body: string;
  status: 'success' | 'failed';
  http_status: number | null;
  error_message: string | null;
  msg_id: number | null;
  sent_by: string | null;
  sent_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  parent: 'ولي أمر', teacher: 'معلم', admin: 'إدارة', unknown: 'غير محدد',
};
const CONTEXT_LABEL: Record<string, string> = {
  note: 'ملاحظة', late: 'تأخير', teacher_credentials: 'بيانات دخول', manual: 'يدوي',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function WhatsappLogPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [contextFilter, setContextFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

  const PAGE_SIZE = 50;

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter !== 'all') p.set('status', statusFilter);
    if (contextFilter !== 'all') p.set('context', contextFilter);
    if (typeFilter !== 'all') p.set('type', typeFilter);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (q.trim()) p.set('q', q.trim());
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String(page * PAGE_SIZE));
    return p.toString();
  }, [statusFilter, contextFilter, typeFilter, from, to, q, page]);

  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useQuery<{
    data: WaMessage[]; total: number; stats: { success: number; failed: number; today: number; last_24h: number };
  }>({
    queryKey: ['whatsapp-log', params],
    queryFn: async () => (await fetch(`/api/whatsapp/messages?${params}`)).json(),
    refetchInterval: 30000,  // auto-refresh every 30s
  });

  // Re-send a previously failed message; the new attempt is logged as a fresh
  // row so the original failure stays in the audit history.
  const resendMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/whatsapp/messages/${id}/resend`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل');
      return d.data as { ok: boolean; error: string | null };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['whatsapp-log'] });
      if (data.ok) toast.success('تم إعادة الإرسال بنجاح');
      else toast.error(`الإرسال فشل مجدداً: ${data.error || 'سبب غير معروف'}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const messages = data?.data || [];
  const total = data?.total || 0;
  const stats = data?.stats || { success: 0, failed: 0, today: 0, last_24h: 0 };
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const resetFilters = () => {
    setStatusFilter('all'); setContextFilter('all'); setTypeFilter('all');
    setFrom(''); setTo(''); setQ(''); setPage(0);
  };
  const hasFilters = statusFilter !== 'all' || contextFilter !== 'all' || typeFilter !== 'all' || from || to || q;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">سجل محادثات الواتساب</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              كل رسالة أرسلها النظام (إشعارات تأخير، ملاحظات، بيانات معلمين)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/whatsapp-log/print?${params}`}
            target="_blank"
            className="btn-secondary inline-flex items-center gap-1"
            title="توليد تقرير قابل للطباعة بنفس الفلاتر الحالية"
          >
            <Printer className="w-4 h-4" />
            تقرير PDF
          </Link>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary inline-flex items-center gap-1"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            تحديث
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="ناجحة" value={stats.success} tone="green" Icon={CheckCircle2} />
        <Stat label="فاشلة" value={stats.failed} tone="red" Icon={XCircle} />
        <Stat label="آخر 24 ساعة" value={stats.last_24h} tone="blue" />
        <Stat label="اليوم" value={stats.today} tone="gray" />
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="label flex items-center gap-1"><Filter className="w-3 h-3" /> الحالة</label>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="input">
              <option value="all">الكل</option>
              <option value="success">ناجحة فقط</option>
              <option value="failed">فاشلة فقط</option>
            </select>
          </div>
          <div>
            <label className="label">السياق</label>
            <select value={contextFilter} onChange={(e) => { setContextFilter(e.target.value); setPage(0); }} className="input">
              <option value="all">الكل</option>
              <option value="note">ملاحظة</option>
              <option value="late">تأخير</option>
              <option value="teacher_credentials">بيانات دخول</option>
              <option value="manual">يدوي</option>
            </select>
          </div>
          <div>
            <label className="label">المستلم</label>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} className="input">
              <option value="all">الكل</option>
              <option value="parent">ولي أمر</option>
              <option value="teacher">معلم</option>
              <option value="admin">إدارة</option>
            </select>
          </div>
          <div>
            <label className="label flex items-center gap-1"><Calendar className="w-3 h-3" /> من</label>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="input" max={todayStr()} />
          </div>
          <div>
            <label className="label">إلى</label>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="input" max={todayStr()} />
          </div>
          <div>
            <label className="label flex items-center gap-1"><Search className="w-3 h-3" /> بحث</label>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className="input" placeholder="اسم/جوال" />
          </div>
        </div>
        {hasFilters && (
          <div className="mt-2 flex justify-end">
            <button onClick={resetFilters} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              مسح الفلاتر
            </button>
          </div>
        )}
      </div>

      {/* Messages list */}
      <div className="card">
        {isLoading ? (
          <SkeletonTable rows={6} cols={4} />
        ) : messages.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
            <MessageCircle className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
            لا توجد رسائل تطابق الفلاتر
          </div>
        ) : (
          <>
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  expanded={expanded === m.id}
                  onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                  onResend={() => resendMut.mutate(m.id)}
                  resending={resendMut.isPending && resendMut.variables === m.id}
                />
              ))}
            </ul>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-200 dark:border-gray-800 text-sm">
                <span className="text-gray-500 dark:text-gray-400">
                  صفحة {page + 1} من {totalPages} • {total} رسالة
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="btn-secondary text-xs disabled:opacity-40"
                  >
                    السابق
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page + 1 >= totalPages}
                    className="btn-secondary text-xs disabled:opacity-40"
                  >
                    التالي
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MessageRow({ message: m, expanded, onToggle, onResend, resending }: {
  message: WaMessage;
  expanded: boolean;
  onToggle: () => void;
  onResend: () => void;
  resending: boolean;
}) {
  const isOk = m.status === 'success';
  return (
    <li className={`py-3 px-2 -mx-2 rounded transition-colors ${expanded ? 'bg-gray-50 dark:bg-gray-800/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}>
      <button onClick={onToggle} className="w-full text-right">
        <div className="flex items-start gap-3">
          <span className={`mt-1 shrink-0 ${isOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {isOk ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-1">
                <User className="w-3 h-3 text-gray-400" />
                {m.recipient_name || '—'}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono inline-flex items-center gap-1" dir="ltr">
                <Phone className="w-3 h-3" /> {m.recipient_phone}
              </span>
              {m.recipient_type !== 'unknown' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {TYPE_LABEL[m.recipient_type]}
                </span>
              )}
              {m.context_type && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400">
                  {CONTEXT_LABEL[m.context_type] || m.context_type}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-1">
              {m.message_body.split('\n').filter((l) => l.trim()).join(' • ')}
            </p>
            {!isOk && m.error_message && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">⚠ {m.error_message}</p>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 text-end shrink-0">
            <p>{new Date(m.sent_at).toLocaleDateString('ar-SA')}</p>
            <p className="font-mono" dir="ltr">{new Date(m.sent_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          <span className="shrink-0 text-gray-400">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 ms-7 ps-3 border-s-2 border-blue-300 dark:border-blue-500/40">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">نص الرسالة:</p>
          <pre className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 font-sans bg-gray-50 dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-800" dir="auto">
            {m.message_body}
          </pre>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {m.template_name && <div>القالب: <code className="text-gray-700 dark:text-gray-300">{m.template_name}</code></div>}
            {m.msg_id && <div>msgId: <code dir="ltr">{m.msg_id}</code></div>}
            {m.http_status && <div>HTTP: <code>{m.http_status}</code></div>}
            {m.context_id && <div>Context ID: <code dir="ltr">{m.context_id}</code></div>}
          </div>

          {/* Resend action — only shown for failed messages */}
          {!isOk && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 flex flex-wrap items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onResend(); }}
                disabled={resending}
                className="btn-primary text-xs inline-flex items-center gap-1.5"
              >
                {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {resending ? 'جارٍ الإعادة...' : 'إعادة إرسال'}
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                إعادة الإرسال تنشئ سجلاً جديداً مع الحفاظ على السجل القديم
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, tone, Icon }: { label: string; value: number; tone: 'green'|'red'|'blue'|'gray'; Icon?: any }) {
  const toneCls = {
    green: 'text-green-600 dark:text-green-400',
    red:   'text-red-600 dark:text-red-400',
    blue:  'text-blue-600 dark:text-blue-400',
    gray:  'text-gray-900 dark:text-gray-100',
  }[tone];
  return (
    <div className="card text-center py-3">
      <div className="flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <p className={`text-2xl font-bold ${toneCls}`}>{value}</p>
    </div>
  );
}
