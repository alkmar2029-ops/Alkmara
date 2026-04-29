'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  History, Loader2, CheckCircle2, XCircle, Pause, Clock, ChevronLeft,
} from 'lucide-react';

interface JobRow {
  id: number;
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
  template: string;
}

const STATUS_BADGE: Record<string, { label: string; classes: string; Icon: any }> = {
  pending:    { label: 'في الانتظار',  classes: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300', Icon: Clock },
  processing: { label: 'جارٍ التشغيل', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300', Icon: Loader2 },
  completed:  { label: 'مكتملة',       classes: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300', Icon: CheckCircle2 },
  failed:     { label: 'فشلت',         classes: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300', Icon: XCircle },
  cancelled:  { label: 'مُلغاة',       classes: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', Icon: Pause },
};

export default function BulkJobsHistoryPage() {
  const { data: jobs = [], isLoading } = useQuery<JobRow[]>({
    queryKey: ['bulk-jobs-list'],
    queryFn: async () => (await (await fetch('/api/whatsapp/bulk-jobs')).json()).data || [],
    refetchInterval: 5000,  // refresh every 5s in case there's an active job
  });

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <History className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">سجل التذكيرات الجماعية</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">آخر 50 مهمة إرسال جماعي</p>
          </div>
        </div>
        <Link
          href="/dashboard/whatsapp-bulk-teachers"
          className="btn-primary inline-flex items-center gap-1 text-sm"
        >
          + تذكير جديد
        </Link>
      </div>

      {/* List */}
      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
            لا توجد مهام سابقة بعد. أرسل أول تذكير جماعي من زر "تذكير جديد".
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {jobs.map((j) => {
              const cfg = STATUS_BADGE[j.status] || STATUS_BADGE.pending;
              const StatusIcon = cfg.Icon;
              const isRunning = j.status === 'pending' || j.status === 'processing';
              const progress = j.total > 0 ? Math.round(((j.sent + j.failed) / j.total) * 100) : 0;
              const subject = j.internal_subject ||
                (j.template.split('\n').find((l) => l.trim().length > 0) || '').slice(0, 60);

              return (
                <li key={j.id}>
                  <Link
                    href={`/dashboard/whatsapp-bulk-teachers/jobs/${j.id}`}
                    className="block p-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium shrink-0 ${cfg.classes}`}>
                          <StatusIcon className={`w-3 h-3 ${j.status === 'processing' ? 'animate-spin' : ''}`} />
                          {cfg.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{subject}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            #{j.id} • {new Date(j.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          {j.sent}/{j.total}
                          {j.failed > 0 && (
                            <span className="text-red-600 dark:text-red-400 ms-1">• فشل {j.failed}</span>
                          )}
                        </div>
                        <ChevronLeft className="w-4 h-4 text-gray-400 shrink-0" />
                      </div>
                    </div>

                    {/* Progress bar (only when in flight) */}
                    {isRunning && (
                      <div className="mt-2 w-full bg-gray-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-blue-500 h-full transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
