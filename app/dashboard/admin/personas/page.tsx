// /dashboard/admin/personas — manage every admin's persona + vp_scope
// + vp_grade_scope + 23 permission flags. Consumes GET /api/admin/personas
// (م1.3) and PATCH /api/admin/users/[id]/persona (م1.4).
//
// Design notes (Codex review م1.7d):
//   - Patch-focused: the PATCH body carries ONLY changed fields, not
//     the full 23-flag map. This minimises audit noise and avoids
//     accidentally overwriting flags that admins didn't visit in the UI.
//   - Optimistic update via TanStack Query onMutate; rollback on error.
//   - Self-modification: the API requires ?force_self=true to edit your
//     own row (anti-lockout). The UI surfaces a confirm() dialog before
//     sending so the admin reads the risk explicitly.
//   - Gate parity: sidebar entry uses requiresPermission='manage_users';
//     this page also relies on the same backend gate.

'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Edit, Save, X, AlertTriangle, Loader2, Crown, ShieldCheck, ShieldAlert,
  UserCog,
} from 'lucide-react';
import { usePersona } from '@/lib/hooks/usePersona';
import {
  PERSONA_VALUES,
  PERSONA_LABELS,
  VP_SCOPE_VALUES,
  VP_SCOPE_LABELS,
  VP_FLAG_KEYS,
  COUNSELOR_FLAG_KEYS,
  SHARED_PERSONA_FLAG_KEYS,
  NEW_PERSONA_FLAG_LABELS,
  type PersonaListItem,
  type Persona,
  type VpScope,
} from '@/lib/personas/types';
import { PERMISSION_KEYS, PERMISSION_LABELS } from '@/lib/validations/schemas';

interface Grade {
  id: number;
  name: string;
}

// Shape of the PATCH body — mirrors the Zod schema in م1.4.
// Each field is optional; only present fields actually change anything.
interface PatchBody {
  persona?: Persona;
  vp_scope?: VpScope | null;
  vp_grade_scope?: number[] | null;
  permissions?: Record<string, boolean>;
}

// Sort grade IDs numerically — used both for the equality check against
// the stored value and for the value we actually send. The audit log
// in م1.4 stringifies arrays for diff detection, so an unsorted-vs-
// sorted array of the same IDs would show as a spurious "changed"
// entry; sending the sorted form keeps the audit clean.
// Default .sort() is lexicographic, so [1, 10, 2] sorts to [1, 10, 2] —
// always use the explicit numeric comparator.
function sortGradeIds(ids: number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

// ===========================================================================
// Main page
// ===========================================================================
export default function PersonasAdminPage() {
  const [editing, setEditing] = useState<PersonaListItem | null>(null);

  const personasQuery = useQuery<PersonaListItem[]>({
    queryKey: ['personas-list'],
    queryFn: async () => {
      const r = await fetch('/api/admin/personas');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `فشل جلب القائمة (${r.status})`);
      }
      return (await r.json()).data ?? [];
    },
    staleTime: 30_000,
  });

  const gradesQuery = useQuery<Grade[]>({
    queryKey: ['grades-list-for-personas'],
    queryFn: async () => {
      const r = await fetch('/api/grades');
      if (!r.ok) return [];
      const body = await r.json();
      return body.data ?? [];
    },
    staleTime: 10 * 60_000,
  });

  if (personasQuery.isLoading) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
        جاري التحميل...
      </div>
    );
  }
  if (personasQuery.isError || !personasQuery.data) {
    return (
      <div className="card border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
        فشل تحميل الأدوار. {personasQuery.error instanceof Error ? personasQuery.error.message : ''}
      </div>
    );
  }

  const list = personasQuery.data;
  const grades = gradesQuery.data ?? [];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">الأدوار والصلاحيات</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            إدارة personas + vp_scope + flags لكل إداري
          </p>
        </div>
      </div>

      {/* Warning banner */}
      <div className="card bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
              تعديل هذه الصفحة يحتاج صلاحية <code className="font-mono text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-500/20 rounded">manage_users</code>
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
              كل تغيير يطبَّق فورًا على المستخدم بعد الحفظ. تعديل صلاحياتك الذاتية يتطلب تأكيدًا إضافيًا.
            </p>
          </div>
        </div>
      </div>

      {/* Persona breakdown */}
      <PersonaCounts list={list} />

      {/* Users table */}
      <UsersTable list={list} onEdit={setEditing} />

      {/* Edit modal */}
      {editing && (
        <EditPersonaModal
          user={editing}
          grades={grades}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Persona counts row
// ===========================================================================
function PersonaCounts({ list }: { list: PersonaListItem[] }) {
  const counts = useMemo(() => {
    const c = {
      super_admin: 0,
      principal: 0,
      vice_principal: 0,
      counselor: 0,
      general_admin: 0,
    };
    for (const u of list) {
      // super_admin role overrides persona for display purposes — they
      // are technically not part of the persona enum.
      if (u.role === 'super_admin') c.super_admin++;
      else c[u.persona]++;
    }
    return c;
  }, [list]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <CountCard icon={Crown}       label="Super Admin"  value={counts.super_admin}    tone="amber" />
      <CountCard icon={ShieldCheck} label={PERSONA_LABELS.principal}      value={counts.principal}      tone="indigo" />
      <CountCard icon={ShieldCheck} label={PERSONA_LABELS.vice_principal} value={counts.vice_principal} tone="purple" />
      <CountCard icon={ShieldAlert} label={PERSONA_LABELS.counselor}      value={counts.counselor}      tone="rose" />
      <CountCard icon={UserCog}     label={PERSONA_LABELS.general_admin}  value={counts.general_admin}  tone="slate" />
    </div>
  );
}

function CountCard({
  icon: Icon, label, value, tone,
}: { icon: any; label: string; value: number; tone: 'amber' | 'indigo' | 'purple' | 'rose' | 'slate' }) {
  const cls = {
    amber:  'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border-purple-200 dark:border-purple-500/30',
    rose:   'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',
    slate:  'bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400 border-slate-200 dark:border-slate-500/30',
  }[tone];
  return (
    <div className={`card border ${cls}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs opacity-80">{label}</p>
        <Icon className="w-4 h-4 opacity-60" />
      </div>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

// ===========================================================================
// Users table
// ===========================================================================
function UsersTable({
  list, onEdit,
}: {
  list: PersonaListItem[];
  onEdit: (u: PersonaListItem) => void;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm min-w-[600px]">
        <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400">
          <tr>
            <th className="px-3 py-2 text-start">المستخدم</th>
            <th className="px-3 py-2 text-start">الدور</th>
            <th className="px-3 py-2 text-start">Persona</th>
            <th className="px-3 py-2 text-start">VP Scope</th>
            <th className="px-3 py-2 text-center">الحالة</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.user_id} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
              <td className="px-3 py-2">
                <p className="font-medium">{u.full_name || '—'}</p>
                {u.email && (
                  <p className="text-[11px] text-gray-500 font-mono" dir="ltr">{u.email}</p>
                )}
              </td>
              <td className="px-3 py-2">
                {u.role === 'super_admin' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <Crown className="w-3 h-3" /> super_admin
                  </span>
                ) : (
                  <span className="text-xs text-gray-600 dark:text-gray-300">{u.role}</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                {PERSONA_LABELS[u.persona]}
                <span className="text-[10px] text-gray-400 ms-1" dir="ltr">({u.persona})</span>
              </td>
              <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                {u.vp_scope ? VP_SCOPE_LABELS[u.vp_scope] : '—'}
              </td>
              <td className="px-3 py-2 text-center">
                <span className={`inline-block w-2 h-2 rounded-full ${u.is_active ? 'bg-green-500' : 'bg-gray-300'}`} title={u.is_active ? 'نشط' : 'غير نشط'} />
              </td>
              <td className="px-3 py-2 text-end">
                <button
                  onClick={() => onEdit(u)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-blue-50 dark:hover:bg-blue-500/15 text-blue-700 dark:text-blue-400"
                >
                  <Edit className="w-3 h-3" /> تعديل
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Edit modal
// ===========================================================================
function EditPersonaModal({
  user, grades, onClose,
}: {
  user: PersonaListItem;
  grades: Grade[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: meData } = usePersona();
  const isSelf = user.user_id === meData?.user_id;

  // Form state — initialised from the user's current values. Submitting
  // diffs against `user` to keep the PATCH minimal.
  const [persona, setPersona] = useState<Persona>(user.persona);
  const [vpScope, setVpScope] = useState<VpScope | null>(user.vp_scope);
  const [vpGradeScope, setVpGradeScope] = useState<number[]>(user.vp_grade_scope ?? []);
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    const ALL_KEYS = [
      ...PERMISSION_KEYS,
      ...VP_FLAG_KEYS,
      ...COUNSELOR_FLAG_KEYS,
      ...SHARED_PERSONA_FLAG_KEYS,
    ];
    for (const k of ALL_KEYS) {
      init[k] = user.permissions[k] === true;
    }
    return init;
  });

  // Mutation with optimistic update + rollback.
  const mutation = useMutation({
    mutationFn: async (vars: { patch: PatchBody; forceSelf: boolean }) => {
      const url = vars.forceSelf
        ? `/api/admin/users/${user.user_id}/persona?force_self=true`
        : `/api/admin/users/${user.user_id}/persona`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars.patch),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `فشل التحديث (${r.status})`);
      }
      return (await r.json()).data;
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['personas-list'] });
      const previous = queryClient.getQueryData<PersonaListItem[]>(['personas-list']);

      // Apply the delta locally so the UI updates instantly.
      queryClient.setQueryData<PersonaListItem[]>(['personas-list'], (old) => {
        if (!old) return old;
        return old.map((u) => {
          if (u.user_id !== user.user_id) return u;
          const next: PersonaListItem = { ...u };
          if (vars.patch.persona !== undefined) next.persona = vars.patch.persona;
          if (vars.patch.vp_scope !== undefined) next.vp_scope = vars.patch.vp_scope;
          if (vars.patch.vp_grade_scope !== undefined) {
            next.vp_grade_scope = vars.patch.vp_grade_scope;
          }
          if (vars.patch.permissions) {
            next.permissions = { ...u.permissions, ...vars.patch.permissions };
          }
          return next;
        });
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['personas-list'], context.previous);
      }
      toast.error(err instanceof Error ? err.message : 'فشل التحديث');
    },
    onSuccess: () => {
      toast.success('تم تحديث الصلاحيات');
      onClose();
    },
    onSettled: () => {
      // Always refetch to reconcile with the server's view (in case the
      // backend cleaned up vp_scope/vp_grade_scope due to persona switch).
      queryClient.invalidateQueries({ queryKey: ['personas-list'] });
    },
  });

  // Compute the patch — only fields that differ from the original.
  // Grade IDs are numerically sorted both for the compare AND the send,
  // so the audit log doesn't record a no-op array-reorder change.
  const patch: PatchBody = useMemo(() => {
    const p: PatchBody = {};
    if (persona !== user.persona) p.persona = persona;
    if (vpScope !== user.vp_scope) p.vp_scope = vpScope;
    const origGrades = sortGradeIds(user.vp_grade_scope ?? []);
    const curGrades = sortGradeIds(vpGradeScope);
    if (JSON.stringify(origGrades) !== JSON.stringify(curGrades)) {
      p.vp_grade_scope = curGrades.length === 0 ? null : curGrades;
    }
    const flagDiff: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(flags)) {
      if ((user.permissions[k] === true) !== v) flagDiff[k] = v;
    }
    if (Object.keys(flagDiff).length > 0) p.permissions = flagDiff;
    return p;
  }, [persona, vpScope, vpGradeScope, flags, user]);

  const changeCount =
    (patch.persona !== undefined ? 1 : 0) +
    (patch.vp_scope !== undefined ? 1 : 0) +
    (patch.vp_grade_scope !== undefined ? 1 : 0) +
    (patch.permissions ? Object.keys(patch.permissions).length : 0);

  // Form-level invariant the API enforces: persona='vice_principal'
  // requires a non-null vp_scope. Catching this client-side keeps the
  // failure mode soft (disabled button + toast) instead of a 400 round-
  // trip after the admin clicks Save.
  const invalid = persona === 'vice_principal' && vpScope === null;

  const handleSave = () => {
    if (invalid) {
      toast.error('persona=vice_principal يتطلب اختيار vp_scope قبل الحفظ');
      return;
    }
    if (changeCount === 0) {
      toast('لا توجد تغييرات', { icon: 'ℹ️' });
      return;
    }
    if (isSelf) {
      const ok = window.confirm(
        'أنت تعدّل صلاحياتك الذاتية. قد تفقد الوصول لهذه الصفحة فورًا بعد الحفظ. هل تريد المتابعة؟',
      );
      if (!ok) return;
    }
    mutation.mutate({ patch, forceSelf: isSelf });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <div>
            <h2 className="font-bold text-lg">{user.full_name || 'مستخدم'}</h2>
            {user.email && (
              <p className="text-[11px] text-gray-500 font-mono" dir="ltr">{user.email}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Self-mod warning */}
        {isSelf && (
          <div className="m-5 mb-0 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-xs text-red-800 dark:text-red-300">
            ⚠️ هذا حسابك الحالي. سيُطلب تأكيد عند الحفظ، وسيُرسَل <code className="font-mono px-1 py-0.5 bg-red-100 dark:bg-red-500/20 rounded" dir="ltr">?force_self=true</code> للـ API.
          </div>
        )}

        <div className="p-5 space-y-4">
          {/* Persona */}
          <Section title="Persona — الدور الوظيفي">
            <select
              value={persona}
              onChange={(e) => {
                const next = e.target.value as Persona;
                setPersona(next);
                // Persona ≠ vice_principal cleans up the related fields.
                // This matches the API's silent-cleanup behaviour so the
                // diff stays minimal: if the user was a VP, switching
                // their persona zeroes vp_scope + vp_grade_scope.
                if (next !== 'vice_principal') {
                  setVpScope(null);
                  setVpGradeScope([]);
                }
              }}
              className="input text-sm"
            >
              {PERSONA_VALUES.map((p) => (
                <option key={p} value={p}>
                  {PERSONA_LABELS[p]} ({p})
                </option>
              ))}
            </select>
          </Section>

          {/* VP scope — conditional */}
          {persona === 'vice_principal' && (
            <Section title="نطاق الوكيل — VP Scope">
              <select
                value={vpScope ?? ''}
                onChange={(e) => setVpScope((e.target.value || null) as VpScope | null)}
                className="input text-sm"
              >
                <option value="">— اختر نطاقًا —</option>
                {VP_SCOPE_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {VP_SCOPE_LABELS[s]} ({s})
                  </option>
                ))}
              </select>
              {vpScope === null && (
                <p className="text-[11px] text-red-700 dark:text-red-400 mt-1">
                  مطلوب: persona='vice_principal' يحتاج vp_scope.
                </p>
              )}
            </Section>
          )}

          {/* VP grade scope — conditional, only when multi-VP setup */}
          {persona === 'vice_principal' && grades.length > 0 && (
            <Section title="نطاق الصفوف — اختياري (للوكلاء المتعددين بنفس النطاق)">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {grades.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={vpGradeScope.includes(g.id)}
                      onChange={(e) => {
                        setVpGradeScope((prev) =>
                          e.target.checked
                            ? [...prev, g.id]
                            : prev.filter((id) => id !== g.id),
                        );
                      }}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                لا تختر شيئًا = نطاق جميع الصفوف.
              </p>
            </Section>
          )}

          {/* Flag sections */}
          <FlagSection
            title="الصلاحيات العامة (قديمة)"
            keys={PERMISSION_KEYS as readonly string[]}
            labels={Object.fromEntries(
              PERMISSION_KEYS.map((k) => [k, PERMISSION_LABELS[k as keyof typeof PERMISSION_LABELS]]),
            )}
            flags={flags}
            onChange={(k, v) => setFlags({ ...flags, [k]: v })}
          />
          <FlagSection
            title="صلاحيات الوكيل"
            keys={VP_FLAG_KEYS as readonly string[]}
            labels={NEW_PERSONA_FLAG_LABELS as Record<string, { label: string; emoji: string }>}
            flags={flags}
            onChange={(k, v) => setFlags({ ...flags, [k]: v })}
          />
          <FlagSection
            title="صلاحيات المرشد"
            keys={COUNSELOR_FLAG_KEYS as readonly string[]}
            labels={NEW_PERSONA_FLAG_LABELS as Record<string, { label: string; emoji: string }>}
            flags={flags}
            onChange={(k, v) => setFlags({ ...flags, [k]: v })}
          />
          <FlagSection
            title="صلاحيات مشتركة"
            keys={SHARED_PERSONA_FLAG_KEYS as readonly string[]}
            labels={NEW_PERSONA_FLAG_LABELS as Record<string, { label: string; emoji: string }>}
            flags={flags}
            onChange={(k, v) => setFlags({ ...flags, [k]: v })}
          />
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-800 sticky bottom-0 bg-white dark:bg-gray-900">
          <p className="text-xs">
            {invalid ? (
              <span className="text-red-700 dark:text-red-400">⚠️ vp_scope مطلوب لـ persona=vice_principal</span>
            ) : changeCount === 0 ? (
              <span className="text-gray-500 dark:text-gray-400">لا تغييرات بعد</span>
            ) : (
              <span className="text-gray-500 dark:text-gray-400">
                {changeCount} تغيير{changeCount === 1 ? '' : 'ات'} في انتظار الحفظ
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              disabled={mutation.isPending}
            >
              إلغاء
            </button>
            <button
              onClick={handleSave}
              disabled={changeCount === 0 || invalid || mutation.isPending}
              className="btn-primary inline-flex items-center gap-1 text-sm disabled:opacity-50"
            >
              {mutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الحفظ...</>
              ) : (
                <><Save className="w-4 h-4" /> حفظ التغييرات</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Section / FlagSection helpers
// ===========================================================================
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

function FlagSection({
  title, keys, labels, flags, onChange,
}: {
  title: string;
  keys: readonly string[];
  labels: Record<string, { label: string; emoji: string }>;
  flags: Record<string, boolean>;
  onChange: (key: string, value: boolean) => void;
}) {
  return (
    <Section title={title}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 border border-gray-200 dark:border-gray-800 rounded-lg p-2">
        {keys.map((k) => {
          const lbl = labels[k];
          return (
            <label
              key={k}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-xs"
            >
              <input
                type="checkbox"
                checked={flags[k] === true}
                onChange={(e) => onChange(k, e.target.checked)}
              />
              <span>{lbl?.emoji}</span>
              <span className="flex-1">{lbl?.label || k}</span>
            </label>
          );
        })}
      </div>
    </Section>
  );
}
