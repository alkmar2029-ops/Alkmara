'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  UserPlus, Loader2, RefreshCw, Search, Check, X, Trash2,
  Mail, Phone, Clock, CheckCircle2, XCircle, AlertCircle, Send,
  Copy, MessageCircle,
} from 'lucide-react';
import type { TeacherRegistration } from '@/lib/types/database';

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

interface ApprovalResult {
  id: number;
  user_id: string;
  email: string;
  full_name: string;
  phone: string;
  whatsapp_sent: boolean;
  whatsapp_error: string | null;
  password: string | null;
}

export default function TeacherRegistrationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('pending');
  const [search, setSearch] = useState('');
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [credentialsToShow, setCredentialsToShow] = useState<ApprovalResult | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<{
    data: TeacherRegistration[];
    pendingCount: number;
  }>({
    queryKey: ['teacher-registrations', tab],
    queryFn: async () => {
      const r = await fetch(`/api/teacher-registrations?status=${tab}`);
      if (!r.ok) throw new Error('فشل جلب الطلبات');
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const rows = useMemo(() => {
    const list = data?.data || [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.phone.includes(q),
    );
  }, [data, search]);

  const approveMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/teacher-registrations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الاعتماد');
      return d.data as ApprovalResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['teacher-registrations'] });
      qc.invalidateQueries({ queryKey: ['teacher-registrations-pending-count'] });
      if (result.whatsapp_sent) {
        toast.success(`✓ تم اعتماد ${result.full_name} وإرسال البيانات عبر الواتساب`);
      } else {
        // WhatsApp failed → show modal with credentials so admin can copy them.
        setCredentialsToShow(result);
        toast.error('تم إنشاء الحساب لكن فشل إرسال الواتساب — انسخ كلمة السر يدوياً');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const r = await fetch(`/api/teacher-registrations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected', notes: notes || undefined }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الرفض');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-registrations'] });
      qc.invalidateQueries({ queryKey: ['teacher-registrations-pending-count'] });
      toast.success('تم رفض الطلب');
      setRejectingId(null);
      setRejectNotes('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/teacher-registrations/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الحذف');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-registrations'] });
      qc.invalidateQueries({ queryKey: ['teacher-registrations-pending-count'] });
      toast.success('تم الحذف');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = useMemo(() => {
    const all = data?.data || [];
    return {
      pending: tab === 'pending' ? all.length : (data?.pendingCount ?? 0),
    };
  }, [data, tab]);

  const fmtDate = (s: string) =>
    new Date(s).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });

  const fmtPhone = (p: string) =>
    p.startsWith('9665') ? '0' + p.slice(3) : p;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center">
            <UserPlus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">طلبات انضمام المعلمين</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              مراجعة الطلبات المرسلة من المعلمين الجدد عبر صفحة التسجيل العامة
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary inline-flex items-center gap-1"
        >
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          تحديث
        </button>
      </div>

      {/* Tabs */}
      <div className="card p-2 flex flex-wrap gap-1">
        {([
          { key: 'pending', label: 'قيد المراجعة', icon: Clock, color: 'amber' },
          { key: 'approved', label: 'مقبول', icon: CheckCircle2, color: 'green' },
          { key: 'rejected', label: 'مرفوض', icon: XCircle, color: 'red' },
          { key: 'all', label: 'الكل', icon: null, color: 'gray' },
        ] as const).map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${
                isActive
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {Icon && <Icon className="w-4 h-4" />}
              {t.label}
              {t.key === 'pending' && counts.pending > 0 && (
                <span className="ms-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold">
                  {counts.pending}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      {(rows.length > 5 || search) && (
        <div className="card">
          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input ps-9"
              placeholder="بحث بالاسم أو البريد أو الجوال..."
            />
          </div>
        </div>
      )}

      {/* Public registration link helper */}
      {tab === 'pending' && (
        <div className="card bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 p-3 text-sm text-blue-800 dark:text-blue-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">شارك رابط التسجيل مع المعلمين الجدد:</p>
            <div className="flex items-center gap-2 mt-1.5">
              <code className="flex-1 text-xs bg-white dark:bg-gray-900 px-2 py-1 rounded border border-blue-200 dark:border-blue-500/30 font-mono break-all" dir="ltr">
                {typeof window !== 'undefined' ? `${window.location.origin}/register/teacher` : '/register/teacher'}
              </code>
              <button
                onClick={() => {
                  if (typeof window === 'undefined') return;
                  navigator.clipboard.writeText(`${window.location.origin}/register/teacher`);
                  toast.success('تم النسخ');
                }}
                className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
                title="نسخ"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="card">
        {isLoading ? (
          <div className="text-center py-12">
            <Loader2 className="w-6 h-6 animate-spin inline text-gray-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            {tab === 'pending' ? (
              <>
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-400">
                  لا توجد طلبات قيد المراجعة حالياً
                </p>
              </>
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                {search ? 'لا توجد نتائج للبحث' : 'لا توجد طلبات في هذه الفئة'}
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((r) => (
              <li key={r.id} className="py-4">
                <div className="flex flex-wrap items-start gap-3">
                  {/* Status badge */}
                  <StatusBadge status={r.status} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{r.full_name}</p>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3 h-3" />
                        <span className="font-mono" dir="ltr">{r.email}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3 h-3" />
                        <span className="font-mono" dir="ltr">{fmtPhone(r.phone)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        <span>{fmtDate(r.created_at)}</span>
                      </div>
                      {r.notes && (
                        <p className="mt-1 text-gray-600 dark:text-gray-300 italic">
                          ملاحظة: {r.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {r.status === 'pending' && (
                      <>
                        <button
                          onClick={() => {
                            if (confirm(`اعتماد المعلم ${r.full_name}؟\nسيتم إنشاء الحساب وإرسال بيانات الدخول عبر الواتساب.`)) {
                              approveMut.mutate(r.id);
                            }
                          }}
                          disabled={approveMut.isPending}
                          className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1"
                        >
                          {approveMut.isPending && approveMut.variables === r.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          اعتماد
                        </button>
                        <button
                          onClick={() => { setRejectingId(r.id); setRejectNotes(''); }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 hover:bg-red-200 inline-flex items-center gap-1"
                        >
                          <X className="w-3.5 h-3.5" />
                          رفض
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        if (confirm('حذف هذا السجل نهائياً؟')) deleteMut.mutate(r.id);
                      }}
                      className="p-1.5 rounded text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Reject inline form */}
                {rejectingId === r.id && (
                  <div className="mt-3 ms-2 p-3 bg-red-50 dark:bg-red-500/10 rounded-lg border border-red-200 dark:border-red-500/30">
                    <label className="label text-xs">سبب الرفض (اختياري — يُحفظ للسجل فقط)</label>
                    <textarea
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                      className="input text-sm"
                      rows={2}
                      placeholder="مثال: البيانات ناقصة، أو ليس من ضمن المعلمين..."
                      maxLength={500}
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => rejectMut.mutate({ id: r.id, notes: rejectNotes })}
                        disabled={rejectMut.isPending}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-1"
                      >
                        {rejectMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        تأكيد الرفض
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectNotes(''); }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-300"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Credentials modal — shown only when WhatsApp delivery failed */}
      {credentialsToShow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-md w-full p-5">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">انسخ بيانات الدخول يدوياً</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  تم إنشاء الحساب لكن فشل إرسال الواتساب: {credentialsToShow.whatsapp_error}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <Field label="الاسم" value={credentialsToShow.full_name} />
              <Field label="البريد" value={credentialsToShow.email} mono />
              <Field label="الجوال" value={fmtPhone(credentialsToShow.phone)} mono />
              <Field
                label="كلمة السر"
                value={credentialsToShow.password || ''}
                mono
                highlight
              />
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  const text = `بيانات الدخول للمعلم ${credentialsToShow.full_name}:\n\nالبريد: ${credentialsToShow.email}\nكلمة السر: ${credentialsToShow.password}`;
                  navigator.clipboard.writeText(text);
                  toast.success('تم النسخ');
                }}
                className="btn-secondary flex-1 inline-flex items-center justify-center gap-1"
              >
                <Copy className="w-4 h-4" />
                نسخ الكل
              </button>
              <a
                href={`https://wa.me/${credentialsToShow.phone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm font-medium"
              >
                <MessageCircle className="w-4 h-4" />
                فتح الواتساب
              </a>
            </div>
            <button
              onClick={() => setCredentialsToShow(null)}
              className="w-full mt-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const config = {
    pending: { label: 'قيد المراجعة', icon: Clock, classes: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
    approved: { label: 'مقبول', icon: CheckCircle2, classes: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' },
    rejected: { label: 'مرفوض', icon: XCircle, classes: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
  }[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium shrink-0 ${config.classes}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function Field({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 p-2 rounded-lg ${highlight ? 'bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-300 dark:border-yellow-500/40' : 'bg-gray-50 dark:bg-gray-800'}`}>
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-sm font-semibold flex-1 ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : 'rtl'}>
        {value}
      </span>
      <button
        onClick={() => { navigator.clipboard.writeText(value); toast.success('تم النسخ'); }}
        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
      >
        <Copy className="w-3.5 h-3.5 text-gray-500" />
      </button>
    </div>
  );
}
