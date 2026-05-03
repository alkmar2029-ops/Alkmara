'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Send, Loader2, CheckCircle2, XCircle, Pause, Play, X, RotateCcw, Volume2, VolumeX,
} from 'lucide-react';
import {
  PHASE_LABELS,
  type CampaignSnapshot,
  type PhaseKey,
} from '@/lib/daily-attendance/campaign-types';

interface RecentRow {
  id: number;
  phase_key: PhaseKey;
  student_name: string;
  phone: string | null;
  status: 'sent' | 'failed';
  error: string | null;
  sent_at: string | null;
}

interface SnapshotResponse {
  campaign: CampaignSnapshot;
  recent: RecentRow[];
}

const PHASE_COLORS: Record<PhaseKey, string> = {
  absence:            'bg-red-500',
  escape_after_first: 'bg-orange-500',
  mid_day_departure:  'bg-cyan-500',
  selective_skip:     'bg-yellow-500',
};

/**
 * Live progress panel for a daily-attendance send campaign. Polls the
 * server every 2 seconds and renders an overall progress bar plus a
 * per-phase breakdown. Pause/Resume/Cancel/Retry-Failed all work via
 * dedicated API calls; the UI updates on the next poll tick.
 *
 * Pass campaignId=null to hide the panel; when an id is provided the
 * panel auto-hides after 30s on terminal status to give the admin
 * time to read the summary.
 */
export default function CampaignProgressPanel({
  campaignId, onDismiss,
}: {
  campaignId: number | null;
  onDismiss: () => void;
}) {
  const qc = useQueryClient();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoHide, setAutoHide] = useState(false);

  const { data } = useQuery<SnapshotResponse>({
    queryKey: ['ds-campaign', campaignId],
    queryFn: async () => {
      const r = await fetch(`/api/daily-attendance/campaigns/${campaignId}`);
      if (!r.ok) throw new Error('failed');
      return (await r.json()).data;
    },
    enabled: campaignId != null,
    refetchInterval: (query) => {
      const c: CampaignSnapshot | undefined = query.state.data?.campaign;
      if (!c) return 2000;
      return ['completed', 'failed', 'cancelled'].includes(c.status) ? false : 2000;
    },
  });

  const campaign = data?.campaign;
  const recent = data?.recent || [];

  // Sound on terminal status (one-shot per campaign).
  const [terminalSoundPlayed, setTerminalSoundPlayed] = useState<number | null>(null);
  useEffect(() => {
    if (!campaign) return;
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(campaign.status);
    if (!isTerminal || terminalSoundPlayed === campaign.id) return;
    setTerminalSoundPlayed(campaign.id);
    if (soundEnabled) playDoneSound(campaign.status === 'completed');
    // Auto-hide after 30 seconds on completion (not on failure/cancel —
    // user might want to retry).
    if (campaign.status === 'completed') {
      const t = setTimeout(() => setAutoHide(true), 30_000);
      return () => clearTimeout(t);
    }
  }, [campaign?.id, campaign?.status, soundEnabled, terminalSoundPlayed]);

  // beforeunload guard while running.
  useEffect(() => {
    if (!campaign) return;
    if (!['pending', 'processing'].includes(campaign.status)) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Note: server keeps running, so this is just a courtesy warning
      // — the user might think closing the tab cancels the job.
      e.preventDefault();
      e.returnValue = 'الإرسال مستمر في الخلفية. مغادرة الصفحة لن توقفه — هل تريد المغادرة؟';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [campaign?.status]);

  const pauseMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/daily-attendance/campaigns/${campaignId}/pause`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ds-campaign', campaignId] }),
    onError: (e: any) => toast.error(e.message),
  });

  const resumeMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/daily-attendance/campaigns/${campaignId}/resume`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ds-campaign', campaignId] }),
    onError: (e: any) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      if (!confirm('إلغاء الحملة؟ الرسائل المُرسَلة ستبقى — والباقية ستتوقَّف.')) {
        throw new Error('cancelled');
      }
      const r = await fetch(`/api/daily-attendance/campaigns/${campaignId}/cancel`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ds-campaign', campaignId] }),
    onError: (e: any) => { if (e.message !== 'cancelled') toast.error(e.message); },
  });

  const retryMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/daily-attendance/campaigns/${campaignId}/retry-failed`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل');
      return d.data as { requeued: number };
    },
    onSuccess: (d) => {
      toast.success(`✓ أُعيد جدولة ${d.requeued} رسالة`);
      setAutoHide(false);
      qc.invalidateQueries({ queryKey: ['ds-campaign', campaignId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ETA calculation based on remaining recipients × 5.5s pacing.
  const etaText = useMemo(() => {
    if (!campaign) return '';
    const remaining = campaign.total - campaign.sent - campaign.failed;
    if (remaining <= 0) return '';
    const seconds = Math.ceil(remaining * 5.5);
    if (seconds < 60) return `~${seconds}ث`;
    return `~${Math.ceil(seconds / 60)}د`;
  }, [campaign]);

  if (!campaignId || !campaign || autoHide) return null;

  const overallPct = campaign.total > 0
    ? Math.round(((campaign.sent + campaign.failed) / campaign.total) * 100)
    : 0;
  const isRunning = ['pending', 'processing'].includes(campaign.status);
  const isPaused = campaign.status === 'paused';
  const isTerminal = ['completed', 'failed', 'cancelled'].includes(campaign.status);

  // Phase order for rendering — matches the priority in PHASE_ORDER.
  const phaseKeys: PhaseKey[] = ['absence', 'escape_after_first', 'mid_day_departure', 'selective_skip'];

  return (
    <div className="card border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 sticky top-2 z-30 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
            isTerminal && campaign.status === 'completed' ? 'bg-green-500'
            : isTerminal ? 'bg-red-500'
            : isPaused ? 'bg-amber-500'
            : 'bg-blue-500'
          }`}>
            {campaign.status === 'completed' ? <CheckCircle2 className="w-5 h-5 text-white" />
             : campaign.status === 'cancelled' ? <X className="w-5 h-5 text-white" />
             : campaign.status === 'failed' ? <XCircle className="w-5 h-5 text-white" />
             : isPaused ? <Pause className="w-5 h-5 text-white" />
             : <Send className="w-5 h-5 text-white animate-pulse" />}
          </div>
          <div>
            <h3 className="font-bold text-base">
              {campaign.status === 'completed' && '✓ اكتملت الحملة'}
              {campaign.status === 'cancelled' && 'تم الإلغاء'}
              {campaign.status === 'failed' && 'فشلت الحملة'}
              {isPaused && 'متوقفة مؤقتًا'}
              {isRunning && '📤 إرسال جارٍ في الخلفية'}
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {campaign.sent + campaign.failed} من {campaign.total}
              {' • '}
              <span className="text-green-700 dark:text-green-400">✓ {campaign.sent}</span>
              {' • '}
              <span className="text-red-700 dark:text-red-400">✗ {campaign.failed}</span>
              {isRunning && etaText && ` • متبقي ${etaText}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSoundEnabled((v) => !v)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            title={soundEnabled ? 'كتم الصوت' : 'تفعيل الصوت'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 opacity-50" />}
          </button>
          {isTerminal && (
            <button
              onClick={onDismiss}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              title="إخفاء"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="mb-3">
        <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              campaign.status === 'completed' ? 'bg-green-500'
              : campaign.status === 'cancelled' || campaign.status === 'failed' ? 'bg-red-500'
              : isPaused ? 'bg-amber-500'
              : 'bg-blue-500'
            }`}
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 text-center">{overallPct}%</p>
      </div>

      {/* Per-phase breakdown */}
      <div className="space-y-2 mb-3">
        {phaseKeys.map((k) => {
          const ps = campaign.phases_state?.[k];
          if (!ps || ps.total === 0) return null;
          const pct = ps.total > 0 ? Math.round(((ps.sent + ps.failed) / ps.total) * 100) : 0;
          const icon =
            ps.status === 'done' ? '✓'
            : ps.status === 'running' ? '⏳'
            : '⏸';
          return (
            <div key={k} className="text-xs">
              <div className="flex items-center justify-between mb-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-4">{icon}</span>
                  <span>{PHASE_LABELS[k]}</span>
                </span>
                <span className="font-mono text-[11px] text-gray-500">
                  {ps.sent + ps.failed}/{ps.total}
                </span>
              </div>
              <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className={`h-full ${PHASE_COLORS[k]} transition-all`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Last sent + recent feed */}
      {campaign.last_recipient_name && isRunning && (
        <div className="text-xs bg-white dark:bg-gray-900 border rounded p-2 mb-3">
          <p className="text-gray-500 dark:text-gray-400 text-[10px] mb-0.5">آخر رسالة:</p>
          <p className="font-medium truncate">✓ {campaign.last_recipient_name}</p>
        </div>
      )}

      {recent.length > 0 && isTerminal && (
        <details className="mb-3 text-xs">
          <summary className="cursor-pointer text-blue-700 dark:text-blue-400">
            آخر {recent.length} رسائل
          </summary>
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-2 py-1 rounded bg-white dark:bg-gray-900">
                {r.status === 'sent'
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
                <span className="flex-1 truncate">{r.student_name}</span>
                {r.error && <span className="text-red-700 dark:text-red-400 text-[10px] truncate max-w-[40%]" title={r.error}>{r.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {isRunning && '✨ يكمل في الخلفية حتى لو أغلقت التبويب'}
          {isPaused && 'الحملة متوقفة — اضغط استئناف للإكمال'}
          {isTerminal && new Date(campaign.last_sent_at || campaign.completed_at || campaign.created_at).toLocaleString('ar-SA-u-ca-gregory', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <>
              <button
                onClick={() => pauseMut.mutate()}
                disabled={pauseMut.isPending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/30"
              >
                <Pause className="w-3.5 h-3.5" /> إيقاف مؤقت
              </button>
              <button
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/30"
              >
                <X className="w-3.5 h-3.5" /> إلغاء
              </button>
            </>
          )}
          {isPaused && (
            <>
              <button
                onClick={() => resumeMut.mutate()}
                disabled={resumeMut.isPending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-blue-500 text-white hover:bg-blue-600"
              >
                <Play className="w-3.5 h-3.5" /> استئناف
              </button>
              <button
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300"
              >
                <X className="w-3.5 h-3.5" /> إلغاء
              </button>
            </>
          )}
          {isTerminal && campaign.failed > 0 && (
            <button
              onClick={() => retryMut.mutate()}
              disabled={retryMut.isPending}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-blue-500 text-white hover:bg-blue-600"
            >
              {retryMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              إعادة المحاولة لمن فشل ({campaign.failed})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Tiny audio-context beep — no asset file needed.
function playDoneSound(success: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = success ? 880 : 300;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch { /* ignore — no audio is fine */ }
}
