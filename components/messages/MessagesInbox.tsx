'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Inbox, Send as SendIcon, Archive, MailOpen, Mail, User,
  GraduationCap, Loader2, Reply, ChevronLeft, X, Search, MessageCircle,
  CheckCircle2, AlertCircle,
} from 'lucide-react';
import type { InternalMessage } from '@/lib/types/database';

type Box = 'inbox' | 'sent' | 'archive';

interface ComposeContext {
  defaultRecipientId?: string;
  defaultRecipientRole?: 'admin' | 'teacher' | 'staff';
  defaultStudentId?: number;
  defaultSubject?: string;
  defaultType?: 'general' | 'student_referral' | 'student_notice';
  parentMessageId?: number;
  threadId?: string;
}

/**
 * Shared inbox UI used by both admin and teacher portals. Differs only by
 * which compose options the role sees:
 *   - admin/staff → can send to specific teacher OR broadcast to all teachers
 *   - teacher     → sends to admin (broadcast role) or replies
 */
export default function MessagesInbox({ role }: { role: 'admin' | 'staff' | 'teacher' }) {
  const qc = useQueryClient();
  const [box, setBox] = useState<Box>('inbox');
  const [openMessage, setOpenMessage] = useState<InternalMessage | null>(null);
  const [showCompose, setShowCompose] = useState<ComposeContext | null>(null);
  const [search, setSearch] = useState('');

  const { data: messages = [], isLoading, refetch } = useQuery<InternalMessage[]>({
    queryKey: ['messages', box],
    queryFn: async () => (await (await fetch(`/api/messages?box=${box}&limit=200`)).json()).data,
    refetchInterval: 30_000,
  });

  const { data: unread } = useQuery<{ count: number }>({
    queryKey: ['messages-unread'],
    queryFn: async () => (await (await fetch('/api/messages/unread-count')).json()),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.trim();
    return messages.filter((m) =>
      m.subject?.includes(q) || m.body.includes(q) ||
      m.sender_name?.includes(q) || m.recipient_name?.includes(q) ||
      m.student_name?.includes(q),
    );
  }, [messages, search]);

  const markReadMut = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['messages-unread'] });
    },
  });

  const archiveMut = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['messages-unread'] });
      toast.success('تمت الأرشفة');
    },
  });

  const handleOpen = (m: InternalMessage) => {
    setOpenMessage(m);
    if (m.status === 'sent' && !m.is_mine) markReadMut.mutate(m.id);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold">الرسائل الداخلية</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {unread?.count
              ? <>لديك <strong className="text-blue-600 dark:text-blue-400">{unread.count}</strong> رسالة جديدة</>
              : 'لا رسائل جديدة'}
          </p>
        </div>
        <button
          onClick={() => setShowCompose({})}
          className="btn-primary inline-flex items-center gap-1 text-sm"
        >
          <SendIcon className="w-4 h-4" />
          رسالة جديدة
        </button>
      </div>

      {/* Box tabs */}
      <div className="card">
        <div className="flex gap-1 -mx-4 px-4 border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
          <BoxTab active={box === 'inbox'} onClick={() => setBox('inbox')} Icon={Inbox} label="الواردة" badge={unread?.count} />
          <BoxTab active={box === 'sent'} onClick={() => setBox('sent')} Icon={SendIcon} label="المرسلة" />
          <BoxTab active={box === 'archive'} onClick={() => setBox('archive')} Icon={Archive} label="الأرشيف" />
        </div>

        {/* Search */}
        {messages.length > 5 && (
          <div className="relative mt-3">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input ps-9"
              placeholder="بحث..."
            />
          </div>
        )}
      </div>

      {/* List */}
      <div className="card">
        {isLoading ? (
          <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline text-gray-400" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-12">
            لا توجد رسائل في هذا الصندوق
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {filtered.map((m) => (
              <MessageItem
                key={m.id}
                msg={m}
                box={box}
                onOpen={() => handleOpen(m)}
                onArchive={() => archiveMut.mutate(m.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Detail modal */}
      {openMessage && (
        <MessageDetailModal
          message={openMessage}
          role={role}
          onClose={() => setOpenMessage(null)}
          onReply={() => {
            setShowCompose({
              defaultRecipientId: openMessage.is_mine ? (openMessage.recipient_id ?? undefined) : openMessage.sender_id,
              defaultStudentId: openMessage.student_id ?? undefined,
              defaultSubject: openMessage.subject ? `رد: ${openMessage.subject}` : '',
              parentMessageId: openMessage.id,
              threadId: openMessage.thread_id,
            });
            setOpenMessage(null);
          }}
        />
      )}

      {/* Compose modal */}
      {showCompose && (
        <ComposeModal
          role={role}
          context={showCompose}
          onClose={() => setShowCompose(null)}
          onSent={() => {
            setShowCompose(null);
            qc.invalidateQueries({ queryKey: ['messages'] });
            refetch();
            toast.success('تم الإرسال');
          }}
        />
      )}
    </div>
  );
}

function BoxTab({ active, onClick, Icon, label, badge }: { active: boolean; onClick: () => void; Icon: any; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-sm whitespace-nowrap ${
        active
          ? 'border-blue-500 text-blue-700 dark:text-blue-400 font-medium'
          : 'border-transparent text-gray-600 dark:text-gray-400'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {badge ? (
        <span className="ms-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function MessageItem({ msg, box, onOpen, onArchive }: { msg: InternalMessage; box: Box; onOpen: () => void; onArchive: () => void }) {
  const isUnread = msg.status === 'sent' && !msg.is_mine && box === 'inbox';
  const dateAr = new Date(msg.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });
  const sender = msg.is_mine ? `أنت → ${msg.recipient_name || msg.recipient_role || '—'}` : (msg.sender_name || '—');

  return (
    <li
      onClick={onOpen}
      className={`flex items-start gap-3 py-2.5 px-2 -mx-2 rounded cursor-pointer transition-colors ${
        isUnread ? 'bg-blue-50/60 dark:bg-blue-500/5' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
      }`}
    >
      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${isUnread ? 'bg-blue-500' : 'bg-transparent'}`} />
      {isUnread ? <Mail className="w-4 h-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" /> :
                  <MailOpen className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-sm truncate ${isUnread ? 'font-bold' : 'font-medium'}`}>
            {sender}
          </span>
          {msg.type === 'student_referral' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">
              تحويل طالب
            </span>
          )}
          {msg.type === 'student_notice' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
              إشعار
            </span>
          )}
          <span className="text-[10px] text-gray-400 ms-auto shrink-0">{dateAr}</span>
        </div>
        {msg.subject && <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{msg.subject}</p>}
        <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">{msg.body}</p>
        {msg.student_name && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
            <GraduationCap className="w-3 h-3 inline" /> {msg.student_name} — {msg.student_grade} / {msg.student_section}
          </p>
        )}
      </div>
      {box === 'inbox' && msg.status !== 'archived' && (
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(); }}
          className="p-1 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 shrink-0"
          title="أرشفة"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );
}

function MessageDetailModal({ message, role, onClose, onReply }: { message: InternalMessage; role: string; onClose: () => void; onReply: () => void }) {
  const [thread, setThread] = useState<InternalMessage[]>([]);
  const { data: threadData } = useQuery<InternalMessage[]>({
    queryKey: ['thread', message.thread_id],
    queryFn: async () => (await (await fetch(`/api/messages?thread_id=${message.thread_id}&box=all&limit=50`)).json()).data,
  });

  useMemo(() => {
    if (threadData) setThread([...threadData].sort((a, b) => a.created_at.localeCompare(b.created_at)));
  }, [threadData]);

  const dateAr = (s: string) => new Date(s).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="font-semibold">{message.subject || 'رسالة'}</h2>
            {message.student_name && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 inline-flex items-center gap-1">
                <GraduationCap className="w-3 h-3" />
                {message.student_name} — {message.student_grade}/{message.student_section}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {(thread.length > 0 ? thread : [message]).map((m) => (
            <div key={m.id} className={`p-3 rounded-lg border ${
              m.is_mine
                ? 'bg-blue-50/60 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 ms-auto max-w-[85%]'
                : 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 me-auto max-w-[85%]'
            }`}>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                <User className="w-3 h-3" />
                <span className="font-semibold">{m.is_mine ? 'أنت' : (m.sender_name || '—')}</span>
                <span className="ms-auto">{dateAr(m.created_at)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap text-gray-900 dark:text-gray-100">{m.body}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">إغلاق</button>
          <button onClick={onReply} className="btn-primary text-sm inline-flex items-center gap-1">
            <Reply className="w-4 h-4" /> رد
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposeModal({ role, context, onClose, onSent }: { role: string; context: ComposeContext; onClose: () => void; onSent: () => void }) {
  const [recipientType, setRecipientType] = useState<'specific' | 'role'>(
    context.defaultRecipientId ? 'specific' : 'role'
  );
  const [recipientId, setRecipientId] = useState<string>(context.defaultRecipientId || '');
  const [recipientRole, setRecipientRole] = useState<'admin' | 'teacher'>(
    role === 'teacher' ? 'admin' : 'teacher'
  );
  const [subject, setSubject] = useState(context.defaultSubject || '');
  const [body, setBody] = useState('');
  const [type, setType] = useState<'general' | 'student_referral' | 'student_notice'>(
    context.defaultType || 'general'
  );
  const [studentId, setStudentId] = useState<number | null>(context.defaultStudentId ?? null);
  const [studentSearch, setStudentSearch] = useState('');

  const isTeacher = role === 'teacher';

  // Fetch teachers (only admin/staff need this list)
  const { data: teachers = [] } = useQuery<any[]>({
    queryKey: ['teachers-for-msg'],
    queryFn: async () => (await (await fetch('/api/teachers')).json()).data || [],
    enabled: !isTeacher && recipientType === 'specific',
  });

  // Student search
  const { data: studentResults = [] } = useQuery<any[]>({
    queryKey: ['students-msg-search', studentSearch],
    queryFn: async () => {
      if (studentSearch.trim().length < 2) return [];
      return (await (await fetch(`/api/students?search=${encodeURIComponent(studentSearch.trim())}&limit=15`)).json()).data || [];
    },
    enabled: studentSearch.trim().length >= 2,
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          recipient_id: recipientType === 'specific' ? recipientId : null,
          recipient_role: recipientType === 'role' ? recipientRole : null,
          student_id: studentId,
          subject: subject.trim() || null,
          body: body.trim(),
          parent_message_id: context.parentMessageId || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإرسال');
      return d.data;
    },
    onSuccess: () => onSent(),
    onError: (e: any) => toast.error(e.message),
  });

  const canSend = body.trim().length > 0 &&
    ((recipientType === 'specific' && recipientId) || (recipientType === 'role' && recipientRole));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold inline-flex items-center gap-2">
            <SendIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            {context.parentMessageId ? 'رد على رسالة' : 'رسالة جديدة'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Recipient selector */}
          {!context.parentMessageId && (
            <>
              {isTeacher ? (
                <div className="card-info bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-200">
                  <p>الرسالة سترسل إلى <strong>إدارة المدرسة</strong></p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setRecipientType('specific')}
                      className={`p-3 rounded-lg border-2 text-sm ${
                        recipientType === 'specific'
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15'
                          : 'border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      معلم محدّد
                    </button>
                    <button
                      onClick={() => setRecipientType('role')}
                      className={`p-3 rounded-lg border-2 text-sm ${
                        recipientType === 'role'
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/15'
                          : 'border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      كل المعلمين
                    </button>
                  </div>
                  {recipientType === 'specific' && (
                    <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)} className="input">
                      <option value="">اختر المعلم</option>
                      {teachers.map((t: any) => (
                        <option key={t.user_id} value={t.user_id}>{t.full_name || t.email}</option>
                      ))}
                    </select>
                  )}
                </>
              )}

              <select value={type} onChange={(e) => setType(e.target.value as any)} className="input">
                <option value="general">رسالة عامة</option>
                {isTeacher
                  ? <option value="student_referral">تحويل طالب للإدارة</option>
                  : <option value="student_notice">إشعار بطالب</option>}
              </select>

              {/* Student picker */}
              <div>
                <label className="label">الطالب (اختياري)</label>
                {studentId ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 text-sm">
                    <GraduationCap className="w-4 h-4 text-blue-600" />
                    <span className="flex-1">{studentSearch || 'طالب محدّد'}</span>
                    <button onClick={() => { setStudentId(null); setStudentSearch(''); }} className="text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      className="input"
                      placeholder="ابحث بالاسم أو الهوية"
                    />
                    {studentResults.length > 0 && (
                      <ul className="mt-1 max-h-40 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
                        {studentResults.map((s: any) => (
                          <li key={s.id}>
                            <button
                              onClick={() => {
                                setStudentId(s.id);
                                setStudentSearch([s.first_name, s.father_name, s.last_name].filter(Boolean).join(' '));
                              }}
                              className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-sm"
                            >
                              <p className="font-medium">{[s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ')}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono" dir="ltr">{s.student_id}</p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="input"
                placeholder="الموضوع (اختياري)"
                maxLength={200}
              />
            </>
          )}

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="input min-h-[150px]"
            placeholder="نص الرسالة..."
            maxLength={2000}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 text-end">{body.length}/2000</p>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">إلغاء</button>
          <button
            onClick={() => sendMut.mutate()}
            disabled={!canSend || sendMut.isPending}
            className="btn-primary text-sm inline-flex items-center gap-1"
          >
            {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendIcon className="w-4 h-4" />}
            إرسال
          </button>
        </div>
      </div>
    </div>
  );
}
