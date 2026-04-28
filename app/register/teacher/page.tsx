'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  GraduationCap, User, Mail, Phone, Send, CheckCircle2, Loader2,
  AlertCircle, Sparkles,
} from 'lucide-react';

export default function TeacherSelfRegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const submitMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/teacher-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل التسجيل');
      return d;
    },
    onSuccess: () => setSubmitted(true),
  });

  const canSubmit = fullName.trim().length >= 3 && email.includes('@') && phone.trim().length >= 10;

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4">
        <div className="w-full max-w-md card text-center py-10">
          <div className="w-20 h-20 bg-green-100 dark:bg-green-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">✨ تم استلام طلبكم بنجاح</h1>
          <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
            شكراً لانضمامكم لأسرتنا التعليمية 🌹
            <br />
            ستتم مراجعة بياناتكم من قِبَل الإدارة، وسنرسل لكم بيانات الدخول
            عبر <strong>الواتساب</strong> فور اعتماد التسجيل.
          </p>
          <div className="bg-blue-50 dark:bg-blue-500/10 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-200 mb-4">
            📲 احرص على أن يكون رقم الجوال مفعّلاً في الواتساب لاستقبال بياناتك.
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            نسأل الله لكم التوفيق والسداد في رسالتكم التربوية 🤲
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4">
      <div className="w-full max-w-md">
        {/* Welcome card */}
        <div className="card mb-3 bg-gradient-to-br from-blue-600 to-indigo-600 text-white border-0 text-center py-6">
          <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center mx-auto mb-3">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold mb-1">
            <Sparkles className="w-5 h-5 inline ms-1" />
            انضم إلى أسرة المعلمين
          </h1>
          <p className="text-sm text-blue-50 leading-relaxed px-3">
            عبّئ بياناتك ليتم اعتماد حسابك في النظام التعليمي
          </p>
        </div>

        {/* Form */}
        <div className="card">
          <div className="space-y-3">
            <div>
              <label className="label flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                الاسم الكامل *
              </label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input"
                placeholder="مثال: أ. محمد أحمد السهلي"
                maxLength={200}
                disabled={submitMut.isPending}
              />
            </div>

            <div>
              <label className="label flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                البريد الإلكتروني *
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="example@gmail.com"
                dir="ltr"
                disabled={submitMut.isPending}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                سيُستخدَم لتسجيل الدخول للنظام
              </p>
            </div>

            <div>
              <label className="label flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                رقم الجوال (واتساب) *
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input"
                placeholder="0555000000"
                dir="ltr"
                disabled={submitMut.isPending}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                📲 يجب أن يكون مفعّلاً في الواتساب لاستلام بيانات الدخول
              </p>
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

            <p className="text-xs text-gray-500 dark:text-gray-400 text-center pt-2 border-t border-gray-200 dark:border-gray-800">
              بإرسال البيانات، توافق على معالجتها لإنشاء حسابك في النظام
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 dark:text-gray-400 mt-4">
          🤲 نرحّب بكم في صرحنا التعليمي
        </p>
      </div>
    </div>
  );
}
