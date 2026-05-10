'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageCircle, Send, Users, Calendar, Clock, AlertTriangle, Shield,
  Loader2, Filter, X, FileText, Sparkles,
} from 'lucide-react';

// 5 quick-pick templates the admin can drop in and edit. Free-form text
// always available below.
const TEMPLATE_PRESETS = [
  {
    id: 'holiday',
    label: '📅 إعلان عطلة رسمية',
    body: `أولياء أمورنا الكرام،
نُعلمكم أن المدرسة عطلة رسمية يوم [اليوم] بتاريخ [التاريخ] بمناسبة [المناسبة].
وستكون الدراسة بإذن الله يوم [اليوم التالي].

— إدارة المدرسة`,
  },
  {
    id: 'meeting',
    label: '🎯 اجتماع أولياء الأمور',
    body: `أولياء أمورنا الكرام،
يسرّنا دعوتكم لاجتماع أولياء الأمور يوم [اليوم] الموافق [التاريخ] في تمام الساعة [الوقت]
في [المكان].

نأمل حضوركم لمناقشة مستوى أبنائكم وآخر المستجدات.

— إدارة المدرسة`,
  },
  {
    id: 'uniform',
    label: '👕 تذكير بالزيّ المدرسي',
    body: `أولياء أمورنا الكرام،
نذكّركم بضرورة التزام الطلاب بالزيّ المدرسي الرسمي يومياً، حفاظاً على مظهر المدرسة وانضباط الطلاب.

شاكرين لكم تعاونكم.

— إدارة المدرسة`,
  },
  {
    id: 'event',
    label: '🎉 إعلان نشاط مدرسي',
    body: `أولياء أمورنا الكرام،
سيُقام بالمدرسة [اسم النشاط] يوم [اليوم] بتاريخ [التاريخ].
ندعوكم لمشاركة أبنائكم هذا النشاط.

— إدارة المدرسة`,
  },
  {
    id: 'contact_update',
    label: '📞 تحديث بيانات التواصل',
    body: `أولياء أمورنا الكرام،
نرجو منكم تحديث بيانات التواصل (رقم الجوال) في حال تغييرها مؤخراً، لضمان وصول إشعارات المدرسة في الوقت المناسب.

يمكنكم التواصل مع إدارة المدرسة لتحديث البيانات.

— إدارة المدرسة`,
  },
];

interface Grade { id: number; name: string }
interface Section { id: number; name: string }

export default function BulkRemindParentsPage() {
  const router = useRouter();

  // ---- Targeting ----
  const [audience, setAudience] = useState<'all' | 'grade' | 'section' | 'students'>('all');
  const [gradeId, setGradeId] = useState<string>('');
  const [sectionId, setSectionId] = useState<string>('');
  // students-mode is left unwired in this MVP — easy to add later via a
  // multi-select picker; for now the admin can just use grade/section
  // narrowing. The audience option is exposed in the API.

  // ---- Message ----
  const [template, setTemplate] = useState<string>('');
  const [pickedPreset, setPickedPreset] = useState<string>('');

  // ---- Schedule ----
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledDate, setScheduledDate] = useState<string>(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [scheduledTime, setScheduledTime] = useState<string>('15:00');

  // ---- Time-of-day warning state ----
  const [pendingWarning, setPendingWarning] = useState<{ message: string; suggested: string } | null>(null);

  // ---- Reference data ----
  const { data: grades = [] } = useQuery<Grade[]>({
    queryKey: ['bulk-parents-grades'],
    queryFn: async () => (await (await fetch('/api/grades')).json()).data || [],
  });
  const { data: sections = [] } = useQuery<Section[]>({
    queryKey: ['bulk-parents-sections', gradeId],
    queryFn: async () => {
      if (!gradeId) return [];
      return (await (await fetch(`/api/sections?grade_id=${gradeId}`)).json()).data || [];
    },
    enabled: !!gradeId,
  });

  // ---- Live preview count ----
  const previewQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('audience', audience);
    if (audience === 'grade' && gradeId) p.set('grade_id', gradeId);
    if (audience === 'section' && sectionId) p.set('section_id', sectionId);
    return p.toString();
  }, [audience, gradeId, sectionId]);

  const { data: preview } = useQuery<{ total: number; with_phone: number; without_phone: number; sample: any[] }>({
    queryKey: ['bulk-parents-preview', previewQuery],
    queryFn: async () => (await (await fetch(`/api/whatsapp/bulk-parents/preview?${previewQuery}`)).json()).data,
  });

  // ---- Submit ----
  const sendMut = useMutation({
    mutationFn: async (acknowledgeWarning: boolean) => {
      const scheduled_for = scheduleMode === 'later'
        ? `${scheduledDate}T${scheduledTime}:00+03:00`
        : null;
      const body: any = {
        message_template: template,
        audience,
        scheduled_for,
        acknowledge_school_hours: acknowledgeWarning,
      };
      if (audience === 'grade' && gradeId) body.grade_id = parseInt(gradeId, 10);
      if (audience === 'section' && sectionId) body.section_id = parseInt(sectionId, 10);

      const r = await fetch('/api/whatsapp/bulk-parents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        const err = new Error(d.error || 'فشل الإرسال') as Error & { code?: string; suggested?: string };
        err.code = d.code;
        err.suggested = d.suggested_scheduled_for;
        throw err;
      }
      return d.data as { job_id: number; status: string; total: number; with_phone: number; skipped: number; scheduled_for: string | null };
    },
    onSuccess: (d) => {
      if (d.status === 'scheduled' && d.scheduled_for) {
        const at = new Date(d.scheduled_for).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'short', timeStyle: 'short' });
        toast.success(`تم جدولة الحملة (${d.with_phone} ولي أمر) للإرسال في ${at}`);
      } else {
        toast.success(`بدأت الحملة (${d.with_phone} ولي أمر)`);
      }
      router.push(`/dashboard/whatsapp-bulk-teachers/jobs/${d.job_id}`);
    },
    onError: (e: any) => {
      if (e.code === 'SCHOOL_HOURS_WARNING') {
        // Show the in-page warning dialog instead of a toast.
        setPendingWarning({ message: e.message, suggested: e.suggested });
        return;
      }
      toast.error(e.message);
    },
  });

  const applyPreset = (presetId: string) => {
    const preset = TEMPLATE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setTemplate(preset.body);
    setPickedPreset(presetId);
  };
  // Manual edit clears the preset tag.
  useEffect(() => {
    if (pickedPreset && template !== TEMPLATE_PRESETS.find((p) => p.id === pickedPreset)?.body) {
      setPickedPreset('');
    }
  }, [template, pickedPreset]);

  const canSend = template.trim().length >= 10
    && (preview?.with_phone || 0) > 0
    && !sendMut.isPending;

  const estimatedMinutes = useMemo(() => {
    const n = preview?.with_phone || 0;
    if (n === 0) return 0;
    // Worker pacing: 6s per send + 60s cooldown every 50 sends.
    const sends = n * 6;
    const cooldowns = Math.floor(n / 50) * 60;
    return Math.ceil((sends + cooldowns) / 60);
  }, [preview?.with_phone]);

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">رسالة جماعية لأولياء الأمور</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            إعلانات المدرسة — إرسال في الخلفية مع متابعة حية وحماية ضد الحظر
          </p>
        </div>
      </div>

      {/* Targeting */}
      <div className="card space-y-3">
        <h2 className="font-bold text-sm flex items-center gap-1.5">
          <Filter className="w-4 h-4 text-blue-600" /> 1. اختر المستهدفين
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <ScopeChip active={audience === 'all'} onClick={() => setAudience('all')} label="🏫 كل أولياء الأمور" />
          <ScopeChip active={audience === 'grade'} onClick={() => setAudience('grade')} label="📚 صف محدد" />
          <ScopeChip active={audience === 'section'} onClick={() => setAudience('section')} label="📌 شعبة محددة" />
        </div>

        {audience === 'grade' && (
          <select value={gradeId} onChange={(e) => setGradeId(e.target.value)} className="input">
            <option value="">— اختر الصف —</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}

        {audience === 'section' && (
          <div className="grid grid-cols-2 gap-2">
            <select value={gradeId} onChange={(e) => { setGradeId(e.target.value); setSectionId(''); }} className="input">
              <option value="">— الصف —</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="input" disabled={!gradeId}>
              <option value="">— الشعبة —</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {/* Live recipient counter */}
        <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3">
          <Users className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">
              سيُرسل لـ <span className="text-blue-700 dark:text-blue-300">{preview?.with_phone ?? '...'}</span> ولي أمر
            </p>
            {(preview?.without_phone || 0) > 0 && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                ⚠️ {preview?.without_phone} طالب بدون رقم جوال — لن يصل للأهل
              </p>
            )}
            {estimatedMinutes > 0 && (
              <p className="text-[11px] text-gray-600 dark:text-gray-400">
                ⏱️ مدة الإرسال المتوقعة: ~{estimatedMinutes} دقيقة (مع cooldown ضد الحظر)
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Templates */}
      <div className="card space-y-3">
        <h2 className="font-bold text-sm flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-purple-600" /> 2. اختر قالباً جاهزاً (اختياري) أو اكتب نصك
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
          {TEMPLATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              className={`text-right text-xs px-2 py-2 rounded-lg border transition-colors ${
                pickedPreset === p.id
                  ? 'bg-purple-100 dark:bg-purple-500/20 border-purple-300 dark:border-purple-500/40 text-purple-800 dark:text-purple-300'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div>
          <label className="label flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" /> نص الرسالة
          </label>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={8}
            placeholder="اكتب نص الرسالة هنا..."
            className="input font-arabic text-sm leading-relaxed"
            maxLength={2000}
          />
          <div className="flex items-center justify-between mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span>الحد الأقصى: 2000 حرف</span>
            <span className={template.length > 1800 ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}>
              {template.length} حرف
            </span>
          </div>
        </div>
      </div>

      {/* Schedule */}
      <div className="card space-y-3">
        <h2 className="font-bold text-sm flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-orange-600" /> 3. توقيت الإرسال
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <ScopeChip active={scheduleMode === 'now'} onClick={() => setScheduleMode('now')} label="🚀 إرسال الآن" />
          <ScopeChip active={scheduleMode === 'later'} onClick={() => setScheduleMode('later')} label="📅 جدولة لوقت لاحق" />
        </div>
        {scheduleMode === 'later' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs flex items-center gap-1"><Calendar className="w-3 h-3" /> التاريخ</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> الوقت</label>
              <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="input" dir="ltr" />
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">توقيت الرياض (Asia/Riyadh)</p>
            </div>
          </div>
        )}
      </div>

      {/* Anti-ban info */}
      <div className="card border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5">
        <h2 className="font-bold text-sm flex items-center gap-1.5 mb-2">
          <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> الحماية ضد حظر Wasender
        </h2>
        <ul className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
          <li>⏱️ <strong>6 ثوانٍ</strong> بين كل رسالة + jitter عشوائي ±1.5 ثانية (يكسر النمط الثابت)</li>
          <li>🛑 <strong>cooldown 60 ثانية</strong> كل 50 رسالة (يبدو طبيعياً للنظام)</li>
          <li>🔀 ترتيب الإرسال <strong>عشوائي</strong> (Fisher-Yates) — أرقام غير متتالية</li>
          <li>⚠️ <strong>إيقاف تلقائي</strong> عند 3 إخفاقات متتالية بنفس النوع (يحمي حسابك)</li>
        </ul>
      </div>

      {/* Submit */}
      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-gradient-to-t from-white via-white dark:from-gray-950 dark:via-gray-950 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={() => sendMut.mutate(false)}
          disabled={!canSend}
          className="btn-primary w-full inline-flex items-center justify-center gap-2 py-3 text-base"
        >
          {sendMut.isPending ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> جارٍ الإرسال...</>
          ) : (
            <>
              <Send className="w-5 h-5" />
              {scheduleMode === 'later' ? '📅 جدولة الحملة' : '🚀 بدء الإرسال الآن'}
              {preview?.with_phone ? ` (${preview.with_phone})` : ''}
            </>
          )}
        </button>
      </div>

      {/* School-hours warning dialog */}
      {pendingWarning && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setPendingWarning(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border-2 border-amber-300 dark:border-amber-500/60 w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-amber-500 px-4 py-3 flex items-center gap-2 text-white">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold flex-1">تحذير: أنت في وقت الدوام</h3>
              <button onClick={() => setPendingWarning(null)} className="p-1 rounded hover:bg-black/20"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-800 dark:text-gray-200 leading-relaxed">{pendingWarning.message}</p>
              <p className="text-xs bg-blue-50 dark:bg-blue-500/10 p-2 rounded border border-blue-200 dark:border-blue-500/30 text-blue-800 dark:text-blue-300">
                💡 الموصى به: جدولة الحملة لـ <strong>3:00 م</strong> بعد انتهاء الدوام، حتى لا تتنافس مع رسائل المعلمين (غياب، تأخير، استئذانات).
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setScheduleMode('later');
                    setScheduledTime('15:00');
                    setPendingWarning(null);
                    toast('تم تحويلها إلى جدولة لـ 3:00 م — اضغط "جدولة الحملة"', { icon: '📅', duration: 4000 });
                  }}
                  className="flex-1 btn-secondary inline-flex items-center justify-center gap-1 text-sm"
                >
                  <Calendar className="w-4 h-4" /> جدولة لـ 3 م
                </button>
                <button
                  onClick={() => { setPendingWarning(null); sendMut.mutate(true); }}
                  className="flex-1 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm inline-flex items-center justify-center gap-1"
                >
                  🚀 إرسال الآن (تجاوز التحذير)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm px-3 py-2 rounded-lg border font-medium transition-colors ${
        active
          ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-500/40'
          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
      }`}
    >
      {label}
    </button>
  );
}
