'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Search, Fingerprint, Upload, Users, Printer, Filter, X } from 'lucide-react';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { useDebounce } from '@/components/hooks/useDebounce';
import { SkeletonTable } from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StudentForm from '@/components/students/StudentForm';
import ImportModal from '@/components/students/ImportModal';

// Special-conditions filter state. Each chip toggles a single backend
// param so the user can mix them ("missing docs + asthma" etc.).
type SpecialFilters = {
  has_health: boolean;
  health_condition: string;
  has_social: boolean;
  custody_type: string;
  docs_status: string;
  has_blocked_pickup: boolean;
};

const HEALTH_CHOICES = [
  { code: 'diabetes',     label: '🩸 السكري' },
  { code: 'hypertension', label: '💓 الضغط' },
  { code: 'heart',        label: '❤️ القلب' },
  { code: 'asthma',       label: '🫁 الربو' },
  { code: 'allergy',      label: '🌾 حساسية' },
  { code: 'epilepsy',     label: '⚡ الصرع' },
  { code: 'vision',       label: '👁️ البصر' },
  { code: 'hearing',      label: '👂 السمع' },
  { code: 'other',        label: '📋 أخرى' },
];

const CUSTODY_CHOICES = [
  { code: 'father',   label: '👨 والد' },
  { code: 'mother',   label: '👩 والدة' },
  { code: 'shared',   label: '👨‍👩‍👧 مشتركة' },
  { code: 'guardian', label: '👤 وصي' },
  { code: 'other',    label: '📋 أخرى' },
];

const DOCS_CHOICES = [
  { code: 'missing',  label: '⚠️ ناقصة',  cls: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/40' },
  { code: 'pending',  label: '⏳ قيد المتابعة', cls: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40' },
  { code: 'verified', label: '✅ مكتملة', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40' },
];

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

  // Special-conditions filters — collapsed by default to keep the page calm.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [special, setSpecial] = useState<SpecialFilters>({
    has_health: false, health_condition: '',
    has_social: false, custody_type: '', docs_status: '',
    has_blocked_pickup: false,
  });

  const activeSpecialCount = (
    (special.has_health ? 1 : 0) +
    (special.health_condition ? 1 : 0) +
    (special.has_social ? 1 : 0) +
    (special.custody_type ? 1 : 0) +
    (special.docs_status ? 1 : 0) +
    (special.has_blocked_pickup ? 1 : 0)
  );
  const clearSpecial = () => setSpecial({
    has_health: false, health_condition: '',
    has_social: false, custody_type: '', docs_status: '',
    has_blocked_pickup: false,
  });

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
    queryKey: ['students', debouncedSearch, gradeFilter, sectionFilter, page, special],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (gradeFilter) params.set('grade_id', gradeFilter);
      if (sectionFilter) params.set('section_id', sectionFilter);
      if (special.has_health) params.set('has_health', '1');
      if (special.health_condition) params.set('health_condition', special.health_condition);
      if (special.has_social) params.set('has_social', '1');
      if (special.custody_type) params.set('custody_type', special.custody_type);
      if (special.docs_status) params.set('docs_status', special.docs_status);
      if (special.has_blocked_pickup) params.set('has_blocked_pickup', '1');
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

      {/* Special-conditions filter row — collapsible. Opens on click and
          remembers state so the user can adjust without re-toggling. */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
            activeSpecialCount > 0
              ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-500/40'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          فلاتر متقدمة
          {activeSpecialCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
              {activeSpecialCount}
            </span>
          )}
        </button>
        {activeSpecialCount > 0 && (
          <button
            onClick={() => { clearSpecial(); setPage(1); }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <X className="w-3 h-3" />
            مسح الفلاتر
          </button>
        )}
      </div>

      {filtersOpen && (
        <div className="card border-2 border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/30 dark:bg-indigo-500/5 space-y-3">
          {/* Health */}
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">🏥 الحالات الصحية</p>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                active={special.has_health}
                onClick={() => { setSpecial((s) => ({ ...s, has_health: !s.has_health })); setPage(1); }}
                label="🏥 لديه حالة صحية"
                tone="red"
              />
              {HEALTH_CHOICES.map((opt) => (
                <FilterChip
                  key={opt.code}
                  active={special.health_condition === opt.code}
                  onClick={() => { setSpecial((s) => ({ ...s, health_condition: s.health_condition === opt.code ? '' : opt.code })); setPage(1); }}
                  label={opt.label}
                  tone="red"
                />
              ))}
            </div>
          </div>

          {/* Custody */}
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">👨‍👩‍👧 الحالة الاجتماعية / الوصاية</p>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                active={special.has_social}
                onClick={() => { setSpecial((s) => ({ ...s, has_social: !s.has_social })); setPage(1); }}
                label="👨‍👩‍👧 لديه حالة وصاية"
                tone="indigo"
              />
              <FilterChip
                active={special.has_blocked_pickup}
                onClick={() => { setSpecial((s) => ({ ...s, has_blocked_pickup: !s.has_blocked_pickup })); setPage(1); }}
                label="🛑 قيود استلام"
                tone="red"
              />
              {CUSTODY_CHOICES.map((opt) => (
                <FilterChip
                  key={opt.code}
                  active={special.custody_type === opt.code}
                  onClick={() => { setSpecial((s) => ({ ...s, custody_type: s.custody_type === opt.code ? '' : opt.code })); setPage(1); }}
                  label={opt.label}
                  tone="indigo"
                />
              ))}
            </div>
          </div>

          {/* Docs */}
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">📄 حالة الوثائق</p>
            <div className="flex flex-wrap gap-1.5">
              {DOCS_CHOICES.map((opt) => (
                <button
                  key={opt.code}
                  onClick={() => { setSpecial((s) => ({ ...s, docs_status: s.docs_status === opt.code ? '' : opt.code })); setPage(1); }}
                  className={`text-xs px-2.5 py-1 rounded-lg border ${
                    special.docs_status === opt.code
                      ? opt.cls
                      : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
                  <th className="px-4 py-3 text-right">حالات</th>
                  <th className="px-4 py-3 text-right">إجراءات</th>
                </tr></thead>
                <tbody>
                  {(data?.data || []).map((s: any, i: number) => {
                    const hasH = (s.health_info?.conditions?.length || 0) > 0;
                    const hasS = !!s.social_info;
                    const blocked = (s.social_info?.blocked_pickup?.length || 0) > 0;
                    const docsMissing = s.social_info?.documentation_status === 'missing';
                    return (
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
                          <div className="flex items-center gap-1">
                            {hasH && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 text-[11px] font-bold border border-red-200 dark:border-red-500/30"
                                title={`حالات صحية: ${s.health_info.conditions.length}`}
                              >
                                🏥 {s.health_info.conditions.length}
                              </span>
                            )}
                            {hasS && (
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold border ${
                                  blocked
                                    ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30'
                                    : 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30'
                                }`}
                                title={blocked ? 'قيود استلام مفروضة' : 'حالة وصاية مسجَّلة'}
                              >
                                {blocked ? '🛑' : '👨‍👩‍👧'}
                              </span>
                            )}
                            {docsMissing && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] font-bold border border-amber-200 dark:border-amber-500/30"
                                title="الوثائق ناقصة"
                              >
                                ⚠️ وثائق
                              </span>
                            )}
                            {!hasH && !hasS && !docsMissing && (
                              <span className="text-gray-300 dark:text-gray-700">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => { setEditing(s); setShowForm(true); }} className="text-blue-600 dark:text-blue-400 text-sm hover:underline">تعديل</button>
                            <button onClick={() => setDeleteTarget(s.id)} className="text-red-600 dark:text-red-400 text-sm hover:underline">حذف</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!hasStudents && !noFiltersApplied && (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-400 dark:text-gray-500">لا يوجد طلاب مطابقين للبحث</td></tr>
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

function FilterChip({
  active, onClick, label, tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone: 'red' | 'indigo';
}) {
  const activeCls = tone === 'red'
    ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40'
    : 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/40';
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
        active ? activeCls : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
      }`}
    >
      {label}
    </button>
  );
}
