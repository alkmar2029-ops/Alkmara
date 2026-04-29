'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { User, Mail, Phone, Lock, Save, Eye, EyeOff } from 'lucide-react';

export default function TeacherProfilePage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<{ full_name: string; email: string; phone: string } | null>(null);
  const [currentPw, setCurrentPw] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase
        .from('user_profiles')
        .select('full_name, phone')
        .eq('user_id', user.id)
        .maybeSingle();
      setProfile({
        full_name: (p?.full_name as string) || (user.user_metadata as any)?.full_name || '',
        email: user.email || '',
        phone: (p?.phone as string) || '',
      });
    })();
  }, [supabase]);

  const changePwMut = useMutation({
    mutationFn: async () => {
      if (!currentPw) throw new Error('أدخل كلمة السر الحالية');
      if (pw.length < 8) throw new Error('كلمة السر يجب أن تكون 8 أحرف فأكثر');
      if (pw !== pw2) throw new Error('كلمتا السر غير متطابقتين');
      const r = await fetch('/api/me/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPw, new_password: pw }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل التغيير');
    },
    onSuccess: () => {
      toast.success('تم تغيير كلمة السر');
      setCurrentPw(''); setPw(''); setPw2('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="card">
        <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
          <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          ملفي
        </h2>

        {!profile ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">جارٍ التحميل...</p>
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <User className="w-4 h-4 mt-0.5 text-gray-400" />
              <dt className="text-gray-500 dark:text-gray-400 w-20 shrink-0">الاسم:</dt>
              <dd className="font-medium">{profile.full_name || '—'}</dd>
            </div>
            <div className="flex items-start gap-2">
              <Mail className="w-4 h-4 mt-0.5 text-gray-400" />
              <dt className="text-gray-500 dark:text-gray-400 w-20 shrink-0">البريد:</dt>
              <dd className="font-mono text-xs" dir="ltr">{profile.email}</dd>
            </div>
            <div className="flex items-start gap-2">
              <Phone className="w-4 h-4 mt-0.5 text-gray-400" />
              <dt className="text-gray-500 dark:text-gray-400 w-20 shrink-0">الجوال:</dt>
              <dd className="font-mono text-xs" dir="ltr">{profile.phone || '—'}</dd>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-800">
              لتعديل الاسم أو الجوال، تواصل مع الإدارة.
            </p>
          </dl>
        )}
      </div>

      <div className="card">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          تغيير كلمة السر
        </h3>
        <div className="space-y-3">
          <div>
            <label className="label">كلمة السر الحالية</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="input"
              placeholder="كلمة السر التي تستخدمها الآن"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label">كلمة السر الجديدة</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="input pe-10"
                placeholder="٨ أحرف على الأقل"
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">تأكيد كلمة السر</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              className="input"
              autoComplete="new-password"
            />
          </div>
          {pw && pw2 && pw !== pw2 && (
            <p className="text-xs text-red-600 dark:text-red-400">كلمتا السر غير متطابقتين</p>
          )}
          <button
            onClick={() => changePwMut.mutate()}
            disabled={changePwMut.isPending || !currentPw || !pw || pw !== pw2 || pw.length < 8}
            className="btn-primary w-full inline-flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {changePwMut.isPending ? 'جارٍ الحفظ...' : 'حفظ كلمة السر الجديدة'}
          </button>
        </div>
      </div>
    </div>
  );
}
