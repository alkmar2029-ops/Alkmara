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

// Custody options — keyed labels match the backend enum in
// lib/validations/schemas.ts (CUSTODY_TYPES).
const CUSTODY_OPTIONS: { code: string; label: string; emoji: string }[] = [
  { code: 'father',    label: 'وصاية الوالد',  emoji: '👨' },
  { code: 'mother',    label: 'وصاية الوالدة', emoji: '👩' },
  { code: 'shared',    label: 'وصاية مشتركة',  emoji: '👨‍👩‍👧' },
  { code: 'guardian',  label: 'وصاية أخرى',    emoji: '👤' },
  { code: 'other',     label: 'حالة أخرى',     emoji: '📋' },
];

const DOCS_OPTIONS: { code: string; label: string; emoji: string; tone: string }[] = [
  { code: 'verified', label: 'مكتملة',  emoji: '✅', tone: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40' },
  { code: 'pending',  label: 'قيد المتابعة', emoji: '⏳', tone: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/40' },
  { code: 'missing',  label: 'ناقصة',  emoji: '⚠️', tone: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/40' },
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
    // social_info JSONB — see lib/validations/schemas.ts → studentSocialInfoSchema.
    // Editing the pickup arrays as comma-separated text in the UI keeps
    // the form one-shot. We split/trim on submit before sending.
    custody_type: (student?.social_info?.custody_type || '') as string,
    documentation_status: (student?.social_info?.documentation_status || '') as string,
    authorized_pickup_text: ((student?.social_info?.authorized_pickup as string[] | undefined) || []).join('، '),
    blocked_pickup_text: ((student?.social_info?.blocked_pickup as string[] | undefined) || []).join('، '),
    court_ref: (student?.social_info?.court_ref || '') as string,
    emergency_name: (student?.social_info?.emergency_contact?.name || '') as string,
    emergency_phone: (student?.social_info?.emergency_contact?.phone || '') as string,
    emergency_relation: (student?.social_info?.emergency_contact?.relation || '') as string,
    social_notes: (student?.social_info?.notes || '') as string,
  });

  // The custody section is large; keep collapsed by default to keep the
  // modal scannable. Pre-expand when editing a student that already has
  // custody info so the user sees it immediately.
  const [socialOpen, setSocialOpen] = useState<boolean>(!!student?.social_info);

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

    // Build social_info — null when truly empty so the column stays NULL
    // and partial-index queries (custody_type, documentation_status) keep
    // working. Comma-separated arrays come back trimmed and de-duplicated.
    const splitNames = (s: string) =>
      s.split(/[،,\n]/).map((x) => x.trim()).filter((x) => x.length > 0);
    const authorized_pickup = splitNames(form.authorized_pickup_text);
    const blocked_pickup = splitNames(form.blocked_pickup_text);
    const emergency_contact = (form.emergency_name.trim() || form.emergency_phone.trim() || form.emergency_relation.trim())
      ? {
          name: form.emergency_name.trim() || undefined,
          phone: form.emergency_phone.trim() || undefined,
          relation: form.emergency_relation.trim() || undefined,
        }
      : null;
    const hasSocial = !!(
      form.custody_type
      || form.documentation_status
      || authorized_pickup.length > 0
      || blocked_pickup.length > 0
      || form.court_ref.trim()
      || emergency_contact
      || form.social_notes.trim()
    );
    const social_info = hasSocial
      ? {
          custody_type: form.custody_type || undefined,
          documentation_status: form.documentation_status || undefined,
          authorized_pickup,
          blocked_pickup,
          court_ref: form.court_ref.trim() || undefined,
          emergency_contact,
          notes: form.social_notes.trim() || undefined,
        }
      : null;

    const {
      health_conditions: _hc, health_notes: _hn,
      custody_type: _ct, documentation_status: _ds,
      authorized_pickup_text: _ap, blocked_pickup_text: _bp,
      court_ref: _cr, emergency_name: _en, emergency_phone: _ep,
      emergency_relation: _er, social_notes: _sn,
      ...rest
    } = form;
    onSubmit({
      ...rest,
      grade_id: parseInt(form.grade_id) || 0,
      section_id: parseInt(form.section_id) || 0,
      health_info,
      social_info,
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

        {/* Social/custody — collapsed by default. Surfaces in dismissals
            to enforce pickup restrictions and in student detail for staff
            review. Sensitive — only admin/staff see it. */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
          <button
            type="button"
            onClick={() => setSocialOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-right p-2 -m-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            <span className="label flex items-center gap-1.5 m-0">
              <span>👨‍👩‍👧 الحالة الاجتماعية / الوصاية</span>
              <span className="text-[10px] text-gray-400 font-normal">(اختياري — يفعّل قيود الاستئذان)</span>
            </span>
            <span className="text-xs text-gray-500">{socialOpen ? '▲' : '▼'}</span>
          </button>

          {socialOpen && (
            <div className="space-y-3 mt-2">
              {/* Custody type — single-pick chips */}
              <div>
                <label className="label text-xs">نوع الوصاية</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {CUSTODY_OPTIONS.map((opt) => {
                    const checked = form.custody_type === opt.code;
                    return (
                      <label
                        key={opt.code}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors border ${
                          checked
                            ? 'bg-indigo-50 dark:bg-indigo-500/15 border-indigo-300 dark:border-indigo-500/40 text-indigo-800 dark:text-indigo-300'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                        }`}
                      >
                        <input
                          type="radio"
                          name="custody_type"
                          checked={checked}
                          onChange={() => setForm({ ...form, custody_type: checked ? '' : opt.code })}
                          className="w-3.5 h-3.5"
                        />
                        <span>{opt.emoji} {opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Documentation status */}
              <div>
                <label className="label text-xs">حالة الوثائق (الصك / المستندات)</label>
                <div className="flex flex-wrap gap-1.5">
                  {DOCS_OPTIONS.map((opt) => {
                    const checked = form.documentation_status === opt.code;
                    return (
                      <label
                        key={opt.code}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors border ${
                          checked ? opt.tone : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                        }`}
                      >
                        <input
                          type="radio"
                          name="documentation_status"
                          checked={checked}
                          onChange={() => setForm({ ...form, documentation_status: checked ? '' : opt.code })}
                          className="w-3.5 h-3.5"
                        />
                        <span>{opt.emoji} {opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Authorized + blocked pickup */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs flex items-center gap-1">
                    <span>✅ مسموح بالاستلام</span>
                    <span className="text-[10px] text-gray-400">(افصل بفاصلة)</span>
                  </label>
                  <textarea
                    value={form.authorized_pickup_text}
                    onChange={(e) => setForm({ ...form, authorized_pickup_text: e.target.value })}
                    rows={2}
                    placeholder="مثلاً: الوالد، الوالدة، العم محمد"
                    className="input text-sm"
                    maxLength={1000}
                  />
                </div>
                <div>
                  <label className="label text-xs flex items-center gap-1 text-red-700 dark:text-red-400">
                    <span>🛑 ممنوع الاستلام</span>
                    <span className="text-[10px] text-red-400/70">(افصل بفاصلة)</span>
                  </label>
                  <textarea
                    value={form.blocked_pickup_text}
                    onChange={(e) => setForm({ ...form, blocked_pickup_text: e.target.value })}
                    rows={2}
                    placeholder="مثلاً: الوالد"
                    className="input text-sm border-red-200 dark:border-red-500/30 focus:border-red-400 focus:ring-red-400"
                    maxLength={1000}
                  />
                </div>
              </div>

              {/* Court reference */}
              <div>
                <label className="label text-xs">📄 رقم الصك / المرجع القضائي</label>
                <input
                  value={form.court_ref}
                  onChange={(e) => setForm({ ...form, court_ref: e.target.value })}
                  placeholder="مثلاً: صك حضانة رقم 12345"
                  className="input"
                  maxLength={100}
                />
              </div>

              {/* Emergency contact */}
              <div>
                <label className="label text-xs">📞 جهة اتصال طوارئ بديلة</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    value={form.emergency_name}
                    onChange={(e) => setForm({ ...form, emergency_name: e.target.value })}
                    placeholder="الاسم"
                    className="input text-sm"
                    maxLength={100}
                  />
                  <input
                    value={form.emergency_phone}
                    onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })}
                    placeholder="الجوال"
                    className="input text-sm font-mono"
                    dir="ltr"
                    maxLength={20}
                  />
                  <input
                    value={form.emergency_relation}
                    onChange={(e) => setForm({ ...form, emergency_relation: e.target.value })}
                    placeholder="صلة القرابة"
                    className="input text-sm"
                    maxLength={50}
                  />
                </div>
              </div>

              {/* Sensitive notes */}
              <div>
                <label className="label text-xs">🔒 ملاحظات سرية (للأدمن فقط)</label>
                <textarea
                  value={form.social_notes}
                  onChange={(e) => setForm({ ...form, social_notes: e.target.value })}
                  rows={2}
                  placeholder="ملاحظات حساسة لا تُعرض للمعلمين"
                  className="input text-sm"
                  maxLength={1000}
                />
              </div>
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
