'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Phone, Loader2, RefreshCw, Search, Save, X,
  Edit3, Send, ExternalLink, Printer,
} from 'lucide-react';
import Link from 'next/link';

interface FailedNumberRow {
  phone: string;
  last_name: string | null;
  last_failed_at: string;
  fail_count: number;
  last_error: string;
  students: Array<{
    id: number;
    student_id: string;
    name: string;
    phone: string | null;
    grade: string | null;
    section: string | null;
  }>;
}

export default function WhatsappIssuesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ studentId: number; current: string } | null>(null);
  const [newPhone, setNewPhone] = useState('');

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery<FailedNumberRow[]>({
    queryKey: ['whatsapp-issues'],
    queryFn: async () => (await (await fetch('/api/whatsapp/failed-numbers')).json()).data || [],
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim();
    return rows.filter((r) =>
      r.phone.includes(q) ||
      r.last_name?.includes(q) ||
      r.students.some((s) => s.name.includes(q) || s.student_id.includes(q)),
    );
  }, [rows, search]);

  // Update student phone — uses /api/students/[id] PATCH (existing endpoint)
  const updatePhoneMut = useMutation({
    mutationFn: async ({ studentId, phone }: { studentId: number; phone: string }) => {
      const r = await fetch(`/api/students/${studentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل التحديث');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-issues'] });
      toast.success('تم تحديث رقم الجوال');
      setEditing(null);
      setNewPhone('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalFails = rows.reduce((acc, r) => acc + r.fail_count, 0);
  const uniqueStudents = rows.reduce((acc, r) => acc + r.students.length, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-500 rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">أرقام تحتاج تحديث</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              أرقام أولياء أمور غير مسجّلة في الواتساب أو خاطئة
            </p>
          </div>
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary inline-flex items-center gap-1">
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          تحديث
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">أرقام مشكوك فيها</p>
          <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{rows.length}</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">طلاب متأثّرون</p>
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{uniqueStudents}</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">إجمالي محاولات فاشلة</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{totalFails}</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="card bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 p-3 text-sm text-blue-800 dark:text-blue-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p>
            هذه الأرقام أعطت خطأ <code className="text-xs bg-blue-100 dark:bg-blue-500/20 px-1 rounded">JID does not exist</code> من واتساب.
          </p>
          <p className="mt-1 text-xs">
            هذا يعني أن الرقم <strong>غير مسجّل في واتساب</strong>. الحلول:
          </p>
          <ul className="text-xs mt-1 list-disc ps-5 space-y-0.5">
            <li>اتصل بولي الأمر للتحقّق من الرقم الصحيح</li>
            <li>اطلب رقماً بديلاً مسجّلاً في الواتساب</li>
            <li>عدّل الرقم باستخدام زر «تعديل» بجانب الطالب</li>
          </ul>
        </div>
      </div>

      {/* Search */}
      {rows.length > 5 && (
        <div className="card">
          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input ps-9"
              placeholder="بحث برقم أو اسم..."
            />
          </div>
        </div>
      )}

      {/* List */}
      <div className="card">
        {isLoading ? (
          <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline text-gray-400" /></div>
        ) : filtered.length === 0 ? (
          rows.length === 0 ? (
            <p className="text-center text-green-600 dark:text-green-400 text-sm py-12">
              ✓ ممتاز! لا يوجد أي رقم مشكوك فيه حالياً
            </p>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">لا توجد نتائج للبحث</p>
          )
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {filtered.map((r) => (
              <li key={r.phone} className="py-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Phone className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
                  <span className="font-mono text-sm font-semibold" dir="ltr">{r.phone}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">
                    فشل {r.fail_count} مرة
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 ms-auto">
                    آخر فشل: {new Date(r.last_failed_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>

                {r.students.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic ms-6">
                    لم يُعثَر على طالب مرتبط بهذا الرقم
                    {r.last_name && <> (آخر اسم استلام: {r.last_name})</>}
                  </p>
                ) : (
                  <ul className="ms-6 divide-y divide-gray-100 dark:divide-gray-800/50">
                    {r.students.map((s) => (
                      <li key={s.id} className="py-2 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{s.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-mono" dir="ltr">{s.student_id}</span> • {s.grade} / {s.section}
                          </p>
                        </div>
                        {editing?.studentId === s.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              value={newPhone}
                              onChange={(e) => setNewPhone(e.target.value)}
                              className="input text-xs py-1 px-2 w-32"
                              placeholder="05xxxxxxxx"
                              dir="ltr"
                            />
                            <button
                              onClick={() => updatePhoneMut.mutate({ studentId: s.id, phone: newPhone })}
                              disabled={updatePhoneMut.isPending || !newPhone.trim()}
                              className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-500/10"
                            >
                              {updatePhoneMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => { setEditing(null); setNewPhone(''); }}
                              className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditing({ studentId: s.id, current: s.phone || '' }); setNewPhone(s.phone || ''); }}
                            className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 hover:bg-blue-200 inline-flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" />
                            تعديل
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
