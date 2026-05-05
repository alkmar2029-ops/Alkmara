'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  LogOut, Plus, Search, Loader2, Calendar, Clock, User, Phone,
  CheckCircle2, XCircle, Printer, Trash2, AlertCircle, RefreshCw,
  X, MessageCircle, Users, FileText,
} from 'lucide-react';

interface DismissalRow {
  id: number;
  student_id: number;
  student_code: string;
  student_name: string;
  student_phone: string | null;
  grade_name: string;
  section_name: string;
  dismissal_date: string;
  dismissal_time: string;
  reason: string;
  reason_details: string | null;
  pickup_person_name: string;
  pickup_person_relationship: string;
  pickup_person_id_number: string | null;
  pickup_person_phone: string | null;
  approved_by_name: string | null;
  notes: string | null;
  whatsapp_sent_at: string | null;
  whatsapp_error: string | null;
  auto_excused_periods: number;
  created_at: string;
}

interface StudentSearchResult {
  id: number;
  student_id: string;
  first_name: string;
  father_name: string | null;
  last_name: string;
  phone: string | null;
  grades?: { name: string };
  sections?: { name: string };
  health_info?: { conditions?: string[]; notes?: string } | null;
}

const HEALTH_LABELS: Record<string, { label: string; emoji: string }> = {
  diabetes:     { label: 'السكري',       emoji: '🩸' },
  hypertension: { label: 'الضغط',         emoji: '💓' },
  heart:        { label: 'مشاكل القلب',   emoji: '❤️' },
  asthma:       { label: 'الربو',         emoji: '🫁' },
  allergy:      { label: 'حساسية',        emoji: '🌾' },
  epilepsy:     { label: 'الصرع',         emoji: '⚡' },
  vision:       { label: 'مشاكل البصر',   emoji: '👁️' },
  hearing:      { label: 'مشاكل السمع',   emoji: '👂' },
  other:        { label: 'أخرى',          emoji: '📋' },
};

const REASON_LABELS: Record<string, string> = {
  medical: '🏥 مراجعة طبية',
  family: '👨‍👩‍👧 ظرف عائلي',
  emergency: '⚠️ حالة طارئة',
  other: '📝 آخر',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  father: 'الوالد',
  mother: 'الوالدة',
  guardian: 'ولي الأمر',
  relative: 'قريب',
  other: 'مفوَّض',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default function DismissalsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'today' | 'week' | 'all'>('today');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  // Pre-selected student id when opened via /dashboard/dismissals?student_id=N
  // (from the student detail page or global search). Forwarded to the
  // create modal which fetches the student and pre-fills the picker.
  const [prefillStudentId, setPrefillStudentId] = useState<number | null>(null);

  // Auto-open the create modal with student pre-filled when the URL
  // arrives with ?student_id=N. Runs once on mount.
  const searchParams = useSearchParams();
  useEffect(() => {
    const sid = searchParams.get('student_id');
    if (!sid) return;
    const id = parseInt(sid, 10);
    if (Number.isNaN(id)) return;
    setPrefillStudentId(id);
    setShowCreate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery<DismissalRow[]>({
    queryKey: ['dismissals', tab],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tab === 'today') params.set('date', todayStr());
      else if (tab === 'week') {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        params.set('from', d.toISOString().slice(0, 10));
        params.set('to', todayStr());
      }
      params.set('limit', '200');
      const r = await fetch(`/api/dismissals?${params}`);
      if (!r.ok) throw new Error('فشل جلب السجل');
      return (await r.json()).data || [];
    },
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      r.student_name.toLowerCase().includes(q) ||
      r.student_code.includes(q) ||
      r.pickup_person_name.toLowerCase().includes(q),
    );
  }, [rows, search]);

  // Frequent-dismissal warning — flag students with 3+ dismissals in the
  // visible range. Helps the deputy spot patterns early.
  const frequentStudents = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.student_id, (counts.get(r.student_id) || 0) + 1);
    return new Set(Array.from(counts.entries()).filter(([, c]) => c >= 3).map(([id]) => id));
  }, [rows]);

  const stats = useMemo(() => ({
    total: rows.length,
    whatsappSent: rows.filter((r) => !!r.whatsapp_sent_at).length,
    autoExcused: rows.reduce((acc, r) => acc + (r.auto_excused_periods || 0), 0),
    flaggedStudents: frequentStudents.size,
  }), [rows, frequentStudents]);

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/dismissals/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الحذف');
    },
    onSuccess: () => {
      toast.success('تم الحذف');
      qc.invalidateQueries({ queryKey: ['dismissals'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center">
            <LogOut className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">سجل استئذان الطلاب</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              تسجيل خروج الطلاب من المدرسة قبل نهاية اليوم الدراسي
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary inline-flex items-center gap-1 text-sm">
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            تحديث
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary inline-flex items-center gap-1 text-sm">
            <Plus className="w-4 h-4" /> استئذان جديد
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card text-center py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">المجموع</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="card text-center py-3 bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30">
          <p className="text-xs text-green-700 dark:text-green-300">واتساب مُرسَل</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-400">{stats.whatsappSent}</p>
        </div>
        <div className="card text-center py-3 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30">
          <p className="text-xs text-blue-700 dark:text-blue-300">حصص استُؤذنت تلقائياً</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{stats.autoExcused}</p>
        </div>
        {stats.flaggedStudents > 0 && (
          <div className="card text-center py-3 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30">
            <p className="text-xs text-red-700 dark:text-red-300">طلاب يحتاجون متابعة</p>
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">{stats.flaggedStudents}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="card p-2 flex gap-1">
        {([
          { key: 'today', label: 'اليوم' },
          { key: 'week', label: 'آخر 7 أيام' },
          { key: 'all', label: 'الكل' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {rows.length > 5 && (
        <div className="card">
          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input ps-9"
              placeholder="بحث بالاسم، الهوية، أو اسم المُستلِم..."
            />
          </div>
        </div>
      )}

      {/* List */}
      <div className="card">
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12 text-sm">
            {rows.length === 0 ? 'لا توجد استئذانات في هذه الفترة' : 'لا توجد نتائج للبحث'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {filtered.map((r) => {
              const isFlagged = frequentStudents.has(r.student_id);
              return (
                <li key={r.id} className={`py-3 ${isFlagged ? 'bg-red-50/30 dark:bg-red-500/5 -mx-3 px-3 rounded-lg' : ''}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    {/* Time */}
                    <div className="bg-orange-100 dark:bg-orange-500/20 rounded-lg p-2 text-center min-w-[60px]">
                      <Clock className="w-4 h-4 mx-auto text-orange-700 dark:text-orange-400 mb-0.5" />
                      <p className="text-xs font-bold text-orange-800 dark:text-orange-300">{r.dismissal_time.slice(0, 5)}</p>
                      <p className="text-[10px] text-orange-700 dark:text-orange-400">
                        {new Date(r.dismissal_date).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>

                    {/* Student */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">{r.student_name}</p>
                        {isFlagged && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 inline-flex items-center gap-0.5">
                            <AlertCircle className="w-3 h-3" /> {Array.from(rows).filter((x) => x.student_id === r.student_id).length} استئذان
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        <span className="font-mono" dir="ltr">{r.student_code}</span>
                        {' • '}{r.grade_name} / {r.section_name}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                        {REASON_LABELS[r.reason] || r.reason}
                        {r.reason_details && ` — ${r.reason_details}`}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        👨 المُستلِم: {RELATIONSHIP_LABELS[r.pickup_person_relationship] || r.pickup_person_relationship} • {r.pickup_person_name}
                        {r.pickup_person_id_number && ` (هوية: ${r.pickup_person_id_number})`}
                      </p>
                    </div>

                    {/* Status badges */}
                    <div className="flex flex-col gap-1 items-end">
                      {r.whatsapp_sent_at ? (
                        <span className="text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                          <MessageCircle className="w-3 h-3" /> تم الإرسال
                        </span>
                      ) : (
                        <span className="text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" title={r.whatsapp_error || ''}>
                          <XCircle className="w-3 h-3" /> {r.whatsapp_error ? 'فشل' : 'لم يُرسَل'}
                        </span>
                      )}
                      {r.auto_excused_periods > 0 && (
                        <span className="text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                          🔄 {r.auto_excused_periods} حصة مستأذَنة
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/dashboard/dismissals/${r.id}/print`}
                        target="_blank"
                        className="p-1.5 rounded text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10"
                        title="طباعة تصريح الخروج"
                      >
                        <Printer className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => {
                          if (confirm(`حذف استئذان ${r.student_name}؟`)) deleteMut.mutate(r.id);
                        }}
                        className="p-1.5 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateDismissalModal
          onClose={() => { setShowCreate(false); setPrefillStudentId(null); }}
          prefillStudentId={prefillStudentId}
        />
      )}
    </div>
  );
}

// =================== Create modal ===================
function CreateDismissalModal({
  onClose, prefillStudentId,
}: {
  onClose: () => void;
  prefillStudentId?: number | null;
}) {
  const qc = useQueryClient();
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentSearchResult | null>(null);

  // Pre-fill the student when opened from a deep-link with student_id=N.
  // Runs once on mount; ignored if no prefill id was passed.
  useEffect(() => {
    if (!prefillStudentId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/students/${prefillStudentId}`);
        if (!r.ok) return;
        const { data } = await r.json();
        if (!cancelled && data) setSelectedStudent(data);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [reason, setReason] = useState<string>('other');
  const [reasonDetails, setReasonDetails] = useState('');
  const [pickupName, setPickupName] = useState('');
  const [pickupRelationship, setPickupRelationship] = useState<string>('father');
  const [pickupIdNumber, setPickupIdNumber] = useState('');
  const [pickupPhone, setPickupPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [sendWhatsapp, setSendWhatsapp] = useState(true);
  const [autoExcuse, setAutoExcuse] = useState(true);

  const { data: students = [] } = useQuery<StudentSearchResult[]>({
    queryKey: ['students-search-dismissal', studentSearch],
    queryFn: async () => {
      if (studentSearch.trim().length < 2) return [];
      const r = await fetch(`/api/students?search=${encodeURIComponent(studentSearch.trim())}&limit=20`);
      return (await r.json()).data || [];
    },
    enabled: studentSearch.trim().length >= 2,
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!selectedStudent) throw new Error('اختر الطالب أولاً');
      if (!pickupName.trim()) throw new Error('اسم المُستلِم مطلوب');

      const r = await fetch('/api/dismissals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: selectedStudent.id,
          reason,
          reason_details: reasonDetails || undefined,
          pickup_person_name: pickupName.trim(),
          pickup_person_relationship: pickupRelationship,
          pickup_person_id_number: pickupIdNumber || undefined,
          pickup_person_phone: pickupPhone || undefined,
          notes: notes || undefined,
          send_whatsapp: sendWhatsapp,
          auto_excuse_periods: autoExcuse,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الحفظ');
      return d.data as { id: number; auto_excused_periods: number; whatsapp_sent: boolean; whatsapp_error: string | null };
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['dismissals'] });
      const parts: string[] = ['تم تسجيل الاستئذان'];
      if (d.auto_excused_periods > 0) parts.push(`${d.auto_excused_periods} حصة مستأذَنة`);
      if (d.whatsapp_sent) parts.push('واتساب ✓');
      else if (d.whatsapp_error) parts.push(`واتساب ✗`);
      toast.success(parts.join(' • '));
      // Open the print exit pass for the security guard.
      window.open(`/dashboard/dismissals/${d.id}/print`, '_blank');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const canSubmit = !!selectedStudent && pickupName.trim().length >= 2 && !submitMut.isPending;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800 bg-orange-50 dark:bg-orange-500/10">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <LogOut className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            تسجيل استئذان جديد
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-500/20">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Student */}
          <div>
            <label className="label flex items-center gap-1"><Users className="w-3.5 h-3.5" /> الطالب *</label>
            {selectedStudent ? (
              <>
                <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                    {selectedStudent.first_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">
                      {[selectedStudent.first_name, selectedStudent.father_name, selectedStudent.last_name].filter(Boolean).join(' ')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      <span className="font-mono" dir="ltr">{selectedStudent.student_id}</span>
                      {' • '}{selectedStudent.grades?.name} / {selectedStudent.sections?.name}
                    </p>
                  </div>
                  <button onClick={() => { setSelectedStudent(null); setStudentSearch(''); }} className="text-red-500 hover:text-red-700 text-sm">تغيير</button>
                </div>
                {/* Health alert — surfaces medical conditions so the
                    deputy contacting the parent knows there's an
                    underlying condition that may justify the dismissal. */}
                {selectedStudent.health_info?.conditions && selectedStudent.health_info.conditions.length > 0 && (
                  <div className="mt-2 border-2 border-red-300 dark:border-red-500/50 bg-red-50 dark:bg-red-500/10 rounded-lg p-2.5">
                    <p className="text-xs font-bold text-red-900 dark:text-red-200 mb-1">
                      🏥 ⚠️ هذا الطالب لديه حالات صحية — انتبه!
                    </p>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {selectedStudent.health_info.conditions.map((c) => {
                        const info = HEALTH_LABELS[c] || { label: c, emoji: '📋' };
                        return (
                          <span
                            key={c}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 text-[10px] font-medium"
                          >
                            {info.emoji} {info.label}
                          </span>
                        );
                      })}
                    </div>
                    {selectedStudent.health_info.notes && (
                      <p className="text-[11px] text-red-800 dark:text-red-300 leading-tight">
                        📝 {selectedStudent.health_info.notes}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
                  <input
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    className="input ps-9"
                    placeholder="ابحث بالاسم أو رقم الهوية..."
                    autoFocus
                  />
                </div>
                {students.length > 0 && (
                  <ul className="mt-2 max-h-44 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800/50">
                    {students.map((s: any) => {
                      const gN = s.grades?.name || s.grade_name || '';
                      const sN = s.sections?.name || s.section_name || '';
                      const gradeLabel = (gN || sN) ? `${gN}${gN && sN ? ' / ' : ''}${sN}` : '';
                      return (
                        <li key={s.id}>
                          <button
                            onClick={() => setSelectedStudent(s)}
                            className="w-full text-right p-2 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">
                                {[s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ')}
                              </p>
                              {gradeLabel && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 font-medium">
                                  {gradeLabel}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              <span className="font-mono" dir="ltr">{s.student_id}</span>
                              {s.phone && (
                                <>
                                  {' • '}
                                  <span className="font-mono" dir="ltr">{s.phone}</span>
                                </>
                              )}
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Reason */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">سبب الاستئذان *</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="input">
                {Object.entries(REASON_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">تفاصيل (اختياري)</label>
              <input
                value={reasonDetails}
                onChange={(e) => setReasonDetails(e.target.value)}
                className="input"
                placeholder="موعد عند طبيب أسنان..."
                maxLength={500}
              />
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> بيانات المُستلِم
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="label">الاسم الكامل *</label>
                <input
                  value={pickupName}
                  onChange={(e) => setPickupName(e.target.value)}
                  className="input"
                  placeholder="مثال: محمد أحمد السهلي"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="label">صلة القرابة *</label>
                <select value={pickupRelationship} onChange={(e) => setPickupRelationship(e.target.value)} className="input">
                  {Object.entries(RELATIONSHIP_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">رقم الهوية (اختياري)</label>
                <input
                  value={pickupIdNumber}
                  onChange={(e) => setPickupIdNumber(e.target.value.replace(/\D/g, ''))}
                  className="input"
                  placeholder="1XXXXXXXXX"
                  maxLength={10}
                  dir="ltr"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">رقم الجوال (اختياري — للتأكيد)</label>
                <input
                  value={pickupPhone}
                  onChange={(e) => setPickupPhone(e.target.value)}
                  className="input"
                  placeholder="0555000000"
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label">ملاحظات للسجل (اختياري)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input"
              rows={2}
              maxLength={500}
            />
          </div>

          {/* Side-effect toggles */}
          <div className="card bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 space-y-2 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={sendWhatsapp} onChange={(e) => setSendWhatsapp(e.target.checked)} className="w-4 h-4" />
              <MessageCircle className="w-4 h-4 text-green-600" />
              <span>إرسال إشعار واتساب لولي الأمر</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={autoExcuse} onChange={(e) => setAutoExcuse(e.target.checked)} className="w-4 h-4" />
              <FileText className="w-4 h-4 text-blue-600" />
              <span>تحديث الحصص المتبقية تلقائياً (تحويلها لـ"مستأذن")</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800">إلغاء</button>
          <button
            onClick={() => submitMut.mutate()}
            disabled={!canSubmit}
            className="btn-primary inline-flex items-center gap-1 text-sm"
          >
            {submitMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الحفظ...</>
              : <><CheckCircle2 className="w-4 h-4" /> حفظ + طباعة التصريح</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
