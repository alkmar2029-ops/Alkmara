'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeftRight, ArrowRight, Loader2, CheckCircle2, XCircle,
  Clock, ShieldCheck, ShieldX, MessageCircle,
} from 'lucide-react';

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

interface SwapRequest {
  id: number;
  requester_id: string;
  requester_name: string | null;
  target_user_name: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  requester_assignment: { day_of_week: number; location_name: string | null } | null;
  target_assignment:    { day_of_week: number; location_name: string | null } | null;
}

const STATUS_META: Record<string, { label: string; cls: string; Icon: any }> = {
  pending:   { label: 'قيد المراجعة', cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30',           Icon: Clock },
  approved:  { label: 'تمت الموافقة', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30', Icon: ShieldCheck },
  rejected:  { label: 'مرفوض',       cls: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30',                       Icon: ShieldX },
  cancelled: { label: 'مُلغى',        cls: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700/40 dark:text-gray-300 dark:border-gray-700',                  Icon: XCircle },
};

export default function SwapInboxPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');

  const { data: requests = [], isLoading } = useQuery<SwapRequest[]>({
    queryKey: ['supervision-swaps', tab],
    queryFn: async () => {
      const url = tab === 'pending' ? '/api/supervision/swaps?status=pending' : '/api/supervision/swaps';
      const r = await fetch(url);
      return (await r.json()).data || [];
    },
    refetchInterval: 30_000,
  });

  const decideMut = useMutation({
    mutationFn: async ({ id, action, note }: { id: number; action: 'approve' | 'reject'; note?: string }) => {
      const r = await fetch(`/api/supervision/swaps/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, decision_note: note }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['supervision-swaps'] });
      toast.success(vars.action === 'approve' ? '✅ تمت الموافقة وتم تبديل الأيام' : '❌ تم الرفض');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/supervision" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center">
            <ArrowLeftRight className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">طلبات تبديل أيام الإشراف</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              عند الموافقة، يتم تبديل التعيينَين في الجدول تلقائياً
            </p>
          </div>
        </div>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-800 -mt-1 gap-2">
        <button onClick={() => setTab('pending')} className={`px-4 py-2 -mb-px border-b-2 text-sm font-medium ${tab === 'pending' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500'}`}>
          قيد المراجعة {pendingCount > 0 && <span className="ms-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[10px]">{pendingCount}</span>}
        </button>
        <button onClick={() => setTab('all')} className={`px-4 py-2 -mb-px border-b-2 text-sm font-medium ${tab === 'all' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500'}`}>
          الكل
        </button>
      </div>

      {isLoading ? (
        <div className="card text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
      ) : requests.length === 0 ? (
        <div className="card text-center py-12">
          <ArrowLeftRight className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">لا توجد طلبات تبديل {tab === 'pending' ? 'معلّقة' : ''}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const meta = STATUS_META[r.status];
            const Icon = meta.Icon;
            return (
              <div key={r.id} className="card">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.cls}`}>
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(r.created_at).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30">
                        <span className="font-bold">{r.requester_name || 'صاحب الطلب'}</span>
                        <span className="text-[11px] text-gray-500">
                          {r.requester_assignment ? `(${ARABIC_DAYS[r.requester_assignment.day_of_week]} - ${r.requester_assignment.location_name})` : ''}
                        </span>
                      </div>
                      <ArrowLeftRight className="w-4 h-4 text-purple-500" />
                      <div className="flex items-center gap-1 px-2 py-1 rounded bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-500/30">
                        <span className="font-bold">{r.target_user_name || 'الزميل المُستهدَف'}</span>
                        <span className="text-[11px] text-gray-500">
                          {r.target_assignment ? `(${ARABIC_DAYS[r.target_assignment.day_of_week]} - ${r.target_assignment.location_name})` : ''}
                        </span>
                      </div>
                    </div>

                    {r.reason && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 inline-flex items-start gap-1 mt-1">
                        <MessageCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{r.reason}</span>
                      </p>
                    )}

                    {r.status !== 'pending' && r.decided_by_name && (
                      <p className="text-[11px] text-gray-500">
                        قرار: {r.decided_by_name}
                        {r.decided_at && <> • {new Date(r.decided_at).toLocaleDateString('ar-SA-u-ca-gregory')}</>}
                        {r.decision_note && <> — “{r.decision_note}”</>}
                      </p>
                    )}
                  </div>

                  {r.status === 'pending' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => decideMut.mutate({ id: r.id, action: 'approve' })}
                        disabled={decideMut.isPending}
                        className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> موافقة
                      </button>
                      <button
                        onClick={() => {
                          const note = prompt('سبب الرفض (اختياري):') || undefined;
                          decideMut.mutate({ id: r.id, action: 'reject', note });
                        }}
                        disabled={decideMut.isPending}
                        className="px-3 py-1.5 rounded-lg text-xs bg-red-600 hover:bg-red-700 text-white inline-flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" /> رفض
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
