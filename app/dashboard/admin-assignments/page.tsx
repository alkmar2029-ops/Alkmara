'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Shield, Loader2, Save, Search, Filter, AlertCircle, Users, Crown,
} from 'lucide-react';

interface AdminUser { user_id: string; full_name: string; role: string; }
interface SectionRow { id: number; name: string; grade_id: number; grade_name: string; }
interface Matrix {
  assignments: { admin_user_id: string; section_id: number }[];
  admins: AdminUser[];
  sections: SectionRow[];
}

export default function AdminAssignmentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  const { data, isLoading, isError } = useQuery<Matrix>({
    queryKey: ['admin-assignments-matrix'],
    queryFn: async () => (await (await fetch('/api/admin-assignments')).json()).data,
  });

  const [edits, setEdits] = useState<Map<string, Set<number>>>(new Map());
  useEffect(() => {
    if (!data) return;
    const m = new Map<string, Set<number>>();
    for (const a of data.admins) m.set(a.user_id, new Set());
    for (const r of data.assignments) m.get(r.admin_user_id)?.add(r.section_id);
    setEdits(m);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (input: { admin_user_id: string; section_ids: number[] }) => {
      const r = await fetch('/api/admin-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الحفظ');
      return d.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-assignments-matrix'] });
      toast.success('✓ تم الحفظ');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const grades = useMemo(() => {
    if (!data) return [] as { id: number; name: string }[];
    const g = new Map<number, string>();
    for (const s of data.sections) g.set(s.grade_id, s.grade_name);
    return Array.from(g.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const visibleSections = useMemo(() => {
    if (!data) return [];
    if (gradeFilter === 'all') return data.sections;
    return data.sections.filter((s) => String(s.grade_id) === gradeFilter);
  }, [data, gradeFilter]);

  const visibleAdmins = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.admins;
    const q = search.trim();
    return data.admins.filter((a) => (a.full_name || '').includes(q));
  }, [data, search]);

  const initialFor = useMemo(() => {
    const m = new Map<string, Set<number>>();
    if (!data) return m;
    for (const a of data.admins) m.set(a.user_id, new Set());
    for (const r of data.assignments) m.get(r.admin_user_id)?.add(r.section_id);
    return m;
  }, [data]);

  const isDirty = (id: string) => {
    const a = edits.get(id) || new Set();
    const b = initialFor.get(id) || new Set();
    if (a.size !== b.size) return true;
    for (const x of a) if (!b.has(x)) return true;
    return false;
  };

  const toggle = (adminId: string, sid: number) => {
    setEdits((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(adminId) || []);
      if (set.has(sid)) set.delete(sid); else set.add(sid);
      next.set(adminId, set);
      return next;
    });
  };

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }
  if (isError || !data) {
    return <div className="text-center py-20 text-red-600 dark:text-red-400">فشل التحميل</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl flex items-center justify-center">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">تعيين الإداريين على الشعب</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            يحدّد ما يستطيع كل إداري رؤيته وإدارته
          </p>
        </div>
      </div>

      <div className="card bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30">
        <div className="flex items-start gap-2 text-sm text-purple-900 dark:text-purple-200">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">كيف تعمل التعيينات؟</p>
            <ul className="text-xs mt-1 space-y-0.5 list-disc ps-5 text-purple-800 dark:text-purple-100/90">
              <li>الإداري يرى فقط طلاب وحضور وملاحظات الشعب المُعيَّنة له</li>
              <li>المدير العام (Super Admin) يرى كل شيء — لا يحتاج تعيينات</li>
              <li>كل تعديل يُحفَظ بضغط زر "حفظ" بجانب الإداري</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label flex items-center gap-1"><Search className="w-3 h-3" /> بحث عن إداري</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} className="input" placeholder="اسم الإداري..." />
          </div>
          <div>
            <label className="label flex items-center gap-1"><Filter className="w-3 h-3" /> الصف</label>
            <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="input">
              <option value="all">كل الصفوف</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {visibleAdmins.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12 text-sm">لا يوجد إداريون</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-right sticky right-0 bg-gray-50 dark:bg-gray-900 z-10 min-w-[200px]">الإداري</th>
                  {visibleSections.map((s) => (
                    <th key={s.id} className="px-2 py-2 text-center text-xs whitespace-nowrap">
                      <div className="text-gray-500 dark:text-gray-400 text-[10px]">{s.grade_name}</div>
                      <div>{s.name}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center sticky left-0 bg-gray-50 dark:bg-gray-900 min-w-[80px]">حفظ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {visibleAdmins.map((t) => {
                  const set = edits.get(t.user_id) || new Set<number>();
                  const dirty = isDirty(t.user_id);
                  const isSuper = t.role === 'super_admin';
                  return (
                    <tr key={t.user_id} className={`${dirty ? 'bg-amber-50/40 dark:bg-amber-500/5' : ''} ${isSuper ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2 sticky right-0 bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 z-10">
                        <div className="flex items-center gap-2">
                          <span className={`w-7 h-7 rounded-full text-xs flex items-center justify-center shrink-0 ${
                            isSuper ? 'bg-yellow-500 text-white' : 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300'
                          }`}>
                            {isSuper ? <Crown className="w-3.5 h-3.5" /> : (t.full_name || '?').charAt(0)}
                          </span>
                          <div>
                            <p className="font-medium text-sm">{t.full_name}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400">
                              {isSuper ? '👑 يرى كل شيء' : `${set.size} مُعيَّنة`}
                            </p>
                          </div>
                        </div>
                      </td>
                      {visibleSections.map((s) => {
                        const checked = set.has(s.id);
                        return (
                          <td key={s.id} className="px-1 py-1 text-center">
                            <button
                              onClick={() => !isSuper && toggle(t.user_id, s.id)}
                              disabled={isSuper}
                              className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-colors ${
                                isSuper
                                  ? 'bg-yellow-100 dark:bg-yellow-500/15 border-yellow-300 dark:border-yellow-500/30 cursor-not-allowed'
                                  : checked
                                    ? 'bg-purple-500 border-purple-500 text-white hover:bg-purple-600'
                                    : 'border-gray-300 dark:border-gray-700 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-500/10'
                              }`}
                            >
                              {(checked || isSuper) && <span className="text-xs">{isSuper ? '✓' : '✓'}</span>}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-center sticky left-0 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800">
                        {!isSuper && (
                          <button
                            onClick={() => saveMut.mutate({ admin_user_id: t.user_id, section_ids: Array.from(set) })}
                            disabled={!dirty || saveMut.isPending}
                            className={`text-xs px-2 py-1 rounded inline-flex items-center justify-center gap-1 ${
                              dirty
                                ? 'bg-purple-600 text-white hover:bg-purple-700'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {saveMut.isPending && (saveMut.variables as any)?.admin_user_id === t.user_id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Save className="w-3 h-3" />}
                            حفظ
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
