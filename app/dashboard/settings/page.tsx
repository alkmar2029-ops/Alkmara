'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Settings, Save } from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';

const STAGES = [
  { value: 'elementary', label: 'ابتدائي', desc: 'الصف الأول إلى السادس' },
  { value: 'middle', label: 'متوسط', desc: 'الصف الأول إلى الثالث' },
  { value: 'secondary', label: 'ثانوي', desc: 'الصف الأول إلى الثالث' },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);

  const { data: settings, isLoading, isError, error } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('فشل في تحميل الإعدادات');
      const r = await res.json();
      return r.data;
    },
  });

  // Only set form when data first loads
  useEffect(() => {
    if (settings && !form) {
      setForm({
        school_name: settings.school_name || '',
        principal_name: settings.principal_name || '',
        phone: settings.phone || '',
        academic_year: settings.academic_year || '2025-2026',
        stage: settings.stage || 'elementary',
        section_type: settings.section_type || 'letters',
      });
    }
  }, [settings, form]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'فشل في حفظ الإعدادات');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('تم حفظ الإعدادات');
      // Don't reset form to null - let it keep current values until refetch updates
    },
    onError: (err: any) => toast.error(err.message || 'حدث خطأ أثناء حفظ الإعدادات'),
  });

  if (isLoading) return <SkeletonPage />;

  if (isError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
        {(error as Error)?.message || 'حدث خطأ أثناء تحميل الإعدادات'}
      </div>
    );
  }

  // While form is being initialized from settings data
  if (!form) return <SkeletonPage />;

  // Check if form has unsaved changes
  const hasUnsavedChanges = settings && (
    form.school_name !== (settings.school_name || '') ||
    form.principal_name !== (settings.principal_name || '') ||
    form.phone !== (settings.phone || '') ||
    form.academic_year !== (settings.academic_year || '2025-2026') ||
    form.stage !== (settings.stage || 'elementary') ||
    form.section_type !== (settings.section_type || 'letters')
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Settings className="w-7 h-7 text-gray-400" />
        <h2 className="text-2xl font-bold">إعدادات المدرسة</h2>
      </div>

      {!settings?.school_name && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 text-sm">
          يرجى إكمال إعدادات المدرسة أولاً للبدء في استخدام النظام
        </div>
      )}

      {/* معلومات المدرسة */}
      <div className="card">
        <h3 className="font-semibold text-lg mb-4">معلومات المدرسة</h3>
        <div className="space-y-4">
          <div>
            <label className="label">اسم المدرسة *</label>
            <input value={form.school_name} onChange={e => setForm({ ...form, school_name: e.target.value })}
              className="input" placeholder="مثال: مدرسة الملك فهد الابتدائية" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">اسم المدير</label>
              <input value={form.principal_name} onChange={e => setForm({ ...form, principal_name: e.target.value })}
                className="input" placeholder="اسم مدير المدرسة" />
            </div>
            <div>
              <label className="label">هاتف المدرسة</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="input" placeholder="05xxxxxxxx" />
            </div>
          </div>
          <div>
            <label className="label">العام الدراسي</label>
            <select value={form.academic_year} onChange={e => setForm({ ...form, academic_year: e.target.value })} className="input">
              <option value="2024-2025">2024-2025</option>
              <option value="2025-2026">2025-2026</option>
              <option value="2026-2027">2026-2027</option>
            </select>
          </div>
        </div>
      </div>

      {/* المرحلة الدراسية */}
      <div className="card">
        <h3 className="font-semibold text-lg mb-4">المرحلة الدراسية</h3>
        <div className="space-y-3">
          {STAGES.map(stage => (
            <label key={stage.value}
              className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                form.stage === stage.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              }`}>
              <input type="radio" name="stage" value={stage.value} checked={form.stage === stage.value}
                onChange={e => setForm({ ...form, stage: e.target.value })}
                className="w-4 h-4 text-blue-600" />
              <div>
                <p className="font-medium">{stage.label}</p>
                <p className="text-sm text-gray-500">{stage.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* نوع تصنيف الشعب */}
      <div className="card">
        <h3 className="font-semibold text-lg mb-4">نوع تصنيف الشعب</h3>
        <div className="flex gap-4">
          <label className={`flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
            form.section_type === 'letters' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" name="section_type" value="letters" checked={form.section_type === 'letters'}
              onChange={e => setForm({ ...form, section_type: e.target.value })} className="w-4 h-4 text-blue-600" />
            <div>
              <p className="font-medium">حروف</p>
              <p className="text-sm text-gray-500">أ ، ب ، ج ، د ...</p>
            </div>
          </label>
          <label className={`flex-1 flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
            form.section_type === 'numbers' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" name="section_type" value="numbers" checked={form.section_type === 'numbers'}
              onChange={e => setForm({ ...form, section_type: e.target.value })} className="w-4 h-4 text-blue-600" />
            <div>
              <p className="font-medium">أرقام</p>
              <p className="text-sm text-gray-500">1 ، 2 ، 3 ، 4 ...</p>
            </div>
          </label>
        </div>
      </div>

      <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending || !form.school_name}
        className="btn-primary flex items-center gap-2 relative">
        <Save className="w-4 h-4" />
        {saveMutation.isPending ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
        {hasUnsavedChanges && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full" />
        )}
      </button>
    </div>
  );
}
