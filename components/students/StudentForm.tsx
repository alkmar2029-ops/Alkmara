'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';

interface StudentFormProps {
  student: any;
  grades: any[];
  settings: any;
  loading: boolean;
  onSubmit: (_data: any) => void;
  onClose: () => void;
}

// Curated list of common health conditions to surface as quick checkboxes.
// "other" + the free-text notes field cover anything not on the list.
const HEALTH_OPTIONS: { code: string; label: string; emoji: string }[] = [
  { code: 'diabetes',     label: 'السكري',       emoji: '🩸' },
  { code: 'hypertension', label: 'الضغط',         emoji: '💓' },
  { code: 'heart',        label: 'مشاكل القلب',   emoji: '❤️' },
  { code: 'asthma',       label: 'الربو',         emoji: '🫁' },
  { code: 'allergy',      label: 'حساسية',        emoji: '🌾' },
  { code: 'epilepsy',     label: 'الصرع',         emoji: '⚡' },
  { code: 'vision',       label: 'مشاكل البصر',   emoji: '👁️' },
  { code: 'hearing',      label: 'مشاكل السمع',   emoji: '👂' },
  { code: 'other',        label: 'أخرى',          emoji: '📋' },
];

export default function StudentForm({ student, grades, onSubmit, onClose, loading }: StudentFormProps) {
  const [form, setForm] = useState({
    student_id: student?.student_id || '',
    first_name: student?.first_name || '',
    father_name: student?.father_name || '',
    last_name: student?.last_name || '',
    grade_id: student?.grade_id || '',
    section_id: student?.section_id || '',
    phone: student?.phone || '',
    notes: student?.notes || '',
    // health_info JSONB: { conditions: ["diabetes", ...], notes: "..." }
    health_conditions: (student?.health_info?.conditions || []) as string[],
    health_notes: (student?.health_info?.notes || '') as string,
  });

  const { data: formSections } = useQuery({
    queryKey: ['sections', form.grade_id],
    queryFn: () => fetch(`/api/sections?grade_id=${form.grade_id}`).then(r => r.json()).then(r => r.data),
    enabled: !!form.grade_id,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (String(form.student_id).length !== 10) { toast.error('رقم الهوية يجب أن يكون 10 أرقام'); return; }
    // Build the JSONB health_info — null if nothing was entered so we
    // don't pollute the column with empty objects.
    const hasHealth = form.health_conditions.length > 0 || form.health_notes.trim().length > 0;
    const health_info = hasHealth
      ? { conditions: form.health_conditions, notes: form.health_notes.trim() || undefined }
      : null;
    const { health_conditions: _hc, health_notes: _hn, ...rest } = form;
    onSubmit({
      ...rest,
      grade_id: parseInt(form.grade_id) || 0,
      section_id: parseInt(form.section_id) || 0,
      health_info,
    });
  };

  const toggleCondition = (code: string) => {
    setForm((prev) => ({
      ...prev,
      health_conditions: prev.health_conditions.includes(code)
        ? prev.health_conditions.filter((c) => c !== code)
        : [...prev.health_conditions, code],
    }));
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

        {/* Health conditions — surfaces in dismissals and student detail
            so emergency-response staff can see at a glance. Optional. */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
          <label className="label flex items-center gap-1.5">
            <span>🏥 الحالات الصحية</span>
            <span className="text-[10px] text-gray-400 font-normal">(اختياري — يُعرض في حال الاستئذان والطوارئ)</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">
            {HEALTH_OPTIONS.map((opt) => {
              const checked = form.health_conditions.includes(opt.code);
              return (
                <label
                  key={opt.code}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors border ${
                    checked
                      ? 'bg-red-50 dark:bg-red-500/15 border-red-300 dark:border-red-500/40 text-red-800 dark:text-red-300'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCondition(opt.code)}
                    className="w-3.5 h-3.5"
                  />
                  <span>{opt.emoji} {opt.label}</span>
                </label>
              );
            })}
          </div>
          {(form.health_conditions.length > 0 || form.health_notes) && (
            <div className="mt-2">
              <label className="label text-xs">تفاصيل الحالة الصحية</label>
              <textarea
                value={form.health_notes}
                onChange={(e) => setForm({ ...form, health_notes: e.target.value })}
                rows={2}
                placeholder="مثلاً: يحتاج إنسولين قبل الوجبات، رقم الطبيب 050xxxxxxx، إلخ."
                className="input text-sm"
                maxLength={500}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1 w-full sm:w-auto">{loading ? 'جاري الحفظ...' : 'حفظ'}</button>
          <button type="button" onClick={onClose} className="btn-secondary w-full sm:w-auto">إلغاء</button>
        </div>
      </form>
    </Modal>
  );
}
