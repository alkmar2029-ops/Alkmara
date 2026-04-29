'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  KeyRound, Plus, Loader2, Copy, MessageCircle, Trash2, Clock,
  CheckCircle2, XCircle, Search, X,
} from 'lucide-react';

interface InviteCode {
  id: number;
  code: string;
  invitee_name: string | null;
  invitee_phone: string | null;
  suggested_section_ids: number[] | null;
  expires_at: string;
  used_at: string | null;
  used_by_registration_id: number | null;
  revoked_at: string | null;
  is_active: boolean;
  is_expired: boolean;
  created_at: string;
}

interface SectionRow {
  id: number;
  name: string;
  grade_id: number;
  grade_name: string;
}

export default function AdminInviteCodesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'active' | 'used' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: codes = [], isLoading } = useQuery<InviteCode[]>({
    queryKey: ['admin-invites'],
    queryFn: async () => (await (await fetch('/api/admin-invites')).json()).data || [],
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    let list = codes;
    if (tab === 'active') list = list.filter((c) => c.is_active);
    else if (tab === 'used') list = list.filter((c) => !!c.used_at);
    if (search.trim()) {
      const q = search.trim();
      list = list.filter((c) =>
        c.code.includes(q.toUpperCase()) ||
        (c.invitee_name || '').includes(q) ||
        (c.invitee_phone || '').includes(q),
      );
    }
    return list;
  }, [codes, tab, search]);

  const revokeMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin-invites/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error || 'فشل الإلغاء');
    },
    onSuccess: () => {
      toast.success('تم الإلغاء');
      qc.invalidateQueries({ queryKey: ['admin-invites'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">رموز دعوة الإداريين</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              توليد رمز دعوة لإداري متوقّع — صالح لمدة 48 ساعة
            </p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary inline-flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> إنشاء رمز جديد
        </button>
      </div>

      <div className="card p-2 flex gap-1">
        {([
          { key: 'active', label: 'نشطة', count: codes.filter((c) => c.is_active).length },
          { key: 'used',   label: 'مستخدمة', count: codes.filter((c) => !!c.used_at).length },
          { key: 'all',    label: 'الكل', count: codes.length },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {codes.length > 5 && (
        <div className="card">
          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} className="input ps-9" placeholder="بحث برمز أو اسم..." />
          </div>
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12 text-sm">لا توجد رموز في هذه الفئة</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {filtered.map((c) => <CodeRow key={c.id} code={c} onRevoke={() => revokeMut.mutate(c.id)} />)}
          </ul>
        )}
      </div>

      {showCreate && <CreateCodeModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CodeRow({ code, onRevoke }: { code: InviteCode; onRevoke: () => void }) {
  const portalBase = typeof window !== 'undefined' ? window.location.origin : '';
  const fullLink = `${portalBase}/register/admin?code=${code.code}`;
  const expiresIn = (() => {
    if (!code.is_active) return null;
    const ms = new Date(code.expires_at).getTime() - Date.now();
    if (ms <= 0) return 'منتهٍ';
    const hrs = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hrs} ساعة و ${mins} دقيقة`;
  })();

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-base font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 px-2 py-0.5 rounded" dir="ltr">
              {code.code}
            </code>
            {code.is_active && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400">نشط</span>}
            {code.used_at && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">مستخدم</span>}
            {code.is_expired && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">منتهٍ</span>}
            {code.revoked_at && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">ملغى</span>}
          </div>
          {code.invitee_name && (
            <p className="text-sm mt-1">📋 لـ: <strong>{code.invitee_name}</strong>{code.invitee_phone && <span className="text-gray-500 dark:text-gray-400 me-2 font-mono" dir="ltr"> • {code.invitee_phone}</span>}</p>
          )}
          {expiresIn && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
              <Clock className="w-3 h-3" /> ينتهي خلال: {expiresIn}
            </p>
          )}
        </div>
        {code.is_active && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => { navigator.clipboard.writeText(fullLink); toast.success('تم نسخ الرابط'); }}
              className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 inline-flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> نسخ الرابط
            </button>
            {code.invitee_phone && (
              <a
                href={`https://wa.me/${code.invitee_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`السلام عليكم، تم توجيه دعوة لكم للانضمام كإداري في النظام. اضغط الرابط لإكمال التسجيل:\n${fullLink}\n\nرمز الدعوة: ${code.code}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400 inline-flex items-center gap-1"
              >
                <MessageCircle className="w-3 h-3" /> إرسال واتساب
              </a>
            )}
            <button
              onClick={() => { if (confirm('إلغاء الرمز؟')) onRevoke(); }}
              className="text-xs px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function CreateCodeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: sections = [] } = useQuery<SectionRow[]>({
    queryKey: ['sections-flat-for-invite'],
    queryFn: async () => {
      const r = await fetch('/api/admin-assignments');
      if (!r.ok) return [];
      return (await r.json()).data?.sections || [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitee_name: name.trim(),
          invitee_phone: phone || undefined,
          suggested_section_ids: selected.size > 0 ? Array.from(selected) : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإنشاء');
      return d.data as InviteCode;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['admin-invites'] });
      toast.success(`✓ تم إنشاء الرمز: ${c.code}`);
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800 bg-amber-50 dark:bg-amber-500/10">
          <h2 className="font-bold text-lg flex items-center gap-2"><KeyRound className="w-5 h-5" /> إنشاء رمز دعوة</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-500/20"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="label">اسم الإداري المتوقع *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="مثال: محمد السهلي" maxLength={200} autoFocus />
          </div>
          <div>
            <label className="label">رقم جواله (اختياري — لتسهيل إرسال الرابط)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="0555000000" dir="ltr" />
          </div>
          <div>
            <label className="label">شعب مقترحة (اختياري)</label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">سترى هذه الاقتراحات في صفحة التسجيل، ويمكنك تعديلها عند الاعتماد</p>
            <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg p-2 space-y-1">
              {sections.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 px-2 rounded">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                      setSelected(next);
                    }}
                    className="w-4 h-4"
                  />
                  <span>{s.grade_name} / {s.name}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 p-2 rounded">
            ⏰ الرمز صالح لمدة 48 ساعة من الإنشاء
          </p>
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800">إلغاء</button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!name.trim() || createMut.isPending}
            className="btn-primary inline-flex items-center gap-1 text-sm"
          >
            {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            إنشاء الرمز
          </button>
        </div>
      </div>
    </div>
  );
}
