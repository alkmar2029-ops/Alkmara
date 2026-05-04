'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Search, Fingerprint, Upload, Users, Printer } from 'lucide-react';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { useDebounce } from '@/components/hooks/useDebounce';
import { SkeletonTable } from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StudentForm from '@/components/students/StudentForm';
import ImportModal from '@/components/students/ImportModal';

export default function StudentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [gradeFilter, setGradeFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(r => r.json()).then(r => r.data),
  });

  const { data: grades } = useQuery({
    queryKey: ['grades', settings?.stage],
    queryFn: () => fetch(`/api/grades?stage=${settings?.stage}`).then(r => r.json()).then(r => r.data),
    enabled: !!settings?.stage,
  });

  const { data: sections } = useQuery({
    queryKey: ['sections', gradeFilter],
    queryFn: () => fetch(`/api/sections?grade_id=${gradeFilter}`).then(r => r.json()).then(r => r.data),
    enabled: !!gradeFilter,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['students', debouncedSearch, gradeFilter, sectionFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (gradeFilter) params.set('grade_id', gradeFilter);
      if (sectionFilter) params.set('section_id', sectionFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      return fetch(`/api/students?${params}`).then(r => r.json());
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (formData: any) => {
      const url = editing ? `/api/students/${editing.id}` : '/api/students';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      toast.success(editing ? 'تم تحديث الطالب' : 'تم إضافة الطالب');
      setShowForm(false); setEditing(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/students/${id}`, { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['students'] }); toast.success('تم حذف الطالب'); },
    onError: () => toast.error('فشل حذف الطالب'),
  });

  const { data: sectionDevice } = useQuery({
    queryKey: ['section-device', sectionFilter],
    queryFn: async () => {
      const res = await fetch('/api/devices');
      const { data } = await res.json();
      return (data || []).find((d: any) => String(d.section_id) === sectionFilter);
    },
    enabled: !!sectionFilter,
  });

  const pushMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/devices/${sectionDevice.id}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push-users' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => toast.success(`تم إرسال ${data.data.success} طالب من أصل ${data.data.total} للجهاز`),
    onError: (err: any) => toast.error(err.message),
  });

  const hasStudents = (data?.data?.length || 0) > 0;
  const noFiltersApplied = !search && !gradeFilter && !sectionFilter;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-2xl font-bold">الطلاب</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center gap-2">
            <Upload className="w-4 h-4" /> استيراد Excel
          </button>
          {/* Print — scope is inferred from the active filters:
              section selected → only that section,
              grade selected   → all students in that grade,
              neither          → entire school. */}
          <a
            href={`/dashboard/students/print${
              sectionFilter ? `?section_id=${sectionFilter}`
              : gradeFilter ? `?grade_id=${gradeFilter}`
              : ''
            }`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex items-center gap-2"
            title={
              sectionFilter ? 'طباعة طلاب الشعبة المحددة'
              : gradeFilter ? 'طباعة طلاب الصف المحدد'
              : 'طباعة كل طلاب المدرسة'
            }
          >
            <Printer className="w-4 h-4" />
            طباعة
            {sectionFilter ? ' (الشعبة)' : gradeFilter ? ' (الصف)' : ' (الكل)'}
          </a>
          {sectionFilter && sectionDevice && (
            <button onClick={() => pushMutation.mutate()} disabled={pushMutation.isPending}
              className="btn-success flex items-center gap-2">
              <Fingerprint className="w-4 h-4" />
              {pushMutation.isPending ? 'جاري الإرسال...' : 'إرسال للجهاز'}
            </button>
          )}
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> إضافة طالب
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
        <select value={gradeFilter} onChange={e => { setGradeFilter(e.target.value); setSectionFilter(''); setPage(1); }} className="input w-full">
          <option value="">كل الصفوف</option>
          {(grades || []).map((g: any) => (
            <option key={g.id} value={g.id}>{g.name} {STAGE_LABELS[g.stage]}</option>
          ))}
        </select>
        <select value={sectionFilter} onChange={e => { setSectionFilter(e.target.value); setPage(1); }} className="input w-full" disabled={!gradeFilter}>
          <option value="">كل الشعب</option>
          {(sections || []).map((s: any) => (
            <option key={s.id} value={s.id}>شعبة {s.name}</option>
          ))}
        </select>
        <div className="relative w-full sm:col-span-2">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input type="text" placeholder="بحث بالاسم أو رقم الهوية..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pr-10 w-full" />
        </div>
      </div>

      {isError && (
        <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-4 text-red-700 dark:text-red-300 text-sm">
          حدث خطأ أثناء تحميل بيانات الطلاب. يرجى تحديث الصفحة والمحاولة مرة أخرى.
        </div>
      )}

      {/* Table or Empty State */}
      {!isLoading && !hasStudents && noFiltersApplied ? (
        <div className="card text-center py-16">
          <Users className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-2">لا يوجد طلاب بعد</h3>
          <p className="text-gray-400 dark:text-gray-500 mb-6">ابدأ بإضافة الطلاب يدوياً أو استيرادهم من ملف Excel</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" /> إضافة طالب
            </button>
            <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center justify-center gap-2">
              <Upload className="w-4 h-4" /> استيراد من Excel
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {isLoading ? <SkeletonTable rows={8} cols={6} /> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-sm font-semibold">
                  <th className="px-4 py-3 text-right w-8">#</th>
                  <th className="px-4 py-3 text-right">رقم الهوية</th>
                  <th className="px-4 py-3 text-right">اسم الطالب</th>
                  <th className="px-4 py-3 text-right">الصف</th>
                  <th className="px-4 py-3 text-right">الشعبة</th>
                  <th className="px-4 py-3 text-right">رقم الجهاز</th>
                  <th className="px-4 py-3 text-right">البصمة</th>
                  <th className="px-4 py-3 text-right">إجراءات</th>
                </tr></thead>
                <tbody>
                  {(data?.data || []).map((s: any, i: number) => (
                    <tr key={s.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                      <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">{(page - 1) * 20 + i + 1}</td>
                      <td className="px-4 py-3 font-mono text-sm">{s.student_id}</td>
                      <td className="px-4 py-3">{s.first_name} {s.father_name ? s.father_name + ' ' : ''}{s.last_name}</td>
                      <td className="px-4 py-3 text-sm">{s.grade_name || '-'}</td>
                      <td className="px-4 py-3 text-sm">{s.section_name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{s.device_uid}</td>
                      <td className="px-4 py-3">
                        <Fingerprint className={`w-4 h-4 ${s.is_fingerprint_enrolled ? 'text-green-500 dark:text-green-400' : 'text-gray-300 dark:text-gray-600'}`} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => { setEditing(s); setShowForm(true); }} className="text-blue-600 dark:text-blue-400 text-sm hover:underline">تعديل</button>
                          <button onClick={() => setDeleteTarget(s.id)} className="text-red-600 dark:text-red-400 text-sm hover:underline">حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!hasStudents && !noFiltersApplied && (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400 dark:text-gray-500">لا يوجد طلاب مطابقين للبحث</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} />
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="حذف طالب"
        message="هل تريد حذف هذا الطالب؟ لا يمكن التراجع عن هذا الإجراء."
        confirmText="حذف"
        cancelText="إلغاء"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget !== null) deleteMutation.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Add/Edit Modal */}
      {showForm && (
        <StudentForm
          student={editing}
          grades={grades || []}
          settings={settings}
          loading={saveMutation.isPending}
          onSubmit={(d: any) => saveMutation.mutate(d)}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          grades={grades || []}
          settings={settings}
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); qc.invalidateQueries({ queryKey: ['students'] }); }}
        />
      )}
    </div>
  );
}
