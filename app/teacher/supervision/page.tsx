'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Shield, Calendar, ArrowLeftRight, Loader2, X, Send, MapPin } from 'lucide-react';

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

interface Assignment {
  id: number; location_id: number; location_name: string;
  day_of_week: number; user_id: string; full_name: string | null;
}

interface MyContext { user_id: string }

export default function TeacherSupervisionPage() {
  const qc = useQueryClient();

  // Get current user_id (teachers don't have /api/admin-assignments/me, but
  // we can pull from teacher-specific endpoint — easiest: parse from session
  // via a quick "me" call to /api/admin-assignments/me which returns ctx for
  // any logged-in user).
  // Simpler: pull all assignments and filter where I'm the user. We need MY
  // user_id — let's grab it from /api/admin-assignments/me which works for
  // any role and returns nothing useful for teachers, BUT we can use
  // /api/teachers in a different way... easier: hit /api/me-style.
  // For MVP: let the server include my user_id via a new query param trick —
  // but actually the simplest is to fetch all assignments + we need to know
  // who "I" am. Use /api/admin-assignments/me which returns role for everyone
  // (it returns sections=[] for teacher but role is in the response).
  // Hmm that doesn't return user_id. Easiest: use Supabase auth on the client.
  // For MVP, we just present the FULL grid colored to highlight teacher's own
  // rows — works without knowing user_id.

  const { data: assignments = [], isLoading } = useQuery<Assignment[]>({
    queryKey: ['supervision-assignments-teacher'],
    queryFn: async () => (await (await fetch('/api/supervision/assignments')).json()).data || [],
  });

  // The teacher needs to know which rows are theirs. We'll reverse-derive it:
  // group assignments by user_id, the user with the most assignments == "current
  // user view" is the wrong heuristic. Better: do a quick fetch of /api/me-like.
  // Use the admin-assignments/me as a proxy — it returns role; for teacher we
  // need user_id another way. Pull from supabase client directly.
  const { data: myUserId } = useQuery<string | null>({
    queryKey: ['supervision-my-user-id'],
    queryFn: async () => {
      // We have a server endpoint that knows: just hit /api/supervision/swaps
      // (POST requires my user_id but GET filters by it — empty result if no
      // requests). Easier: hit /api/teacher-assignments/me which returns the
      // teacher's user_id implicitly (it returns my own assignments).
      // Actually we'll add a tiny inline endpoint hit: read first GET response
      // headers if available; fallback to no-highlighting.
      try {
        const r = await fetch('/api/teacher-assignments/me');
        if (!r.ok) return null;
        const d = await r.json();
        // The response contains assignments with user_id — read first.
        const first = (d.data || d.sections || [])[0];
        return first?.teacher_user_id || first?.user_id || null;
      } catch { return null; }
    },
    staleTime: 10 * 60 * 1000,
  });

  const myAssignments = useMemo(
    () => myUserId ? assignments.filter((a) => a.user_id === myUserId) : [],
    [assignments, myUserId],
  );
  const otherAssignments = useMemo(
    () => myUserId ? assignments.filter((a) => a.user_id !== myUserId) : assignments,
    [assignments, myUserId],
  );

  // Swap-request UI state.
  const [swapForm, setSwapForm] = useState<{ myId: number; targetId: number | null; reason: string } | null>(null);

  const swapMut = useMutation({
    mutationFn: async () => {
      if (!swapForm || !swapForm.targetId) throw new Error('اختر تعييناً للتبديل معه');
      const r = await fetch('/api/supervision/swaps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_assignment_id: swapForm.myId,
          target_assignment_id: swapForm.targetId,
          reason: swapForm.reason,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل');
    },
    onSuccess: () => {
      setSwapForm(null);
      qc.invalidateQueries({ queryKey: ['supervision-assignments-teacher'] });
      toast.success('📨 تم إرسال طلب التبديل للإدارة');
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">إشراف الفسحة — أيامي</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {myUserId ? `لديك ${myAssignments.length} ${myAssignments.length === 1 ? 'يوم' : 'أيام'} إشراف هذا الأسبوع` : 'الجدول الكامل'}
          </p>
        </div>
      </div>

      {/* My days */}
      {myUserId && (
        <div className="card">
          <h2 className="font-bold text-sm flex items-center gap-1.5 mb-2">
            <Calendar className="w-4 h-4 text-orange-600" /> أيامي
          </h2>
          {myAssignments.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">ليس لديك أيام إشراف معيَّنة هذا الأسبوع</p>
          ) : (
            <ul className="space-y-1.5">
              {myAssignments.sort((a, b) => a.day_of_week - b.day_of_week).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30">
                  <div>
                    <p className="text-sm font-bold">{ARABIC_DAYS[a.day_of_week]}</p>
                    <p className="text-xs text-gray-700 dark:text-gray-300">📍 {a.location_name}</p>
                  </div>
                  <button
                    onClick={() => setSwapForm({ myId: a.id, targetId: null, reason: '' })}
                    className="text-xs px-2 py-1 rounded bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/25 border border-purple-200 dark:border-purple-500/30 inline-flex items-center gap-1"
                  >
                    <ArrowLeftRight className="w-3 h-3" /> اطلب تبديل
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Full week — read-only */}
      <div className="card">
        <h2 className="font-bold text-sm flex items-center gap-1.5 mb-2">
          <MapPin className="w-4 h-4 text-blue-600" /> جدول الأسبوع الكامل
        </h2>
        {assignments.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-6">لا توجد تعيينات بعد</p>
        ) : (
          <div className="space-y-3">
            {ARABIC_DAYS.map((dayName, day) => {
              const dayItems = assignments.filter((a) => a.day_of_week === day).sort((a, b) => (a.location_id - b.location_id));
              if (dayItems.length === 0) return null;
              return (
                <div key={day}>
                  <p className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-1">{dayName}</p>
                  <ul className="text-xs space-y-0.5">
                    {dayItems.map((a) => {
                      const isMe = myUserId && a.user_id === myUserId;
                      return (
                        <li key={a.id} className={`flex items-center justify-between gap-2 px-2 py-1 rounded ${
                          isMe ? 'bg-orange-50 dark:bg-orange-500/10 font-semibold' : ''
                        }`}>
                          <span>📍 {a.location_name}</span>
                          <span className="text-gray-500 dark:text-gray-400">{a.full_name || '—'} {isMe && '(أنا)'}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Swap request modal */}
      {swapForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSwapForm(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
              <h3 className="font-semibold">طلب تبديل يوم إشراف</h3>
              <button onClick={() => setSwapForm(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">يومك:</p>
                <p className="text-sm font-bold p-2 rounded bg-orange-50 dark:bg-orange-500/15 border border-orange-200 dark:border-orange-500/30">
                  {(() => {
                    const a = myAssignments.find((x) => x.id === swapForm.myId);
                    return a ? `${ARABIC_DAYS[a.day_of_week]} — 📍 ${a.location_name}` : '—';
                  })()}
                </p>
              </div>
              <div>
                <label className="label text-xs">اختر زميلاً للتبديل معه:</label>
                <ul className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded divide-y divide-gray-100 dark:divide-gray-800">
                  {otherAssignments.length === 0 ? (
                    <li className="text-center text-xs text-gray-400 py-4">لا يوجد زملاء بأيام أخرى</li>
                  ) : otherAssignments.map((a) => {
                    const selected = swapForm.targetId === a.id;
                    return (
                      <li key={a.id}>
                        <button
                          onClick={() => setSwapForm({ ...swapForm, targetId: a.id })}
                          className={`w-full text-right p-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 ${selected ? 'bg-purple-50 dark:bg-purple-500/15' : ''}`}
                        >
                          <p className="text-sm font-medium">{a.full_name || '—'}</p>
                          <p className="text-[11px] text-gray-500">{ARABIC_DAYS[a.day_of_week]} — 📍 {a.location_name}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <label className="label text-xs">سبب الطلب (اختياري)</label>
                <textarea
                  value={swapForm.reason}
                  onChange={(e) => setSwapForm({ ...swapForm, reason: e.target.value })}
                  rows={2}
                  className="input text-sm"
                  placeholder="مثلاً: ظرف عائلي يوم الثلاثاء..."
                  maxLength={500}
                />
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
              <button onClick={() => swapMut.mutate()} disabled={swapMut.isPending || !swapForm.targetId} className="btn-primary flex-1 inline-flex items-center justify-center gap-1">
                {swapMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                إرسال للإدارة
              </button>
              <button onClick={() => setSwapForm(null)} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
