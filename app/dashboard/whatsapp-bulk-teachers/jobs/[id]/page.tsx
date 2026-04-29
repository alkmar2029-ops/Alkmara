'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Loader2, CheckCircle2, XCircle, Clock, AlertCircle, ChevronRight,
  Pause, MessageCircle, RefreshCw, Filter,
} from 'lucide-react';

interface Recipient {
  id: number;
  user_id: string;
  teacher_name: string | null;
  phone: string | null;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  sent_at: string | null;
}

interface Job {
  id: number;
  template: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  total: number;
  sent: number;
  failed: number;
  also_internal: boolean;
  internal_subject: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const STATUS_CONFIG = {
  queued:   { label: 'في الانتظار', icon: Clock,         cls: 'text-gray-500 dark:text-gray-400' },
  sending:  { label: 'جارٍ الإرسال', icon: Loader2,      cls: 'text-blue-600 dark:text-blue-400 animate-pulse' },
  sent:     { label: 'تم الإرسال',   icon: CheckCircle2, cls: 'text-green-600 dark:text-green-400' },
  failed:   { label: 'فشل',          icon: XCircle,      cls: 'text-red-600 dark:text-red-400' },
  skipped:  { label: 'تخطّي',        icon: AlertCircle,  cls: 'text-amber-600 dark:text-amber-400' },
} as const;

export default function BulkJobProgressPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  // Next 14 sometimes provides params as a plain object (server component)
  // and sometimes as a Promise (when 'use' hook is needed). Handle both.
  const resolvedParams = (params as any).then ? use(params as Promise<{ id: string }>) : params as { id: string };
  const jobId = Number(resolvedParams.id);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'sent' | 'failed' | 'queued' | 'sending'>('all');

  const { data, isLoading, refetch } = useQuery<{ job: Job; recipients: Recipient[] }>({
    queryKey: ['bulk-job', jobId],
    queryFn: async () => {
      const r = await fetch(`/api/whatsapp/bulk-jobs/${jobId}`);
      if (!r.ok) throw new Error('فشل جلب المهمة');
      return (await r.json()).data;
    },
    refetchInterval: (q) => {
      // Poll fast while in-flight, slowly once terminal.
      const status = q.state.data?.job.status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') return false;
      return 2000;
    },
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/whatsapp/bulk-jobs/${jobId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الإلغاء');
    },
    onSuccess: () => {
      toast.success('تم إلغاء المهمة');
      qc.invalidateQueries({ queryKey: ['bulk-job', jobId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="text-center py-20">
        <Loader2 className="w-8 h-8 animate-spin inline text-gray-400" />
      </div>
    );
  }
  if (!data) {
    return <div className="text-center py-20 text-red-600 dark:text-red-400">المهمة غير موجودة</div>;
  }

  const { job, recipients } = data;
  const counts = {
    sent: recipients.filter((r) => r.status === 'sent').length,
    failed: recipients.filter((r) => r.status === 'failed').length,
    queued: recipients.filter((r) => r.status === 'queued').length,
    sending: recipients.filter((r) => r.status === 'sending').length,
    skipped: recipients.filter((r) => r.status === 'skipped').length,
  };
  const filteredRecipients = filter === 'all'
    ? recipients
    : recipients.filter((r) => r.status === filter);

  const progress = job.total > 0
    ? Math.round(((counts.sent + counts.failed + counts.skipped) / job.total) * 100)
    : 0;
  const isActive = job.status === 'pending' || job.status === 'processing';
  const isTerminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';

  // Estimate ETA based on remaining queued × 5.5s.
  const etaSeconds = (counts.queued + counts.sending) * 5.5;
  const etaMinutes = Math.floor(etaSeconds / 60);
  const etaRemainder = Math.round(etaSeconds % 60);

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
        <Link href="/dashboard/whatsapp-bulk-teachers" className="hover:underline">تذكير جماعي</Link>
        <ChevronRight className="w-3 h-3 rotate-180" />
        <Link href="/dashboard/whatsapp-bulk-teachers/jobs" className="hover:underline">المهام</Link>
        <ChevronRight className="w-3 h-3 rotate-180" />
        <span>مهمة #{job.id}</span>
      </nav>

      {/* Status hero */}
      <div className={`card p-5 ${
        job.status === 'completed' ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30' :
        job.status === 'failed' ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30' :
        job.status === 'cancelled' ? 'bg-gray-50 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/30' :
        'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30'
      }`}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              job.status === 'completed' ? 'bg-green-500' :
              job.status === 'failed' ? 'bg-red-500' :
              job.status === 'cancelled' ? 'bg-gray-500' :
              'bg-blue-500'
            }`}>
              {job.status === 'completed' ? <CheckCircle2 className="w-6 h-6 text-white" /> :
               job.status === 'failed' ? <XCircle className="w-6 h-6 text-white" /> :
               job.status === 'cancelled' ? <Pause className="w-6 h-6 text-white" /> :
               <Loader2 className="w-6 h-6 text-white animate-spin" />}
            </div>
            <div>
              <h1 className="text-xl font-bold">
                {job.status === 'completed' && '✓ اكتمل الإرسال'}
                {job.status === 'failed' && 'فشلت المهمة'}
                {job.status === 'cancelled' && 'تم إلغاء المهمة'}
                {job.status === 'pending' && 'جارٍ بدء التشغيل...'}
                {job.status === 'processing' && 'جارٍ الإرسال...'}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                مهمة #{job.id} • بدأت {new Date(job.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => refetch()} className="btn-secondary inline-flex items-center gap-1 text-sm">
              <RefreshCw className="w-4 h-4" /> تحديث
            </button>
            {isActive && (
              <button
                onClick={() => {
                  if (confirm('سيتم إلغاء المهمة. الرسائل التي أُرسلت لن تُسحَب. هل أنت متأكد؟')) {
                    cancelMut.mutate();
                  }
                }}
                disabled={cancelMut.isPending}
                className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 hover:bg-red-200"
              >
                {cancelMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                إيقاف
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>التقدّم</span>
            <span className="font-bold">{progress}%</span>
          </div>
          <div className="w-full bg-white/60 dark:bg-black/30 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                job.status === 'completed' ? 'bg-green-500' :
                job.status === 'failed' ? 'bg-red-500' :
                job.status === 'cancelled' ? 'bg-gray-500' :
                'bg-blue-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-gray-700 dark:text-gray-200">
              تم: <strong>{counts.sent + counts.failed + counts.skipped}</strong> من <strong>{job.total}</strong>
            </span>
            {isActive && counts.queued > 0 && (
              <span className="text-blue-700 dark:text-blue-300 text-xs">
                ⏱ المتبقّي تقريباً: {etaMinutes > 0 ? `${etaMinutes} د و ` : ''}{etaRemainder} ث
              </span>
            )}
          </div>
        </div>

        {job.error_message && (
          <div className="mt-3 bg-red-100 dark:bg-red-500/20 border border-red-300 dark:border-red-500/40 rounded-lg p-2 text-sm text-red-800 dark:text-red-200">
            ❌ {job.error_message}
          </div>
        )}

        {isTerminal && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            {job.status === 'completed' && job.completed_at && (
              <>اكتملت في {new Date(job.completed_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}</>
            )}
          </p>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <button onClick={() => setFilter('all')} className={`card text-center py-3 ${filter === 'all' ? 'ring-2 ring-blue-500' : ''}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400">الكل</p>
          <p className="text-2xl font-bold">{job.total}</p>
        </button>
        <button onClick={() => setFilter('sent')} className={`card text-center py-3 bg-green-50 dark:bg-green-500/10 ${filter === 'sent' ? 'ring-2 ring-green-500' : ''}`}>
          <p className="text-xs text-green-700 dark:text-green-300">تم الإرسال</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-400">{counts.sent}</p>
        </button>
        <button onClick={() => setFilter('failed')} className={`card text-center py-3 bg-red-50 dark:bg-red-500/10 ${filter === 'failed' ? 'ring-2 ring-red-500' : ''}`}>
          <p className="text-xs text-red-700 dark:text-red-300">فشل</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{counts.failed}</p>
        </button>
        <button onClick={() => setFilter('queued')} className={`card text-center py-3 bg-gray-50 dark:bg-gray-500/10 ${filter === 'queued' ? 'ring-2 ring-gray-500' : ''}`}>
          <p className="text-xs text-gray-700 dark:text-gray-300">في الانتظار</p>
          <p className="text-2xl font-bold text-gray-700 dark:text-gray-400">{counts.queued}</p>
        </button>
        <button onClick={() => setFilter('sending')} className={`card text-center py-3 bg-blue-50 dark:bg-blue-500/10 ${filter === 'sending' ? 'ring-2 ring-blue-500' : ''}`}>
          <p className="text-xs text-blue-700 dark:text-blue-300">جارٍ الإرسال</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{counts.sending}</p>
        </button>
      </div>

      {/* Recipients list */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            قائمة المستلمين
            {filter !== 'all' && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                (مفلترة: {STATUS_CONFIG[filter as keyof typeof STATUS_CONFIG]?.label})
              </span>
            )}
          </h3>
          {filter !== 'all' && (
            <button
              onClick={() => setFilter('all')}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
            >
              <Filter className="w-3 h-3" /> إلغاء التصفية
            </button>
          )}
        </div>
        {filteredRecipients.length === 0 ? (
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-6">لا يوجد مستلمون في هذا التصفية</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[600px] overflow-y-auto">
            {filteredRecipients.map((r) => {
              const cfg = STATUS_CONFIG[r.status];
              const Icon = cfg.icon;
              return (
                <li key={r.id} className="py-2 flex items-center gap-2">
                  <Icon className={`w-4 h-4 shrink-0 ${cfg.cls}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.teacher_name || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">
                      {r.phone || '—'}
                      {r.sent_at && (
                        <span className="ms-2 opacity-70">
                          {new Date(r.sent_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      )}
                    </p>
                  </div>
                  {r.error && (
                    <span className="text-xs text-red-600 dark:text-red-400 truncate max-w-[40%]" title={r.error}>
                      {r.error}
                    </span>
                  )}
                  <span className={`text-xs ${cfg.cls} shrink-0`}>{cfg.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Sent template (collapsed) */}
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">
          عرض نص الرسالة المُرسَل
        </summary>
        <pre className="mt-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-xs whitespace-pre-wrap font-sans">
          {job.template}
        </pre>
      </details>
    </div>
  );
}
