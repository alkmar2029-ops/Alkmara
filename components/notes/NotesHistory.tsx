'use client';

// سجل الملاحظات — shared history list for the dashboard notes page
// (mode="admin": all notes + grade/section filters) and the teacher
// portal (mode="teacher": the API already scopes to the teacher's own
// recordings, so only type/date filters are shown).
//
// Edit/delete buttons appear only on rows the API marked can_edit
// (own note, or super_admin). Both actions warn when a WhatsApp
// message was already delivered for the note — editing/deleting here
// cannot retract it.

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ThumbsUp, ThumbsDown, Pencil, Trash2, X, Loader2,
  MessageCircle, Printer, AlertTriangle, History,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import type { NoteCategory, NoteType } from '@/lib/types/database';

const CATEGORY_LABELS: Record<NoteCategory, string> = {
  academic:      'أكاديمي',
  behavior:      'سلوكي',
  attendance:    'حضور',
  participation: 'مشاركة',
  general:       'عام',
};

interface NoteRow {
  id: number;
  student_id: number;
  text: string;
  type: NoteType;
  category: NoteCategory;
  source: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
  batch_id: string | null;
  whatsapp_sent_at: string | null;
  printed_at: string | null;
  can_edit: boolean;
  student_code: string | null;
  student_name: string | null;
  grade_name: string | null;
  section_name: string | null;
}

const LIST_LIMIT = 200;

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default function NotesHistory({
  mode,
  initialStudentId = null,
}: {
  mode: 'admin' | 'teacher';
  initialStudentId?: number | null;
}) {
  const qc = useQueryClient();

  // Filters
  const [typeFilter, setTypeFilter] = useState<'' | NoteType>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [studentFilter, setStudentFilter] = useState<number | null>(initialStudentId);

  // Edit / delete targets
  const [editTarget, setEditTarget] = useState<NoteRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NoteRow | null>(null);

  // Admin-only filter sources (same query keys as the recording tab so
  // the cache is shared).
  const { data: grades = [] } = useQuery<any[]>({
    queryKey: ['grades-all'],
    queryFn: async () => {
      const r = await fetch('/api/grades');
      if (!r.ok) throw new Error('فشل تحميل الصفوف');
      return ((await r.json()).data || []) as any[];
    },
    enabled: mode === 'admin',
  });
  const { data: sections = [] } = useQuery<any[]>({
    queryKey: ['sections', gradeId],
    queryFn: async () => (await (await fetch(`/api/sections?grade_id=${gradeId}`)).json()).data,
    enabled: mode === 'admin' && !!gradeId,
  });

  const listQuery = useQuery<NoteRow[]>({
    queryKey: ['student-notes', 'history', mode, typeFilter, from, to, sectionId, studentFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', String(LIST_LIMIT));
      if (typeFilter) params.set('type', typeFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (mode === 'admin' && sectionId) params.set('section_id', sectionId);
      if (studentFilter) params.set('student_id', String(studentFilter));
      const r = await fetch(`/api/student-notes?${params}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل تحميل الملاحظات');
      return (body.data ?? []) as NoteRow[];
    },
  });
  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  // Name for the active student chip — from the rows when available.
  const studentChipName = useMemo(() => {
    if (!studentFilter) return null;
    return rows.find((r) => r.student_id === studentFilter)?.student_name
      ?? `طالب #${studentFilter}`;
  }, [studentFilter, rows]);

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/student-notes/${id}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل الحذف');
      return body;
    },
    onSuccess: () => {
      toast.success('تم حذف الملاحظة');
      qc.invalidateQueries({ queryKey: ['student-notes'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e.message || 'فشل الحذف'),
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card">
        <div className={`grid grid-cols-2 gap-3 ${mode === 'admin' ? 'sm:grid-cols-5' : 'sm:grid-cols-3'}`}>
          <div>
            <label className="label">النوع</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | NoteType)} className="input">
              <option value="">الكل</option>
              <option value="positive">إيجابية</option>
              <option value="negative">سلبية</option>
            </select>
          </div>
          <div>
            <label className="label">من تاريخ</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">إلى تاريخ</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
          </div>
          {mode === 'admin' && (
            <>
              <div>
                <label className="label">الصف</label>
                <select
                  value={gradeId}
                  onChange={(e) => { setGradeId(e.target.value); setSectionId(''); }}
                  className="input"
                >
                  <option value="">الكل</option>
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
                  <option value="">الكل</option>
                  {sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </>
          )}
        </div>

        {/* Active student filter chip (arrives via ?student_id=N) */}
        {studentFilter && (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 text-sm text-blue-800 dark:text-blue-300">
            <span>ملاحظات الطالب: <strong>{studentChipName}</strong></span>
            <button
              onClick={() => setStudentFilter(null)}
              className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-200"
              title="إلغاء تصفية الطالب"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold inline-flex items-center gap-2">
            <History className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            {mode === 'teacher' ? 'ملاحظاتي السابقة' : 'سجل الملاحظات'}
          </h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {rows.length} ملاحظة
            {rows.length >= LIST_LIMIT && ' (أحدث ' + LIST_LIMIT + ' — ضيّق بالفلاتر لعرض الأقدم)'}
          </span>
        </div>

        {listQuery.isLoading ? (
          <SkeletonTable rows={6} cols={3} />
        ) : listQuery.isError ? (
          <div className="text-center py-10 text-sm text-red-600 dark:text-red-400">
            {listQuery.error instanceof Error ? listQuery.error.message : 'فشل تحميل الملاحظات'}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 py-12 text-sm">
            لا توجد ملاحظات مطابقة للفلاتر
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((n) => (
              <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <span
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      n.type === 'positive'
                        ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
                    }`}
                  >
                    {n.type === 'positive' ? <ThumbsUp className="w-4 h-4" /> : <ThumbsDown className="w-4 h-4" />}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{n.student_name ?? '—'}</span>
                      {(n.grade_name || n.section_name) && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                          {[n.grade_name, n.section_name].filter(Boolean).join(' / ')}
                        </span>
                      )}
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300">
                        {CATEGORY_LABELS[n.category] ?? n.category}
                      </span>
                    </div>

                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 leading-relaxed whitespace-pre-wrap">
                      {n.text}
                    </p>

                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 flex-wrap">
                      <span className="font-mono" dir="ltr">{formatDateTime(n.recorded_at)}</span>
                      {n.recorded_by_name && (
                        <>
                          <span>•</span>
                          <span>سجّلها {n.recorded_by_name}</span>
                        </>
                      )}
                      {n.whatsapp_sent_at && (
                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                          <MessageCircle className="w-3 h-3" /> أُرسلت واتساب
                        </span>
                      )}
                      {n.printed_at && (
                        <span className="inline-flex items-center gap-1">
                          <Printer className="w-3 h-3" /> طُبعت
                        </span>
                      )}
                    </div>
                  </div>

                  {n.can_edit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditTarget(n)}
                        className="p-1.5 rounded-md text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:text-gray-400 dark:hover:text-blue-400 dark:hover:bg-blue-500/10 transition-colors"
                        title="تعديل الملاحظة"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(n)}
                        className="p-1.5 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-500/10 transition-colors"
                        title="حذف الملاحظة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Edit modal */}
      {editTarget && (
        <EditNoteModal
          note={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            qc.invalidateQueries({ queryKey: ['student-notes'] });
          }}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="حذف الملاحظة"
        message={
          deleteTarget
            ? `سيتم حذف ملاحظة الطالب «${deleteTarget.student_name ?? '—'}» نهائياً ولا يمكن استرجاعها.${
                deleteTarget.whatsapp_sent_at
                  ? ' تنبيه: رسالة الواتساب التي أُرسلت لولي الأمر لن تُسحب بالحذف.'
                  : ''
              }`
            : ''
        }
        confirmText={deleteMut.isPending ? 'جارٍ الحذف...' : 'حذف نهائي'}
        cancelText="إلغاء"
        variant="danger"
        onConfirm={() => deleteTarget && !deleteMut.isPending && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ==================== Edit modal ====================

function EditNoteModal({
  note, onClose, onSaved,
}: {
  note: NoteRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(note.text);
  const [type, setType] = useState<NoteType>(note.type);
  const [category, setCategory] = useState<NoteCategory>(note.category);

  const saveMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/student-notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), type, category }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || 'فشل حفظ التعديل');
      return body;
    },
    onSuccess: () => {
      toast.success('تم تعديل الملاحظة');
      onSaved();
    },
    onError: (e: any) => toast.error(e.message || 'فشل حفظ التعديل'),
  });

  const canSave = text.trim().length >= 2 && !saveMut.isPending;

  return (
    <Modal isOpen onClose={onClose} title="تعديل الملاحظة" maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 text-sm">
          <span className="text-gray-500 dark:text-gray-400">الطالب: </span>
          <span className="font-medium">{note.student_name ?? '—'}</span>
          {(note.grade_name || note.section_name) && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ms-2">
              {[note.grade_name, note.section_name].filter(Boolean).join(' / ')}
            </span>
          )}
        </div>

        {note.whatsapp_sent_at && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              أُرسلت رسالة واتساب لولي الأمر بهذه الملاحظة — تعديلها هنا يغيّر السجل فقط ولا يغيّر الرسالة المرسلة.
            </span>
          </div>
        )}

        {/* Type toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType('positive')}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg border-2 transition-colors ${
              type === 'positive'
                ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
            }`}
          >
            <ThumbsUp className="w-4 h-4" /> إيجابية
          </button>
          <button
            type="button"
            onClick={() => setType('negative')}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg border-2 transition-colors ${
              type === 'negative'
                ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
            }`}
          >
            <ThumbsDown className="w-4 h-4" /> سلبية
          </button>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CATEGORY_LABELS) as NoteCategory[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
                category === c
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        {/* Text */}
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input min-h-[100px]"
            maxLength={1000}
            placeholder="نص الملاحظة..."
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{text.length}/1000</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end pt-1">
          <button type="button" onClick={onClose} className="btn-secondary w-full sm:w-auto" disabled={saveMut.isPending}>
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={!canSave}
            className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2"
          >
            {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            حفظ التعديل
          </button>
        </div>
      </div>
    </Modal>
  );
}
