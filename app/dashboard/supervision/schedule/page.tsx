'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Calendar, ArrowRight, Loader2, X, Save, MapPin, Users,
  Search, Trash2,
} from 'lucide-react';

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

interface Location { id: number; name: string; is_active: boolean; sort_order: number }
interface Assignment {
  id: number; location_id: number; day_of_week: number;
  user_id: string; full_name: string | null; phone: string | null;
}
interface UserOption { user_id: string; full_name: string | null; role: string; phone: string | null }

export default function SupervisionScheduleEditPage() {
  const qc = useQueryClient();

  // Cell being edited via the picker modal: { location_id, day_of_week } or null.
  const [picker, setPicker] = useState<{ location_id: number; day_of_week: number; current_user_id?: string | null } | null>(null);
  const [search, setSearch] = useState('');

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['supervision-locations-edit'],
    queryFn: async () => (await (await fetch('/api/supervision/locations')).json()).data || [],
  });

  const { data: assignments = [], isLoading } = useQuery<Assignment[]>({
    queryKey: ['supervision-assignments-edit'],
    queryFn: async () => (await (await fetch('/api/supervision/assignments')).json()).data || [],
    refetchInterval: 30_000,
  });

  // Pickable users = teachers + admins. Pulled from /api/teachers and /api/admins.
  const { data: teachers = [] } = useQuery<UserOption[]>({
    queryKey: ['users-teachers-pick'],
    queryFn: async () => {
      const r = await fetch('/api/teachers');
      if (!r.ok) return [];
      const d = await r.json();
      return (d.data || []).map((t: any) => ({ user_id: t.user_id, full_name: t.full_name, role: 'teacher', phone: t.phone }));
    },
  });
  const { data: admins = [] } = useQuery<UserOption[]>({
    queryKey: ['users-admins-pick'],
    queryFn: async () => {
      const r = await fetch('/api/admins');
      if (!r.ok) return [];
      const d = await r.json();
      return (d.data || []).map((a: any) => ({ user_id: a.user_id, full_name: a.full_name, role: a.role, phone: a.phone }));
    },
  });
  const allUsers = useMemo(() => {
    const seen = new Set<string>();
    const merged: UserOption[] = [];
    for (const u of [...admins, ...teachers]) {
      if (!u.user_id || seen.has(u.user_id)) continue;
      seen.add(u.user_id);
      merged.push(u);
    }
    return merged.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ar'));
  }, [teachers, admins]);

  // Build a quick lookup: assignmentMap.get(`${location_id}:${day}`)
  const assignmentMap = useMemo(() => {
    const m = new Map<string, Assignment>();
    for (const a of assignments) m.set(`${a.location_id}:${a.day_of_week}`, a);
    return m;
  }, [assignments]);

  // Per-supervisor day count to flag heavy-loaded teachers in the picker.
  const userDayCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments) m.set(a.user_id, (m.get(a.user_id) || 0) + 1);
    return m;
  }, [assignments]);

  const setCellMut = useMutation({
    mutationFn: async ({ location_id, day_of_week, user_id }: { location_id: number; day_of_week: number; user_id: string }) => {
      const r = await fetch('/api/supervision/assignments', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id, day_of_week, user_id }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supervision-assignments-edit'] });
      setPicker(null); setSearch('');
      toast.success('تم الحفظ');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const clearCellMut = useMutation({
    mutationFn: async ({ location_id, day_of_week }: { location_id: number; day_of_week: number }) => {
      const r = await fetch(`/api/supervision/assignments?location_id=${location_id}&day_of_week=${day_of_week}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supervision-assignments-edit'] });
      setPicker(null);
      toast.success('تم المسح');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return allUsers;
    const q = search.trim();
    return allUsers.filter((u) => (u.full_name || '').includes(q));
  }, [allUsers, search]);

  const activeLocations = locations.filter((l) => l.is_active);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/supervision" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center">
            <Calendar className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">جدول إشراف الأسبوع</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              اضغط على أي خلية لتعيين معلم/إداري — الجدول يتكرر كل أسبوع تلقائياً
            </p>
          </div>
        </div>
        <Link href="/dashboard/supervision/locations" className="btn-secondary inline-flex items-center gap-1">
          <MapPin className="w-4 h-4" /> إدارة المواقع
        </Link>
      </div>

      {isLoading ? (
        <div className="card text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
      ) : activeLocations.length === 0 ? (
        <div className="card text-center py-12">
          <MapPin className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-3">لا توجد مواقع نشطة بعد</p>
          <Link href="/dashboard/supervision/locations" className="btn-primary inline-flex items-center gap-1 text-sm">
            <MapPin className="w-4 h-4" /> أضف مواقع الإشراف أولاً
          </Link>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium sticky right-0 bg-gray-50 dark:bg-gray-900 z-10 min-w-[180px]">الموقع</th>
                  {ARABIC_DAYS.map((d, i) => (
                    <th key={i} className="px-2 py-2 font-medium text-center min-w-[120px]">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {activeLocations.map((loc) => (
                  <tr key={loc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2 font-medium sticky right-0 bg-white dark:bg-gray-950 z-10">
                      📍 {loc.name}
                    </td>
                    {ARABIC_DAYS.map((_, day) => {
                      const a = assignmentMap.get(`${loc.id}:${day}`);
                      return (
                        <td key={day} className="px-2 py-2 text-center align-middle">
                          <button
                            onClick={() => setPicker({ location_id: loc.id, day_of_week: day, current_user_id: a?.user_id })}
                            className={`w-full text-xs px-2 py-1.5 rounded border transition-colors ${
                              a
                                ? 'bg-blue-50 dark:bg-blue-500/15 border-blue-300 dark:border-blue-500/40 text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/25'
                                : 'border-dashed border-gray-300 dark:border-gray-700 text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                            }`}
                            title={a?.full_name || 'اضغط لتعيين'}
                          >
                            {a ? (a.full_name || '— غير معروف —') : '+ تعيين'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Picker modal */}
      {picker && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPicker(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h3 className="font-semibold flex items-center gap-1.5">
                  <Users className="w-4 h-4" /> اختر المشرف
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  📍 {locations.find((l) => l.id === picker.location_id)?.name} • 📅 {ARABIC_DAYS[picker.day_of_week]}
                </p>
              </div>
              <button onClick={() => setPicker(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-gray-200 dark:border-gray-800">
              <div className="relative">
                <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-2.5 text-gray-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم..." className="input text-sm pe-8" autoFocus />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredUsers.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">لا يوجد مستخدمون مطابقون</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredUsers.map((u) => {
                    const isSelected = picker.current_user_id === u.user_id;
                    const dayCount = userDayCount.get(u.user_id) || 0;
                    return (
                      <li key={u.user_id}>
                        <button
                          onClick={() => setCellMut.mutate({
                            location_id: picker.location_id,
                            day_of_week: picker.day_of_week,
                            user_id: u.user_id,
                          })}
                          disabled={setCellMut.isPending}
                          className={`w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 disabled:opacity-50 ${
                            isSelected ? 'bg-blue-50 dark:bg-blue-500/15' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {u.full_name || '—'}
                                {isSelected && <span className="text-[10px] text-blue-600 dark:text-blue-400 ms-1">(الحالي)</span>}
                              </p>
                              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                {u.role === 'teacher' ? 'معلم' : u.role === 'super_admin' ? 'مدير عام' : 'إداري'}
                                {u.phone && <> • <span className="font-mono" dir="ltr">{u.phone}</span></>}
                              </p>
                            </div>
                            {dayCount > 0 && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                                dayCount >= 3
                                  ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                              }`} title="عدد الأيام المُعيَّنة عليه حالياً">
                                {dayCount} {dayCount === 1 ? 'يوم' : 'أيام'}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {picker.current_user_id && (
              <div className="p-3 border-t border-gray-200 dark:border-gray-800">
                <button
                  onClick={() => clearCellMut.mutate({ location_id: picker.location_id, day_of_week: picker.day_of_week })}
                  disabled={clearCellMut.isPending}
                  className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/25"
                >
                  {clearCellMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  مسح التعيين من هذه الخلية
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
