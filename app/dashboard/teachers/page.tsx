'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Users, Plus, KeyRound, Pencil, Trash2, Send, X, Save, Mail, Phone,
  CheckCircle2, XCircle, AlertTriangle, Copy, Loader2,
} from 'lucide-react';
import { SkeletonTable } from '@/components/ui/Skeleton';

interface Teacher {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  email: string | null;
}

interface CreateForm { full_name: string; email: string; phone: string }
const emptyForm: CreateForm = { full_name: '', email: '', phone: '' };

export default function TeachersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const { data: teachers = [], isLoading } = useQuery<Teacher[]>({
    queryKey: ['teachers'],
    queryFn: async () => (await (await fetch('/api/teachers')).json()).data,
  });

  const createMut = useMutation({
    mutationFn: async (data: CreateForm) => {
      const r = await fetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || 'فشل الإنشاء');
      return result.data as { whatsapp_sent: boolean; whatsapp_error: string | null; password: string | null; email: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      setShowForm(false);
      setForm(emptyForm);
      if (data.whatsapp_sent) {
        toast.success('تم إنشاء الحساب وإرسال البيانات على الواتساب');
      } else {
        toast(`تم الإنشاء، لكن فشل الواتساب${data.whatsapp_error ? ': ' + data.whatsapp_error : ''}`, { icon: '⚠️' });
        if (data.password) setCredentials({ email: data.email, password: data.password });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateForm & { is_active: boolean }> }) => {
      const r = await fetch(`/api/teachers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل التعديل');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      toast.success('تم التعديل');
      setEditingId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetPwMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/teachers/${id}/reset-password`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل');
      return d.data as { whatsapp_sent: boolean; password: string | null };
    },
    onSuccess: (data, id) => {
      const t = teachers.find((x) => x.user_id === id);
      if (data.whatsapp_sent) {
        toast.success('تم إعادة تعيين كلمة السر وإرسالها واتساب');
      } else {
        toast('تم التعيين لكن فشل الواتساب', { icon: '⚠️' });
        if (data.password && t?.email) setCredentials({ email: t.email, password: data.password });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/teachers/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الحذف');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      toast.success('تم الحذف');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">المعلمون</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              إنشاء حسابات المعلمين وإرسال بيانات الدخول عبر الواتساب
            </p>
          </div>
        </div>
        <button onClick={() => { setForm(emptyForm); setShowForm(true); }} className="btn-primary inline-flex items-center gap-1">
          <Plus className="w-4 h-4" /> إضافة معلم
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <SkeletonTable rows={4} cols={4} />
      ) : teachers.length === 0 ? (
        <div className="card text-center py-12">
          <Users className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">لا يوجد معلمون بعد. اضغط <strong>إضافة معلم</strong>.</p>
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium">الاسم</th>
                  <th className="px-3 py-2 font-medium">البريد</th>
                  <th className="px-3 py-2 font-medium">الجوال</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">آخر دخول</th>
                  <th className="px-3 py-2 font-medium text-end">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {teachers.map((t) => (
                  <tr key={t.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    {editingId === t.user_id ? (
                      <EditRow
                        teacher={t}
                        onCancel={() => setEditingId(null)}
                        onSave={(data) => updateMut.mutate({ id: t.user_id, data })}
                        saving={updateMut.isPending}
                      />
                    ) : (
                      <>
                        <td className="px-3 py-2 font-medium">{t.full_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs" dir="ltr">{t.email || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs" dir="ltr">{t.phone || '—'}</td>
                        <td className="px-3 py-2">
                          {t.is_active ? (
                            <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
                              <CheckCircle2 className="w-3 h-3" /> فعّال
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
                              <XCircle className="w-3 h-3" /> معطّل
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {t.last_login_at ? new Date(t.last_login_at).toLocaleDateString('ar-SA') : 'لم يدخل'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => resetPwMut.mutate(t.user_id)}
                              disabled={resetPwMut.isPending}
                              title="إعادة كلمة السر وإرسالها واتساب"
                              className="p-1.5 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:opacity-50"
                            >
                              {resetPwMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => setEditingId(t.user_id)}
                              title="تعديل"
                              className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => updateMut.mutate({ id: t.user_id, data: { is_active: !t.is_active } })}
                              disabled={updateMut.isPending}
                              title={t.is_active ? 'تعطيل' : 'تفعيل'}
                              className="p-1.5 rounded text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-500/10"
                            >
                              {t.is_active ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => { if (confirm(`حذف ${t.full_name}؟`)) deleteMut.mutate(t.user_id); }}
                              title="حذف"
                              className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-semibold">معلم جديد</h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="label">الاسم الكامل *</label>
                <input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="input"
                  placeholder="أ. محمد أحمد"
                />
              </div>
              <div>
                <label className="label">البريد الإلكتروني *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input"
                  placeholder="teacher@school.sa"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="label">رقم الجوال *</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="input"
                  placeholder="0555000000"
                  dir="ltr"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  بصيغة 05xxxxxxxx — ستُرسل بيانات الدخول واتساب
                </p>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
              <button
                onClick={() => createMut.mutate(form)}
                disabled={createMut.isPending || !form.full_name || !form.email || !form.phone}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-1"
              >
                {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {createMut.isPending ? 'جارٍ الإرسال...' : 'إنشاء + إرسال واتساب'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Credentials fallback (when WhatsApp failed) */}
      {credentials && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setCredentials(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-yellow-200 dark:border-yellow-500/40 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-semibold flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="w-5 h-5" /> نسخ بيانات الدخول يدوياً
              </h3>
              <button onClick={() => setCredentials(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                لم يتم إرسال البيانات عبر الواتساب — انسخها وأرسلها يدوياً للمعلم. هذه آخر فرصة لرؤية كلمة السر.
              </p>
              <CredField label="البريد" value={credentials.email} />
              <CredField label="كلمة السر" value={credentials.password} />
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-800">
              <button onClick={() => setCredentials(null)} className="btn-primary w-full">حسناً، نسختها</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditRow({ teacher, onCancel, onSave, saving }: {
  teacher: Teacher;
  onCancel: () => void;
  onSave: (data: { full_name: string; phone: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(teacher.full_name || '');
  const [phone, setPhone] = useState(teacher.phone || '');
  return (
    <>
      <td className="px-3 py-2"><input value={name} onChange={(e) => setName(e.target.value)} className="input text-sm py-1" /></td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500" dir="ltr">{teacher.email}</td>
      <td className="px-3 py-2"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input text-sm py-1" dir="ltr" /></td>
      <td className="px-3 py-2 text-xs text-gray-500">—</td>
      <td className="px-3 py-2 text-xs text-gray-500">—</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => onSave({ full_name: name, phone })} disabled={saving} className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-500/10">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </button>
          <button onClick={onCancel} className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-4 h-4" /></button>
        </div>
      </td>
    </>
  );
}

function CredField({ label, value }: { label: string; value: string }) {
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => toast.success('تم النسخ'));
  };
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-16 shrink-0">{label}:</span>
      <code className="font-mono text-sm flex-1 break-all" dir="ltr">{value}</code>
      <button onClick={copy} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><Copy className="w-4 h-4" /></button>
    </div>
  );
}
