'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Send, Loader2, MessageCircle, Users, AlertCircle, CheckCircle2,
  XCircle, Eye, Bell, Mail, Sparkles,
} from 'lucide-react';

interface TeacherRow {
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active?: boolean;
}

interface SendResult {
  total: number;
  sent: number;
  failed: number;
  outcomes: Array<{
    user_id: string;
    teacher_name: string;
    phone: string | null;
    ok: boolean;
    error: string | null;
  }>;
}

const PLACEHOLDERS = [
  { key: '{{teacher_name}}', label: 'اسم المعلم' },
  { key: '{{school_name}}', label: 'اسم المدرسة' },
  { key: '{{principal_name}}', label: 'اسم المدير' },
  { key: '{{date}}', label: 'تاريخ اليوم' },
];

const DEFAULT_TEMPLATE = `🌹 السلام عليكم أ. {{teacher_name}}

تذكير من إدارة المدرسة:

نأمل التكرّم بتسجيل حضور الحصص في تطبيق المعلم،
وذلك لمتابعة دقّة البيانات وتزويد أولياء الأمور بالإشعارات في وقتها.

مع جزيل الشكر لتعاونكم 🤝
— {{school_name}}`;

export default function BulkRemindTeachersPage() {
  const qc = useQueryClient();
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [scope, setScope] = useState<'all' | 'specific'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [alsoInternal, setAlsoInternal] = useState(true);
  const [internalSubject, setInternalSubject] = useState('تذكير من الإدارة');
  const [showResult, setShowResult] = useState<SendResult | null>(null);

  // Pull teacher list with phones for the picker + count display.
  const { data: teachers = [], isLoading: loadingTeachers } = useQuery<TeacherRow[]>({
    queryKey: ['teachers-for-bulk'],
    queryFn: async () => {
      const r = await fetch('/api/teachers');
      if (!r.ok) return [];
      const d = await r.json();
      return (d.data || []).filter((t: any) => t.is_active !== false);
    },
  });

  const targetCount = scope === 'all' ? teachers.length : selectedIds.size;
  const teachersWithPhone = teachers.filter((t) => !!t.phone).length;
  const teachersWithoutPhone = teachers.length - teachersWithPhone;

  // Pacing math: 5.5s between sends + ~1s send latency = 6.5s effective per recipient.
  const estimatedSeconds = Math.max(0, (targetCount - 1) * 5.5);
  const estimatedMinutes = Math.floor(estimatedSeconds / 60);
  const estimatedRemainder = Math.round(estimatedSeconds % 60);

  // Live preview — render the template using the first teacher's name, or a
  // placeholder if none loaded yet. Helps the admin sanity-check formatting.
  const preview = useMemo(() => {
    const t = teachers[0];
    const name = t?.full_name || 'محمد أحمد السهلي';
    const today = new Date().toLocaleDateString('ar-SA-u-ca-gregory');
    return template
      .replaceAll('{{teacher_name}}', name)
      .replaceAll('{{school_name}}', 'متوسطة الخمرة الأولى')
      .replaceAll('{{principal_name}}', 'مدير المدرسة')
      .replaceAll('{{date}}', today);
  }, [template, teachers]);

  const sendMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/whatsapp/bulk-remind-teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_template: template,
          scope,
          teacher_user_ids: scope === 'specific' ? Array.from(selectedIds) : undefined,
          also_internal: alsoInternal,
          internal_subject: alsoInternal ? internalSubject : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإرسال');
      return d.data as SendResult;
    },
    onSuccess: (result) => {
      setShowResult(result);
      if (result.failed === 0) {
        toast.success(`✓ أُرسلت ${result.sent} رسالة بنجاح`);
      } else {
        toast(`أُرسلت ${result.sent} • فشلت ${result.failed}`, { icon: '⚠️', duration: 5000 });
      }
      qc.invalidateQueries({ queryKey: ['whatsapp-messages'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const insertPlaceholder = (key: string) => {
    setTemplate((prev) => prev + key);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllWithPhone = () => {
    const ids = teachers.filter((t) => !!t.phone).map((t) => t.user_id);
    setSelectedIds(new Set(ids));
  };

  const canSend = template.trim().length >= 10 && targetCount > 0 && !sendMut.isPending;

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">تذكير جماعي للمعلمين</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              رسالة واتساب موحّدة تُرسَل لكل معلم باسمه
            </p>
          </div>
        </div>
      </div>

      {/* Stats banner */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">المعلمون النشطون</p>
          <p className="text-2xl font-bold">{loadingTeachers ? '—' : teachers.length}</p>
        </div>
        <div className="card text-center py-3 bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30">
          <p className="text-xs text-green-700 dark:text-green-300">لديهم رقم جوال</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-400">{teachersWithPhone}</p>
        </div>
        {teachersWithoutPhone > 0 && (
          <div className="card text-center py-3 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30">
            <p className="text-xs text-amber-700 dark:text-amber-300">بدون جوال (لن يصلهم)</p>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{teachersWithoutPhone}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column — composition */}
        <div className="space-y-4">
          {/* Scope */}
          <div className="card">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              المستهدفون
            </h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                <input
                  type="radio"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="w-4 h-4"
                />
                <span className="flex-1">
                  <span className="font-medium">كل المعلمين النشطين</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 block">
                    {teachers.length} معلم — منهم {teachersWithPhone} لديهم جوال
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                <input
                  type="radio"
                  checked={scope === 'specific'}
                  onChange={() => setScope('specific')}
                  className="w-4 h-4"
                />
                <span className="flex-1">
                  <span className="font-medium">اختيار معلمين محدّدين</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 block">
                    {selectedIds.size} معلم مختار
                  </span>
                </span>
              </label>
            </div>

            {/* Specific picker */}
            {scope === 'specific' && (
              <div className="mt-3 border-t border-gray-200 dark:border-gray-800 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">اختر المعلمين:</p>
                  <button
                    onClick={selectAllWithPhone}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    تحديد كل من لديهم جوال
                  </button>
                </div>
                <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
                  {teachers.map((t) => (
                    <li key={t.user_id}>
                      <label className={`flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${!t.phone ? 'opacity-50' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.user_id)}
                          onChange={() => toggleSelected(t.user_id)}
                          disabled={!t.phone}
                          className="w-4 h-4"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{t.full_name}</p>
                          {t.phone ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{t.phone}</p>
                          ) : (
                            <p className="text-xs text-amber-600 dark:text-amber-400">بدون جوال</p>
                          )}
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Template */}
          <div className="card">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              نص الرسالة
            </h3>

            <div className="mb-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">المتغيرات المتاحة:</p>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => insertPlaceholder(p.key)}
                    className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/25"
                    title={`اضغط لإدراج ${p.label}`}
                  >
                    <code className="text-[10px]">{p.key}</code>
                    <span className="ms-1">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="input font-mono text-sm leading-relaxed"
              rows={12}
              placeholder="اكتب نص الرسالة هنا..."
              maxLength={2000}
              disabled={sendMut.isPending}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
              {template.length} / 2000 حرف
            </p>
          </div>

          {/* Internal mirror */}
          <div className="card">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={alsoInternal}
                onChange={(e) => setAlsoInternal(e.target.checked)}
                className="w-4 h-4 mt-0.5"
              />
              <div className="flex-1">
                <p className="font-medium flex items-center gap-1.5">
                  <Mail className="w-4 h-4" />
                  أرسل أيضاً كرسالة داخلية في تطبيق المعلم
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  ستظهر في صندوق وارد المعلم مع شارة 🔔
                </p>
              </div>
            </label>
            {alsoInternal && (
              <input
                value={internalSubject}
                onChange={(e) => setInternalSubject(e.target.value)}
                className="input mt-2 text-sm"
                placeholder="عنوان الرسالة الداخلية..."
                maxLength={200}
              />
            )}
          </div>
        </div>

        {/* Right column — preview + send */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* Preview */}
          <div className="card bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-500/10 dark:to-emerald-500/10 border-green-200 dark:border-green-500/30">
            <h3 className="font-semibold mb-2 flex items-center gap-2 text-green-800 dark:text-green-200">
              <Eye className="w-4 h-4" />
              المعاينة (للمعلم الأول)
            </h3>
            <div className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-green-200 dark:border-green-500/30 shadow-sm">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{preview}</p>
            </div>
            <p className="text-xs text-green-700 dark:text-green-300 mt-2">
              💡 سيتم استبدال <code>{'{{teacher_name}}'}</code> باسم كل معلم تلقائياً
            </p>
          </div>

          {/* Estimated time */}
          <div className="card bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30">
            <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">⏱️ الوقت المتوقّع</p>
            <p className="text-2xl font-bold text-amber-800 dark:text-amber-200 mt-1">
              {estimatedMinutes > 0 ? `${estimatedMinutes} دقيقة` : ''}
              {estimatedMinutes > 0 && estimatedRemainder > 0 ? ' و ' : ''}
              {estimatedRemainder > 0 ? `${estimatedRemainder} ثانية` : ''}
              {estimatedSeconds === 0 ? 'فوري' : ''}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              {targetCount} رسالة × 5.5 ثانية بين كل رسالة (حماية واتساب)
            </p>
          </div>

          {/* Action */}
          <div className="card">
            <button
              onClick={() => {
                const msg = `سيتم إرسال ${targetCount} رسالة عبر واتساب.\nالوقت المتوقّع: ${estimatedMinutes > 0 ? estimatedMinutes + ' دقيقة و ' : ''}${estimatedRemainder} ثانية.\n\nهل تريد المتابعة؟`;
                if (confirm(msg)) sendMut.mutate();
              }}
              disabled={!canSend}
              className="btn-primary w-full inline-flex items-center justify-center gap-2 py-3 text-base"
            >
              {sendMut.isPending
                ? <><Loader2 className="w-5 h-5 animate-spin" /> جارٍ الإرسال... ({targetCount} رسالة)</>
                : <><Send className="w-5 h-5" /> إرسال لـ {targetCount} معلم</>
              }
            </button>
            {sendMut.isPending && (
              <p className="text-xs text-center text-gray-500 dark:text-gray-400 mt-2">
                لا تُغلق الصفحة — العملية ستأخذ ~{estimatedMinutes > 0 ? estimatedMinutes + ' دقيقة' : estimatedRemainder + ' ثانية'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Result modal */}
      {showResult && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowResult(null)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`p-4 ${showResult.failed === 0 ? 'bg-green-50 dark:bg-green-500/10' : 'bg-amber-50 dark:bg-amber-500/10'}`}>
              <div className="flex items-center gap-3">
                {showResult.failed === 0 ? (
                  <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                )}
                <div>
                  <h3 className="font-bold text-lg">نتيجة الإرسال</h3>
                  <p className="text-sm">
                    تم الإرسال بنجاح: <strong className="text-green-700 dark:text-green-400">{showResult.sent}</strong>
                    {' '}من <strong>{showResult.total}</strong>
                    {showResult.failed > 0 && (
                      <> • فشل: <strong className="text-red-700 dark:text-red-400">{showResult.failed}</strong></>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Outcomes list */}
            <div className="flex-1 overflow-y-auto p-4">
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {showResult.outcomes.map((o) => (
                  <li key={o.user_id} className="py-2 flex items-center gap-2">
                    {o.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{o.teacher_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{o.phone || '—'}</p>
                    </div>
                    {o.error && (
                      <span className="text-xs text-red-600 dark:text-red-400 truncate max-w-[40%]" title={o.error}>
                        {o.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex justify-end">
              <button onClick={() => setShowResult(null)} className="btn-primary text-sm">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
