# خطة المتبقّي للوصول إلى 100/100 — خريطة تنفيذ متسلسلة

> **المصدر:** بناءً على `opus48-plan-to-100.md` + تدقيق الحالة الفعلية في الكود بتاريخ 2026-05-31.
> **الوضع الحالي:** ~87/100 — المرحلة 1 مكتملة بالكامل، وجزء كبير من المرحلة 2 مغلق.
> **الهدف:** 100/100 — كلها إصلاحات موضعية، لا إعادة هيكلة.

---

## 0) ما تأكّد إغلاقه فعلًا (لا تكرّره)

**المرحلة 1 كاملة:** P1.1 صلاحيات `requireManageUsers` · P1.2 نطاق حضور الحصص (هجرة `2026_07_06_001`) · P1.3 توحيد الهاتف (`lib/phone/normalize.ts` + `toJid`) · P1.4 تسريب البحث · P1.5 أتمتة pg_cron (`002`) + `WORKER_SECRET` بـ `timingSafeEqual` · P1.6 حدّ الإرسال الجماعي (`003` + `bulk-send-limit.ts`).

**من المرحلة 2 — مغلق ومُتحقَّق:**
- P2.1 تسجيل القراءات السرّية (`lib/audit/confidential-read.ts`).
- P2.2 سرّ العامل المستقل + إزالة فرع `x-vercel-cron` (لا أثر له في `app/api`).
- P2.8 الوصولية: باتشات 0/1a/1b/2/3 (skip-link, focus-trap, listbox للبحث, نماذج دلالية, تباين, ConfirmDialog أساسي, loading skeletons).
- P2.9 التواريخ: `lib/utils/date-format.ts` + سياسة `ar-SA-u-ca-gregory-nu-latn` + طباعة ملوّنة.
- **AUTH-10** fail-closed للدور (`lib/supabase/auth.ts:39`) · **AUTH-12** `email_is_registered` (هجرة `004`) · **DB-08** تحصين `*_update_search_text` (هجرة `005`).

**بوابة كل بند (إلزامية):** `npx tsc --noEmit` = EXIT 0 + lint للملفات الملموسة + (عند المساس بالحضور/الواتساب) `smoke:sprint2/3` + سطر في qa المرحلة + (للأمان) اختبار سلبي. اقرأ الكود/المخطط الفعلي قبل أي تعديل — الأسطر هنا قد تنزاح.

---

## الموجة A — جسور الاكتمال (المرحلة 3) — ✅ مكتملة (الكود) 2026-05-31

> **الحالة:** الخمسة بنود منفَّذة، `tsc` + `eslint` خضراء. تفاصيل + اختبارات القبول في `scripts/opus48-p3-qa.md`. **متبقٍّ تشغيليًا:** تطبيق هجرة `2026_07_10_001` + ضبط `COUNSELING_SESSION_KEY` + تشغيل الاختبارات السلبية على staging قبل الإغلاق النهائي.
>
> البنية كانت جاهزة: `lib/cases/state-machine.ts`, جدول `student_cases` (هجرة `2026_06_10_001`), `case_history` (`003`), `create_counseling_session` (`009`).

### A1 — جسر المخالفة ← الحالة 🔴
- **جديد:** `app/api/incidents/[id]/escalate/route.ts`.
- **البوّابة:** `requireAdminWithFlag('review_teacher_incidents', …)` (نفس `action/route.ts`).
- **المنطق:** تحقّق المخالفة موجودة + حالتها `submitted|under_review` + نطاق `reviewer_can_see_student` + ليست self-review → أنشئ صف `student_cases` (`status='open'`, `opened_by=ctx.userId`, اربط `incident_id`/المصدر) ثم حدِّث المخالفة `status='escalated'` + `case_id`/`escalated_to` + صف `case_history` ابتدائي.
- **اقرأ أولًا:** أعمدة `student_cases` (`002`/`001`) و`student_incidents` (هل فيه حالة `escalated` و`case_id`؟) قبل تثبيت الحقول.
- **القبول:** تصعيد مخالفة `submitted` ينشئ حالة `open` مربوطة بها وحالة المخالفة تصير `escalated`؛ مراجع خارج النطاق ← 403.

### A2 — إشعار الوالد بمخالفة (م3.19) 🟠
- **الملف:** `app/api/incidents/[id]/action/route.ts:183` (الـ `TODO` صريح) + مسار `dismiss` لإشعار المعلم عند الرفض.
- **التغيير:** عند `parent_notified=true` نادِ `sendTextAndLog` بقالب وليّ الأمر؛ اجلب جوال الوصي من `students` خادميًا ومرّره عبر `toJid` (طبيعي بعد P1.3). **idempotent:** أرسل فقط إن لم يوجد صف `whatsapp_messages` للمخالفة (التعليق يصف هذا).
- **القبول:** إجراء بـ `parent_notified=true` ← رسالة تصل وتُسجَّل؛ استدعاء ثانٍ لا يُكرّر الإرسال.

### A3 — كروت الوكيل الفعلية 🟠
- **الملفات:** `app/api/vp/morning-summary/route.ts:267` · `app/api/vp/operations-report/[date]/route.ts:73`.
- **التغيير:** استبدل `pending_incidents:0`/`open_cases:0` بعدّتين فعليّتين مقيّدتين بنطاق الوكيل: `student_incidents` بحالة `submitted|under_review`، و`student_cases` بحالة `open|in_progress`.
- **القبول:** الكروت تعكس الأعداد الحقيقية.

### A4 — قراءة جلسات الإرشاد المشفّرة 🟠
- **جديد (هجرة):** `decrypt_session_content(p_actor_user_id, p_session_id, p_key)` — `SECURITY DEFINER`, **service_role فقط** (نفس انضباط `create_counseling_session`)، يعيد فحص النطاق عبر `counselor_assignments`، يفكّ `pgp_sym_decrypt`، ويكتب `action='decrypt'` في `confidential_access_log` (الصف «المؤجَّل» الموصوف في تعليق `009`).
- **API:** `app/api/counselor/cases/[id]/sessions/[sessionId]/route.ts` (GET) — بوّابة `requireCounselorWorkspace`, نداء RPC عبر admin client بمفتاح `COUNSELING_SESSION_KEY`, تسجيل القراءة.
- **UI:** شاشة محميّة تحت `counselor/cases`.
- **القبول:** مرشد داخل النطاق يفكّ المحتوى ← يظهر + صف `decrypt`؛ خارج النطاق ← 42501.

### A5 — تقييد بحث المرشد بالنطاق (PRIV-02) 🟠
- **الملف:** `app/api/search/route.ts`.
- **التغيير:** فرع `persona=counselor`: قصُر نتائج الطلاب على نطاق `counselor_assignments` (أعِد استخدام `counselor_can_see_student`)، ثم أعِد تفعيل البحث للمرشد.
- **القبول:** بحث المرشد يُرجِع طلاب نطاقه فقط.

---

## الموجة B — تحصين قاعدة البيانات (P2.6 + بقية P2.7) — يوم–يومان

### B1 — DB-02 ترتيب الهجرات النظيف 🟠
- **✅ مؤكَّد بتشخيص `scripts/migration-order-check.mjs` (2026-05-31, read-only):** الاسترجاع النظيف من الصفر يفشل عند الهجرة `2026_05_20_counselor_assignments.sql` لأن سياساتها (CREATE POLICY) تستدعي `current_user_has_flag` و`current_user_is_counselor` المُعرَّفتين أولًا في `2026_05_20_extend_permissions.sql` (تليها). `persona_helper_fixes` يُعيد تعريفهما لكنه يأتي بعد نقطة الفشل فلا ينقذ الاسترجاع النظيف.
  - تنبيه إضافي من نفس التشخيص: `is_admin`/`is_staff_or_admin` تُستخدمان في `2026_04_27_note_templates`/`_student_notes` لكن أول تعريف داخل-المجلد عند `2026_04_29_admin_assignments…` (CREATE OR REPLACE) ← المجلد يفترض **baseline ما قبل 04_27** خارجه؛ ليستا انحدارًا، لكن أي clean-deploy لازم يبدأ من ذلك الـ baseline.
- **التغيير (الأقل خطرًا على DB قائمة):** انقل تعريفَي `current_user_has_flag` + `current_user_is_counselor` لأعلى `counselor_assignments` (قبل سياساتها) — يتجنّب إعادة تسمية هجرة مُطبَّقة. البديل: أعِد تسمية `extend_permissions` لتسبق `counselor_assignments`.
- **القبول:** `node scripts/migration-order-check.mjs` = EXIT 0، و**استرجاع قاعدة من الصفر** ينجح مع `check_function_bodies=on`.

### B2 — DB-05 فصل `social_info`/`health_info` 🟠
- **هجرة جديدة:** انقلهما لجدول منفصل بـ RLS أضيق (نمط counseling)، أو `REVOKE SELECT (social_info, health_info) ON students FROM authenticated` + منحهما عبر view/RPC مقيّدة بالـ flags الموجودة `view_health_info`/`view_social_info`.
- **القبول:** مستخدم بلا الـ flag لا يقرأ العمودين عبر REST مباشر.

### B3 — DB-06 اتساق رؤية المرشد 🟡
- **التغيير:** أضِف فرعًا لسياسة `students read`: `OR counselor_can_see_student(students.id)`.

### B4 — DB-07 trigger مزامنة `assignment_date` 🟡
- **اقرأ أولًا:** أيّ جدول يحمل `assignment_date` ومن أبوه (`substitution_assignments`؟).
- **التغيير:** trigger مزامنة من الأب (نمط `counseling_sessions_sync_student_id`).

---

## الموجة C — ذيل الأمان (P2.4 + بقية P2.5 + P2.3) — يوم

### C1 — AUTH-08 اشتقاق محتوى الواتساب اليومي من DB 🟠
- **الملف:** `app/api/daily-attendance/send-whatsapp/route.ts` — اشتق `phone`/`name` من `students` عبر `student_id` خادميًا بدل قبولها من body.

### C2 — AUTH-11 rate-limit موزّع (Upstash) 🟡
- **التغيير:** للدخول/reset استخدم مخزن موزّع (Upstash Redis) بدل الذاكرة (الذي لا يصمد أمام تعدد نسخ Vercel). الإرسال الجماعي مغطّى أصلًا بحصّة DB (P1.6).

### C3 — AUTH-09 تدقيق flags المسارات 🟡
- **التغيير:** تأكّد أن كل مسار محميّ بالـ persona/flag الصحيح بعد P1.1، بحيث يكون `TEACHER_ONLY` تحسين UX لا حدًّا أمنيًا. وثّق المصفوفة في qa.

### C4 — AUTH-07 حماية الدخول (تشغيلي) 🟡
- فعّل rate limit + bot/CAPTCHA من لوحة Supabase Auth، أو endpoint خادمي بتأخير تصاعدي. وثّق القرار.

---

## الموجة D — الأداء و PWA (P2.10) — ٣–٤ أيام · أكبر فجوة محور متبقية

**مكاسب سريعة (نصف يوم):**
- **PERF-04:** `npm uninstall @tanstack/react-table` (لسه في `package.json:20`، غير مستخدمة).
- **PERF-05:** `experimental: { optimizePackageImports: ['lucide-react'] }` في `next.config.mjs` (غير موجود).
- **PERF-06:** `next/dynamic` (ssr:false) للـ recharts في `reports/page.tsx`.
- **PERF-09/10:** فحص الأجهزة مشروط بالبيئة (تخطّيه على `process.env.VERCEL`)، وتوسيع matcher الـ `middleware` ليستثني `manifest/sw.js/icon-`.

**PWA (يوم):**
- **PWA-02/03:** صفحة `/offline` ثابتة (غير موجودة) مُضافة لـ `SHELL_URLS`، ومكوّن `<ServiceWorkerRegistrar/>` مشترك مع `clearInterval`.

**polling (نصف يوم):**
- **PERF-07:** ارفع الفترات غير الحرجة (اللوحة 60-120ث، الأجهزة 30ث) ودمج الشارات في استعلام واحد.

**الأثقل — PERF-01 (يوم–يومان):**
- حوّل الصفحات الأثقل (`students`, `daily-attendance`, `dashboard`) لنمط «جزر العميل»: `page.tsx` خادميّ يجلب `initialData` ويمرّرها لمكوّن عميل، أو `prefetchQuery`+`HydrationBoundary`.
- **القبول:** Lighthouse perf ≥ 90، PWA ≥ 95.

---

## الموجة E — كنس الوصولية والتدويل (ذيل P2.8/P2.9) — يومان

- **UX-12:** استبدل باقي `confirm()` في لوحات الحملات/محرّر القوالب/أكواد الدعوة/الـ personas/إرسال الحضور/حضور الحصص/الإشراف/الملاحظات/أعمال الواتساب بـ `ConfirmDialog`.
- **A11Y-10/11:** كنس باقي `text-[10px]`/`text-gray-400` الحاملة للمعنى → `text-xs` وتباين أقوى.
- **RTL-13:** كنس الخصائص الفيزيائية المتبقية → منطقية (`ms-/me-/ps-/pe-/text-start/end`).
- **COMPAT:** كنس `toLocaleDateString('ar-SA…')` المباشر (~31 ملف) → مساعِد `date-format`؛ احذف/فوّض `getLocalToday` (COMPAT-07)؛ أيقونات PNG 192/512/maskable/apple-touch-180 (COMPAT-06/PWA-01)؛ `islamic-umalqura` في طباعة الإشراف (COMPAT-09).
- **القبول:** فحص axe بلا أخطاء على الأسطح الرئيسية.

---

## الموجة F — إتمام الخصوصية — نصف يوم

- **PRIV-04:** حدّ k للإجماليات الصغيرة (إخفاء العدّ < k في التقارير المُجمّعة).
- سياسة احتفاظ/حذف موثّقة لبيانات القُصّر.

---

## البوابة النهائية (تعريف الإنجاز لكل محور → 100)

- **الأمان:** A2 + C1/2/3/4 مغلقة؛ صفر مسار حسّاس بلا flag دقيق؛ rate-limit موزّع على دخول/reset.
- **قاعدة البيانات:** B1–B4؛ **استرجاع نظيف ينجح في CI**؛ صفر سياسة كتابة بلا scope.
- **الخصوصية:** A5 (نطاق المرشد) + A4 (سجل decrypt) + F؛ سياسة احتفاظ موثّقة.
- **UX/الوصولية:** E مكتملة + **axe بلا أخطاء** + RTL منطقي بالكامل.
- **التوافق:** كنس التواريخ + أيقونات PNG + طباعة ملوّنة (مغلق جزئيًا).
- **الأداء/PWA:** الموجة D؛ **Lighthouse perf ≥90 / PWA ≥95**.
- **الاكتمال:** الموجة A الخمسة موصولة.

### اختبارات سلبية ختامية (يجب أن تمرّ)
مرشد/وكيل ← إنشاء أدمن = 403 · معلّم ← بحث المعلمين = `[]` · معلّم ← حفظ شعبة غير مخصّصة = 42501 · عامل بـ `x-vercel-cron` وحده = 401 · مرشد خارج النطاق ← فكّ جلسة = 42501.

---

## قائمة التحقّق التشغيلي (قبل اعتبار البنود مغلقة)

- [ ] سقف Hobby 60ث مؤكَّد من لوحة Vercel.
- [ ] `WORKER_SECRET` في Vercel = `worker_secret` في Supabase Vault؛ و`app_base_url` في الـ Vault.
- [ ] هجرات pg_cron مُطبَّقة بعد تفعيل الإضافات المطلوبة.
- [ ] `COUNSELING_SESSION_KEY` مضبوط في البيئة (للموجة A4).
- [ ] حدود Supabase Auth مفعّلة (C4).
- [ ] كل الهجرات مُطبَّقة على staging/production بالترتيب الصحيح (لا drift).

---

## الترتيب المقترح والجهد التقديري

```
A (الجسور · ٢-٣ي) → B (DB · ١-٢ي) → C (أمان · ١ي)
        ↓ بوابة + qa لكل موجة
D (أداء/PWA · ٣-٤ي) → E (كنس a11y/i18n · ٢ي) → F (خصوصية · ٠.٥ي)
        ↓ axe + Lighthouse + استرجاع نظيف + اختبارات سلبية
        100/100 ✅
```

**إجمالي الجهد:** ~10–12 يوم عمل. **أعلى أثر فوري:** الموجة A (الاكتمال) ثم مكاسب D السريعة.
**منهجية:** كل موجة في worktree → مراجعة → مزامنة main → تطبيق staging (review-gate)، وسطر qa لكل بند.
