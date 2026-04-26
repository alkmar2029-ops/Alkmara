'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { BookOpen, Save, Info } from 'lucide-react';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { SkeletonPage } from '@/components/ui/Skeleton';

const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
const NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

function getSectionNames(count: number, type: string): string[] {
  const source = type === 'letters' ? LETTERS : NUMBERS;
  return source.slice(0, count);
}

export default function GradesPage() {
  const qc = useQueryClient();
  // User-edited counts (only set when user manually changes a value)
  const [editedCounts, setEditedCounts] = useState<Record<number, number>>({});

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(r => r.json()).then(r => r.data),
  });

  const { data: grades, isLoading: gradesLoading, isError: gradesError } = useQuery({
    queryKey: ['grades', settings?.stage],
    queryFn: async () => {
      const res = await fetch(`/api/grades?stage=${settings?.stage}`);
      if (!res.ok) throw new Error('فشل في تحميل الصفوف');
      const r = await res.json();
      return r.data;
    },
    enabled: !!settings?.stage,
  });

  const { data: allSections, isError: sectionsError } = useQuery({
    queryKey: ['all-sections'],
    queryFn: async () => {
      const res = await fetch('/api/sections');
      if (!res.ok) throw new Error('فشل في تحميل الشعب');
      const r = await res.json();
      return r.data;
    },
  });

  // Derive section counts from data, with user edits taking priority
  const sectionCounts = useMemo(() => {
    if (!grades || !allSections) return {};
    const counts: Record<number, number> = {};
    grades.forEach((g: any) => {
      const existing = allSections.filter((s: any) => s.grade_id === g.id);
      counts[g.id] = existing.length || 1;
    });
    // Merge in any user-edited counts
    return { ...counts, ...editedCounts };
  }, [grades, allSections, editedCounts]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const promises = (grades || []).map((grade: any) => {
        const count = sectionCounts[grade.id] || 1;
        const names = getSectionNames(count, settings?.section_type || 'letters');
        return fetch('/api/sections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grade_id: grade.id,
            sections: names.map((name, i) => ({ name, sort_order: i + 1 })),
          }),
        }).then(res => { if (!res.ok) throw new Error('Save failed'); return res; });
      });
      await Promise.all(promises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-sections'] });
      setEditedCounts({});
      toast.success('تم حفظ الشعب بنجاح');
    },
    onError: () => toast.error('حدث خطأ أثناء الحفظ'),
  });

  if (!settings?.school_name) {
    return (
      <div className="text-center py-12">
        <Info className="w-12 h-12 text-yellow-400 dark:text-yellow-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">أكمل إعدادات المدرسة أولاً</h3>
        <p className="text-gray-500 dark:text-gray-400 mb-4">يرجى الذهاب لصفحة الإعدادات وتحديد المرحلة الدراسية</p>
        <Link href="/dashboard/settings" className="btn-primary">الذهاب للإعدادات</Link>
      </div>
    );
  }

  if (gradesLoading) return <SkeletonPage />;

  if (gradesError || sectionsError) {
    return (
      <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-4 text-red-700 dark:text-red-300 text-sm">
        حدث خطأ أثناء تحميل البيانات. يرجى تحديث الصفحة والمحاولة مرة أخرى.
      </div>
    );
  }

  const totalSections = Object.values(sectionCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-gray-400 dark:text-gray-500" />
          <h2 className="text-2xl font-bold">الصفوف والشعب</h2>
        </div>
        <span className="text-sm bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full font-medium self-start sm:self-auto">
          المرحلة: {STAGE_LABELS[settings.stage]}
        </span>
      </div>

      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <h3 className="font-semibold">تحديد عدد الشعب لكل صف</h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            التصنيف: {settings.section_type === 'letters' ? 'حروف (أ، ب، ج...)' : 'أرقام (1، 2، 3...)'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-sm font-semibold">
                <th className="px-4 py-3 text-right">الصف</th>
                <th className="px-4 py-3 text-right w-32">عدد الشعب</th>
                <th className="px-4 py-3 text-right">الشعب المُنشأة</th>
              </tr>
            </thead>
            <tbody>
              {(grades || []).map((grade: any) => {
                const count = sectionCounts[grade.id] || 1;
                const names = getSectionNames(count, settings?.section_type || 'letters');

                return (
                  <tr key={grade.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-3 font-medium">
                      {grade.name} {STAGE_LABELS[grade.stage]}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={count}
                        onChange={e => {
                          const val = Math.min(10, Math.max(1, parseInt(e.target.value) || 1));
                          setEditedCounts({ ...editedCounts, [grade.id]: val });
                        }}
                        className="input w-20 text-center"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        {names.map(name => (
                          <span key={name} className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 text-sm font-medium">
                            {name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
          <span className="text-sm text-gray-500 dark:text-gray-400">الإجمالي: <strong>{totalSections}</strong> شعبة</span>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto">
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'جاري الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  );
}
