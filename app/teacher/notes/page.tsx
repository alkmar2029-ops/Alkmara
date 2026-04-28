'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  MessageSquarePlus, Search, Mic, MicOff, Save, ThumbsUp, ThumbsDown,
  CheckSquare, Square, Loader2, Eraser, AlertCircle, Calendar, Clock,
} from 'lucide-react';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { useSpeechToText } from '@/lib/hooks/useSpeechToText';
import { useClassSession } from '@/lib/hooks/useClassSession';
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
  academic: 'أكاديمي', behavior: 'سلوكي', attendance: 'حضور', participation: 'مشاركة', general: 'عام',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function TeacherNotesPage() {
  const router = useRouter();
  const qc = useQueryClient();

  // Class session — persists grade/section/date for ~45 minutes so the
  // teacher doesn't keep re-picking the same class.
  const { session, patch, loaded } = useClassSession();

  const [date, setDate] = useState<string>(todayStr());
  const [gradeId, setGradeId] = useState<string>('');
  const [sectionId, setSectionId] = useState<string>('');
  const [search, setSearch] = useState('');

  // Hydrate from class session once.
  useEffect(() => {
    if (!loaded) return;
    if (session.date) setDate(session.date);
    if (session.gradeId) setGradeId(String(session.gradeId));
    if (session.sectionId) setSectionId(String(session.sectionId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Persist on change (skip while still hydrating).
  useEffect(() => {
    if (!loaded) return;
    patch({
      date,
      gradeId: gradeId ? Number(gradeId) : null,
      sectionId: sectionId ? Number(sectionId) : null,
    });
  }, [date, gradeId, sectionId, loaded, patch]);

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Note input
  const [noteType, setNoteType] = useState<NoteType>('positive');
  const [noteCategory, setNoteCategory] = useState<NoteCategory>('general');
  const [noteText, setNoteText] = useState('');
  const [pickedTemplateId, setPickedTemplateId] = useState<number | null>(null);

  // Voice
  const speech = useSpeechToText({ lang: 'ar-SA' });
  const lastTranscriptRef = useRef('');
  useEffect(() => {
    if (speech.transcript && speech.transcript !== lastTranscriptRef.current) {
      const newPart = speech.transcript.slice(lastTranscriptRef.current.length).trim();
      if (newPart) setNoteText((prev) => (prev ? prev + ' ' : '') + newPart);
      lastTranscriptRef.current = speech.transcript;
    }
  }, [speech.transcript]);

  // ---- Data ----
  const { data: grades = [] } = useQuery<any[]>({
    queryKey: ['grades-all'],
    queryFn: async () => (await (await fetch('/api/grades')).json()).data,
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
    queryKey: ['students-for-notes-teacher', sectionId, search],
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

  // Templates filtered by teacher role.
  const { data: templates = [] } = useQuery<NoteTemplate[]>({
    queryKey: ['note-templates', 'teacher-audience'],
    queryFn: async () => (await (await fetch('/api/note-templates?active=1&for_role=teacher')).json()).data,
  });

  // Reset section when grade changes — but skip the first run so persisted
  // session_id survives initial mount.
  const gradeChangeSeen = useMemo(() => ({ count: 0 }), []);
  useEffect(() => {
    gradeChangeSeen.count++;
    if (gradeChangeSeen.count > 1) {
      setSectionId('');
      setSelected(new Set());
    }
  }, [gradeId, gradeChangeSeen]);
  useEffect(() => { setSelected(new Set()); }, [sectionId]);

  const visibleTemplates = useMemo(() =>
    templates
      .filter((t) => t.type === noteType && t.is_active)
      .filter((t) => noteCategory === 'general' ? true : t.category === noteCategory),
    [templates, noteType, noteCategory]);

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

  // ---- Save (NO WhatsApp from teacher portal) ----
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
      return result.data as { batch_id: string; count: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['student-notes'] });
      toast.success(`تم حفظ ${data.count} ملاحظة`);
      clearNote();
      setSelected(new Set());
      router.push(`/teacher/notes/print/${data.batch_id}`);
    },
    onError: (e: any) => toast.error(e.message || 'فشل الحفظ'),
  });

  const canSave =
    selected.size > 0 &&
    noteText.trim().length >= 2 &&
    !saveMut.isPending;

  return (
    <div className="space-y-3 pb-40 lg:pb-0">
      {/* Sticky filters — date + grade + section */}
      <div className="card sticky top-[60px] z-20 bg-white/95 dark:bg-gray-900/95 backdrop-blur">
        <div className="flex items-center gap-2 mb-2 text-xs text-gray-500 dark:text-gray-400">
          <MessageSquarePlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="font-semibold text-gray-900 dark:text-gray-100">تسجيل الملاحظات</span>
          <Clock className="w-3 h-3 ms-auto" />
          <span title="جلسة الصف تُحفَظ ٤٥ دقيقة">جلسة محفوظة</span>
        </div>
        <label className="block mb-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mb-1">
            <Calendar className="w-3 h-3" /> التاريخ
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            max={todayStr()}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الصف</label>
            <select value={gradeId} onChange={(e) => setGradeId(e.target.value)} className="input">
              <option value="">اختر</option>
              {grades.map((g: any) => (
                <option key={g.id} value={g.id}>
                  {g.name}{g.stage ? ` — ${STAGE_LABELS[g.stage]}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الشعبة</label>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="input" disabled={!gradeId}>
              <option value="">اختر</option>
              {sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        {sectionId && students.length > 12 && (
          <div className="relative mt-2">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input ps-9"
              placeholder="بحث بالاسم أو الهوية..."
            />
          </div>
        )}
      </div>

      {/* Students */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={toggleAll}
            disabled={students.length === 0}
            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          >
            {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            {allSelected ? 'إلغاء اختيار الكل' : 'اختيار الكل'}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            <strong className="text-gray-900 dark:text-gray-100">{selected.size}</strong> من {students.length}
          </span>
        </div>

        {!sectionId ? (
          <div className="text-center text-gray-400 dark:text-gray-500 py-12 text-sm">
            اختر الصف والشعبة
          </div>
        ) : studentsLoading ? (
          <SkeletonTable rows={6} cols={2} />
        ) : students.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 py-12 text-sm">
            لا يوجد طلاب
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800 max-h-[40vh] overflow-y-auto">
            {students.map((s) => {
              const checked = selected.has(s.id);
              const fullName = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ');
              return (
                <li
                  key={s.id}
                  onClick={() => toggleOne(s.id)}
                  className={`flex items-center gap-2 py-2 px-2 -mx-2 rounded cursor-pointer transition-colors ${
                    checked ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(s.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{fullName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{s.student_id}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Note panel */}
      <div className="card sticky bottom-0 z-30">
        <h3 className="font-semibold mb-2 text-sm">
          نص الملاحظة
          {selected.size > 0 && (
            <span className="font-normal text-blue-600 dark:text-blue-400 mr-2">
              لـ {selected.size} طالب
            </span>
          )}
        </h3>

        {/* Type toggle */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <TypeButton
            active={noteType === 'positive'}
            onClick={() => { setNoteType('positive'); setPickedTemplateId(null); }}
            tone="green" Icon={ThumbsUp} label="إيجابية"
          />
          <TypeButton
            active={noteType === 'negative'}
            onClick={() => { setNoteType('negative'); setPickedTemplateId(null); }}
            tone="red" Icon={ThumbsDown} label="سلبية"
          />
        </div>

        {/* Categories */}
        <div className="flex flex-wrap gap-1 mb-2">
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

        {/* Templates */}
        {visibleTemplates.length > 0 && (
          <div className="space-y-1 mb-2 max-h-28 overflow-y-auto">
            {visibleTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => pickTemplate(t)}
                className={`w-full text-right px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                  pickedTemplateId === t.id
                    ? noteType === 'positive'
                      ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                      : 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                    : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60'
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
            className="input min-h-[80px] pe-12 text-sm"
            placeholder="اكتب الملاحظة، أو اختر قالباً، أو اضغط الميكروفون..."
            maxLength={1000}
          />
          <button
            onClick={() => speech.listening ? speech.stop() : speech.start()}
            disabled={!speech.supported}
            title={speech.supported ? (speech.listening ? 'إيقاف' : 'تسجيل صوتي') : 'غير مدعوم'}
            className={`absolute top-2 left-2 p-2 rounded-lg ${
              speech.listening
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-400 disabled:opacity-30'
            }`}
          >
            {speech.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex items-center justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
          <span>{noteText.length}/1000</span>
          {(noteText || speech.transcript) && (
            <button onClick={clearNote} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200">
              <Eraser className="w-3 h-3" /> مسح
            </button>
          )}
        </div>

        {speech.error && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 inline-flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5" /> {speech.error}
          </p>
        )}

        <button
          onClick={() => saveMut.mutate()}
          disabled={!canSave}
          className="btn-primary w-full mt-3 inline-flex items-center justify-center gap-1.5"
        >
          {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          حفظ وطباعة ({selected.size})
        </button>
      </div>
    </div>
  );
}

function TypeButton({ active, onClick, tone, Icon, label }: any) {
  const cls = active
    ? tone === 'green'
      ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
      : 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
    : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60';
  return (
    <button onClick={onClick} className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg border-2 text-sm ${cls}`}>
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function CategoryChip({ active, onClick, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-full text-xs border ${
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
          : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
      }`}
    >
      {label}
    </button>
  );
}
