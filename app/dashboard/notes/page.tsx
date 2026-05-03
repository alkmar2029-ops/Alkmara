'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  MessageSquarePlus, Search, Mic, MicOff, Save, X, ThumbsUp, ThumbsDown,
  CheckSquare, Square, Loader2, Eraser, Sparkles, AlertCircle, Users, ChevronDown, ChevronUp, Trash2,
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

  // Selection — keyed by student id, stores the full record so we can show
  // the student's grade/section in the "selected students" panel even after
  // the user changes the filter and the original list is no longer in view.
  // Using a Map (not a Set of ids) is what makes cross-grade/cross-section
  // multi-select work without re-fetching every selected student.
  const [selectedMap, setSelectedMap] = useState<Map<number, Student>>(new Map());
  // Panel is open by default — admins should see exactly who they're about
  // to message before they save. We collapse it only on explicit user action.
  const [showSelectedPanel, setShowSelectedPanel] = useState(true);

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

  // The list query fires when EITHER a section is picked OR the admin
  // typed at least 2 characters into the search. That way the search can
  // be used to hop across grades/sections — e.g. type "محمد" → pick the
  // right one → search "خالد" → pick → save for both at once.
  const trimmedSearch = search.trim();
  const searchActive = trimmedSearch.length >= 2;
  const isCrossSchoolSearch = searchActive && !sectionId;

  const { data: studentsResp, isLoading: studentsLoading } = useQuery<{ data: Student[] }>({
    queryKey: ['students-for-notes', sectionId, trimmedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sectionId) params.set('section_id', sectionId);
      if (trimmedSearch) params.set('search', trimmedSearch);
      // When searching across the whole school we use a smaller cap because
      // the result list is meant to be narrowed via search, not paged.
      params.set('limit', sectionId ? '500' : '50');
      const r = await fetch(`/api/students?${params}`);
      if (!r.ok) throw new Error('فشل تحميل الطلاب');
      return r.json();
    },
    enabled: !!sectionId || searchActive,
  });
  const students = studentsResp?.data ?? [];

  // Admin sees admin + both audiences (teacher templates are hidden here).
  const { data: templates = [] } = useQuery<NoteTemplate[]>({
    queryKey: ['note-templates', 'admin-audience'],
    queryFn: async () => (await (await fetch('/api/note-templates?active=1&for_role=admin')).json()).data,
  });

  // Reset section when grade changes — but keep the selection so admin can
  // pick students across multiple sections in one go.
  useEffect(() => { setSectionId(''); }, [gradeId]);

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
  // "All selected" is scoped to the *current view*; toggling all only adds or
  // removes the visible students, leaving selections from other sections intact.
  const allCurrentSelected = students.length > 0 && students.every((s) => selectedMap.has(s.id));
  const toggleAll = () => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (allCurrentSelected) {
        // Remove only the visible students — preserve out-of-view selections.
        for (const s of students) next.delete(s.id);
      } else {
        for (const s of students) next.set(s.id, s);
      }
      return next;
    });
  };
  const toggleOne = (s: Student) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(s.id)) next.delete(s.id);
      else next.set(s.id, s);
      return next;
    });
  };
  const removeSelected = (id: number) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };
  const clearAllSelected = () => setSelectedMap(new Map());

  // Group selected students by grade/section for the summary panel. The
  // student records may be missing the joined `grades`/`sections` fields if
  // they came from a search-by-name query — fall back to ids in that case.
  const groupedSelected = useMemo(() => {
    const groups = new Map<string, { label: string; students: Student[] }>();
    for (const s of selectedMap.values()) {
      const key = `${s.grade_id}-${s.section_id}`;
      const label = `${s.grades?.name || `صف #${s.grade_id}`} / ${s.sections?.name || `شعبة #${s.section_id}`}`;
      if (!groups.has(key)) groups.set(key, { label, students: [] });
      groups.get(key)!.students.push(s);
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [selectedMap]);

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
      const studentIds = Array.from(selectedMap.keys());
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
      setSelectedMap(new Map());
      router.push(`/dashboard/notes/print/${data.batch_id}`);
    },
    onError: (e: any) => toast.error(e.message || 'فشل الحفظ'),
  });

  const canSave =
    selectedMap.size > 0 &&
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
            <label className="label">بحث بالاسم/الهوية (في كامل المدرسة)</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input ps-9"
                placeholder="اكتب اسم الطالب أو رقم الهوية..."
              />
            </div>
            {!sectionId && trimmedSearch.length === 1 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                اكتب حرفين على الأقل للبحث في كامل المدرسة
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Cross-grade/section selection summary. Open by default so admins
          see exactly who they're about to message before saving. Each
          group is its own bordered block so it's easy to scan: which
          section, how many, and the names. */}
      {selectedMap.size > 0 && (
        <div className="card border-2 border-blue-300 dark:border-blue-500/40 bg-blue-50/70 dark:bg-blue-500/5">
          {/* Header bar — kept as a button so it can collapse if the list gets huge */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              onClick={() => setShowSelectedPanel((v) => !v)}
              className="flex items-center gap-2 text-right hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <Users className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="font-semibold text-blue-900 dark:text-blue-200">
                  المختارون عبر الصفوف
                  <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full ms-2">
                    {selectedMap.size} طالب
                  </span>
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  من {groupedSelected.length} {groupedSelected.length === 1 ? 'شعبة' : 'شعب'} مختلفة
                </p>
              </div>
              {showSelectedPanel
                ? <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                : <ChevronDown className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
            </button>
            <button
              onClick={() => {
                if (confirm(`مسح اختيار ${selectedMap.size} طالب؟`)) clearAllSelected();
              }}
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              <Trash2 className="w-3.5 h-3.5" /> مسح الكل
            </button>
          </div>

          {showSelectedPanel && (
            <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-500/30 space-y-3 max-h-[400px] overflow-y-auto">
              {groupedSelected.map((g) => (
                <div
                  key={g.label}
                  className="bg-white dark:bg-gray-900 border border-blue-100 dark:border-blue-500/20 rounded-lg p-3"
                >
                  {/* Group header */}
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-blue-100 dark:border-blue-500/20">
                    <h4 className="text-sm font-bold text-blue-900 dark:text-blue-200 inline-flex items-center gap-1.5">
                      📚 {g.label}
                      <span className="bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs px-2 py-0.5 rounded-full">
                        {g.students.length}
                      </span>
                    </h4>
                    <button
                      onClick={() => {
                        setSelectedMap((prev) => {
                          const next = new Map(prev);
                          for (const s of g.students) next.delete(s.id);
                          return next;
                        });
                      }}
                      className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      title="إزالة كل طلاب هذه الشعبة"
                    >
                      إزالة الشعبة
                    </button>
                  </div>

                  {/* Student rows — name + ID + remove button */}
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {g.students.map((s) => {
                      const fullName = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ');
                      return (
                        <li
                          key={s.id}
                          className="group inline-flex items-center gap-2 bg-gray-50 dark:bg-gray-800/60 hover:bg-blue-50 dark:hover:bg-blue-500/10 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                        >
                          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                            {fullName.charAt(0)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{fullName}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{s.student_id}</p>
                          </div>
                          <button
                            onClick={() => removeSelected(s.id)}
                            className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
                            title="إزالة من الاختيار"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-blue-700 dark:text-blue-300 mt-3 leading-relaxed flex items-start gap-1">
            <span>💡</span>
            <span>
              يمكنك تغيير الصف/الشعبة أو البحث — اختياراتك تبقى محفوظة. عند الحفظ ستُسجّل الملاحظة لكل المختارين دفعة واحدة.
            </span>
          </p>
        </div>
      )}

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
                {allCurrentSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                {allCurrentSelected ? 'إلغاء اختيار هذا العرض' : 'اختيار كل هذا العرض'}
              </button>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {selectedMap.size > 0 && (
                <span className="me-2 text-blue-600 dark:text-blue-400">
                  <strong>{selectedMap.size}</strong> محدّد إجمالاً
                </span>
              )}
              <strong className="text-gray-900 dark:text-gray-100">{students.filter((s) => selectedMap.has(s.id)).length}</strong> من {students.length} في هذا العرض
            </span>
          </div>

          {!sectionId && !searchActive ? (
            <div className="text-center text-gray-400 dark:text-gray-500 py-12 text-sm space-y-1">
              <p>اختر الصف والشعبة لعرض طلابها،</p>
              <p>أو ابحث بالاسم/الهوية في كامل المدرسة 🔍</p>
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
                const checked = selectedMap.has(s.id);
                const fullName = [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ');
                // Always show the grade/section badge — students with the
                // same name need to be distinguishable, not just in cross-
                // school search.
                const gN = s.grades?.name || (s as any).grade_name || '';
                const sN = s.sections?.name || (s as any).section_name || '';
                const gradeLabel = (gN || sN) ? `${gN}${gN && sN ? ' / ' : ''}${sN}` : null;
                return (
                  <li
                    key={s.id}
                    onClick={() => toggleOne(s)}
                    className={`flex items-center gap-3 py-2.5 px-2 -mx-2 rounded cursor-pointer transition-colors ${
                      checked ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(s)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{fullName}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-mono" dir="ltr">{s.student_id}</span>
                        {gradeLabel && (
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                            {gradeLabel}
                          </span>
                        )}
                      </div>
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
            {selectedMap.size > 0 && (
              <span className="text-sm font-normal text-blue-600 dark:text-blue-400 mr-2">
                — لـ {selectedMap.size} طالب
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
                  ? `حفظ + واتساب + طباعة (${selectedMap.size})`
                  : `حفظ وطباعة (${selectedMap.size})`}
              </>
            )}
          </button>

          {selectedMap.size === 0 && (
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
