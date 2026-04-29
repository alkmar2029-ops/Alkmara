'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  UserCog, Loader2, Save, Search, CheckSquare, Square, Users,
  GraduationCap, AlertCircle, Filter,
} from 'lucide-react';

interface Teacher {
  user_id: string;
  full_name: string;
  is_active: boolean;
}

interface Section {
  id: number;
  name: string;
  grade_id: number;
  grade_name: string;
}

interface AssignmentMatrix {
  assignments: { teacher_user_id: string; section_id: number }[];
  teachers: Teacher[];
  sections: Section[];
}

export default function TeacherAssignmentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  const { data, isLoading, isError } = useQuery<AssignmentMatrix>({
    queryKey: ['teacher-assignments-matrix'],
    queryFn: async () => (await (await fetch('/api/teacher-assignments')).json()).data,
  });

  // Local edit state — keyed by teacher_user_id, each value is the Set of
  // assigned section ids. We initialise from the server data and let the
  // admin toggle freely; "Save row" sends ONE teacher's complete set.
  const [edits, setEdits] = useState<Map<string, Set<number>>>(new Map());

  useEffect(() => {
    if (!data) return;
    const map = new Map<string, Set<number>>();
    for (const t of data.teachers) {
      map.set(t.user_id, new Set());
    }
    for (const a of data.assignments) {
      const set = map.get(a.teacher_user_id);
      if (set) set.add(a.section_id);
    }
    setEdits(map);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (input: { teacher_user_id: string; section_ids: number[] }) => {
      const r = await fetch('/api/teacher-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الحفظ');
      return d.data as { added: number; removed: number };
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['teacher-assignments-matrix'] });
      const parts: string[] = [];
      if (d.added) parts.push(`+${d.added}`);
      if (d.removed) parts.push(`-${d.removed}`);
      toast.success(`✓ تم الحفظ ${parts.length ? `(${parts.join(' / ')})` : ''}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const grades = useMemo(() => {
    if (!data) return [] as { id: number; name: string }[];
    const g = new Map<number, string>();
    for (const s of data.sections) {
      g.set(s.grade_id, s.grade_name);
    }
    return Array.from(g.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const visibleSections = useMemo(() => {
    if (!data) return [];
    if (gradeFilter === 'all') return data.sections;
    return data.sections.filter((s) => String(s.grade_id) === gradeFilter);
  }, [data, gradeFilter]);

  const visibleTeachers = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.teachers;
    const q = search.trim();
    return data.teachers.filter((t) => (t.full_name || '').includes(q));
  }, [data, search]);

  // Diff helpers — has the row been edited since last save?
  const initialFor = useMemo(() => {
    const m = new Map<string, Set<number>>();
    if (!data) return m;
    for (const t of data.teachers) m.set(t.user_id, new Set());
    for (const a of data.assignments) {
      m.get(a.teacher_user_id)?.add(a.section_id);
    }
    return m;
  }, [data]);

  const isDirty = (teacherId: string) => {
    const a = edits.get(teacherId) || new Set();
    const b = initialFor.get(teacherId) || new Set();
    if (a.size !== b.size) return true;
    for (const x of a) if (!b.has(x)) return true;
    return false;
  };

  const toggle = (teacherId: string, sectionId: number) => {
    setEdits((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(teacherId) || []);
      if (set.has(sectionId)) set.delete(sectionId);
      else set.add(sectionId);
      next.set(teacherId, set);
      return next;
    });
  };

  const toggleAll = (teacherId: string) => {
    const set = edits.get(teacherId) || new Set();
    const allVisibleAssigned = visibleSections.every((s) => set.has(s.id));
    setEdits((prev) => {
      const next = new Map(prev);
      const ns = new Set(next.get(teacherId) || []);
      for (const s of visibleSections) {
        if (allVisibleAssigned) ns.delete(s.id);
        else ns.add(s.id);
      }
      next.set(teacherId, ns);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (isError || !data) {
    return <div className="text-center py-20 text-red-600 dark:text-red-400">فشل تحميل البيانات</div>;
  }

  // Cumulative stats — total assignments, unassigned teachers (likely
  // the admin needs to act on these).
  const totalAssignments = data.assignments.length;
  const unassignedTeachers = data.teachers.filter((t) =>
    (initialFor.get(t.user_id)?.size || 0) === 0,
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <UserCog className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">تعيين المعلمين على الشعب</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              يحدّد ما يستطيع كل معلم رؤيته وتسجيله من بيانات
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">معلمون نشطون</p>
          <p className="text-2xl font-bold">{data.teachers.length}</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">إجمالي التعيينات</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalAssignments}</p>
        </div>
        <div className={`card text-center py-3 ${unassignedTeachers > 0 ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30' : ''}`}>
          <p className="text-xs text-gray-500 dark:text-gray-400">معلمون بدون تعيينات</p>
          <p className={`text-2xl font-bold ${unassignedTeachers > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
            {unassignedTeachers}
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="card bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30">
        <div className="flex items-start gap-2 text-sm text-blue-900 dark:text-blue-200">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">كيف يعمل التعيين؟</p>
            <ul className="text-xs mt-1 space-y-0.5 list-disc ps-5 text-blue-800 dark:text-blue-100/90">
              <li>المعلم يرى فقط طلاب الشعب المُعيَّن لها</li>
              <li>لا يستطيع تسجيل حضور أو ملاحظات لشعبة غير معيَّنة</li>
              <li>تعديلاتك على صف معلم تُحفَظ بضغط زر "حفظ" بجانبه</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label flex items-center gap-1"><Search className="w-3 h-3" /> بحث عن معلم</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              placeholder="اكتب اسم المعلم..."
            />
          </div>
          <div>
            <label className="label flex items-center gap-1"><Filter className="w-3 h-3" /> الصف</label>
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="input"
            >
              <option value="all">كل الصفوف</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Matrix */}
      <div className="card p-0 overflow-hidden">
        {visibleTeachers.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12 text-sm">
            لا يوجد معلمون مطابقون
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-right font-medium sticky right-0 bg-gray-50 dark:bg-gray-900 z-10 min-w-[180px]">
                    المعلم
                  </th>
                  {visibleSections.map((s) => (
                    <th key={s.id} className="px-2 py-2 font-medium text-center text-xs whitespace-nowrap">
                      <div className="text-gray-500 dark:text-gray-400 text-[10px]">{s.grade_name}</div>
                      <div>{s.name}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium text-center sticky left-0 bg-gray-50 dark:bg-gray-900 min-w-[100px]">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {visibleTeachers.map((t) => {
                  const set = edits.get(t.user_id) || new Set<number>();
                  const dirty = isDirty(t.user_id);
                  const allVisibleAssigned = visibleSections.length > 0
                    && visibleSections.every((s) => set.has(s.id));
                  return (
                    <tr key={t.user_id} className={dirty ? 'bg-amber-50/40 dark:bg-amber-500/5' : ''}>
                      <td className="px-3 py-2 font-medium whitespace-nowrap sticky right-0 bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 z-10">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 text-xs flex items-center justify-center shrink-0">
                            {(t.full_name || '?').charAt(0)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate">{t.full_name}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400">{set.size} مُعيَّنة</p>
                          </div>
                        </div>
                      </td>
                      {visibleSections.map((s) => {
                        const checked = set.has(s.id);
                        return (
                          <td key={s.id} className="px-1 py-1 text-center">
                            <button
                              onClick={() => toggle(t.user_id, s.id)}
                              className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-colors ${
                                checked
                                  ? 'bg-purple-500 border-purple-500 text-white hover:bg-purple-600'
                                  : 'border-gray-300 dark:border-gray-700 text-transparent hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-500/10'
                              }`}
                              title={checked ? 'إزالة من التعيين' : 'إضافة للتعيين'}
                            >
                              {checked && <CheckSquare className="w-4 h-4" />}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-center sticky left-0 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800">
                        <div className="flex flex-col gap-1 items-stretch">
                          <button
                            onClick={() => toggleAll(t.user_id)}
                            className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                            title={allVisibleAssigned ? 'إلغاء كل المرئي' : 'تحديد كل المرئي'}
                          >
                            {allVisibleAssigned ? '−' : '+'} الكل
                          </button>
                          <button
                            onClick={() => saveMut.mutate({
                              teacher_user_id: t.user_id,
                              section_ids: Array.from(set),
                            })}
                            disabled={!dirty || saveMut.isPending}
                            className={`text-xs px-2 py-1 rounded inline-flex items-center justify-center gap-1 ${
                              dirty
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {saveMut.isPending && saveMut.variables?.teacher_user_id === t.user_id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Save className="w-3 h-3" />}
                            حفظ
                          </button>
                        </div>
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
