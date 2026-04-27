'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Settings, Save, Clock } from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import NoteTemplatesSection from '@/components/settings/NoteTemplatesSection';

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
      // The DB column is TIME and may come back as 'HH:MM:SS' — trim seconds.
      const rawStart = (settings.school_start_time || '06:45') as string;
      const startTime = /^\d{2}:\d{2}:\d{2}$/.test(rawStart) ? rawStart.slice(0, 5) : rawStart;
      setForm({
        school_name: settings.school_name || '',
        principal_name: settings.principal_name || '',
        phone: settings.phone || '',
        academic_year: settings.academic_year || '2025-2026',
        stage: settings.stage || 'elementary',
        section_type: settings.section_type || 'letters',
        school_start_time: startTime,
        late_threshold: settings.late_threshold ?? 15,
        absent_threshold: settings.absent_threshold ?? 45,
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
      <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-4 text-red-700 dark:text-red-400 text-sm">
        {(error as Error)?.message || 'حدث خطأ أثناء تحميل الإعدادات'}
      </div>
    );
  }

  // While form is being initialized from settings data
  if (!form) return <SkeletonPage />;

  // Normalize 'HH:MM:SS' → 'HH:MM' for comparison since DB returns seconds.
  const dbStart = settings
    ? (/^\d{2}:\d{2}:\d{2}$/.test(settings.school_start_time || '')
        ? (settings.school_start_time as string).slice(0, 5)
        : (settings.school_start_time || '06:45'))
    : '06:45';

  // Check if form has unsaved changes
  const hasUnsavedChanges = settings && (
    form.school_name !== (settings.school_name || '') ||
    form.principal_name !== (settings.principal_name || '') ||
    form.phone !== (settings.phone || '') ||
    form.academic_year !== (settings.academic_year || '2025-2026') ||
    form.stage !== (settings.stage || 'elementary') ||
    form.section_type !== (settings.section_type || 'letters') ||
    form.school_start_time !== dbStart ||
    form.late_threshold !== (settings.late_threshold ?? 15) ||
    form.absent_threshold !== (settings.absent_threshold ?? 45)
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Settings className="w-7 h-7 text-gray-400 dark:text-gray-500" />
        <h2 className="text-2xl font-bold">إعدادات المدرسة</h2>
      </div>

      {!settings?.school_name && (
        <div className="bg-yellow-50 dark:bg-yellow-500/15 border border-yellow-200 dark:border-yellow-500/30 rounded-lg p-4 text-yellow-800 dark:text-yellow-200 text-sm">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                form.stage === stage.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15'
                  : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
              }`}>
              <input type="radio" name="stage" value={stage.value} checked={form.stage === stage.value}
                onChange={e => setForm({ ...form, stage: e.target.value })}
                className="w-4 h-4 text-blue-600" />
              <div>
                <p className="font-medium">{stage.label}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{stage.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* الدوام والتأخير */}
      <div className="card">
        <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          الدوام واحتساب التأخير
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          وقت الدوام يُستخدم كقيمة افتراضية لاحتساب التأخير عند سحب البصمات من الأجهزة، ما لم يكن للشُعبة جدول حصص خاص بها.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">وقت الدوام (24 ساعة)</label>
            <input
              type="time"
              value={form.school_start_time}
              onChange={e => setForm({ ...form, school_start_time: e.target.value })}
              className="input"
              step="60"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              يُحسب التأخير من هذا الوقت (مثلاً 06:45)
            </p>
          </div>
          <div>
            <label className="label">سماح التأخير (دقائق)</label>
            <input
              type="number"
              min={1}
              max={120}
              value={form.late_threshold}
              onChange={e => setForm({ ...form, late_threshold: +e.target.value })}
              className="input"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">أقل من هذه القيمة = حاضر</p>
          </div>
          <div>
            <label className="label">حد الغياب (دقائق)</label>
            <input
              type="number"
              min={1}
              max={240}
              value={form.absent_threshold}
              onChange={e => setForm({ ...form, absent_threshold: +e.target.value })}
              className="input"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">أكثر من هذه القيمة = غائب</p>
          </div>
        </div>
      </div>

      {/* نوع تصنيف الشعب */}
      <div className="card">
        <h3 className="font-semibold text-lg mb-4">نوع تصنيف الشعب</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
            form.section_type === 'letters'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15'
              : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
          }`}>
            <input type="radio" name="section_type" value="letters" checked={form.section_type === 'letters'}
              onChange={e => setForm({ ...form, section_type: e.target.value })} className="w-4 h-4 text-blue-600" />
            <div>
              <p className="font-medium">حروف</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">أ ، ب ، ج ، د ...</p>
            </div>
          </label>
          <label className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
            form.section_type === 'numbers'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15'
              : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
          }`}>
            <input type="radio" name="section_type" value="numbers" checked={form.section_type === 'numbers'}
              onChange={e => setForm({ ...form, section_type: e.target.value })} className="w-4 h-4 text-blue-600" />
            <div>
              <p className="font-medium">أرقام</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">1 ، 2 ، 3 ، 4 ...</p>
            </div>
          </label>
        </div>
      </div>

      <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending || !form.school_name}
        className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2 relative">
        <Save className="w-4 h-4" />
        {saveMutation.isPending ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
        {hasUnsavedChanges && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full" />
        )}
      </button>

      {/* Note templates — admin-managed list of canned positive/negative notes */}
      <NoteTemplatesSection />
    </div>
  );
}
