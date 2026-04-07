'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Search, Fingerprint, Upload, Download, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Users } from 'lucide-react';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { useDebounce } from '@/components/hooks/useDebounce';
import { SkeletonTable } from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

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
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">الطلاب</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center gap-2">
            <Upload className="w-4 h-4" /> استيراد Excel
          </button>
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
      <div className="flex gap-3 flex-wrap items-center">
        <select value={gradeFilter} onChange={e => { setGradeFilter(e.target.value); setSectionFilter(''); setPage(1); }} className="input max-w-[180px]">
          <option value="">كل الصفوف</option>
          {(grades || []).map((g: any) => (
            <option key={g.id} value={g.id}>{g.name} {STAGE_LABELS[g.stage]}</option>
          ))}
        </select>

        <select value={sectionFilter} onChange={e => { setSectionFilter(e.target.value); setPage(1); }} className="input max-w-[150px]" disabled={!gradeFilter}>
          <option value="">كل الشعب</option>
          {(sections || []).map((s: any) => (
            <option key={s.id} value={s.id}>شعبة {s.name}</option>
          ))}
        </select>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="بحث بالاسم أو رقم الهوية..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pr-10" />
        </div>
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          حدث خطأ أثناء تحميل بيانات الطلاب. يرجى تحديث الصفحة والمحاولة مرة أخرى.
        </div>
      )}

      {/* Table or Empty State */}
      {!isLoading && !hasStudents && noFiltersApplied ? (
        <div className="card text-center py-16">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-600 mb-2">لا يوجد طلاب بعد</h3>
          <p className="text-gray-400 mb-6">ابدأ بإضافة الطلاب يدوياً أو استيرادهم من ملف Excel</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> إضافة طالب
            </button>
            <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center gap-2">
              <Upload className="w-4 h-4" /> استيراد من Excel
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {isLoading ? <SkeletonTable rows={8} cols={6} /> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-gray-50 text-gray-600 text-sm font-semibold">
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
                    <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-400">{(page - 1) * 20 + i + 1}</td>
                      <td className="px-4 py-3 font-mono text-sm">{s.student_id}</td>
                      <td className="px-4 py-3">{s.first_name} {s.father_name ? s.father_name + ' ' : ''}{s.last_name}</td>
                      <td className="px-4 py-3 text-sm">{s.grade_name || '-'}</td>
                      <td className="px-4 py-3 text-sm">{s.section_name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{s.device_uid}</td>
                      <td className="px-4 py-3">
                        <Fingerprint className={`w-4 h-4 ${s.is_fingerprint_enrolled ? 'text-green-500' : 'text-gray-300'}`} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => { setEditing(s); setShowForm(true); }} className="text-blue-600 text-sm hover:underline">تعديل</button>
                          <button onClick={() => setDeleteTarget(s.id)} className="text-red-600 text-sm hover:underline">حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!hasStudents && !noFiltersApplied && (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400">لا يوجد طلاب مطابقين للبحث</td></tr>
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

// ==================== Student Form ====================
function StudentForm({ student, grades, settings, onSubmit, onClose, loading }: any) {
  const [form, setForm] = useState({
    student_id: student?.student_id || '',
    first_name: student?.first_name || '',
    father_name: student?.father_name || '',
    last_name: student?.last_name || '',
    grade_id: student?.grade_id || '',
    section_id: student?.section_id || '',
    phone: student?.phone || '',
    notes: student?.notes || '',
  });

  const { data: formSections } = useQuery({
    queryKey: ['sections', form.grade_id],
    queryFn: () => fetch(`/api/sections?grade_id=${form.grade_id}`).then(r => r.json()).then(r => r.data),
    enabled: !!form.grade_id,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (String(form.student_id).length !== 10) { toast.error('رقم الهوية يجب أن يكون 10 أرقام'); return; }
    onSubmit({
      ...form,
      grade_id: parseInt(form.grade_id) || 0,
      section_id: parseInt(form.section_id) || 0,
    });
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={student ? 'تعديل طالب' : 'إضافة طالب جديد'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label">رقم الهوية *</label>
          <input value={form.student_id} onChange={e => setForm({ ...form, student_id: e.target.value.replace(/\D/g, '').slice(0, 10) })}
            className="input font-mono" required placeholder="10 أرقام" maxLength={10} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">الاسم الأول *</label>
            <input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} className="input" required /></div>
          <div><label className="label">اسم الأب *</label>
            <input value={form.father_name} onChange={e => setForm({ ...form, father_name: e.target.value })} className="input" required /></div>
          <div><label className="label">اسم العائلة *</label>
            <input value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} className="input" required /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">الصف *</label>
            <select value={form.grade_id} onChange={e => setForm({ ...form, grade_id: e.target.value, section_id: '' })} className="input" required>
              <option value="">اختر الصف</option>
              {grades.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select></div>
          <div><label className="label">الشعبة *</label>
            <select value={form.section_id} onChange={e => setForm({ ...form, section_id: e.target.value })} className="input" required disabled={!form.grade_id}>
              <option value="">اختر الشعبة</option>
              {(formSections || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">رقم الجوال</label>
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" /></div>
          <div><label className="label">ملاحظات</label>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input" /></div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'جاري الحفظ...' : 'حفظ'}</button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}

// ==================== Import Modal ====================
function ImportModal({ grades, settings, onClose, onDone }: any) {
  const [step, setStep] = useState(1);
  const [importType, setImportType] = useState<'specific' | 'full'>('specific');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [validationResults, setValidationResults] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: importSections } = useQuery({
    queryKey: ['sections', gradeId],
    queryFn: () => fetch(`/api/sections?grade_id=${gradeId}`).then(r => r.json()).then(r => r.data),
    enabled: !!gradeId,
  });

  // تقسيم الاسم الكامل إلى أجزاء: الأول + الأب + العائلة
  const splitFullName = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first_name: parts[0], father_name: '', last_name: '' };
    if (parts.length === 2) return { first_name: parts[0], father_name: '', last_name: parts[1] };
    return {
      first_name: parts[0],
      father_name: parts.slice(1, -1).join(' '),
      last_name: parts[parts.length - 1],
    };
  };

  // تحويل رقم الصف (مثل 0725) إلى اسم مقروء
  const gradeCodeToName = (code: string): string => {
    const num = parseInt(code.substring(0, 2));
    const gradeNames: Record<number, string> = {
      1: 'الأول ابتدائي', 2: 'الثاني ابتدائي', 3: 'الثالث ابتدائي',
      4: 'الرابع ابتدائي', 5: 'الخامس ابتدائي', 6: 'السادس ابتدائي',
      7: 'الأول متوسط', 8: 'الثاني متوسط', 9: 'الثالث متوسط',
      10: 'الأول ثانوي', 11: 'الثاني ثانوي', 12: 'الثالث ثانوي',
    };
    return gradeNames[num] || `الصف ${num}`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);

      // === كشف نوع الملف تلقائياً ===
      // دعم ملفات نظام نور (StudentGuidance): البيانات في Sheet2 بتنسيق خاص
      let rows: any[] = [];
      let isNoorFormat = false;

      if (workbook.SheetNames.length >= 2) {
        const sheet2 = workbook.Sheets[workbook.SheetNames[1]];
        const rawRows: any[] = XLSX.utils.sheet_to_json(sheet2, { header: 1 });
        // كشف صيغة نور: الصف 3 (index 3) فيه "اسم الطالب" و "رقم الطالب"
        const headerRow = rawRows[3];
        if (headerRow && (
          headerRow.includes('اسم الطالب') || headerRow.includes('رقم الطالب')
        )) {
          isNoorFormat = true;
          // البيانات تبدأ من الصف 4
          for (let i = 4; i < rawRows.length; i++) {
            const r = rawRows[i];
            if (!r || !r[5]) continue; // تخطي الصفوف الفارغة
            rows.push({
              'رقم الطالب': r[5],
              'اسم الطالب': r[4],
              'رقم الصف': r[3],
              'الفصل': r[2],
              'الجوال': r[1],
            });
          }
        }
      }

      // إذا ليس صيغة نور، اقرأ الشيت الأول بالطريقة العادية
      if (!isNoorFormat) {
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet);
      }

      if (rows.length === 0) { toast.error('الملف فارغ أو لا يحتوي بيانات طلاب'); return; }

      // === تحويل الأعمدة ===
      const mapped = rows.map((row: any) => {
        // دعم حقل الاسم الكامل (نظام نور) أو الأسماء المقسمة
        const fullName = String(row['اسم الطالب'] || row['اسم_الطالب'] || '').trim();
        let first_name = String(row['الاسم_الاول'] || row['الاسم الأول'] || row['first_name'] || '').trim();
        let father_name = String(row['اسم_الاب'] || row['اسم الأب'] || row['father_name'] || '').trim();
        let last_name = String(row['اسم_العائلة'] || row['اسم العائلة'] || row['last_name'] || '').trim();

        // إذا الاسم حقل واحد، قسّمه
        if (fullName && !first_name) {
          const split = splitFullName(fullName);
          first_name = split.first_name;
          father_name = split.father_name;
          last_name = split.last_name;
        }

        // رقم الهوية
        const student_id = String(row['رقم الطالب'] || row['رقم_الطالب'] || row['رقم_الهوية'] || row['رقم الهوية'] || row['student_id'] || row['id'] || '').trim();

        // رقم الصف: دعم أكواد نور (0725 → الأول متوسط)
        const gradeCode = String(row['رقم الصف'] || row['رقم_الصف'] || '').trim();
        const grade = gradeCode ? gradeCodeToName(gradeCode) : String(row['الصف'] || row['grade'] || '').trim();

        // الفصل (الشعبة)
        const section = String(row['الفصل'] || row['الشعبة'] || row['section'] || '').trim();

        // الجوال
        const phone = String(row['الجوال'] || row['رقم_الجوال'] || row['رقم الجوال'] || row['phone'] || '').trim();

        return { student_id, first_name, father_name, last_name, phone, grade, section };
      });

      setParsedData(mapped);

      // إذا الملف يحتوي صفوف وشعب، حوّل لـ "استيراد شامل" تلقائياً
      if (isNoorFormat || mapped.some(r => r.grade || r.section)) {
        setImportType('full');
      }

      // === التحقق ===
      const validated = mapped.map((row, i) => {
        const errors: string[] = [];
        if (!row.student_id || !/^\d{7,10}$/.test(row.student_id)) {
          errors.push('رقم الهوية غير صحيح');
        }
        if (!row.first_name) errors.push('الاسم مطلوب');
        return { ...row, rowNum: i + 1, errors, status: errors.length === 0 ? 'valid' : 'error' };
      });

      // كشف المكرر
      const seenIds = new Set<string>();
      validated.forEach(row => {
        if (row.status === 'valid') {
          if (seenIds.has(row.student_id)) {
            row.status = 'duplicate';
            row.errors.push('مكرر في الملف');
          } else {
            seenIds.add(row.student_id);
          }
        }
      });

      setValidationResults(validated);
      toast.success(`تم قراءة ${mapped.length} طالب من الملف`);
      setStep(4); // المعاينة
    } catch (err) {
      toast.error('خطأ في قراءة الملف');
    }
  };

  const handleImport = async () => {
    setImporting(true);
    const validRows = validationResults.filter(r => r.status === 'valid');
    const students = validRows.map(r => ({
      student_id: r.student_id,
      first_name: r.first_name,
      father_name: r.father_name,
      last_name: r.last_name,
      phone: r.phone || '',
      grade_name: r.grade || '',
      section_name: r.section || '',
    }));

    try {
      const res = await fetch('/api/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students,
          grade_id: importType === 'specific' ? parseInt(gradeId) : undefined,
          section_id: importType === 'specific' ? parseInt(sectionId) : undefined,
          auto_create_grades: importType === 'full',
        }),
      });
      if (!res.ok) throw new Error('Import failed');
      const result = await res.json();
      setImportResult(result.data);
      setStep(5);
      toast.success(`تم استيراد ${result.data.imported} طالب`);
    } catch (err) {
      toast.error('خطأ أثناء الاستيراد');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    import('xlsx').then(XLSX => {
      const headers = importType === 'specific'
        ? [{ 'رقم الهوية': '', 'الاسم الأول': '', 'اسم الأب': '', 'اسم العائلة': '', 'رقم الجوال': '' }]
        : [{ 'رقم الهوية': '', 'الاسم الأول': '', 'اسم الأب': '', 'اسم العائلة': '', 'الصف': '', 'الشعبة': '', 'رقم الجوال': '' }];
      const ws = XLSX.utils.json_to_sheet(headers);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
      XLSX.writeFile(wb, 'نموذج_استيراد_الطلاب.xlsx');
    });
  };

  const validCount = validationResults.filter(r => r.status === 'valid').length;
  const errorCount = validationResults.filter(r => r.status === 'error').length;
  const duplicateCount = validationResults.filter(r => r.status === 'duplicate').length;

  return (
    <Modal isOpen={true} onClose={onClose} title="استيراد طلاب من Excel" maxWidth="max-w-2xl">
      {/* Step 1: Choose type */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">اختر طريقة الاستيراد:</p>
          <label className={`flex gap-3 p-4 rounded-lg border-2 cursor-pointer ${importType === 'specific' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
            <input type="radio" checked={importType === 'specific'} onChange={() => setImportType('specific')} />
            <div>
              <p className="font-medium">استيراد لشعبة محددة</p>
              <p className="text-sm text-gray-500">حدد الصف والشعبة، ثم ارفع الملف. الأعمدة المطلوبة: الهوية والاسم فقط</p>
            </div>
          </label>
          <label className={`flex gap-3 p-4 rounded-lg border-2 cursor-pointer ${importType === 'full' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
            <input type="radio" checked={importType === 'full'} onChange={() => setImportType('full')} />
            <div>
              <p className="font-medium">استيراد شامل</p>
              <p className="text-sm text-gray-500">ارفع ملف يحتوي الصف والشعبة لكل طالب داخل الأعمدة</p>
            </div>
          </label>
          <div className="flex justify-end">
            <button onClick={() => setStep(importType === 'specific' ? 2 : 3)} className="btn-primary">التالي</button>
          </div>
        </div>
      )}

      {/* Step 2: Choose section (specific only) */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="label">الصف *</label>
            <select value={gradeId} onChange={e => { setGradeId(e.target.value); setSectionId(''); }} className="input">
              <option value="">اختر الصف</option>
              {grades.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">الشعبة *</label>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)} className="input" disabled={!gradeId}>
              <option value="">اختر الشعبة</option>
              {(importSections || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="btn-secondary">السابق</button>
            <button onClick={() => setStep(3)} disabled={!gradeId || !sectionId} className="btn-primary">التالي</button>
          </div>
        </div>
      )}

      {/* Step 3: Upload file */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => fileInputRef.current?.click()}>
            <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">اسحب ملف Excel هنا أو اضغط للاختيار</p>
            <p className="text-sm text-gray-400 mt-1">الصيغ: .xlsx, .xls, .csv</p>
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
          <button onClick={downloadTemplate} className="text-blue-600 text-sm hover:underline flex items-center gap-1">
            <Download className="w-3 h-3" /> تحميل نموذج Excel
          </button>
          <div className="flex justify-between">
            <button onClick={() => setStep(importType === 'specific' ? 2 : 1)} className="btn-secondary">السابق</button>
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex items-center gap-2 text-green-600"><CheckCircle className="w-4 h-4" /> {validCount} صحيح</div>
            <div className="flex items-center gap-2 text-red-600"><XCircle className="w-4 h-4" /> {errorCount} خطأ</div>
            <div className="flex items-center gap-2 text-yellow-600"><AlertTriangle className="w-4 h-4" /> {duplicateCount} مكرر</div>
          </div>

          <div className="max-h-80 overflow-y-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-right">الحالة</th>
                  <th className="px-3 py-2 text-right">رقم الهوية</th>
                  <th className="px-3 py-2 text-right">الاسم</th>
                  <th className="px-3 py-2 text-right">الخطأ</th>
                </tr>
              </thead>
              <tbody>
                {validationResults.map((r, i) => (
                  <tr key={i} className={`border-b ${r.status === 'error' ? 'bg-red-50' : r.status === 'duplicate' ? 'bg-yellow-50' : ''}`}>
                    <td className="px-3 py-2">
                      {r.status === 'valid' && <CheckCircle className="w-4 h-4 text-green-500" />}
                      {r.status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
                      {r.status === 'duplicate' && <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.student_id}</td>
                    <td className="px-3 py-2">{r.first_name} {r.father_name} {r.last_name}</td>
                    <td className="px-3 py-2 text-red-600 text-xs">{r.errors.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(3)} className="btn-secondary">السابق</button>
            <button onClick={handleImport} disabled={importing || validCount === 0} className="btn-primary flex items-center gap-2">
              <Upload className="w-4 h-4" />
              {importing ? 'جاري الاستيراد...' : `استيراد ${validCount} طالب`}
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Result */}
      {step === 5 && importResult && (
        <div className="space-y-4 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h3 className="text-xl font-bold">تم الاستيراد بنجاح</h3>
          <div className="flex gap-6 justify-center">
            <div><p className="text-2xl font-bold text-green-600">{importResult.imported}</p><p className="text-sm text-gray-500">تم استيرادهم</p></div>
            <div><p className="text-2xl font-bold text-yellow-600">{importResult.skipped}</p><p className="text-sm text-gray-500">تم تخطيهم</p></div>
            <div><p className="text-2xl font-bold text-red-600">{importResult.errors?.length || 0}</p><p className="text-sm text-gray-500">أخطاء</p></div>
          </div>
          {importResult.errors?.length > 0 && (
            <div className="text-right bg-red-50 p-3 rounded-lg max-h-32 overflow-y-auto">
              {importResult.errors.map((e: string, i: number) => <p key={i} className="text-sm text-red-600">{e}</p>)}
            </div>
          )}
          <button onClick={onDone} className="btn-primary">إغلاق</button>
        </div>
      )}
    </Modal>
  );
}
