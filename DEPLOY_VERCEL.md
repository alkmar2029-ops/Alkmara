# نشر بوابة المعلم على Vercel

## الفكرة
نفس الكود يعمل في مكانين:
- **محلياً** (لوحة الإدارة + بوابة المعلم) — مرتبط بأجهزة البصمة
- **Vercel** (بوابة المعلم فقط) — متاح لكل المعلمين عبر الإنترنت

كلاهما يتصل بنفس قاعدة بيانات Supabase.

## الخطوات

### 1) ادفع الكود إلى GitHub
```bash
# لو الريبو محلي فقط، أنشئ ريبو على GitHub أولاً ثم:
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

### 2) أنشئ مشروع Vercel
1. افتح https://vercel.com/new
2. اختر "Import Git Repository" واختر الريبو
3. **Framework Preset**: Next.js (يُكتشف تلقائياً)
4. **Build Command**: `next build` (الافتراضي)
5. **Root Directory**: `./` (الافتراضي)

### 3) أضف متغيّرات البيئة (مهم)
في الـ Project Settings → Environment Variables، أضف:

| المتغيّر | القيمة |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://yufpttbzfucrznbftnnv.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (انسخه من `.env.local`) |
| `SUPABASE_SERVICE_ROLE_KEY` | (انسخه من `.env.local`) |
| `NEXT_PUBLIC_TEACHER_ONLY` | `true` |

> ✅ هذه المتغيّرات تظهر للبيئات الثلاث (Production, Preview, Development).

### 4) Deploy
اضغط **Deploy** — Vercel ستبني وتنشر تلقائياً (~2-3 دقائق).
ستحصل على رابط: `https://your-project.vercel.app`

### 5) حدّث رابط البوابة في الـ Admin المحلي
في `.env.local` على جهاز الإدارة، أضف:
```env
NEXT_PUBLIC_PORTAL_URL=https://your-project.vercel.app
```
هذا يضمن أن رسائل الواتساب التي تُرسل للمعلمين تحوي رابط Vercel (لا localhost).

أعد تشغيل سيرفر الـ dev المحلي بعد التعديل.

---

## كيف يعمل القفل؟
- `NEXT_PUBLIC_TEACHER_ONLY=true` يفعّل قفل في الـ middleware:
  - `/` و `/dashboard/*` → تحويل إلى `/teacher`
  - API endpoints الإدارية تُعيد 404 (مخفية تماماً)
  - فقط `/teacher/*`, `/login`, واجهات API اللازمة للمعلم تعمل
- نفس قاعدة البيانات على Supabase
- المعلم يدخل بنفس بريده وكلمة سره (تم إنشاؤها من جهاز الإدارة)

## الأمان
- RLS على Supabase يحمي البيانات حتى لو أحدهم تجاوز الـ middleware
- Service Role key محمي (سيرفر فقط، لا يصل للمتصفح)
- المعلم role مقيّد على جداول حضور الحصص فقط

## Domain مخصّص (اختياري)
- في Vercel → Project → Domains → أضف `teachers.school.sa` (مثلاً)
- اربطه بـ DNS (Vercel يعطيك التعليمات)
- بعدها حدّث `NEXT_PUBLIC_PORTAL_URL` في الـ admin المحلي للنطاق الجديد

## التكلفة
- **Vercel Free Tier**:
  - 100 GB bandwidth/شهر — كافٍ لمدرسة بـ 100 معلم
  - serverless functions: 100K requests/شهر
- **Supabase Free**: قاعدة موجودة فعلاً
- **WhatsApp** (wasenderapi): مدفوع منفصل (للإدارة فقط)

## التحديثات
أي `git push` على branch الـ main يُعيد النشر تلقائياً (Continuous Deployment).
لاختبار التغييرات قبل الـ production، استخدم branch منفصل وستحصل على Preview URL.

## استكشاف الأخطاء
| المشكلة | الحل |
|---|---|
| "Endpoint غير متاح" عند تسجيل الدخول | تأكد أن `/api/grades`, `/api/sections`, `/api/students` في الـ allowlist |
| "Unauthorized" بعد الدخول | تأكد من `SUPABASE_SERVICE_ROLE_KEY` صحيح |
| الواتساب يحوي رابط localhost | لم تضف `NEXT_PUBLIC_PORTAL_URL` في `.env.local` المحلي |
| Build فشل | تحقق من Logs في Vercel — غالباً متغير بيئة ناقص |
