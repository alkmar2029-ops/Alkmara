'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Users, UserCog, Plus, KeyRound, Pencil, Trash2, Send, X, Save, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Copy, Shield,
} from 'lucide-react';
import { SkeletonTable } from '@/components/ui/Skeleton';

// Permission keys + labels MUST stay in sync with lib/validations/schemas.ts.
// Inlined here to avoid pulling the whole zod module into the client bundle
// just for label text. If you add a key to the backend, mirror it below.
const PERMISSION_KEYS = [
  'take_attendance', 'manage_dismissals', 'write_notes', 'send_whatsapp',
  'view_reports', 'manage_students', 'manage_users', 'override_pickup',
  'manage_schedule', 'manage_settings',
] as const;
type PermissionKey = typeof PERMISSION_KEYS[number];
const PERMISSION_LABELS: Record<PermissionKey, { label: string; emoji: string }> = {
  take_attendance:   { label: 'تسجيل الحضور (يومي وحصص)',          emoji: '✅' },
  manage_dismissals: { label: 'إصدار وإلغاء الاستئذانات',          emoji: '🚪' },
  write_notes:       { label: 'كتابة الملاحظات الإدارية',          emoji: '📝' },
  send_whatsapp:     { label: 'إرسال رسائل واتساب يدوية وجماعية', emoji: '💬' },
  view_reports:      { label: 'عرض التقارير',                       emoji: '📊' },
  manage_students:   { label: 'إدارة الطلاب (إضافة/تعديل/حذف)',    emoji: '👥' },
  manage_users:      { label: 'إدارة المعلمين والإداريين',         emoji: '👤' },
  override_pickup:   { label: 'تجاوز قيود استلام الطلاب',          emoji: '🔓' },
  manage_schedule:   { label: 'إدارة الجدول الذكي والتعيينات',     emoji: '📅' },
  manage_settings:   { label: 'إعدادات المدرسة والواتساب والأجهزة', emoji: '⚙️' },
};
const PERMISSION_PROFILES: Record<string, {
  label: string; emoji: string; description: string;
  permissions: Record<PermissionKey, boolean>;
}> = {
  full_admin: {
    label: 'مدير عام', emoji: '👑',
    description: 'صلاحيات كاملة — مماثلة للمدير الرئيسي',
    permissions: PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {} as Record<PermissionKey, boolean>),
  },
  student_affairs: {
    label: 'وكيل شؤون طلاب', emoji: '🏫',
    description: 'الحضور والاستئذانات والملاحظات والواتساب والتقارير',
    permissions: {
      take_attendance: true, manage_dismissals: true, write_notes: true,
      send_whatsapp: true, view_reports: true,
      manage_students: false, manage_users: false, override_pickup: false,
      manage_schedule: false, manage_settings: false,
    },
  },
  counselor: {
    label: 'مرشد طلابي', emoji: '📝',
    description: 'كتابة الملاحظات الإدارية وقراءة التقارير فقط',
    permissions: {
      write_notes: true, view_reports: true,
      take_attendance: false, manage_dismissals: false, send_whatsapp: false,
      manage_students: false, manage_users: false, override_pickup: false,
      manage_schedule: false, manage_settings: false,
    },
  },
  observer: {
    label: 'مراقب', emoji: '👁️',
    description: 'قراءة التقارير فقط — لا يستطيع تعديل أي بيانات',
    permissions: {
      view_reports: true,
      take_attendance: false, manage_dismissals: false, write_notes: false,
      send_whatsapp: false, manage_students: false, manage_users: false,
      override_pickup: false, manage_schedule: false, manage_settings: false,
    },
  },
};

interface BaseUser {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  email: string | null;
}
interface AdminUser extends BaseUser {
  role: 'admin' | 'super_admin';
  permissions: Partial<Record<PermissionKey, boolean>> | null;
}

export default function UsersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>}>
      <UsersInner />
    </Suspense>
  );
}

function UsersInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const initialTab = (sp.get('tab') === 'admins' ? 'admins' : 'teachers') as 'teachers' | 'admins';
  const [tab, setTab] = useState<'teachers' | 'admins'>(initialTab);

  // Reflect the tab in the URL so the user can deep-link / reload back
  // to the same view.
  useEffect(() => {
    const params = new URLSearchParams(sp.toString());
    params.set('tab', tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
          <UserCog className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">المستخدمون</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            إدارة المعلمين والإداريين — إنشاء حسابات وضبط صلاحيات وإرسال بيانات الدخول
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 -mt-1">
        <TabBtn active={tab === 'teachers'} onClick={() => setTab('teachers')} icon={Users} label="المعلمون" />
        <TabBtn active={tab === 'admins'} onClick={() => setTab('admins')} icon={Shield} label="الإداريون" />
      </div>

      {tab === 'teachers' ? <TeachersTab /> : <AdminsTab />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2.5 -mb-px border-b-2 text-sm font-medium transition-colors ${
        active
          ? 'border-blue-600 text-blue-600 dark:text-blue-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

// ===== TEACHERS TAB =====================================================
// Duplicates the CRUD shape from /dashboard/teachers in a self-contained
// way so the unified users page doesn't depend on that legacy file.
// Once we're confident the unified page is the canonical one, the legacy
// /dashboard/teachers page can be deleted.

function TeachersTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const { data: teachers = [], isLoading } = useQuery<BaseUser[]>({
    queryKey: ['users-teachers'],
    queryFn: async () => (await (await fetch('/api/teachers')).json()).data,
  });

  const createMut = useMutation({
    mutationFn: async (data: typeof form) => {
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
      qc.invalidateQueries({ queryKey: ['users-teachers'] });
      setShowForm(false);
      setForm({ full_name: '', email: '', phone: '' });
      if (data.whatsapp_sent) {
        toast.success('تم إنشاء حساب المعلم وإرسال بيانات الدخول واتساب');
      } else {
        toast(`تم الإنشاء، لكن فشل الواتساب${data.whatsapp_error ? ': ' + data.whatsapp_error : ''}`, { icon: '⚠️' });
        if (data.password) setCredentials({ email: data.email, password: data.password });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetPwMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/teachers/${id}/reset-password`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل');
      return { id, ...(d.data as { whatsapp_sent: boolean; password: string | null }) };
    },
    onSuccess: (data) => {
      const t = teachers.find((x) => x.user_id === data.id);
      if (data.whatsapp_sent) toast.success('تم إعادة كلمة السر وإرسالها واتساب');
      else {
        toast('تم التعيين لكن فشل الواتساب', { icon: '⚠️' });
        if (data.password && t?.email) setCredentials({ email: t.email, password: data.password });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActiveMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const r = await fetch(`/api/teachers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل التعديل');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-teachers'] });
      toast.success('تم التعديل');
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/teachers/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الحذف');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-teachers'] });
      toast.success('تم الحذف');
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => { setForm({ full_name: '', email: '', phone: '' }); setShowForm(true); }} className="btn-primary inline-flex items-center gap-1">
          <Plus className="w-4 h-4" /> إضافة معلم
        </button>
      </div>

      {isLoading ? (
        <SkeletonTable rows={4} cols={4} />
      ) : teachers.length === 0 ? (
        <EmptyHint icon={Users} label="لا يوجد معلمون بعد" hint="اضغط «إضافة معلم» لإنشاء حساب جديد." />
      ) : (
        <UsersTable
          rows={teachers.map((t) => ({ ...t, role: 'teacher' as const }))}
          onResetPw={(id) => resetPwMut.mutate(id)}
          resetting={resetPwMut.isPending}
          onToggleActive={(id, on) => toggleActiveMut.mutate({ id, is_active: on })}
          onDelete={(id, name) => { if (confirm(`حذف ${name || 'هذا المعلم'}؟`)) deleteMut.mutate(id); }}
        />
      )}

      {showForm && (
        <UserFormModal
          title="معلم جديد"
          form={form}
          setForm={(f) => setForm({ full_name: f.full_name, email: f.email, phone: f.phone })}
          submitting={createMut.isPending}
          onClose={() => setShowForm(false)}
          onSubmit={() => createMut.mutate(form)}
          submitLabel="إنشاء + إرسال واتساب"
        />
      )}

      {credentials && <CredentialsFallback creds={credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}

// ===== ADMINS TAB =======================================================

function AdminsTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '',
    profile: 'student_affairs' as string,
    permissions: { ...PERMISSION_PROFILES.student_affairs.permissions } as Record<PermissionKey, boolean>,
  });
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const { data: admins = [], isLoading } = useQuery<AdminUser[]>({
    queryKey: ['users-admins'],
    queryFn: async () => (await (await fetch('/api/admins')).json()).data,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: form.full_name, email: form.email, phone: form.phone,
          profile: form.profile, permissions: form.permissions,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || 'فشل الإنشاء');
      return result.data as { whatsapp_sent: boolean; whatsapp_error: string | null; password: string | null; email: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['users-admins'] });
      setShowForm(false);
      // Reset form to a clean default profile.
      setForm({
        full_name: '', email: '', phone: '',
        profile: 'student_affairs',
        permissions: { ...PERMISSION_PROFILES.student_affairs.permissions },
      });
      if (data.whatsapp_sent) {
        toast.success('تم إنشاء حساب الأدمن وإرسال البيانات + الصلاحيات واتساب');
      } else {
        toast(`تم الإنشاء، لكن فشل الواتساب${data.whatsapp_error ? ': ' + data.whatsapp_error : ''}`, { icon: '⚠️' });
        if (data.password) setCredentials({ email: data.email, password: data.password });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Apply a profile preset — replaces all toggles. The user can still
  // override individual ones afterwards.
  const applyProfile = (profileKey: string) => {
    const profile = PERMISSION_PROFILES[profileKey];
    if (!profile) return;
    setForm((f) => ({ ...f, profile: profileKey, permissions: { ...profile.permissions } }));
  };

  const togglePermission = (k: PermissionKey) => {
    setForm((f) => ({
      ...f,
      // Manual toggle un-tags the profile (to signal "custom") since it
      // no longer matches any preset perfectly.
      profile: 'custom',
      permissions: { ...f.permissions, [k]: !f.permissions[k] },
    }));
  };

  const enabledCount = useMemo(
    () => Object.values(form.permissions).filter(Boolean).length,
    [form.permissions],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          الإداريون: {admins.length} • super_admin يظهر هنا أيضاً للمراجعة لكن لا يُعدَّل
        </p>
        <button onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-1">
          <Plus className="w-4 h-4" /> إضافة أدمن
        </button>
      </div>

      {isLoading ? (
        <SkeletonTable rows={4} cols={5} />
      ) : admins.length === 0 ? (
        <EmptyHint icon={Shield} label="لا يوجد إداريون بعد" hint="اضغط «إضافة أدمن» لإنشاء حساب." />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium">الاسم</th>
                  <th className="px-3 py-2 font-medium">الصلاحيات</th>
                  <th className="px-3 py-2 font-medium">البريد</th>
                  <th className="px-3 py-2 font-medium">الجوال</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">آخر دخول</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {admins.map((a) => {
                  const perms = a.permissions || {};
                  const grantedCount = PERMISSION_KEYS.filter((k) => perms[k]).length;
                  const isSuper = a.role === 'super_admin';
                  return (
                    <tr key={a.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-2 font-medium">
                        {a.full_name || '—'}
                        {isSuper && (
                          <span className="ms-2 text-[10px] inline-flex items-center px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-500/40">
                            👑 مدير عام (Super)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {isSuper ? (
                          <span className="text-yellow-700 dark:text-yellow-400 font-semibold">كل الصلاحيات</span>
                        ) : grantedCount === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30">
                            🛡️ {grantedCount} صلاحية
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs" dir="ltr">{a.email || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs" dir="ltr">{a.phone || '—'}</td>
                      <td className="px-3 py-2">
                        {a.is_active ? (
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
                        {a.last_login_at ? new Date(a.last_login_at).toLocaleDateString('ar-SA-u-ca-gregory') : 'لم يدخل'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" /> أدمن جديد
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Basic info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="label">الاسم الكامل *</label>
                  <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input" placeholder="أ. محمد أحمد" />
                </div>
                <div>
                  <label className="label">البريد الإلكتروني *</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" placeholder="admin@school.sa" dir="ltr" />
                </div>
                <div>
                  <label className="label">رقم الجوال *</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" placeholder="0555000000" dir="ltr" />
                </div>
              </div>

              {/* Profile picker — quick-start templates */}
              <div>
                <label className="label">القالب (اختر ثم عدّل أدناه عند الحاجة)</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(PERMISSION_PROFILES).map(([key, p]) => {
                    const active = form.profile === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => applyProfile(key)}
                        className={`text-right p-2 rounded-lg border transition-colors ${
                          active
                            ? 'bg-blue-50 dark:bg-blue-500/15 border-blue-300 dark:border-blue-500/40 text-blue-800 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                        }`}
                      >
                        <div className="text-sm font-bold">{p.emoji} {p.label}</div>
                        <div className="text-[10px] opacity-70 leading-tight mt-0.5">{p.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Permission toggles */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label m-0">الصلاحيات ({enabledCount}/{PERMISSION_KEYS.length})</label>
                  {form.profile === 'custom' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
                      تعديل مخصّص
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {PERMISSION_KEYS.map((k) => {
                    const checked = !!form.permissions[k];
                    const meta = PERMISSION_LABELS[k];
                    return (
                      <label
                        key={k}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-xs transition-colors border ${
                          checked
                            ? 'bg-blue-50 dark:bg-blue-500/15 border-blue-300 dark:border-blue-500/40 text-blue-800 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                        }`}
                      >
                        <input type="checkbox" checked={checked} onChange={() => togglePermission(k)} className="w-4 h-4" />
                        <span>{meta.emoji} {meta.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Preview of the WhatsApp permission summary */}
              <div className="text-[11px] bg-gray-50 dark:bg-gray-800/50 p-2.5 rounded border border-gray-200 dark:border-gray-700">
                💬 <span className="font-semibold">معاينة رسالة الواتساب:</span> سيتم إرسال الترحيب + الرابط + بيانات الدخول + قائمة الصلاحيات الـ{enabledCount} المحدَّدة + خطوات تغيير كلمة السر.
              </div>
            </div>

            <div className="flex gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !form.full_name || !form.email || !form.phone}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-1"
              >
                {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {createMut.isPending ? 'جارٍ الإنشاء والإرسال...' : 'إنشاء + إرسال الصلاحيات والبيانات واتساب'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {credentials && <CredentialsFallback creds={credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}

// ===== Shared sub-components ============================================

function UsersTable({ rows, onResetPw, resetting, onToggleActive, onDelete }: {
  rows: Array<BaseUser & { role: string }>;
  onResetPw: (_id: string) => void;
  resetting: boolean;
  onToggleActive: (_id: string, _on: boolean) => void;
  onDelete: (_id: string, _name: string | null) => void;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
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
            {rows.map((u) => (
              <tr key={u.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <td className="px-3 py-2 font-medium">{u.full_name || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">{u.email || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">{u.phone || '—'}</td>
                <td className="px-3 py-2">
                  {u.is_active ? (
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
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('ar-SA-u-ca-gregory') : 'لم يدخل'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onResetPw(u.user_id)}
                      disabled={resetting}
                      title="إعادة تعيين كلمة السر وإرسالها واتساب"
                      className="p-1.5 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:opacity-50"
                    >
                      {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => onToggleActive(u.user_id, !u.is_active)}
                      title={u.is_active ? 'تعطيل' : 'تفعيل'}
                      className="p-1.5 rounded text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-500/10"
                    >
                      {u.is_active ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => onDelete(u.user_id, u.full_name)}
                      title="حذف"
                      className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserFormModal({ title, form, setForm, onClose, onSubmit, submitting, submitLabel }: {
  title: string;
  form: { full_name: string; email: string; phone: string };
  setForm: (_f: { full_name: string; email: string; phone: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label">الاسم الكامل *</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input" placeholder="أ. محمد أحمد" />
          </div>
          <div>
            <label className="label">البريد الإلكتروني *</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" placeholder="user@school.sa" dir="ltr" />
          </div>
          <div>
            <label className="label">رقم الجوال *</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" placeholder="0555000000" dir="ltr" />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              بصيغة 05xxxxxxxx — ستُرسل بيانات الدخول واتساب
            </p>
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onSubmit}
            disabled={submitting || !form.full_name || !form.email || !form.phone}
            className="btn-primary flex-1 inline-flex items-center justify-center gap-1"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {submitting ? 'جارٍ الإرسال...' : submitLabel}
          </button>
          <button onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function CredentialsFallback({ creds, onClose }: { creds: { email: string; password: string }; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-yellow-200 dark:border-yellow-500/40 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="font-semibold flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
            <AlertTriangle className="w-5 h-5" /> نسخ بيانات الدخول يدوياً
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            لم يتم إرسال البيانات عبر الواتساب — انسخها وأرسلها يدوياً للمستخدم. هذه آخر فرصة لرؤية كلمة السر.
          </p>
          <CredField label="البريد" value={creds.email} />
          <CredField label="كلمة السر" value={creds.password} />
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="btn-primary w-full">حسناً، نسختها</button>
        </div>
      </div>
    </div>
  );
}

function CredField({ label, value }: { label: string; value: string }) {
  const copy = () => navigator.clipboard.writeText(value).then(() => toast.success('تم النسخ'));
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-16 shrink-0">{label}:</span>
      <code className="font-mono text-sm flex-1 break-all" dir="ltr">{value}</code>
      <button onClick={copy} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><Copy className="w-4 h-4" /></button>
    </div>
  );
}

function EmptyHint({ icon: Icon, label, hint }: { icon: any; label: string; hint: string }) {
  return (
    <div className="card text-center py-12">
      <Icon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
      <p className="text-gray-600 dark:text-gray-300 font-medium">{label}</p>
      <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">{hint}</p>
    </div>
  );
}
