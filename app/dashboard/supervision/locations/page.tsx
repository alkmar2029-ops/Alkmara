'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { MapPin, Plus, Pencil, Trash2, Loader2, X, Save, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';

interface Location {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export default function SupervisionLocationsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', sort_order: 0 });

  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ['supervision-locations'],
    queryFn: async () => (await (await fetch('/api/supervision/locations')).json()).data || [],
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/supervision/locations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supervision-locations'] });
      setShowForm(false); setForm({ name: '', sort_order: 0 });
      toast.success('تمت الإضافة');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Location> }) => {
      const r = await fetch(`/api/supervision/locations/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supervision-locations'] });
      setEditingId(null);
      toast.success('تم التعديل');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/supervision/locations/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supervision-locations'] });
      toast.success('تم الحذف');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/supervision" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <MapPin className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">مواقع الإشراف</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">قائمة بأماكن الإشراف في المدرسة (يُستخدم في جدول الأسبوع)</p>
          </div>
        </div>
        <button onClick={() => { setForm({ name: '', sort_order: 0 }); setShowForm(true); }} className="btn-primary inline-flex items-center gap-1">
          <Plus className="w-4 h-4" /> موقع جديد
        </button>
      </div>

      {isLoading ? (
        <div className="card text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
      ) : locations.length === 0 ? (
        <div className="card text-center py-12">
          <MapPin className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">لا توجد مواقع — اضغط «موقع جديد».</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr className="text-right">
                <th className="px-3 py-2 font-medium w-12">الترتيب</th>
                <th className="px-3 py-2 font-medium">اسم الموقع</th>
                <th className="px-3 py-2 font-medium w-24">الحالة</th>
                <th className="px-3 py-2 font-medium text-end w-32">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {locations.map((loc) => (
                editingId === loc.id ? (
                  <EditRow key={loc.id} loc={loc} onSave={(d) => updateMut.mutate({ id: loc.id, data: d })} onCancel={() => setEditingId(null)} saving={updateMut.isPending} />
                ) : (
                  <tr key={loc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2 font-mono text-xs text-gray-500" dir="ltr">{loc.sort_order}</td>
                    <td className="px-3 py-2 font-medium">📍 {loc.name}</td>
                    <td className="px-3 py-2">
                      {loc.is_active
                        ? <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-xs"><CheckCircle2 className="w-3 h-3" /> نشط</span>
                        : <span className="inline-flex items-center gap-0.5 text-gray-500 text-xs"><XCircle className="w-3 h-3" /> معطّل</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditingId(loc.id)} title="تعديل" className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => updateMut.mutate({ id: loc.id, data: { is_active: !loc.is_active } })}
                          title={loc.is_active ? 'تعطيل' : 'تفعيل'}
                          className="p-1.5 rounded text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-500/10"
                        >
                          {loc.is_active ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => { if (confirm(`حذف الموقع "${loc.name}"؟ سيُحذف أي تعيين عليه.`)) deleteMut.mutate(loc.id); }}
                          title="حذف" className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-semibold">موقع إشراف جديد</h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="label">اسم الموقع *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="مثلاً: الساحة الأمامية" />
              </div>
              <div>
                <label className="label">ترتيب العرض</label>
                <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })} className="input font-mono" dir="ltr" />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">الأرقام الأصغر تظهر أولاً (10, 20, 30 ...).</p>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
              <button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name.trim()} className="btn-primary flex-1 inline-flex items-center justify-center gap-1">
                {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditRow({ loc, onSave, onCancel, saving }: { loc: Location; onSave: (data: Partial<Location>) => void; onCancel: () => void; saving: boolean }) {
  const [name, setName] = useState(loc.name);
  const [sortOrder, setSortOrder] = useState(loc.sort_order);
  return (
    <tr>
      <td className="px-3 py-2"><input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} className="input text-sm py-1 font-mono" dir="ltr" /></td>
      <td className="px-3 py-2"><input value={name} onChange={(e) => setName(e.target.value)} className="input text-sm py-1" /></td>
      <td className="px-3 py-2 text-xs text-gray-500">—</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => onSave({ name, sort_order: sortOrder })} disabled={saving} className="p-1.5 rounded text-green-600 hover:bg-green-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          </button>
          <button onClick={onCancel} className="p-1.5 rounded text-gray-500 hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
      </td>
    </tr>
  );
}
