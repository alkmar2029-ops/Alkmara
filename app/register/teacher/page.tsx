'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  GraduationCap, User, Mail, Phone, Send, CheckCircle2, Loader2,
  AlertCircle, Sparkles, MessageCircle, Heart, Award, BookOpen,
} from 'lucide-react';

interface SchoolInfo {
  school_name: string;
  principal_name: string;
}

export default function TeacherSelfRegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // Honeypot — invisible to humans (display:none), filled by naive bots.
  // We send it on submit; the API rejects any non-empty value.
  const [website, setWebsite] = useState('');

  // Public school info — used for the welcome banner so the teacher knows
  // exactly which school they're applying to. Falls back gracefully if the
  // endpoint is unreachable; the form still works.
  const { data: school } = useQuery<SchoolInfo>({
    queryKey: ['public-school-info'],
    queryFn: async () => {
      const r = await fetch('/api/public/school-info');
      if (!r.ok) return { school_name: '', principal_name: '' };
      const d = await r.json();
      return d.data;
    },
    staleTime: 60 * 60 * 1000,  // info rarely changes; cache an hour
  });

  const schoolName = school?.school_name || 'متوسطة الخمرة الأولى';

  const submitMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/teacher-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          website,  // honeypot — humans never see this field
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
    phone.trim().length >= 10;

  // === Success state ===
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 py-8">
        <div className="max-w-md mx-auto space-y-4">
          {/* Hero */}
          <div className="card text-center py-8 bg-gradient-to-br from-green-500 to-emerald-600 text-white border-0">
            <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold mb-2">✨ تم استلام طلبكم بنجاح</h1>
            <p className="text-green-50 leading-relaxed">
              شكراً لتسجيلك أستاذنا الفاضل 🌹
              <br />
              بياناتك بين يدي إدارة <strong>{schoolName}</strong>
            </p>
          </div>

          {/* What happens next */}
          <div className="card">
            <h3 className="font-bold mb-3 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              ماذا بعد؟
            </h3>
            <ol className="space-y-3 text-sm">
              <Step n={1} text="ستتم مراجعة بياناتك من قِبَل إدارة المدرسة" />
              <Step n={2} text="بعد الاعتماد، ستصلك بيانات الدخول عبر الواتساب مباشرةً" />
              <Step n={3} text="سجّل دخولك وابدأ رحلتك مع تطبيق المعلم 🎓" />
            </ol>
          </div>

          {/* WhatsApp note */}
          <div className="card bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30">
            <div className="flex items-start gap-2">
              <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-green-800 dark:text-green-200">
                  📲 تأكّد من تفعيل واتسابك على رقم {phone}
                </p>
                <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                  أرسلنا لك رسالة ترحيبية تشرح مميزات التطبيق بإذن الله 🌟
                </p>
              </div>
            </div>
          </div>

          {/* Closing dua */}
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 pt-2">
            🤲 نسأل الله أن يجعل قدومك خيراً وبركة
          </p>
        </div>
      </div>
    );
  }

  // === Form ===
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 py-6">
      <div className="max-w-md mx-auto space-y-3">
        {/* Hero card with school identity */}
        <div className="card bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-0 text-center py-7">
          <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center mx-auto mb-3">
            <GraduationCap className="w-9 h-9 text-white" />
          </div>
          <p className="text-blue-100 text-xs mb-1">انضم إلى أسرة المعلمين في</p>
          <h1 className="text-xl font-bold mb-2">{schoolName}</h1>
          <div className="inline-flex items-center gap-1 px-3 py-1 bg-white/20 rounded-full text-xs">
            <Sparkles className="w-3.5 h-3.5" />
            تسجيل المعلمين الجدد
          </div>
        </div>

        {/* Welcome from administration */}
        <div className="card bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
          <div className="flex items-start gap-2.5">
            <Heart className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" fill="currentColor" />
            <div className="text-sm leading-relaxed">
              <p className="font-bold text-amber-900 dark:text-amber-200 mb-1">
                🌹 ترحيب من إدارة المدرسة
              </p>
              <p className="text-amber-800 dark:text-amber-100/90">
                أهلاً وسهلاً بكم أساتذتنا الكرام، يسعدنا انضمامكم إلى أسرتنا
                التعليمية. عبّئوا بياناتكم بدقّة وسنرحّب بكم في التطبيق فور
                اعتماد التسجيل بإذن الله ✨
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="card">
          <h2 className="font-bold mb-3 flex items-center gap-1.5 text-gray-900 dark:text-gray-100">
            <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            بياناتك
          </h2>
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
                📲 يجب أن يكون مفعّلاً في الواتساب لاستلام بياناتك
              </p>
            </div>

            {/* Honeypot — visually hidden but still focusable so bots can find it.
                aria-hidden + tabIndex=-1 keeps it out of screen-reader / keyboard
                flows for real users. autoComplete=off prevents browser fillers. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
              <label htmlFor="website-field">Leave this empty</label>
              <input
                id="website-field"
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
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
              {submitMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitMut.isPending ? 'جارٍ الإرسال...' : 'إرسال طلب الانضمام'}
            </button>
          </div>
        </div>

        {/* Why join card — quick highlights */}
        <div className="card bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-500/10 dark:to-blue-500/10 border border-indigo-200 dark:border-indigo-500/30">
          <h3 className="font-bold text-sm mb-2 flex items-center gap-1.5 text-indigo-900 dark:text-indigo-200">
            <Award className="w-4 h-4" />
            لماذا تطبيق المعلم؟
          </h3>
          <ul className="text-xs space-y-1.5 text-indigo-800 dark:text-indigo-100/90">
            <li className="flex items-start gap-1.5">
              <span>✓</span>
              <span>تسجيل الحضور والملاحظات بنقرات بسيطة من جوالك</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span>✓</span>
              <span>تواصل مباشر مع أولياء الأمور عبر الواتساب</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span>✓</span>
              <span>تقارير احترافية لأداء طلابك جاهزة للطباعة</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span>✓</span>
              <span>يعمل كتطبيق مستقل بعد التثبيت — سريع وأنيق</span>
            </li>
          </ul>
        </div>

        <p className="text-center text-[11px] text-gray-500 dark:text-gray-400 pt-1">
          بإرسال البيانات، توافق على معالجتها لإنشاء حسابك في النظام
        </p>
      </div>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">
        {n}
      </span>
      <span className="text-gray-700 dark:text-gray-200 leading-relaxed pt-0.5">{text}</span>
    </li>
  );
}
