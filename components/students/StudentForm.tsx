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
