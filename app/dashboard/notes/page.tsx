'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  MessageSquarePlus, Search, Mic, MicOff, Save, X, ThumbsUp, ThumbsDown,
  CheckSquare, Square, Loader2, Eraser, Sparkles, AlertCircle,
} from 'lucide-react';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { useSpeechToText } from '@/lib/hooks/useSpeechToText';
import type { NoteTemplate, NoteType, NoteCategory } from '@/lib/types/database';

interface Student {
  id: number;
  student_id: string;
  first_name: string;
  father_name: string | null;
  last_name: string;
  phone: string | null;
  grade_id: number;
  section_id: number;
  is_active: boolean;
  grades?: { name: string; stage: string };
  sections?: { name: string };
}

const CATEGORY_LABELS: Record<NoteCategory, string> = {
  academic:      'أكاديمي',
  behavior:      'سلوكي',
  attendance:    'حضور',
  participation: 'مشاركة',
  general:       'عام',
};

export default function NotesPage() {
  const router = useRouter();
  const qc = useQueryClient();

  // Filters
  const [gradeId, setGradeId] = useState<string>('');
  const [sectionId, setSectionId] = useState<string>('');
  const [search, setSearch] = useState('');

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Note input state
  const [noteType, setNoteType] = useState<NoteType>('positive');
  const [noteCategory, setNoteCategory] = useState<NoteCategory>('general');
  const [noteText, setNoteText] = useState('');
  const [pickedTemplateId, setPickedTemplateId] = useState<number | null>(null);
  // Send WhatsApp on save? Default ON so the common case (save + notify
  // parents) is one click; unchecking saves silently.
  const [sendWhatsapp, setSendWhatsapp] = useState(true);

  // ---- Data fetching ----
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data,
  });

  // Show ALL grades regardless of the school's saved stage — multi-stage
  // schools and mis-imported data both happen, and the stage filter would
  // hide grades that actually have students. The stage label is appended to
  // each option so duplicate names (الأول in middle vs secondary) are clear.
  const { data: grades = [] } = useQuery<any[]>({
    queryKey: ['grades-all'],
    queryFn: async () => {
      const r = await fetch('/api/grades');
      if (!r.ok) throw new Error('فشل تحميل الصفوف');
      return ((await r.json()).data || []) as any[];
    },
  });

  const { data: sections = [] } = useQuery<any[]>({
    queryKey: ['sections', gradeId],
    queryFn: async () => {
      if (!gradeId) return [];
      return (await (await fetch(`/api/sections?grade_id=${gradeId}`)).json()).data;
    },
    enabled: !!gradeId,
  });

  const { data: studentsResp, isLoading: studentsLoading } = useQuery<{ data: Student[] }>({
    queryKey: ['students-for-notes', sectionId, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sectionId) params.set('section_id', sectionId);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', '500');
      const r = await fetch(`/api/students?${params}`);
      if (!r.ok) throw new Error('فشل تحميل الطلاب');
      return r.json();
    },
    enabled: !!sectionId,
  });
  const students = studentsResp?.data ?? [];

  const { data: templates = [] } = useQuery<NoteTemplate[]>({
    queryKey: ['note-templates'],
    queryFn: async () => (await (await fetch('/api/note-templates?active=1')).json()).data,
  });

  // Reset section when grade changes; reset selection when section changes.
  useEffect(() => { setSectionId(''); setSelected(new Set()); }, [gradeId]);
  useEffect(() => { setSelected(new Set()); }, [sectionId]);

  // ---- Voice recording ----
  const speech = useSpeechToText({ lang: 'ar-SA' });
  // Mirror committed transcript into the textarea (append, don't replace, so
  // the user can keep editing while dictating).
  const lastTranscriptRef = useRef('');
  useEffect(() => {
    if (speech.transcript && speech.transcript !== lastTranscriptRef.current) {
      const newPart = speech.transcript.slice(lastTranscriptRef.current.length).trim();
      if (newPart) {
        setNoteText((prev) => (prev ? prev + ' ' : '') + newPart);
      }
      lastTranscriptRef.current = speech.transcript;
    }
  }, [speech.transcript]);

  // ---- Filtered/sorted templates for the picker ----
  const visibleTemplates = useMemo(() => {
    return templates
      .filter((t) => t.type === noteType && t.is_active)
      .filter((t) => noteCategory === 'general' ? true : t.category === noteCategory);
  }, [templates, noteType, noteCategory]);

  // ---- Selection helpers ----
  const allSelected = students.length > 0 && students.every((s) => selected.has(s.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(students.map((s) => s.id)));
  };
  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const pickTemplate = (t: NoteTemplate) => {
    // Tapping a template fills the text and sets category — user can still edit.
    setNoteText(t.text);
    setNoteType(t.type);
    setNoteCategory(t.category);
    setPickedTemplateId(t.id);
  };

  const clearNote = () => {
    setNoteText('');
    setPickedTemplateId(null);
    speech.reset();
    lastTranscriptRef.current = '';
  };

  // ---- Save ----
  // The mutation does two things sequentially when the user opts in to
  // WhatsApp: first writes the notes (returns a batch_id), then fires the
  // send-notes endpoint with that batch_id. WhatsApp failure is non-fatal —
  // the notes are still saved and the user is sent to the print page.
  const saveMut = useMutation({
    mutationFn: async () => {
      const studentIds = Array.from(selected);
      const text = noteText.trim();
      const notes = studentIds.map((sid) => ({
        student_id: sid,
        template_id: pickedTemplateId,
        text,
        type: noteType,
        category: noteCategory,
        source: speech.transcript ? 'voice' as const : (pickedTemplateId ? 'template' as const : 'text' as const),
      }));
      const r = await fetch('/api/student-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || 'فشل الحفظ');
      const saved = result.data as { batch_id: string; count: number };

      let waResult: { sent: number; failed: number; skipped: number; error?: string } | null = null;
      if (sendWhatsapp) {
        try {
          const wr = await fetch('/api/whatsapp/send-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch_id: saved.batch_id }),
          });
          const wd = await wr.json();
          if (!wr.ok) {
            waResult = { sent: 0, failed: 0, skipped: 0, error: wd.error || 'فشل الإرسال' };
          } else {
            waResult = wd.data;
          }
        } catch (e: any) {
          waResult = { sent: 0, failed: 0, skipped: 0, error: e?.message || 'خطأ في الشبكة' };
        }
      }

      return { ...saved, wa: waResult };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['student-notes'] });
      // Compose a single toast that covers both the save and (optional) send.
      if (data.wa) {
        if (data.wa.error) {
          toast.error(`تم حفظ ${data.count} ملاحظة، لكن فشل إرسال الواتساب: ${data.wa.error}`);
        } else {
          const parts = [`حفظ ${data.count}`, `واتساب ${data.wa.sent}`];
          if (data.wa.failed) parts.push(`فشل ${data.wa.failed}`);
          toast.success(`تم — ${parts.join(' · ')}`);
        }
      } else {
        toast.success(`تم حفظ ${data.count} ملاحظة`);
      }
      clearNote();
      setSelected(new Set());
      router.push(`/dashboard/notes/print/${data.batch_id}`);
    },
    onError: (e: any) => toast.error(e.message || 'فشل الحفظ'),
  });

  const canSave =
    selected.size > 0 &&
    noteText.trim().length >= 2 &&
    !saveMut.isPending;

  // ---- Render ----
  return (
    <div className="space-y-4 pb-40 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <MessageSquarePlus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">تسجيل الملاحظات</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">اختر الصف والشعبة، حدّد طلاباً، ثم سجّل الملاحظة</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">الصف</label>
            <select value={gradeId} onChange={(e) => setGradeId(e.target.value)} className="input">
              <option value="">اختر الصف</option>
              {grades.map((g: any) => (
                <option key={g.id} value={g.id}>
                  {g.name}{g.stage ? ` — ${STAGE_LABELS[g.stage]}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">الشعبة</label>
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className="input"
              disabled={!gradeId}
            >
              <option value="">اختر الشعبة</option>
              {sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">بحث بالاسم/الهوية</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input ps-9"
                placeholder="اكتب للبحث..."
                disabled={!sectionId}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Two-column on desktop: students list + sticky note panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* Students list */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleAll}
                disabled={students.length === 0}
                className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:no-underline"
              >
                {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                {allSelected ? 'إلغاء اختيار الكل' : 'اختيار الكل'}
              </button>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              <strong className="text-gray-900 dark:text-gray-100">{selected.size}</strong> محدّد من {students.length}
            </span>
          </div>

          {!sectionId ? (
            <div className="text-center text-gray-400 dark:text-gray-500 py-12 text-sm">
              اختر الصف والشعبة أولاً لعرض الطلاب
            </div>
          ) : studentsLoading ? (
            <SkeletonTable rows={6} cols={3} />
          ) : students.length === 0 ? (
            <div className="text-center text-gray-400 dark:text-gray-500 py-12 text-sm">
              لا يوجد طلاب مطابقون
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800 max-h-[calc(100vh-360px)] overflow-y-auto">
              {students.map((s) => {
                const checked = selected.has(s.id);
                const fullName = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ');
                return (
                  <li
                    key={s.id}
                    onClick={() => toggleOne(s.id)}
                    className={`flex items-center gap-3 py-2.5 px-2 -mx-2 rounded cursor-pointer transition-colors ${
                      checked ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{fullName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{s.student_id}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Note input panel — on mobile becomes a fixed bottom panel */}
        <div className="card lg:sticky lg:top-4 lg:self-start fixed bottom-0 inset-x-0 lg:relative lg:inset-auto rounded-t-2xl lg:rounded-xl border-t-2 lg:border lg:border-gray-200 dark:lg:border-gray-800 shadow-2xl lg:shadow-sm bg-white dark:bg-gray-900 z-40 max-h-[60vh] lg:max-h-none overflow-y-auto">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
            تسجيل ملاحظة
            {selected.size > 0 && (
              <span className="text-sm font-normal text-blue-600 dark:text-blue-400 mr-2">
                — لـ {selected.size} طالب
              </span>
            )}
          </h3>

          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <TypeButton
              active={noteType === 'positive'}
              onClick={() => { setNoteType('positive'); setPickedTemplateId(null); }}
              tone="green"
              Icon={ThumbsUp}
              label="إيجابية"
            />
            <TypeButton
              active={noteType === 'negative'}
              onClick={() => { setNoteType('negative'); setPickedTemplateId(null); }}
              tone="red"
              Icon={ThumbsDown}
              label="سلبية"
            />
          </div>

          {/* Category filter */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <CategoryChip active={noteCategory === 'general'} onClick={() => setNoteCategory('general')} label="الكل" />
            {(['academic', 'behavior', 'attendance', 'participation'] as NoteCategory[]).map((c) => (
              <CategoryChip
                key={c}
                active={noteCategory === c}
                onClick={() => setNoteCategory(c)}
                label={CATEGORY_LABELS[c]}
              />
            ))}
          </div>

          {/* Template chips */}
          {visibleTemplates.length > 0 && (
            <div className="space-y-1.5 mb-3 max-h-32 overflow-y-auto">
              {visibleTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTemplate(t)}
                  className={`w-full text-right px-3 py-2 rounded-lg text-sm border transition-colors ${
                    pickedTemplateId === t.id
                      ? noteType === 'positive'
                        ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                        : 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                      : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <span className="ms-1">{t.icon}</span> {t.text}
                </button>
              ))}
            </div>
          )}

          {/* Free text + voice */}
          <div className="relative">
            <textarea
              value={noteText + (speech.interim ? ' ' + speech.interim : '')}
              onChange={(e) => { setNoteText(e.target.value); setPickedTemplateId(null); }}
              className="input min-h-[100px] pe-12"
              placeholder="اكتب الملاحظة هنا، أو اختر قالباً، أو اضغط الميكروفون لتسجيل صوتي..."
              maxLength={1000}
            />
            <button
              onClick={() => speech.listening ? speech.stop() : speech.start()}
              disabled={!speech.supported}
              title={speech.supported ? (speech.listening ? 'إيقاف التسجيل' : 'تسجيل صوتي') : 'المتصفح لا يدعم التعرف الصوتي'}
              className={`absolute top-2 left-2 p-2 rounded-lg transition-colors ${
                speech.listening
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/30 disabled:opacity-30 disabled:cursor-not-allowed'
              }`}
            >
              {speech.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>

          {/* Char count + clear */}
          <div className="flex items-center justify-between mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span>{noteText.length}/1000</span>
            <div className="flex items-center gap-2">
              {speech.error && (
                <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {speech.error}
                </span>
              )}
              {speech.listening && (
                <span className="text-red-600 dark:text-red-400 inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> جارٍ التسجيل...
                </span>
              )}
              {(noteText || speech.transcript) && (
                <button
                  onClick={clearNote}
                  className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200"
                  title="مسح النص"
                >
                  <Eraser className="w-3 h-3" /> مسح
                </button>
              )}
            </div>
          </div>

          {!speech.supported && (
            <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-400 inline-flex items-start gap-1">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5" />
              التسجيل الصوتي يحتاج Chrome أو Edge مع HTTPS (يعمل على localhost)
            </p>
          )}

          {/* WhatsApp opt-in — defaults ON. Unchecking saves without sending. */}
          <label
            className={`mt-4 flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${
              sendWhatsapp
                ? 'border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-500/10 text-green-800 dark:text-green-300'
                : 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400'
            }`}
          >
            <input
              type="checkbox"
              checked={sendWhatsapp}
              onChange={(e) => setSendWhatsapp(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="flex-1">إرسال رسالة واتساب لولي الأمر</span>
            <span className="text-xs opacity-70">
              {sendWhatsapp ? '✓ سيُرسل عند الحفظ' : 'لن يُرسل'}
            </span>
          </label>

          {/* Save button */}
          <button
            onClick={() => saveMut.mutate()}
            disabled={!canSave}
            className="btn-primary w-full mt-2 inline-flex items-center justify-center gap-2"
          >
            {saveMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Save className="w-4 h-4" />
                {sendWhatsapp
                  ? `حفظ + واتساب + طباعة (${selected.size})`
                  : `حفظ وطباعة (${selected.size})`}
              </>
            )}
          </button>

          {selected.size === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-2">
              حدّد طالباً واحداً على الأقل لتفعيل الحفظ
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeButton({ active, onClick, tone, Icon, label }: {
  active: boolean; onClick: () => void; tone: 'green' | 'red'; Icon: any; label: string;
}) {
  const cls = active
    ? tone === 'green'
      ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
      : 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
    : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60';
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 py-2 rounded-lg border-2 transition-colors ${cls}`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function CategoryChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
          : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  );
}
