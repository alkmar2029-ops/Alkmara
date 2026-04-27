'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FileText, Save, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { TEMPLATE_PLACEHOLDERS, renderTemplate } from '@/lib/whatsapp/template';

interface MessageTemplate {
  id: number;
  name: string;
  description: string | null;
  body: string;
  is_active: boolean;
  updated_at: string;
}

const TEMPLATE_LABELS: Record<string, { label: string; tone: 'blue' | 'green' | 'red' }> = {
  late_notification: { label: 'إشعار التأخير', tone: 'blue' },
  note_positive:     { label: 'ملاحظة إيجابية', tone: 'green' },
  note_negative:     { label: 'ملاحظة سلبية',  tone: 'red'   },
};

// Sample data used to render the live preview.
const SAMPLE_VARS = {
  student_name: 'تركي محمد السهلي',
  grade: 'الأول متوسط',
  section: '5',
  date: '27/4/2026',
  punch_time: '07:32:15',
  minutes_late: 47,
  phone: '966555000000',
  school_name: 'متوسطة الخمرة الأولى',
  principal_name: 'جمعان الزهراني',
  teacher_name: 'أ. محمد',
  note_text: 'متفوق في إنجاز الواجبات وأبدى مشاركة فعّالة في الحصة',
  note_emoji: '⭐',
  note_type: 'إيجابية',
  note_category: 'أكاديمي',
};

export default function MessageTemplatesEditor() {
  const qc = useQueryClient();
  const [activeName, setActiveName] = useState<string>('note_positive');
  const [draft, setDraft] = useState<string>('');
  const [originalBody, setOriginalBody] = useState<string>('');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [originalActive, setOriginalActive] = useState<boolean>(true);
  const [showPreview, setShowPreview] = useState(true);

  const { data: templates = [], isLoading } = useQuery<MessageTemplate[]>({
    queryKey: ['message-templates'],
    queryFn: async () => (await (await fetch('/api/message-templates')).json()).data,
  });

  // Load the currently selected template into the editor.
  useEffect(() => {
    const t = templates.find((x) => x.name === activeName);
    if (t) {
      setDraft(t.body);
      setOriginalBody(t.body);
      setIsActive(t.is_active);
      setOriginalActive(t.is_active);
    }
  }, [activeName, templates]);

  const isDirty = draft !== originalBody || isActive !== originalActive;

  const saveMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/message-templates/${activeName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft, is_active: isActive }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الحفظ');
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['message-templates'] });
      toast.success('تم حفظ القالب');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const insertPlaceholder = (key: string) => {
    const ta = document.getElementById('tmpl-body') as HTMLTextAreaElement | null;
    if (!ta) {
      setDraft((d) => d + ` {{${key}}}`);
      return;
    }
    const start = ta.selectionStart ?? draft.length;
    const end = ta.selectionEnd ?? draft.length;
    const placeholder = `{{${key}}}`;
    const newVal = draft.slice(0, start) + placeholder + draft.slice(end);
    setDraft(newVal);
    // Restore cursor after the inserted placeholder.
    setTimeout(() => {
      ta.focus();
      const pos = start + placeholder.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  // Filter placeholders relevant to the chosen template.
  const visiblePlaceholders = useMemo(() => {
    const isLate = activeName === 'late_notification';
    const isNote = activeName.startsWith('note_');
    return TEMPLATE_PLACEHOLDERS.filter((p) => {
      if (p.group === 'common') return true;
      if (p.group === 'late') return isLate;
      if (p.group === 'note') return isNote;
      return true;
    });
  }, [activeName]);

  const previewText = useMemo(() => renderTemplate(draft, SAMPLE_VARS), [draft]);

  if (isLoading) {
    return <div className="card text-center text-gray-500 dark:text-gray-400 py-6 text-sm">جارٍ التحميل...</div>;
  }
  if (templates.length === 0) {
    return <div className="card text-center text-gray-500 dark:text-gray-400 py-6 text-sm">لا توجد قوالب رسائل</div>;
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            قوالب رسائل الواتساب
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            عدّل نص الرسائل التي تُرسل لأولياء الأمور. استخدم المتغيّرات المتاحة لإدراج بيانات الطالب تلقائياً.
          </p>
        </div>
      </div>

      {/* Template tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {templates.map((t) => {
          const meta = TEMPLATE_LABELS[t.name];
          const active = t.name === activeName;
          const tone = meta?.tone || 'blue';
          const cls =
            active
              ? tone === 'green'
                ? 'border-green-500 text-green-700 dark:text-green-400'
                : tone === 'red'
                  ? 'border-red-500 text-red-700 dark:text-red-400'
                  : 'border-blue-500 text-blue-700 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200';
          return (
            <button
              key={t.name}
              onClick={() => {
                if (isDirty && !confirm('لديك تغييرات غير محفوظة. هل تريد المتابعة؟')) return;
                setActiveName(t.name);
              }}
              className={`px-4 py-2 -mb-px border-b-2 transition-colors text-sm whitespace-nowrap ${cls}`}
            >
              {meta?.label || t.name}
              {!t.is_active && <span className="text-xs ms-1 text-gray-400">(معطّل)</span>}
            </button>
          );
        })}
      </div>

      {/* Active template description */}
      {templates.find((t) => t.name === activeName)?.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {templates.find((t) => t.name === activeName)?.description}
        </p>
      )}

      {/* Placeholders chips */}
      <div className="mb-2">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">
          المتغيّرات المتاحة (انقر لإدراج):
        </p>
        <div className="flex flex-wrap gap-1.5">
          {visiblePlaceholders.map((p) => (
            <button
              key={p.key}
              onClick={() => insertPlaceholder(p.key)}
              className="text-xs px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:border-blue-300 dark:hover:border-blue-500/40 text-gray-700 dark:text-gray-300 font-mono"
              title={p.label}
              dir="ltr"
            >
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
      </div>

      {/* Editor + Preview */}
      <div className={`grid gap-3 ${showPreview ? 'lg:grid-cols-2' : ''}`}>
        <div>
          <label className="label flex items-center justify-between">
            <span>نص الرسالة</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{draft.length}/4000</span>
          </label>
          <textarea
            id="tmpl-body"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="input min-h-[280px] font-mono text-sm leading-relaxed"
            maxLength={4000}
            dir="auto"
          />
          <label className="flex items-center gap-2 mt-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            مفعّل (غير المفعّل لن يُرسل)
          </label>
        </div>

        {showPreview && (
          <div>
            <label className="label">المعاينة (ببيانات تجريبية)</label>
            <div className="min-h-[280px] p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200" dir="auto">
              {previewText || <span className="text-gray-400">— فارغ —</span>}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              المتغيّرات تُستبدل بالبيانات الفعلية للطالب وقت الإرسال.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={() => saveMut.mutate()}
          disabled={!isDirty || saveMut.isPending}
          className="btn-primary inline-flex items-center gap-1"
        >
          <Save className="w-4 h-4" />
          {saveMut.isPending ? 'جارٍ الحفظ...' : 'حفظ القالب'}
        </button>
        <button
          onClick={() => { setDraft(originalBody); setIsActive(originalActive); }}
          disabled={!isDirty}
          className="btn-secondary inline-flex items-center gap-1"
        >
          <RotateCcw className="w-4 h-4" /> تراجع
        </button>
        <button
          onClick={() => setShowPreview((v) => !v)}
          className="ms-auto btn-secondary inline-flex items-center gap-1 text-sm"
        >
          {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showPreview ? 'إخفاء المعاينة' : 'إظهار المعاينة'}
        </button>
      </div>
    </div>
  );
}
