'use client';

import { useState, useMemo, Suspense, Fragment } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  MessageCircle, Filter, Search, Calendar, Printer, Loader2,
  CheckCircle2, XCircle, X, Users, BookOpen, Shield, User as UserIcon,
  ChevronDown, ChevronUp, FileText,
} from 'lucide-react';
import MessageBodyViewer from '@/components/whatsapp/MessageBodyViewer';

interface Msg {
  id: number;
  recipient_phone: string;
  recipient_name: string | null;
  recipient_type: 'parent' | 'teacher' | 'admin' | 'unknown';
  context_type: string | null;
  context_id: string | null;
  template_name: string | null;
  message_body: string;
  status: 'success' | 'failed';
  error_message: string | null;
  sent_by: string | null;
  sender_name: string | null;
  sender_role: string | null;
  sent_at: string;
}

// Hint text for "copy-helper" templates — short messages that exist
// only to give the recipient a clean long-press → copy target. Without
// this, viewers see a bare value (e.g. just a password) and panic.
const TEMPLATE_HINT: Record<string, string> = {
  teacher_password_only: '📌 رسالة قصيرة للنسخ السريع — التعليمات الكاملة + الرابط + البريد في رسالة "بيانات الدخول" التي سُبقَت بها.',
  teacher_email_only: '📌 رسالة قصيرة للنسخ السريع — التعليمات الكاملة + الرابط + كلمة السر في رسالة "بيانات الدخول" التي سُبقَت بها.',
};

interface Stats { success: number; failed: number; today: number; last_24h: number }

const RECIPIENT_LABEL: Record<string, string> = {
  parent: 'ولي أمر', teacher: 'معلم', admin: 'إدارة', unknown: 'غير محدد',
};
const CONTEXT_LABEL: Record<string, string> = {
  note: 'ملاحظة', late: 'تأخير', teacher_credentials: 'بيانات دخول', manual: 'يدوي',
  dismissal: 'استئذان', daily_attendance: 'غياب يومي', bulk_remind: 'تذكير جماعي',
};
const SENDER_ROLE_LABEL: Record<string, string> = {
  super_admin: 'المدير العام', admin: 'الإدارة', staff: 'الإدارة', teacher: 'معلم',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function nDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function startOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}

export default function WhatsappReportPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>}>
      <ReportInner />
    </Suspense>
  );
}

function ReportInner() {
  // Pre-fill context_id from URL — supports deep links from the
  // whatsapp-log page's "related messages" button.
  const sp = useSearchParams();
  const urlContextId = sp.get('context_id') || '';

  // ---- Filters ----
  // When opened with a context_id, widen the date window so the user
  // sees the full sequence (otherwise today's filter might hide older
  // related messages).
  const [from, setFrom] = useState(urlContextId ? nDaysAgo(30) : todayStr());
  const [to, setTo] = useState(todayStr());
  const [senderRole, setSenderRole] = useState<'' | 'admin' | 'super_admin' | 'teacher'>('');
  const [sentBy, setSentBy] = useState<string>('');           // specific user_id
  const [recipientType, setRecipientType] = useState<string>('');
  const [studentId, setStudentId] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState<string>('');
  const [gradeId, setGradeId] = useState<string>('');
  const [sectionId, setSectionId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'' | 'success' | 'failed'>('');
  const [contextFilter, setContextFilter] = useState<string>('');
  // contextId is set when the user clicks "الرسائل المرتبطة" on an
  // expanded row — surfaces all messages sharing the same context_id.
  // Initial value comes from the URL (deep link from whatsapp-log).
  const [contextId, setContextId] = useState<string>(urlContextId);
  const [groupBy, setGroupBy] = useState<'none' | 'day' | 'sender' | 'grade'>('none');
  const [expanded, setExpanded] = useState<number | null>(null);

  // ---- Reference data for the pickers ----
  const { data: teachers = [] } = useQuery<{ user_id: string; full_name: string }[]>({
    queryKey: ['report-wa-teachers'],
    queryFn: async () => {
      const r = await fetch('/api/teachers');
      if (!r.ok) return [];
      const d = await r.json();
      return (d.data || []).filter((t: any) => t.is_active !== false);
    },
  });

  const { data: grades = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['report-wa-grades'],
    queryFn: async () => {
      const r = await fetch('/api/grades');
      if (!r.ok) return [];
      return (await r.json()).data || [];
    },
  });

  const { data: sections = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['report-wa-sections', gradeId],
    queryFn: async () => {
      if (!gradeId) return [];
      const r = await fetch(`/api/sections?grade_id=${gradeId}`);
      if (!r.ok) return [];
      return (await r.json()).data || [];
    },
    enabled: !!gradeId,
  });

  const { data: studentMatches = [] } = useQuery<any[]>({
    queryKey: ['report-wa-student-search', studentSearch],
    queryFn: async () => {
      if (studentSearch.trim().length < 2) return [];
      const r = await fetch(`/api/students?search=${encodeURIComponent(studentSearch.trim())}&limit=10`);
      return (await r.json()).data || [];
    },
    enabled: studentSearch.trim().length >= 2 && !studentId,
  });

  // ---- Build query string ----
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (senderRole) p.set('sender_role', senderRole);
    if (sentBy) p.set('sent_by', sentBy);
    if (recipientType) p.set('type', recipientType);
    if (studentId) p.set('student_id', studentId);
    if (gradeId && !studentId) p.set('grade_id', gradeId);
    if (sectionId && !studentId) p.set('section_id', sectionId);
    if (statusFilter) p.set('status', statusFilter);
    if (contextFilter) p.set('context', contextFilter);
    if (contextId) p.set('context_id', contextId);
    p.set('limit', '500');
    return p.toString();
  }, [from, to, senderRole, sentBy, recipientType, studentId, gradeId, sectionId, statusFilter, contextFilter, contextId]);

  const { data, isLoading, isFetching } = useQuery<{ data: Msg[]; total: number; stats: Stats }>({
    queryKey: ['wa-report', queryString],
    queryFn: async () => (await fetch(`/api/whatsapp/messages?${queryString}`)).json(),
  });

  const messages = data?.data || [];
  const stats = data?.stats || { success: 0, failed: 0, today: 0, last_24h: 0 };

  // Selected student/teacher labels for the filter chip strip.
  const selectedStudent = studentMatches.find((s: any) => String(s.id) === studentId);
  const selectedTeacher = teachers.find((t) => t.user_id === sentBy);

  // ---- Grouping ----
  const grouped = useMemo(() => {
    if (groupBy === 'none') return null;
    const map = new Map<string, Msg[]>();
    for (const m of messages) {
      let key = '—';
      if (groupBy === 'day') {
        key = m.sent_at.slice(0, 10);
      } else if (groupBy === 'sender') {
        key = m.sender_name || (m.sender_role ? SENDER_ROLE_LABEL[m.sender_role] || m.sender_role : 'النظام');
      } else if (groupBy === 'grade') {
        // Grouping by grade requires us to know the recipient's grade —
        // we don't have it on the message row. Fall back to "ولي أمر / معلم".
        key = RECIPIENT_LABEL[m.recipient_type] || 'غير محدد';
      }
      const arr = map.get(key) || [];
      arr.push(m);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [groupBy, messages]);

  const clearFilters = () => {
    setFrom(todayStr()); setTo(todayStr());
    setSenderRole(''); setSentBy('');
    setRecipientType('');
    setStudentId(''); setStudentSearch('');
    setGradeId(''); setSectionId('');
    setStatusFilter(''); setContextFilter('');
    setContextId('');
  };

  // Print URL — pass current filters so the print page renders the same set.
  const printHref = `/dashboard/reports/whatsapp/print?${queryString}&group_by=${groupBy}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            تقرير رسائل الواتساب
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            استعراض الرسائل الصادرة من النظام مع فلاتر متقدمة وطباعة احترافية
          </p>
        </div>
        <a
          href={printHref}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary inline-flex items-center gap-2"
        >
          <Printer className="w-4 h-4" />
          طباعة التقرير
        </a>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={MessageCircle} label="إجمالي" value={data?.total ?? 0} tone="blue" />
        <StatCard icon={CheckCircle2} label="ناجحة" value={stats.success} tone="green" />
        <StatCard icon={XCircle} label="فاشلة" value={stats.failed} tone="red" />
        <StatCard icon={Calendar} label="اليوم" value={stats.today} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* ---- Sidebar filters ---- */}
        <aside className="card space-y-4 lg:sticky lg:top-4 self-start">
          <h2 className="font-bold text-base flex items-center gap-1.5">
            <Filter className="w-4 h-4" /> الفلاتر
          </h2>

          {/* Date presets */}
          <div className="space-y-1.5">
            <label className="label text-xs">الفترة</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => { setFrom(todayStr()); setTo(todayStr()); }} className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60">اليوم</button>
              <button onClick={() => { setFrom(nDaysAgo(1)); setTo(nDaysAgo(1)); }} className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60">أمس</button>
              <button onClick={() => { setFrom(nDaysAgo(6)); setTo(todayStr()); }} className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60">٧ أيام</button>
              <button onClick={() => { setFrom(startOfMonth()); setTo(todayStr()); }} className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60">هذا الشهر</button>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input text-sm" max={todayStr()} />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input text-sm" max={todayStr()} />
            </div>
          </div>

          {/* Sender */}
          <div className="space-y-1.5">
            <label className="label text-xs flex items-center gap-1"><Shield className="w-3 h-3" /> المُرسِل</label>
            <div className="grid grid-cols-3 gap-1.5">
              <RoleChip active={!senderRole} onClick={() => { setSenderRole(''); setSentBy(''); }} label="الكل" />
              <RoleChip active={senderRole === 'admin'} onClick={() => { setSenderRole('admin'); setSentBy(''); }} label="الإدارة" />
              <RoleChip active={senderRole === 'teacher'} onClick={() => { setSenderRole('teacher'); }} label="المعلمون" />
            </div>
            {senderRole === 'teacher' && (
              <select value={sentBy} onChange={(e) => setSentBy(e.target.value)} className="input text-sm">
                <option value="">— كل المعلمين —</option>
                {teachers.map((t) => (
                  <option key={t.user_id} value={t.user_id}>{t.full_name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Recipient */}
          <div className="space-y-1.5">
            <label className="label text-xs flex items-center gap-1"><UserIcon className="w-3 h-3" /> المُستقبِل</label>
            <select value={recipientType} onChange={(e) => setRecipientType(e.target.value)} className="input text-sm">
              <option value="">— كل الأنواع —</option>
              <option value="parent">ولي أمر</option>
              <option value="teacher">معلم</option>
              <option value="admin">إدارة</option>
            </select>
          </div>

          {/* Student picker */}
          <div className="space-y-1.5">
            <label className="label text-xs flex items-center gap-1"><Users className="w-3 h-3" /> طالب محدد</label>
            {selectedStudent ? (
              <div className="flex items-center gap-1 p-1.5 rounded bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 text-xs">
                <span className="flex-1 truncate">{selectedStudent.first_name} {selectedStudent.last_name}</span>
                <button onClick={() => { setStudentId(''); setStudentSearch(''); }} className="p-0.5 hover:bg-blue-100 dark:hover:bg-blue-500/20 rounded">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 right-2 text-gray-400" />
                  <input
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="بحث بالاسم أو رقم..."
                    className="input text-sm pe-7"
                  />
                </div>
                {studentMatches.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded text-xs divide-y divide-gray-100 dark:divide-gray-800">
                    {studentMatches.map((s: any) => (
                      <li key={s.id}>
                        <button
                          onClick={() => { setStudentId(String(s.id)); setStudentSearch(`${s.first_name} ${s.last_name}`); }}
                          className="w-full text-right p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        >
                          {s.first_name} {s.father_name || ''} {s.last_name}
                          <span className="block text-[10px] opacity-60 font-mono" dir="ltr">{s.student_id}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Grade + section */}
          <div className="space-y-1.5">
            <label className="label text-xs flex items-center gap-1"><BookOpen className="w-3 h-3" /> صف / شعبة</label>
            <select value={gradeId} onChange={(e) => { setGradeId(e.target.value); setSectionId(''); }} className="input text-sm" disabled={!!studentId}>
              <option value="">— كل الصفوف —</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="input text-sm" disabled={!gradeId || !!studentId}>
              <option value="">— كل الشعب —</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="label text-xs">الحالة</label>
            <div className="grid grid-cols-3 gap-1.5">
              <RoleChip active={!statusFilter} onClick={() => setStatusFilter('')} label="الكل" />
              <RoleChip active={statusFilter === 'success'} onClick={() => setStatusFilter('success')} label="✅ ناجحة" tone="green" />
              <RoleChip active={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')} label="❌ فاشلة" tone="red" />
            </div>
          </div>

          {/* Context */}
          <div className="space-y-1.5">
            <label className="label text-xs flex items-center gap-1"><FileText className="w-3 h-3" /> نوع الرسالة</label>
            <select value={contextFilter} onChange={(e) => setContextFilter(e.target.value)} className="input text-sm">
              <option value="">— كل الأنواع —</option>
              {Object.entries(CONTEXT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {/* Grouping */}
          <div className="space-y-1.5 pt-2 border-t border-gray-200 dark:border-gray-700">
            <label className="label text-xs">تجميع حسب</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)} className="input text-sm">
              <option value="none">— بدون تجميع —</option>
              <option value="day">حسب اليوم</option>
              <option value="sender">حسب المُرسِل</option>
              <option value="grade">حسب نوع المُستقبِل</option>
            </select>
          </div>

          <button
            onClick={clearFilters}
            className="w-full text-xs text-red-600 dark:text-red-400 hover:underline pt-1"
          >
            مسح كل الفلاتر
          </button>
        </aside>

        {/* ---- Results ---- */}
        <section className="space-y-3">
          {/* Active filters chip strip */}
          {(senderRole || sentBy || recipientType || studentId || gradeId || sectionId || statusFilter || contextFilter || contextId) && (
            <div className="card py-2 flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-gray-500 dark:text-gray-400">الفلاتر النشطة:</span>
              {senderRole && <Chip text={senderRole === 'teacher' ? 'المعلمون' : 'الإدارة'} />}
              {selectedTeacher && <Chip text={`👨‍🏫 ${selectedTeacher.full_name}`} />}
              {recipientType && <Chip text={`→ ${RECIPIENT_LABEL[recipientType]}`} />}
              {selectedStudent && <Chip text={`👤 ${selectedStudent.first_name} ${selectedStudent.last_name}`} />}
              {gradeId && !studentId && <Chip text={`🏫 ${grades.find(g => String(g.id) === gradeId)?.name || ''}`} />}
              {sectionId && <Chip text={`/ ${sections.find(s => String(s.id) === sectionId)?.name || ''}`} />}
              {statusFilter && <Chip text={statusFilter === 'success' ? '✅ ناجحة' : '❌ فاشلة'} />}
              {contextFilter && <Chip text={CONTEXT_LABEL[contextFilter] || contextFilter} />}
              {contextId && (
                <button onClick={() => setContextId('')} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 text-[11px] border border-purple-200 dark:border-purple-500/30 hover:bg-purple-200 dark:hover:bg-purple-500/30">
                  🔗 سلسلة مرتبطة
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="card text-center py-16">
              <Loader2 className="w-6 h-6 animate-spin inline text-gray-400" />
            </div>
          ) : messages.length === 0 ? (
            <div className="card text-center py-16">
              <MessageCircle className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">لا توجد رسائل مطابقة للفلاتر المحددة</p>
            </div>
          ) : groupBy === 'none' ? (
            <MessagesTable messages={messages} expanded={expanded} setExpanded={setExpanded} onShowRelated={setContextId} />
          ) : (
            grouped!.map(([key, items]) => (
              <div key={key} className="card p-0 overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-800/50 px-4 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                  <h3 className="font-bold text-sm">{key}</h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{items.length} رسالة</span>
                </div>
                <MessagesTable messages={items} expanded={expanded} setExpanded={setExpanded} onShowRelated={setContextId} compact />
              </div>
            ))
          )}

          {isFetching && !isLoading && (
            <p className="text-xs text-gray-400 text-center">جارٍ التحديث...</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ---- Helper components ----

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: 'blue'|'green'|'red'|'amber' }) {
  const cls = {
    blue:  'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
    green: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    red:   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
    amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
  }[tone];
  return (
    <div className={`card flex items-center gap-3 ${cls} border-current/20`}>
      <Icon className="w-6 h-6 shrink-0" />
      <div>
        <p className="text-xs opacity-80">{label}</p>
        <p className="text-xl font-bold">{value.toLocaleString('ar-SA')}</p>
      </div>
    </div>
  );
}

function RoleChip({ active, onClick, label, tone }: { active: boolean; onClick: () => void; label: string; tone?: 'green'|'red' }) {
  const activeCls = tone === 'green'
    ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/40'
    : tone === 'red'
      ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-500/40'
      : 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-500/40';
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-1 rounded border ${active ? activeCls : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}
    >
      {label}
    </button>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 text-[11px] border border-blue-200 dark:border-blue-500/30">
      {text}
    </span>
  );
}

function MessagesTable({
  messages, expanded, setExpanded, onShowRelated, compact = false,
}: {
  messages: Msg[];
  expanded: number | null;
  setExpanded: (id: number | null) => void;
  onShowRelated: (contextId: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? '' : 'card p-0 overflow-hidden'}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="text-right px-3 py-2 font-semibold">التاريخ/الوقت</th>
              <th className="text-right px-3 py-2 font-semibold">المُرسِل</th>
              <th className="text-right px-3 py-2 font-semibold">المُستقبِل</th>
              <th className="text-right px-3 py-2 font-semibold">النوع</th>
              <th className="text-right px-3 py-2 font-semibold">الحالة</th>
              <th className="text-right px-3 py-2 font-semibold w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {messages.map((m) => {
              const dt = new Date(m.sent_at);
              const isOpen = expanded === m.id;
              return (
                <Fragment key={m.id}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : m.id)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div>{dt.toLocaleDateString('ar-SA-u-ca-gregory')}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">{dt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{m.sender_name || (m.sender_role ? SENDER_ROLE_LABEL[m.sender_role] : 'النظام')}</div>
                      {m.sender_role && (
                        <div className="text-[10px] text-gray-500 dark:text-gray-400">{SENDER_ROLE_LABEL[m.sender_role] || m.sender_role}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium truncate max-w-[160px]">{m.recipient_name || '—'}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{m.recipient_phone}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px]">
                        {RECIPIENT_LABEL[m.recipient_type]}
                        {m.context_type ? ` / ${CONTEXT_LABEL[m.context_type] || m.context_type}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {m.status === 'success' ? (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" /> ناجحة
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-red-700 dark:text-red-400" title={m.error_message || ''}>
                          <XCircle className="w-3.5 h-3.5" /> فاشلة
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-50/60 dark:bg-gray-900/40">
                      <td colSpan={6} className="px-3 py-3 space-y-2">
                        {/* Template hint — shown only for known
                            "copy-helper" templates so admins don't get
                            confused by bare-value messages. */}
                        {m.template_name && TEMPLATE_HINT[m.template_name] && (
                          <div className="text-[11px] bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 text-blue-800 dark:text-blue-300 p-2 rounded">
                            {TEMPLATE_HINT[m.template_name]}
                          </div>
                        )}

                        <MessageBodyViewer body={m.message_body} />

                        {m.error_message && (
                          <p className="text-[11px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 p-2 rounded">
                            خطأ: {m.error_message}
                          </p>
                        )}

                        {/* Related-messages link + raw template name. */}
                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800">
                          {m.template_name && (
                            <span>القالب: <span className="font-mono">{m.template_name}</span></span>
                          )}
                          {m.context_id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onShowRelated(m.context_id!);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/25 border border-purple-200 dark:border-purple-500/30"
                              title="عرض كل الرسائل التي تشترك بنفس السياق (مثلاً السلسلة الكاملة لاعتماد المعلم)"
                            >
                              🔗 الرسائل المرتبطة بهذا السياق
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
