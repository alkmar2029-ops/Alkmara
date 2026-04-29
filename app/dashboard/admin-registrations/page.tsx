'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  UserPlus, Loader2, Check, X, Trash2, Mail, Phone, Clock,
  CheckCircle2, XCircle, AlertCircle, Send, Copy, MessageCircle,
} from 'lucide-react';

interface Registration {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  invite_code_id: number | null;
  created_at: string;
}

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

interface SectionRow {
  id: number;
  name: string;
  grade_id: number;
  grade_name: string;
}

export default function AdminRegistrationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [approveTarget, setApproveTarget] = useState<Registration | null>(null);
  const [credentialsToShow, setCredentialsToShow] = useState<ApprovalResult | null>(null);

  const { data, isLoading } = useQuery<{ data: Registration[]; pendingCount: number }>({
    queryKey: ['admin-registrations', tab],
    queryFn: async () => (await (await fetch(`/api/admin-registrations?status=${tab}`)).json()),
    refetchInterval: 30_000,
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const r = await fetch(`/api/admin-registrations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected', notes: notes || undefined }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الرفض');
    },
    onSuccess: () => {
      toast.success('تم رفض الطلب');
      qc.invalidateQueries({ queryKey: ['admin-registrations'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin-registrations/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الحذف');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-registrations'] });
      toast.success('تم الحذف');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const fmtDate = (s: string) => new Date(s).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
          <UserPlus className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">طلبات تسجيل الإداريين</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            مراجعة الطلبات المرسلة عبر صفحة التسجيل
          </p>
        </div>
      </div>

      <div className="card p-2 flex flex-wrap gap-1">
        {([
          { key: 'pending', label: 'قيد المراجعة', icon: Clock },
          { key: 'approved', label: 'مقبول', icon: CheckCircle2 },
          { key: 'rejected', label: 'مرفوض', icon: XCircle },
          { key: 'all', label: 'الكل', icon: null },
        ] as const).map((t) => {
          const isActive = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${
                isActive ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {Icon && <Icon className="w-4 h-4" />}
              {t.label}
              {t.key === 'pending' && (data?.pendingCount || 0) > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 rounded-full">{data?.pendingCount}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="card">
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
        ) : !data?.data || data.data.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12 text-sm">لا توجد طلبات</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {data.data.map((r) => (
              <li key={r.id} className="py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${
                    r.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' :
                    r.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' :
                    'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
                  }`}>
                    {r.status === 'pending' ? 'قيد المراجعة' : r.status === 'approved' ? 'مقبول' : 'مرفوض'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{r.full_name}</p>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                      <div className="flex items-center gap-1.5"><Mail className="w-3 h-3" /><span dir="ltr">{r.email}</span></div>
                      <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" /><span dir="ltr">{r.phone}</span></div>
                      <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" /><span>{fmtDate(r.created_at)}</span></div>
                      {r.notes && <p className="italic mt-1">ملاحظة: {r.notes}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.status === 'pending' && (
                      <>
                        <button onClick={() => setApproveTarget(r)} className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> اعتماد + تعيين
                        </button>
                        <button
                          onClick={() => {
                            const reason = prompt('سبب الرفض (اختياري):');
                            if (reason !== null) rejectMut.mutate({ id: r.id, notes: reason });
                          }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 inline-flex items-center gap-1"
                        >
                          <X className="w-3.5 h-3.5" /> رفض
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => { if (confirm('حذف نهائياً؟')) deleteMut.mutate(r.id); }}
                      className="p-1.5 rounded text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {approveTarget && (
        <ApproveModal
          registration={approveTarget}
          onClose={() => setApproveTarget(null)}
          onCredentialsFallback={(c) => { setApproveTarget(null); setCredentialsToShow(c); }}
        />
      )}

      {credentialsToShow && (
        <CredentialsFallbackModal data={credentialsToShow} onClose={() => setCredentialsToShow(null)} />
      )}
    </div>
  );
}

function ApproveModal({ registration, onClose, onCredentialsFallback }: {
  registration: Registration;
  onClose: () => void;
  onCredentialsFallback: (c: ApprovalResult) => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: matrix } = useQuery<{ sections: SectionRow[] }>({
    queryKey: ['sections-for-approval'],
    queryFn: async () => (await (await fetch('/api/admin-assignments')).json()).data || { sections: [] },
  });

  const approveMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/admin-registrations/${registration.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'approved',
          initial_section_ids: selected.size > 0 ? Array.from(selected) : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الاعتماد');
      return d.data as ApprovalResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin-registrations'] });
      qc.invalidateQueries({ queryKey: ['admin-assignments-matrix'] });
      if (result.whatsapp_sent) {
        toast.success(`✓ تم اعتماد ${result.full_name} وإرسال البيانات`);
        onClose();
      } else {
        toast.error('تم الإنشاء لكن فشل الواتساب — انسخ يدوياً');
        onCredentialsFallback(result);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-purple-50 dark:bg-purple-500/10">
          <h2 className="font-bold text-lg">اعتماد {registration.full_name}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            سيتم إنشاء الحساب وإرسال بيانات الدخول عبر الواتساب
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-sm font-semibold mb-2">📚 الشعب المُعيَّنة (اختياري)</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            يمكنك تعيين الشعب الآن أو لاحقاً من شاشة "تعيين الإداريين"
          </p>
          <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg p-2 space-y-1">
            {(matrix?.sections || []).map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 px-2 rounded">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                    setSelected(next);
                  }}
                  className="w-4 h-4"
                />
                <span>{s.grade_name} / {s.name}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-400 mt-3 bg-blue-50 dark:bg-blue-500/10 p-2 rounded">
            💡 الإداري بدون شعب لن يرى أيّ طالب — يمكنك تعيينه لاحقاً
          </p>
        </div>
        <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800">إلغاء</button>
          <button onClick={() => approveMut.mutate()} disabled={approveMut.isPending} className="btn-primary inline-flex items-center gap-1 text-sm">
            {approveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            اعتماد + إنشاء الحساب
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialsFallbackModal({ data, onClose }: { data: ApprovalResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold">انسخ بيانات الدخول يدوياً</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">فشل الواتساب: {data.whatsapp_error}</p>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <Field label="الاسم" value={data.full_name} />
          <Field label="البريد" value={data.email} mono />
          <Field label="الجوال" value={data.phone} mono />
          <Field label="كلمة السر" value={data.password || ''} mono highlight />
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => {
              const text = `بيانات الدخول للإداري ${data.full_name}:\n\nالبريد: ${data.email}\nكلمة السر: ${data.password}`;
              navigator.clipboard.writeText(text);
              toast.success('تم النسخ');
            }}
            className="btn-secondary flex-1 inline-flex items-center justify-center gap-1"
          >
            <Copy className="w-4 h-4" /> نسخ الكل
          </button>
          <a
            href={`https://wa.me/${data.phone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm"
          >
            <MessageCircle className="w-4 h-4" /> فتح الواتساب
          </a>
        </div>
        <button onClick={onClose} className="w-full mt-2 text-sm text-gray-500 hover:text-gray-700">إغلاق</button>
      </div>
    </div>
  );
}

function Field({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 p-2 rounded-lg ${highlight ? 'bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-300 dark:border-yellow-500/40' : 'bg-gray-50 dark:bg-gray-800'}`}>
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-semibold flex-1 ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : 'rtl'}>{value}</span>
      <button onClick={() => { navigator.clipboard.writeText(value); toast.success('تم النسخ'); }} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
        <Copy className="w-3.5 h-3.5 text-gray-500" />
      </button>
    </div>
  );
}
