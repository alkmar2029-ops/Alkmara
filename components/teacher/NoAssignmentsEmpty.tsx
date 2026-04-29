'use client';

import { AlertCircle, Mail } from 'lucide-react';

/**
 * Shown when a teacher logs in but the admin hasn't assigned them any
 * sections yet. The portal's section pickers would otherwise be empty
 * and the teacher would assume the system is broken — this card explains
 * what's going on and gives them a direct path to the internal-messages
 * inbox to nudge the admin.
 */
export default function NoAssignmentsEmpty() {
  return (
    <div className="card max-w-xl mx-auto my-12 bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-200 dark:border-amber-500/30">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shrink-0">
          <AlertCircle className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="font-bold text-amber-900 dark:text-amber-200">
            لم يتم تعيينك على شعب بعد
          </h2>
          <p className="text-sm text-amber-800 dark:text-amber-300 mt-1.5 leading-relaxed">
            لا يستطيع النظام عرض الطلاب أو السماح لك بتسجيل الحضور والملاحظات
            حتى تُعيّنك الإدارة على الشعب التي تُدرّسها.
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">
            🌹 تواصل مع إدارة المدرسة لتفعيل حسابك. يمكنك إرسال رسالة داخلية من تبويب "الرسائل".
          </p>
          <a
            href="/teacher/messages"
            className="mt-4 inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
          >
            <Mail className="w-4 h-4" />
            فتح الرسائل الداخلية
          </a>
        </div>
      </div>
    </div>
  );
}
