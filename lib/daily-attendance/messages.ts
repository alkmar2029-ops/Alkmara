// Arabic message templates for daily-attendance notifications. Used
// by both the synchronous send endpoint and the background-campaign
// worker so both flows produce identical text.

import type { PhaseKey } from './campaign-types';

interface MessageArgs {
  studentName: string;
  gradeName: string | null;
  sectionName: string | null;
  date: string;            // YYYY-MM-DD
  missedPeriods?: number[];
  schoolName: string;
}

function formatDate(date: string): string {
  try {
    return new Date(date).toLocaleDateString('ar-SA-u-ca-gregory', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return date;
  }
}

export function buildPhaseMessage(phase: PhaseKey, args: MessageArgs): string {
  const dateStr = formatDate(args.date);
  const sectionLabel = `${args.gradeName || ''} / ${args.sectionName || ''}`.trim();

  if (phase === 'absence') {
    return `🔴 *إشعار غياب يومي*

السلام عليكم ورحمة الله وبركاته،

نُعلمكم أن ابنكم/ابنتكم:
👤 *${args.studentName}*
📚 ${sectionLabel}

غاب اليوم *${dateStr}* عن المدرسة، ولم يصلنا استئذان مسبق.

نأمل التواصل معنا في أقرب وقت إذا كان هناك سبب،
أو متابعة الطالب لضمان انتظامه 🤝

— *${args.schoolName}*`;
  }

  const periodsStr = (args.missedPeriods || []).join(' • ');

  if (phase === 'escape_after_first') {
    return `🟠 *إشعار هروب بعد التحضير*

السلام عليكم ورحمة الله وبركاته،

ابنكم/ابنتكم:
👤 *${args.studentName}*
📚 ${sectionLabel}

حضر اليوم *${dateStr}* الحصة الأولى للتحضير،
ثم غاب عن باقي الحصص: *${periodsStr}*

هذه حالة تستدعي المتابعة العاجلة،
ونرجو التواصل لمناقشة الأمر 🌹

— *${args.schoolName}*`;
  }

  if (phase === 'mid_day_departure') {
    return `🔵 *إشعار انصراف من المدرسة*

السلام عليكم ورحمة الله وبركاته،

ابنكم/ابنتكم:
👤 *${args.studentName}*
📚 ${sectionLabel}

حضر اليوم *${dateStr}* بداية اليوم الدراسي،
ثم غاب عن الحصص: *${periodsStr}*

نرجو التواصل معنا للتأكد من سبب الانصراف 🤝

— *${args.schoolName}*`;
  }

  // selective_skip
  return `🟡 *إشعار تهرّب من حصص*

السلام عليكم ورحمة الله وبركاته،

ابنكم/ابنتكم:
👤 *${args.studentName}*
📚 ${sectionLabel}

حضر اليوم *${dateStr}* المدرسة،
لكنه تغيّب عن الحصص: *${periodsStr}*

نأمل المتابعة من حضراتكم لضبط انتظامه 🌹

— *${args.schoolName}*`;
}
