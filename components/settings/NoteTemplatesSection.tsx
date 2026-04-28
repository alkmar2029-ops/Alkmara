'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageSquarePlus, Pencil, Trash2, ThumbsUp, ThumbsDown, Tag, X, Save, Plus,
  Shield, GraduationCap, Users as UsersIcon,
} from 'lucide-react';
import type { NoteTemplate, NoteType, NoteCategory, NoteAudience } from '@/lib/types/database';

const CATEGORY_LABELS: Record<NoteCategory, string> = {
  academic:      'أكاديمي',
  behavior:      'سلوكي',
  attendance:    'حضور',
  participation: 'مشاركة',
  general:       'عام',
};
const AUDIENCE_LABELS: Record<NoteAudience, string> = {
  admin:   'الإدارة فقط',
  teacher: 'المعلم فقط',
  both:    'الكل',
};

const CATEGORY_OPTIONS: NoteCategory[] = ['academic', 'behavior', 'attendance', 'participation', 'general'];
const AUDIENCE_OPTIONS: NoteAudience[] = ['both', 'admin', 'teacher'];

interface FormState {
  text: string;
  type: NoteType;
  category: NoteCategory;
  audience: NoteAudience;
  icon: string;
  is_active: boolean;
  sort_order: number;
}

const emptyForm = (type: NoteType): FormState => ({
  text: '',
  type,
  category: 'general',
  audience: 'both',
  icon: '',
  is_active: true,
  sort_order: 0,
});

export default function NoteTemplatesSection() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<NoteType>('positive');
  const [audienceFilter, setAudienceFilter] = useState<NoteAudience | 'all'>('all');
  const [editing, setEditing] = useState<NoteTemplate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm('positive'));

  const { data: templates = [], isLoading, isError } = useQuery<NoteTemplate[]>({
    queryKey: ['note-templates'],
    queryFn: async () => {
      const r = await fetch('/api/note-templates');
      if (!r.ok) throw new Error('فشل تحميل القوالب');
      return (await r.json()).data;
    },
  });

  const createMut = useMutation({
    mutationFn: async (data: FormState) => {
      const r = await fetch('/api/note-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الإضافة');
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['note-templates'] });
      toast.success('تمت إضافة القالب');
      closeForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FormState> }) => {
      const r = await fetch(`/api/note-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل التعديل');
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['note-templates'] });
      toast.success('تم التعديل');
      closeForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/note-templates/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الحذف');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['note-templates'] });
      toast.success('تم الحذف');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const tabTemplates = templates
    .filter((t) => t.type === activeTab)
    .filter((t) => audienceFilter === 'all' || (t.audience ?? 'both') === audienceFilter);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm(activeTab));
    setShowForm(true);
  };

  const openEdit = (t: NoteTemplate) => {
    setEditing(t);
    setForm({
      text: t.text,
      type: t.type,
      category: t.category,
      audience: t.audience ?? 'both',
      icon: t.icon ?? '',
      is_active: t.is_active,
      sort_order: t.sort_order,
    });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditing(null); };

  const submit = () => {
    if (!form.text.trim()) { toast.error('نص الملاحظة مطلوب'); return; }
    if (editing) updateMut.mutate({ id: editing.id, data: form });
    else createMut.mutate(form);
  };

  const onDelete = (t: NoteTemplate) => {
    if (!confirm(`حذف القالب "${t.text}"؟`)) return;
    deleteMut.mutate(t.id);
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <MessageSquarePlus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            قوالب الملاحظات
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            عبارات جاهزة تظهر للمعلم عند تسجيل ملاحظة على الطالب — لتسريع الإدخال وتوحيد الصياغة.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="btn-primary text-sm inline-flex items-center gap-1 shrink-0"
        >
          <Plus className="w-4 h-4" /> إضافة
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800 mb-4">
        <TabButton
          active={activeTab === 'positive'}
          onClick={() => setActiveTab('positive')}
          tone="green"
          Icon={ThumbsUp}
          label="إيجابية"
          count={templates.filter((t) => t.type === 'positive').length}
        />
        <TabButton
          active={activeTab === 'negative'}
          onClick={() => setActiveTab('negative')}
          tone="red"
          Icon={ThumbsDown}
          label="سلبية"
          count={templates.filter((t) => t.type === 'negative').length}
        />
      </div>

      {/* Audience filter — pill row */}
      <div className="flex flex-wrap gap-1.5 mb-3 text-xs">
        <span className="text-gray-500 dark:text-gray-400 me-1 self-center">الجمهور:</span>
        <AudiencePill active={audienceFilter === 'all'} onClick={() => setAudienceFilter('all')} Icon={UsersIcon} label="الكل" />
        <AudiencePill active={audienceFilter === 'both'} onClick={() => setAudienceFilter('both')} Icon={UsersIcon} label="مشترك" />
        <AudiencePill active={audienceFilter === 'admin'} onClick={() => setAudienceFilter('admin')} Icon={Shield} label="إدارة فقط" />
        <AudiencePill active={audienceFilter === 'teacher'} onClick={() => setAudienceFilter('teacher')} Icon={GraduationCap} label="معلم فقط" />
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">جارٍ التحميل...</p>
      ) : isError ? (
        <p className="text-center text-red-600 dark:text-red-400 py-8 text-sm">فشل التحميل</p>
      ) : tabTemplates.length === 0 ? (
        <p className="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">
          لا توجد قوالب. اضغط <strong>إضافة</strong> لإنشاء أول قالب.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {tabTemplates.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <span className="text-xl shrink-0 w-8 text-center">{t.icon || '•'}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-gray-900 dark:text-gray-100 ${!t.is_active ? 'line-through opacity-60' : ''}`}>
                  {t.text}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
                    <Tag className="w-3 h-3" /> {CATEGORY_LABELS[t.category]}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                    (t.audience ?? 'both') === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400' :
                    (t.audience ?? 'both') === 'teacher' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' :
                    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                  }`}>
                    {(t.audience ?? 'both') === 'admin' ? <Shield className="w-3 h-3" /> :
                     (t.audience ?? 'both') === 'teacher' ? <GraduationCap className="w-3 h-3" /> :
                     <UsersIcon className="w-3 h-3" />}
                    {AUDIENCE_LABELS[t.audience ?? 'both']}
                  </span>
                  {!t.is_active && <span className="text-yellow-600 dark:text-yellow-400">معطّل</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEdit(t)}
                  className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                  title="تعديل"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDelete(t)}
                  className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15"
                  title="حذف"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Form modal — kept inline to avoid a separate Modal import */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={closeForm}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h4 className="font-semibold">{editing ? 'تعديل قالب' : 'قالب جديد'}</h4>
              <button onClick={closeForm} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="label">النص *</label>
                <textarea
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="مثال: متفوق في إنجاز الواجبات"
                  maxLength={300}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{form.text.length}/300</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">النوع</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as NoteType })}
                    className="input"
                  >
                    <option value="positive">إيجابية</option>
                    <option value="negative">سلبية</option>
                  </select>
                </div>
                <div>
                  <label className="label">التصنيف</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as NoteCategory })}
                    className="input"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">الجمهور</label>
                <select
                  value={form.audience}
                  onChange={(e) => setForm({ ...form, audience: e.target.value as NoteAudience })}
                  className="input"
                >
                  {AUDIENCE_OPTIONS.map((a) => (
                    <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  من يرى هذا القالب عند تسجيل الملاحظة
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">الأيقونة (اختياري)</label>
                  <input
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    className="input text-center text-xl"
                    placeholder="⭐"
                    maxLength={4}
                  />
                </div>
                <div>
                  <label className="label">ترتيب الظهور</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: +e.target.value })}
                    className="input"
                    min={0}
                    max={9999}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                مفعّل (يظهر للمعلمين عند التسجيل)
              </label>
            </div>
            <div className="flex gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
              <button
                onClick={submit}
                disabled={createMut.isPending || updateMut.isPending}
                className="btn-primary flex-1 inline-flex items-center justify-center gap-1"
              >
                <Save className="w-4 h-4" />
                {editing ? 'حفظ' : 'إضافة'}
              </button>
              <button onClick={closeForm} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AudiencePill({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border transition-colors ${
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

function TabButton({ active, onClick, tone, Icon, label, count }: {
  active: boolean;
  onClick: () => void;
  tone: 'green' | 'red';
  Icon: any;
  label: string;
  count: number;
}) {
  const activeCls =
    tone === 'green'
      ? 'border-green-500 text-green-700 dark:text-green-400'
      : 'border-red-500 text-red-700 dark:text-red-400';
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 -mb-px border-b-2 transition-colors ${
        active ? activeCls : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">{count}</span>
    </button>
  );
}
