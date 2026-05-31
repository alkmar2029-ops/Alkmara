# خطة الوصول إلى 100/100 — موجز تنفيذي لـ Codex

> **المصدر:** مراجعة Claude Opus 4.8 (White-Box) بتاريخ 2026-05-30.
> **التقارير الكاملة (HTML):** `C:\Users\basem\OneDrive\Desktop\حضور الطلاب مراجعة opus4.8`
> **الوضع الحالي:** 75/100 — منصّة ناضجة جاهزة لإطلاق متحكَّم.
> **الهدف:** 100/100 عبر 3 مراحل، كلها إصلاحات **موضعية لا معمارية**.

---

## 0) كيف يعمل Codex على هذه الخطة (Guardrails)

1. **اقرأ الكود الفعلي قبل أي تعديل.** أرقام الأسطر هنا من لقطة 2026-05-30 وقد تنزاح؛ اعتمد على أسماء الدوال/المسارات لا الأرقام وحدها.
2. **منهجية المشروع (إلزامية):**
   - كل إصلاح SQL = **هجرة جديدة** ببادئة رقمية في `supabase/migrations/` (لا تعديل هجرة قديمة).
   - العمل في **worktree** ومراجعته قبل المزامنة لـ `main` والتطبيق على staging (review-gate).
   - لا حذف تبعية من `package.json` بلا `npm install` لمزامنة الـ lock.
3. **بوابة التحقق بعد كل بند:** `npx tsc --noEmit` = EXIT 0، و`npm run lint`، و(عند المساس بالحضور/الواتساب) `npm run smoke:sprint2` / `smoke:sprint3`.
4. **«تمّ» لكل بند =** الكود + اجتياز بوابة التحقق + سطر في qa.md للمرحلة + (للأمان) اختبار سلبي يثبت أن المهاجم يُرفَض.
5. **علِّم البنود المُستنتَجة** (سقف Hobby، ترتيب الهجرات، انتحال الترويسة) بأنها تحتاج **تأكيدًا تشغيليًا** قبل اعتبارها مغلقة (القسم 5).

**معيار 100/100 الإجمالي:** صفر بنود «حرجة/عالية» مفتوحة + أتمتة إنتاج موثوقة + تغطية وصولية WCAG AA + اتساق تدويل منهجي + جسور المميزات موصولة.

---

## 1) المرحلة 1 — حرجة/عالية (تحجب التوسّع) — يوم–يومان

### P1.1 — إغلاق تصعيد الصلاحيات (AUTH-01 / AUTH-02) 🔴 حرجة
**المشكلة:** إدارة المستخدمين/المعلمين تستخدم `requireRole(['admin'])` فقط، والمرشد/الوكيل يحملون `role='admin'` ← يستطيع مرشد إنشاء أدمن بـ `manage_users:true` ثم تصعيد نفسه.

**الملفات:**
- `app/api/admins/route.ts` (GET ~22، POST ~56)
- `app/api/teachers/route.ts` (GET، POST ~47)
- `app/api/teachers/[id]/route.ts` (PATCH ~11، DELETE ~60)
- `app/api/teachers/[id]/reset-password/route.ts` (POST ~10)

**التغيير:** استبدل بوّابة `requireRole(['admin'])` بـ `requireManageUsers()` من `@/lib/personas/auth-gate` مع الحفاظ على نمط إرجاع الخطأ الموجود في كل ملف:
```ts
import { requireManageUsers } from '@/lib/personas/auth-gate';
// ...
const gate = await requireManageUsers();
if (!gate.ok) return gate.res;
const { ctx } = gate; // role موثوق من DB
```
> ملاحظة: `requireManageUsers()` يُرجِع `{ ok:true, ctx } | { ok:false, res }` (مؤكَّد من `lib/personas/auth-gate.ts:22`). super_admin يمرّ دائمًا؛ الأدمن العادي يحتاج `permissions.manage_users === true`.

**زيادة (في reset-password):** أضِف rate limit per-caller قبل التنفيذ: `checkRateLimit('reset-pw:'+ctx.userId, 5, 60_000)` من `@/lib/security/rate-limit`.

**القبول:** مستخدم `persona=counselor` (أو vice_principal) يستدعي `POST /api/admins` و`reset-password` ← **403**. super_admin يمرّ. اكتب اختبار سلبي يثبت ذلك.

---

### P1.2 — إصلاح انحدار حضور الحصص (DB-01 / DB-03 / DB-04) 🟠 عالية
**المشكلة:** النسخة الحيّة من `save_period_attendance` (في `2026_04_30_period_absence_source.sql`) فقدت فحص `teacher_section_assignments` الذي أُضيف في `2026_04_29`، وتثق بـ `p_recorded_by` المُورَّد من العميل. وسياسات الكتابة المباشرة على `period_sessions`/`period_absences` بلا تقييد شعبة.

**التغيير — هجرة تصحيحية جديدة** `supabase/migrations/2026_05_30_001_fix_period_attendance_scope.sql`:
1. **اقرأ** التعريف الحالي للدالة في `2026_04_30_period_absence_source.sql` وأعِد إنشاءه بـ `CREATE OR REPLACE` **مع الحفاظ على كل منطق `source` الحالي**، وأضِف بعد فحص الدور:
```sql
-- إعادة حارس تخصيص الشعبة (المفقود في 2026_04_30)
IF current_user_role() = 'teacher' AND NOT EXISTS (
  SELECT 1 FROM teacher_section_assignments
  WHERE teacher_user_id = auth.uid() AND section_id = p_section_id
) THEN
  RAISE EXCEPTION 'لست مُعيَّناً على هذه الشعبة' USING ERRCODE = '42501';
END IF;
```
2. **DB-04:** داخل الدالة، استبدل كل استخدام لـ `p_recorded_by` بـ `auth.uid()` (أو `COALESCE(auth.uid(), p_recorded_by)` فقط لمسار service_role)، أو أضِف `IF p_recorded_by <> auth.uid() AND current_user_role() <> 'super_admin' THEN RAISE EXCEPTION ...`.
3. **DB-03:** أعِد كتابة سياسات `period_sessions ins/upd` و`period_absences ins/upd` (المُعرَّفة في `2026_04_27_period_attendance.sql:69-110`) لتقييد `teacher` بـ `teacher_section_assignments` و`admin` بـ `admin_section_assignments` — **انسخ منطق سياسة `SELECT`** الموجودة في `2026_04_29_teacher_section_assignments.sql:83-109`.

**زيادة وقائية:** أعِد تسمية كل ملفات `save_period_attendance` ببادئة رقمية لمنع تكرار الانحدار (موثَّق في qa).

**القبول:** معلّم يحفظ حضور شعبة **غير مخصّصة له** عبر RPC و**عبر REST مباشرة** ← يُرفَض (42501). `recorded_by` يساوي دائمًا منفّذ العملية. تحقّق باسترجاع نظيف للقاعدة.

---

### P1.3 — توحيد أرقام الهاتف (COMPAT-01 / COMPAT-08) 🟠 عالية
**المشكلة:** مساران يرسلان الرقم خامًا فيفشل التسليم لأولياء الأمور بصمت.

**الملفات:** `app/api/whatsapp/send-notes/route.ts:165` · `app/api/whatsapp/send-period-absences/route.ts:144` · `app/api/students/import/route.ts:182`

**التغيير (المصدر الواحد المفضّل):** انقل التوحيد داخل `toJid()` في `lib/whatsapp/wasender-client.ts:150` بحيث يستحيل تكرار السهو:
```ts
import { normalizePhone } from '@/lib/teachers/credentials';
function toJid(raw: string): string {
  const e164 = normalizePhone(raw || '');          // 9665XXXXXXXX
  if (!/^9665\d{8}$/.test(e164)) throw new Error('bad_number'); // COMPAT-13
  return `${e164}@s.whatsapp.net`;
}
```
**+ COMPAT-08:** طبِّع الهاتف عند الاستيراد في `students/import/route.ts` (حوِّل الأرقام العربية-الهندية للاتينية أولًا) وخزّن `9665XXXXXXXX` موحّدًا.

**القبول:** إرسال ملاحظة/غياب لطالب رقمه مخزَّن `05XXXXXXXX` ← يصل فعلًا (يُحوَّل لـ `9665…`). رقم ناقص ← يُسجَّل «غير صالح» محليًا دون استهلاك رصيد Wasender.

---

### P1.4 — سدّ تسريب البحث (AUTH-03) 🟠 عالية
**الملف:** `app/api/search/route.ts:131-176`
**التغيير:** قصُر فرعي `teachers` و`sections` (اللذين يستخدمان عميل service-role) على `ctx.role !== 'teacher'`؛ أعِد نتائج فارغة لهذين النوعين عند المعلم، أو انقل استعلام teachers للعميل المربوط بـ RLS.
**القبول:** `GET /api/search?types=teachers&q=أ` كمعلّم ← `[]` (لا أسماء/أرقام معلمين).

---

### P1.5 — إصلاح أتمتة الإنتاج (PERF-02 / PERF-03) 🟠 عالية
**المشكلة:** `maxDuration=300` موروث من Vercel Pro بينما النشر على Hobby (سقف 60ث) ← الدالة تُقتَل قبل إطلاق العامل التالي. و`cron` محذوف ← الحملات المجدولة و sweep لا تنطلق.

**التغيير:**
1. في `bulk-jobs/[id]/process/route.ts:13`، `campaigns/[id]/process/route.ts:16`، `daily-attendance/send-whatsapp/route.ts:12`، `devices/sync-bulk/route.ts:10`: اضبط `export const maxDuration = 60;` و`BUDGET_MS ≈ 50_000`، وصحّح التعليقات («Vercel Pro» → «Hobby 60s»). وانقل منطق self-trigger ليُطلَق **قبل** انتهاء الميزانية بأمان.
2. **مُجدوِل خارجي** (اختر واحدًا، موثّقًا في qa):
   - **Supabase `pg_cron`** (مفضّل — داخل القاعدة): job كل دقيقة/5 دقائق يستدعي `sweep-scheduled` والـ workers العالقة عبر `net.http_post` بترويسة `x-worker-secret`.
   - أو **cron-job.org/QStash** يضرب الـ endpoints بالـ secret.
   - أو `setInterval` داخل `ecosystem.config.js` (PM2 المحلي) إن كان جهاز المدرسة دائم التشغيل.

**القبول:** حملة بـ 500 مستلم تكتمل عبر استدعاءات متتابعة دون توقّف. وظيفة `scheduled` بعد الدوام تنطلق تلقائيًا خلال نافذة المُجدوِل.

---

### P1.6 — تحديد المعدّل على الإرسال الجماعي (AUTH-04) 🟠 عالية
**الملف:** `app/api/whatsapp/bulk-parents/route.ts:72` (+ `bulk-remind-teachers`، `daily-attendance/campaigns`، `daily-attendance/send-whatsapp`، `send-notes`)
**التغيير:** `checkRateLimit('bulk:'+ctx.userId, N, window)` على إنشاء/تشغيل الإرسال الجماعي + حدّ يومي لإجمالي المستلمين/المُصدِّر مدعوم بقاعدة البيانات (`whatsapp_bulk_usage` + `reserve_whatsapp_bulk_quota`) حتى يصمد أمام تعدد نسخ Vercel و cold starts. فكّر في اشتراط flag `send_whatsapp` بدل `role` فقط.
**القبول:** محاولة إطلاق عدة حملات ضخمة متتالية من نفس المستخدم ← تُكبَح بعد الحدّ، وطلبان متزامنان يتجاوزان الحد اليومي لا يمران معًا.

> **بنهاية المرحلة 1:** الأمان ~85، قاعدة البيانات ~90، التوافق ~80، الأداء ~78. الإجمالي ~82.

---

## 2) المرحلة 2 — تقوية + خصوصية + وصولية (1–2 أسبوع)

### P2.1 — تفعيل تسجيل القراءات السرّية (PRIV-01) 🟠 عالية
**المشكلة:** `confidential_access_log` يلتقط الكتابات فقط؛ قراءة بيانات القُصّر السرّية لا تُسجَّل (وهم مساءلة، يخالف ضمانة الكود).
**التغيير:** helper موحّد `logConfidentialRead({ accessedBy, studentId, recordType, recordId, ip, userAgent })` يكتب بـ service-role، استدعِه في كل مسار GET يلمس `counseling_sessions` أو ملاحظات `is_confidential`:
- `counselor/cases/[id]/route.ts:182` · `workspace-summary/route.ts:205` · `watchlist/route.ts:135` · `cases/route.ts:98`
استخدم صفًّا مُجمَّعًا واحدًا لكل عرض حالة (`record_id = case_id`) إن قلق الحجم.
**القبول:** فتح المرشد لتفاصيل حالة ← صفّ `action='read'` في `confidential_access_log` بـ `accessed_by` الصحيح.

### P2.2 — سرّ عامل مستقل (AUTH-05 / AUTH-06)
- استبدل `SERVICE_ROLE_KEY.slice(0,32)` بـ `process.env.WORKER_SECRET` (عشوائي CSPRNG ≥32 بايت) في الملفات السبعة، مع `crypto.timingSafeEqual`.
- احذف فرع `isVercelCron` في `sweep-scheduled/route.ts:18` (لا cron مُكوَّن).
**القبول:** الـ workers تعمل بالـ secret الجديد؛ طلب بـ `x-vercel-cron` وحده ← 401.

### P2.3 — حماية تسجيل الدخول (AUTH-07)
فعّل rate limit + bot/CAPTCHA من لوحة Supabase Auth (خارج المستودع)، أو وجّه الدخول عبر endpoint خادمي بتأخير تصاعدي. وثّق القرار في qa.

### P2.4 — اشتقاق محتوى الواتساب اليومي من DB (AUTH-08)
في `daily-attendance/send-whatsapp/route.ts`، اشتق `phone`/`name` من جدول `students` عبر `student_id` خادميًا بدل قبولها من body.

### P2.5 — بنود أمنية منخفضة (AUTH-09/10/11/12)
- AUTH-10: في `lib/supabase/auth.ts:33`، افحص `error` صراحةً وارفض عند تعذّر تحديد الدور (fail-closed) بدل افتراض `viewer`.
- AUTH-11: للأسطح الحرجة (دخول/reset/bulk) استخدم مخزن rate-limit موزّع (Upstash) بدل الذاكرة.
- AUTH-12: استبدل `listUsers({perPage:1000})` لفحص تكرار البريد باستعلام مباشر/قيد UNIQUE.
- AUTH-09: تأكّد أن كل مسار محميّ بالـ persona/flag الصحيح (بعد P1.1) بحيث يكون `TEACHER_ONLY` تحسين UX لا حدًّا أمنيًا.

### P2.6 — إصلاح ترتيب هجرات النشر النظيف (DB-02)
أعِد تسمية ملف إنشاء `counselor_can_see_student` ليأتي **بعد** `extend_permissions` (الذي يُعرّف `current_user_is_counselor`)، أو انقل تعريف الدالة لأعلى `counselor_assignments.sql`. **تحقّق: استرجاع قاعدة نظيفة من الصفر في CI** (يكشف الفشل لو `check_function_bodies=on`).

### P2.7 — بنود قاعدة بيانات (DB-05/06/07/08)
- DB-05: انقل `social_info`/`health_info` لجدول منفصل بـ RLS أضيق (نمط counseling)، أو `REVOKE SELECT (social_info, health_info) ON students FROM authenticated` وامنحهما عبر view/RPC مقيّدة بـ flag `view_health_info`/`view_social_info` (الموجودين أصلًا).
- DB-06: أضِف فرعًا لسياسة `students read`: `OR counselor_can_see_student(students.id)` لاتساق رؤية المرشد.
- DB-07: trigger مزامنة `assignment_date` من الأب (نمط `counseling_sessions_sync_student_id`).
- DB-08: أضِف `SET search_path = public` (و`SECURITY DEFINER`) لدالّتي `*_update_search_text` وتأهيل `public.normalize_search_text`.

### P2.8 — موجة الوصولية (الأكبر أثرًا: 52 → ~85) ♿
- **A11Y-01:** قاعدة `@media (prefers-reduced-motion: reduce)` في `app/globals.css` تُعطّل الحركات، واستبدال `animate-pulse` الدائم على الشارات الحرجة بحدّ لوني ثابت.
- **A11Y-03:** غلِّف نماذج `register/{teacher,admin}` و`incidents/new` بـ `<form onSubmit>` وزر `type="submit"`.
- **A11Y-04:** خطاف `useFocusTrap` (حصر Tab + إرجاع البؤرة) على `components/ui/Modal.tsx` وكل النوافذ اليدوية في `teacher/page.tsx`.
- **A11Y-02:** نتائج `GlobalSearch.tsx` كـ `role="option"` داخل `role="listbox"` مع `aria-activedescendant`، وإظهار زر البحث على الجوال.
- **A11Y-05:** skip-link في `app/layout.tsx` + `<main id="main">`.
- **A11Y-06:** نص بديل/`aria-label` لحوامل الدلالة بالإيموجي/اللون.
- **A11Y-07:** `autoComplete`/`inputMode` لحقول الدخول والتسجيل.
- **A11Y-10/11:** رفع `text-gray-400` الحامل للمعنى إلى 500/600، وحدّ أدنى `text-xs` للنصوص الحاملة للمعلومة.
- **UX-09/12/RTL-13:** `loading.tsx` يصدّر `SkeletonPage` في المجلدات الرئيسية، استبدال `confirm()` بـ `ConfirmDialog`، وتوحيد RTL على الخصائص المنطقية (`ms-/me-/ps-/pe-/text-start/end/start-/end-`).

### P2.9 — توحيد التدويل (COMPAT-02/03/04/05/06/07)
- مساعِد واحد `AR_DATE_LOCALE = 'ar-SA-u-ca-gregory-nu-latn'` وأصلِح `lib/utils/helpers.ts:9,13` ليستخدماه، ثم وجّه كل `toLocale*` المباشرة إليهما.
- قاعدة عامة `@media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }` + `direction: rtl` في `globals.css` (COMPAT-05/14).
- أضِف أيقونات PNG (192/512 + 512 maskable + apple-touch-180) جنب SVG (COMPAT-06/PWA-01).
- احذف `getLocalToday()` المكسورة أو فوّضها لـ `todayInSchoolTz` بعد فحص مستهلكيها (COMPAT-07).
- استخدم `ca-islamic-umalqura` في طباعة الإشراف (COMPAT-09).

### P2.10 — تنظيف الأداء و PWA (PERF-01/04..10، PWA-02..05)
- **PERF-01 (الأهم):** حوّل الصفحات الأثقل (`students`, `daily-attendance`, `dashboard` الرئيسية) إلى نمط «جزر العميل»: `page.tsx` خادميّ يجلب `initialData` ويمرّرها لمكوّن عميل، أو `prefetchQuery`+`HydrationBoundary`.
- **PERF-04:** `npm uninstall @tanstack/react-table` (غير مستخدمة).
- **PERF-05:** `experimental: { optimizePackageImports: ['lucide-react'] }` في `next.config.mjs`.
- **PERF-06:** `next/dynamic` (ssr:false) للـ recharts في `reports/page.tsx`.
- **PERF-07:** ارفع فترات polling غير الحرجة (اللوحة 60-120ث، الأجهزة 30ث) ودمج الشارات في استعلام واحد.
- **PERF-09/10:** فحص الأجهزة مشروط بالبيئة (تخطّيه على `process.env.VERCEL`)، وتوسيع استثناءات `middleware` matcher لتشمل `manifest/sw.js/icon-`.
- **PWA-02/03:** صفحة `/offline` ثابتة مُضافة لـ `SHELL_URLS`، ومكوّن `<ServiceWorkerRegistrar/>` مشترك مع `clearInterval`.

> **بنهاية المرحلة 2:** كل المحاور ≥ 85، الإجمالي ~90.

---

## 3) المرحلة 3 — وصل جسور المميزات (الاكتمال → ~100٪)

| البند | التغيير | الملفات |
|---|---|---|
| **جسر المخالفة ← الحالة** | مسار `POST /api/incidents/[id]/escalate` ينشئ صف `student_cases`، يملأ `case_id`/`escalated_to`/`status='escalated'` (state-machine جاهزة) | `app/api/incidents/[id]/escalate/route.ts` (جديد) + `lib/cases/state-machine.ts` |
| **بطاقات placeholder للوكيل** | استبدل `pending_incidents:0`/`open_cases:0` بعدّتين فعليّتين | `vp/morning-summary/route.ts:267` · `vp/operations-report/[date]/route.ts:73` |
| **إشعار الوالد بمخالفة (م3.19)** | استدعِ `sendTextAndLog` عند `parent_notified=true` (+ إشعار المعلم عند الرفض) | `incidents/[id]/action/route.ts:183` · `dismiss/route.ts:198` |
| **قراءة جلسات الإرشاد المشفّرة** | `decrypt_session_content` RPC (service_role) + شاشة محميّة + تسجيل `action='decrypt'` في سجل الوصول | migration جديدة + `counselor/cases/[id]/sessions` |
| **تقييد بحث المرشد بالنطاق** | فرع `counselor_assignments` في `/api/search` ثم إعادة تفعيله للمرشد | `app/api/search/route.ts` |

---

## 4) معيار 100 لكل محور (Definition of Done)

- **الأمان (→100):** P1.1, P1.4, P1.6 + P2.2/3/4/5 مغلقة؛ صفر مسار حسّاس بلا flag دقيق؛ rate limit على دخول/reset/bulk؛ سرّ عامل مستقل.
- **قاعدة البيانات (→100):** P1.2 + P2.6/7 مغلقة؛ استرجاع نظيف ينجح في CI؛ صفر سياسة كتابة بلا scope.
- **الخصوصية (→100):** P2.1 (تسجيل القراءات) + حدّ k للإجماليات الصغيرة (PRIV-04) + تقييد بحث المرشد (PRIV-02) + سياسة احتفاظ/حذف موثّقة.
- **UX/الوصولية (→100):** كل بنود P2.8 + اجتياز فحص axe بلا أخطاء + RTL منطقي بالكامل.
- **التوافق (→100):** P1.3 + P2.9 كاملة؛ مساعِد تواريخ واحد؛ طباعة بألوان؛ أيقونات PNG.
- **الأداء/PWA (→100):** P1.5 + P2.10؛ جزر عميل على الصفحات الثقيلة؛ Lighthouse perf ≥90؛ PWA ≥95.
- **الاكتمال (→100٪):** كل جسور المرحلة 3 موصولة.

---

## 5) قائمة التحقّق التشغيلي (أكّدها قبل اعتبار البنود مغلقة)

- [ ] **سقف Hobby (60ث):** أكّد من لوحة Vercel. لو رُقّي لـ Pro تخفّ P1.5 جزئيًا لكن المُجدوِل يبقى مطلوبًا.
- [ ] **`check_function_bodies`:** اختبر استرجاع قاعدة نظيفة لكشف فشل DB-02.
- [ ] **انتحال `x-vercel-cron`:** بعد حذف الفرع (P2.2) تأكّد أن المُجدوِل البديل يعمل.
- [ ] **حدود Supabase Auth:** فعّلها من اللوحة (AUTH-07).
- [ ] **`drift` في RLS:** أكّد أن كل الهجرات مُطبَّقة على staging/production بالترتيب الصحيح.

---

## 6) ترتيب التنفيذ المقترح

```
المرحلة 1 (P1.1 → P1.6)  ← ابدأ بـ P1.1 و P1.2 (إصلاحان صغيران، أثر حاسم)
        ↓ بوابة تحقق + qa
المرحلة 2 (P2.1 → P2.10) ← P2.1 و P2.8 الأعلى أثرًا
        ↓ بوابة تحقق + qa
المرحلة 3 (الجسور)       ← بعد استقرار الأمان والأتمتة
        ↓ axe + Lighthouse + استرجاع نظيف
        100/100 ✅
```

> **ملاحظة ختامية لـ Codex:** البنية الأساسية لهذا النظام متينة (RLS ناضج، personas، تشفير، PWA). كل ما سبق **إضافات وإصلاحات موضعية لا إعادة هيكلة** — لذا الوصول إلى 100 مسألة انضباط تنفيذي لا إعادة بناء. التزِم بـ review-gate، واجعل كل ادعاء «تمّ» مُسنَدًا باختبار/تحقّق. وفّق الله الجميع. 🤍

---

## P1.5 Decision Addendum — Supabase pg_cron

قرار التنفيذ: استخدم Supabase `pg_cron` + `pg_net` كمجدول أساسي، لا Vercel Cron ولا PM2 المحلي.

نقاط المراجعة الملزمة:

- خزّن `WORKER_SECRET` في Vercel env، وخزّن نفس القيمة في Supabase Vault باسم `worker_secret`.
- خزّن رابط التطبيق العام في Supabase Vault باسم `app_base_url`.
- لا تضع السر صريحًا داخل `cron.job`: jobs يجب أن تقرأ من `vault.decrypted_secrets` وقت التنفيذ.
- `pg_net` fire-and-forget؛ راقب `net._http_response` عند التحقيق في فشل الاستدعاءات.
- `supervision/reminder/run` يجب أن يحرس نافذة Riyadh 06:00-10:00 وأن يكون idempotent عبر `supervision_reminder_log`.
- `risk-scores/sweep` يُجدول يوميًا لا كل دقيقة.
- sweeps يجب ألا تلمس أعمالًا نشطة؛ daily campaigns تستأنف `pending` أو `processing` الخاملة فقط.
- كل worker محمي بـ `x-worker-secret` فقط؛ `x-vercel-cron` وحده لا يكفي.
