'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Shield, User, Mail, Phone, Send, CheckCircle2, Loader2,
  AlertCircle, KeyRound, Sparkles, Award, BookOpen, MessageCircle,
} from 'lucide-react';

interface ValidateResponse {
  valid: boolean;
  reason?: string;
  invitee_name?: string;
  invitee_phone?: string;
  suggested_sections?: { id: number; name: string; grade_name: string }[];
  expires_at?: string;
}

export default function AdminRegisterPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <AdminRegisterBody />
    </Suspense>
  );
}

function AdminRegisterBody() {
  const sp = useSearchParams();
  const code = (sp.get('code') || '').toUpperCase().trim();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');  // honeypot
  const [submitted, setSubmitted] = useState(false);

  const { data: codeCheck, isLoading: checking } = useQuery<ValidateResponse>({
    queryKey: ['admin-invite-validate', code],
    queryFn: async () => {
      if (!code) return { valid: false, reason: 'no_code' };
      const r = await fetch(`/api/admin-invites/validate/${encodeURIComponent(code)}`);
      return (await r.json()).data;
    },
    staleTime: 30_000,
  });

  // Pre-fill from invitee_phone if the principal stored one with the code.
  useEffect(() => {
    if (codeCheck?.invitee_phone && !phone) setPhone(codeCheck.invitee_phone);
    if (codeCheck?.invitee_name && !fullName) setFullName(codeCheck.invitee_name);
  }, [codeCheck]);

  const submitMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/admin-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invite_code: code,
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          website,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل التسجيل');
      return d;
    },
    onSuccess: () => setSubmitted(true),
  });

  const canSubmit =
    fullName.trim().length >= 3 &&
    email.includes('@') &&
    phone.trim().length >= 10 &&
    codeCheck?.valid;

  // === No code provided ===
  if (!code) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4">
        <div className="card max-w-md w-full text-center py-10">
          <div className="w-20 h-20 bg-amber-100 dark:bg-amber-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-10 h-10 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-xl font-bold mb-2">لا يوجد رمز دعوة</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            صفحة تسجيل الإداريين تتطلّب رمز دعوة من المدير العام.
            <br />
            <br />
            تواصل مع مدير المدرسة للحصول على رابط دعوة شخصي 🌹
          </p>
        </div>
      </div>
    );
  }

  // === Validating code ===
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  // === Invalid code ===
  if (!codeCheck?.valid) {
    const messages: Record<string, string> = {
      not_found: 'رمز الدعوة غير صحيح',
      expired: 'انتهت صلاحية الرمز — تواصل مع المدير لطلب رمز جديد',
      already_used: 'تم استخدام الرمز مسبقاً',
      revoked: 'تم إلغاء الرمز',
      invalid_format: 'صيغة الرمز غير صحيحة',
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4">
        <div className="card max-w-md w-full text-center py-10">
          <div className="w-20 h-20 bg-red-100 dark:bg-red-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-xl font-bold mb-2 text-red-700 dark:text-red-400">رمز الدعوة غير صالح</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {messages[codeCheck?.reason || ''] || 'تعذّر التحقق من الرمز'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
            تواصل مع مدير المدرسة للحصول على رمز جديد
          </p>
        </div>
      </div>
    );
  }

  // === Submitted successfully ===
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 py-8">
        <div className="max-w-md mx-auto space-y-4">
          <div className="card text-center py-8 bg-gradient-to-br from-green-500 to-emerald-600 text-white border-0">
            <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold mb-2">✨ تم استلام طلبكم بنجاح</h1>
            <p className="text-green-50">
              شكراً لانضمامك لفريق الإدارة 🌹
              <br />
              بياناتك بين يدي المدير
            </p>
          </div>

          <div className="card">
            <h3 className="font-bold mb-3 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" /> ماذا بعد؟
            </h3>
            <ol className="space-y-3 text-sm">
              <Step n={1} text="ستتم مراجعة بياناتك من قِبَل المدير العام" />
              <Step n={2} text="سيُحدِّد المدير نطاقك الإداري (الصفوف التي ستشرف عليها)" />
              <Step n={3} text="بعد الاعتماد، ستصلك بيانات الدخول عبر الواتساب" />
              <Step n={4} text="سجّل دخولك وابدأ رحلتك الإدارية 🛡️" />
            </ol>
          </div>

          <div className="card bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30">
            <div className="flex items-start gap-2">
              <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-green-800 dark:text-green-200">📲 تأكّد من تفعيل واتسابك على رقم {phone}</p>
                <p className="text-xs text-green-700 dark:text-green-300 mt-1">أرسلنا لك رسالة ترحيبية بإذن الله 🌟</p>
              </div>
            </div>
          </div>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400 pt-2">
            🤲 نسأل الله أن يجعل قدومك خيراً وبركة
          </p>
        </div>
      </div>
    );
  }

  // === Active form ===
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 py-6">
      <div className="max-w-md mx-auto space-y-3">
        {/* Hero */}
        <div className="card bg-gradient-to-br from-purple-600 to-indigo-700 text-white border-0 text-center py-7">
          <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Shield className="w-9 h-9 text-white" />
          </div>
          <p className="text-purple-100 text-xs mb-1">انضم إلى فريق الإدارة في</p>
          <h1 className="text-xl font-bold mb-2">المدرسة</h1>
          <div className="inline-flex items-center gap-1 px-3 py-1 bg-white/20 rounded-full text-xs">
            <KeyRound className="w-3.5 h-3.5" />
            رمز دعوة: <code className="font-mono" dir="ltr">{code}</code>
          </div>
        </div>

        {/* Suggested sections preview */}
        {codeCheck.suggested_sections && codeCheck.suggested_sections.length > 0 && (
          <div className="card bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30">
            <h3 className="font-bold text-sm mb-2 flex items-center gap-1.5 text-blue-900 dark:text-blue-200">
              <BookOpen className="w-4 h-4" /> الشعب المقترحة لإشرافك
            </h3>
            <ul className="text-xs space-y-1 text-blue-800 dark:text-blue-100/90">
              {codeCheck.suggested_sections.map((s) => (
                <li key={s.id}>📚 {s.grade_name} / {s.name}</li>
              ))}
            </ul>
            <p className="text-[11px] text-blue-700 dark:text-blue-300 mt-2">
              💡 المدير قد يعدّل التعيينات عند الاعتماد
            </p>
          </div>
        )}

        {/* Form */}
        <div className="card">
          <h2 className="font-bold mb-3 flex items-center gap-1.5">
            <User className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            بياناتك
          </h2>
          <div className="space-y-3">
            <div>
              <label className="label flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> الاسم الكامل *</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" placeholder="مثال: محمد أحمد السهلي" maxLength={200} />
            </div>
            <div>
              <label className="label flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> البريد الإلكتروني *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="example@gmail.com" dir="ltr" />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">سيُستخدَم لتسجيل الدخول</p>
            </div>
            <div>
              <label className="label flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> رقم الجوال (واتساب) *</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input" placeholder="0555000000" dir="ltr" />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">📲 لاستلام بيانات الدخول بعد الاعتماد</p>
            </div>

            {/* Honeypot */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            {submitMut.isError && (
              <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{(submitMut.error as Error)?.message}</p>
              </div>
            )}

            <button
              onClick={() => submitMut.mutate()}
              disabled={!canSubmit || submitMut.isPending}
              className="btn-primary w-full inline-flex items-center justify-center gap-2 py-3 text-base"
            >
              {submitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {submitMut.isPending ? 'جارٍ الإرسال...' : 'إرسال طلب الانضمام'}
            </button>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-500/10 dark:to-indigo-500/10 border border-purple-200 dark:border-purple-500/30">
          <h3 className="font-bold text-sm mb-2 flex items-center gap-1.5 text-purple-900 dark:text-purple-200">
            <Award className="w-4 h-4" /> ما يميّز نظامنا الإداري
          </h3>
          <ul className="text-xs space-y-1.5 text-purple-800 dark:text-purple-100/90">
            <li className="flex items-start gap-1.5"><span>🛡️</span><span>صلاحيات منظَّمة وفق نطاقكم — تركيز على ما يخصّكم</span></li>
            <li className="flex items-start gap-1.5"><span>📊</span><span>تقارير شاملة عن طلاب صفوفكم</span></li>
            <li className="flex items-start gap-1.5"><span>📲</span><span>تواصل مباشر مع أولياء الأمور بضغطة</span></li>
            <li className="flex items-start gap-1.5"><span>🔐</span><span>خصوصية بيانات الطلاب بين الإداريين</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 font-bold text-xs flex items-center justify-center shrink-0">
        {n}
      </span>
      <span className="text-gray-700 dark:text-gray-200 leading-relaxed pt-0.5">{text}</span>
    </li>
  );
}
