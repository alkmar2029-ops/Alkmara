'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MessageCircle, Save, RefreshCw, Eye, EyeOff, CheckCircle2, XCircle, Loader2, QrCode, AlertTriangle } from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import type { WhatsappSettings, WhatsappStatus } from '@/lib/types/database';

const STATUS_META: Record<WhatsappStatus, { label: string; cls: string; Icon: any }> = {
  connected:    { label: 'متصل',         cls: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/30',     Icon: CheckCircle2 },
  disconnected: { label: 'غير متصل',     cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800',                  Icon: XCircle },
  connecting:   { label: 'جارٍ الاتصال', cls: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',           Icon: Loader2 },
  scanning:     { label: 'بانتظار QR',   cls: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/30', Icon: QrCode },
  error:        { label: 'خطأ',          cls: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30',                 Icon: AlertTriangle },
  unknown:      { label: 'غير معروف',    cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-800',                  Icon: AlertTriangle },
};

function formatTime(iso: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ar-SA'); } catch { return iso; }
}

export default function WhatsappSettingsPage() {
  const qc = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [form, setForm] = useState<{ api_key: string; session_id: string } | null>(null);

  const { data: settings, isLoading, isError, error } = useQuery<WhatsappSettings>({
    queryKey: ['whatsapp-settings'],
    queryFn: async () => {
      const res = await fetch('/api/whatsapp/settings');
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل في تحميل الإعدادات');
      }
      const r = await res.json();
      return r.data;
    },
  });

  useEffect(() => {
    if (settings && !form) {
      setForm({ api_key: settings.api_key || '', session_id: settings.session_id || '' });
    }
  }, [settings, form]);

  const saveMutation = useMutation({
    mutationFn: async (data: { api_key?: string; session_id?: string }) => {
      const res = await fetch('/api/whatsapp/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل في الحفظ');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-settings'] });
      toast.success('تم حفظ الإعدادات');
    },
    onError: (err: any) => toast.error(err.message || 'حدث خطأ أثناء الحفظ'),
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/whatsapp/check', { method: 'POST' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل اختبار الاتصال');
      }
      return res.json();
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['whatsapp-settings'] });
      const st = r?.data?.status as WhatsappStatus;
      if (st === 'connected') toast.success('الاتصال يعمل');
      else if (r?.data?.error) toast.error(r.data.error);
      else toast(`الحالة: ${STATUS_META[st]?.label || st}`);
    },
    onError: (err: any) => toast.error(err.message || 'فشل اختبار الاتصال'),
  });

  if (isLoading) return <SkeletonPage />;
  if (isError) {
    return (
      <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-4 text-red-700 dark:text-red-400 text-sm">
        {(error as Error)?.message || 'حدث خطأ في تحميل الإعدادات'}
      </div>
    );
  }
  if (!form || !settings) return <SkeletonPage />;

  const status: WhatsappStatus = settings.status || 'unknown';
  const meta = STATUS_META[status];
  const StatusIcon = meta.Icon;

  const hasChanges =
    form.api_key !== (settings.api_key || '') ||
    form.session_id !== (settings.session_id || '');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">إعدادات WhatsApp</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">تكامل WasenderAPI لإرسال الإشعارات للأهالي</p>
        </div>
      </div>

      {/* Status card */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">حالة الاتصال</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">الحالة</p>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${meta.cls}`}>
              <StatusIcon className={`w-4 h-4 ${status === 'connecting' ? 'animate-spin' : ''}`} />
              <span className="text-sm font-medium">{meta.label}</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">رقم الجوال</p>
            <p className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all" dir="ltr">
              {settings.phone_number || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">آخر فحص</p>
            <p className="text-sm text-gray-900 dark:text-gray-100">{formatTime(settings.last_checked_at)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row flex-wrap gap-2">
          <button
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending || !settings.api_key_set}
            className="btn-secondary w-full sm:w-auto inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${checkMutation.isPending ? 'animate-spin' : ''}`} />
            {checkMutation.isPending ? 'جارٍ الفحص...' : 'اختبار الاتصال'}
          </button>
          {!settings.api_key_set && (
            <span className="text-xs text-gray-500 dark:text-gray-400 self-center">احفظ مفتاح API أولاً</span>
          )}
        </div>
      </div>

      {/* Settings card */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">الإعدادات</h2>
        <div className="space-y-4">
          <div>
            <label className="label">مفتاح API</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                className="input pe-10"
                placeholder="Bearer token من WasenderAPI"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label={showKey ? 'إخفاء' : 'إظهار'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              يُحفظ مشفّراً ولا يظهر مرة أخرى — اترك الحقل كما هو لاستبقاء المفتاح الحالي.
            </p>
          </div>

          <div>
            <label className="label">معرّف الجلسة (Session ID)</label>
            <input
              type="text"
              value={form.session_id}
              onChange={(e) => setForm({ ...form, session_id: e.target.value })}
              className="input"
              placeholder="مثال: 12345"
              dir="ltr"
              spellCheck={false}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              تجده في WasenderAPI → Session Management. اتركه فارغاً ليُجلب أول جلسة تلقائياً.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => saveMutation.mutate({ api_key: form.api_key, session_id: form.session_id })}
              disabled={saveMutation.isPending || !hasChanges}
              className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </div>
        </div>
      </div>

      <div className="card bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/30">
        <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2 text-sm">كيفية الحصول على مفتاح API</h3>
        <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-decimal ps-5">
          <li>سجّل دخول إلى <span className="font-mono" dir="ltr">wasenderapi.com</span></li>
          <li>أنشئ جلسة WhatsApp جديدة من Session Management</li>
          <li>امسح رمز QR من تطبيق WhatsApp على جوالك</li>
          <li>انسخ الـ <span className="font-mono">Bearer Token</span> والصقه أعلاه</li>
        </ol>
      </div>
    </div>
  );
}
