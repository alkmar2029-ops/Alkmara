'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Printer, ArrowRight, ThumbsUp, ThumbsDown, Loader2, Send, CheckCircle2 } from 'lucide-react';

interface NoteRow {
  id: number;
  student_id: number;
  text: string;
  type: 'positive' | 'negative';
  category: string | null;
  source: string;
  recorded_at: string;
  whatsapp_sent_at: string | null;
  student_code: string | null;
  student_name: string | null;
  grade_name: string | null;
  section_name: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  academic: 'أكاديمي',
  behavior: 'سلوكي',
  attendance: 'حضور',
  participation: 'مشاركة',
  general: 'عام',
};

export default function NotesPrintPage() {
  const params = useParams<{ batchId: string }>();
  const router = useRouter();
  const batchId = params?.batchId;

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data,
  });

  const { data: notes, isLoading, isError, refetch } = useQuery<NoteRow[]>({
    queryKey: ['notes-batch', batchId],
    queryFn: async () => {
      const r = await fetch(`/api/student-notes?batch_id=${batchId}`);
      if (!r.ok) throw new Error('فشل تحميل الملاحظات');
      return (await r.json()).data;
    },
    enabled: !!batchId,
  });

  // Send WhatsApp messages for the whole batch.
  const sendWaMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/whatsapp/send-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'فشل الإرسال');
      return data.data as { requested: number; sent: number; failed: number; skipped: number; outcomes: any[] };
    },
    onSuccess: (d) => {
      const msg = `تم إرسال ${d.sent} رسالة` + (d.failed ? ` — فشل ${d.failed}` : '');
      d.failed > 0 ? toast(msg, { icon: '⚠️' }) : toast.success(msg);
      refetch();
    },
    onError: (e: any) => toast.error(e.message || 'فشل الإرسال'),
  });

  const sentCount = (notes || []).filter((n) => n.whatsapp_sent_at).length;
  const totalCount = notes?.length ?? 0;
  const allSent = totalCount > 0 && sentCount === totalCount;

  // Safety opt-out: a small checkbox next to the send button. Defaults to ON
  // so the regular flow isn't slowed down, but unchecking disables sending.
  const [sendEnabled, setSendEnabled] = useState(true);

  // After load, set page title to something meaningful for the saved PDF.
  useEffect(() => {
    if (notes && notes.length > 0) {
      const date = new Date(notes[0].recorded_at).toLocaleDateString('ar-SA');
      document.title = `ملاحظات الطلاب — ${date}`;
    }
    return () => { document.title = 'نظام الحضور'; };
  }, [notes]);

  const formattedDate = useMemo(() => {
    if (!notes || notes.length === 0) return '';
    return new Date(notes[0].recorded_at).toLocaleDateString('ar-SA', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }, [notes]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin me-2" /> جارٍ التحميل...
      </div>
    );
  }
  if (isError || !notes || notes.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500 dark:text-gray-400">
        <p>لا توجد ملاحظات لهذه الدفعة.</p>
        <button onClick={() => router.push('/dashboard/notes')} className="btn-secondary mt-4 inline-flex items-center gap-1">
          <ArrowRight className="w-4 h-4" /> رجوع لتسجيل الملاحظات
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Print-only stylesheet */}
      <style jsx global>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; }
          .no-print { display: none !important; }
          .note-page {
            page-break-after: always;
            break-after: page;
            min-height: calc(100vh - 24mm);
          }
          .note-page:last-child { page-break-after: auto; break-after: auto; }
        }
      `}</style>

      {/* Top bar — hidden on print */}
      <div className="no-print sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 -mx-4 -mt-4 px-4 py-3 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">معاينة الطباعة</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">{notes.length} ورقة — {formattedDate}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => router.push('/dashboard/notes')}
              className="btn-secondary inline-flex items-center gap-1 text-sm"
            >
              <ArrowRight className="w-4 h-4" /> رجوع
            </button>
            <button
              onClick={() => window.print()}
              className="btn-secondary inline-flex items-center gap-1 text-sm"
            >
              <Printer className="w-4 h-4" /> طباعة / حفظ PDF
            </button>
            <label
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                sendEnabled
                  ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                  : 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400'
              }`}
              title="ألغ الصح لمنع الإرسال"
            >
              <input
                type="checkbox"
                checked={sendEnabled}
                onChange={(e) => setSendEnabled(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              تفعيل الإرسال
            </label>
            <button
              onClick={() => {
                if (allSent) {
                  if (!confirm('تم إرسال هذه الملاحظات سابقاً. هل تريد إعادة الإرسال؟')) return;
                }
                sendWaMut.mutate();
              }}
              disabled={sendWaMut.isPending || totalCount === 0 || !sendEnabled}
              className={`btn-primary inline-flex items-center gap-1 text-sm ${allSent ? 'opacity-70' : ''} ${!sendEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              title={
                !sendEnabled
                  ? 'الإرسال معطّل — فعّل المربع المجاور لتفعيله'
                  : allSent
                    ? 'تم الإرسال — يمكنك إعادة الإرسال'
                    : 'إرسال إلى أولياء الأمور عبر واتساب'
              }
            >
              {sendWaMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : allSent ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {sendWaMut.isPending
                ? 'جارٍ الإرسال...'
                : allSent
                  ? `تم الإرسال (${sentCount})`
                  : `إرسال واتساب (${totalCount})`}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            💡 لحفظ PDF: اضغط طباعة → اختر "حفظ كـ PDF".
          </span>
          {sentCount > 0 && sentCount < totalCount && (
            <span className="text-yellow-600 dark:text-yellow-400">
              تم إرسال {sentCount} من {totalCount} مسبقاً.
            </span>
          )}
        </div>

        {/* Send results */}
        {sendWaMut.data && (
          <div className="mt-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-sm">
            <div className="flex flex-wrap gap-3 mb-2">
              <span className="text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4 inline" /> أُرسل: <strong>{sendWaMut.data.sent}</strong>
              </span>
              {sendWaMut.data.failed > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  فشل: <strong>{sendWaMut.data.failed}</strong>
                </span>
              )}
              {sendWaMut.data.skipped > 0 && (
                <span className="text-gray-500 dark:text-gray-400">
                  تخطّى: <strong>{sendWaMut.data.skipped}</strong>
                </span>
              )}
            </div>
            {sendWaMut.data.outcomes.some((o: any) => !o.ok) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-600 dark:text-gray-300">عرض تفاصيل الفشل</summary>
                <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
                  {sendWaMut.data.outcomes
                    .filter((o: any) => !o.ok)
                    .map((o: any) => (
                      <li key={o.note_id} className="text-red-600 dark:text-red-400">
                        {o.student_name} — {o.error}
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Print area — one page per note */}
      <div className="print-area space-y-4">
        {notes.map((n) => (
          <NoteSheet key={n.id} note={n} settings={settings} />
        ))}
      </div>
    </>
  );
}

function NoteSheet({ note, settings }: { note: NoteRow; settings: any }) {
  const isPositive = note.type === 'positive';
  const dateStr = new Date(note.recorded_at).toLocaleDateString('ar-SA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="note-page bg-white text-black border border-gray-300 rounded-lg p-8 print:p-0 print:border-0 print:rounded-none mx-auto max-w-[210mm]">
      {/* Header */}
      <div className="text-center pb-4 border-b-2 border-gray-800">
        <p className="text-sm text-gray-600 mb-1">المملكة العربية السعودية — وزارة التعليم</p>
        <h1 className="text-2xl font-bold">{settings?.school_name || 'المدرسة'}</h1>
        {settings?.principal_name && (
          <p className="text-sm text-gray-700 mt-1">المدير: {settings.principal_name}</p>
        )}
      </div>

      {/* Title bar */}
      <div className={`flex items-center justify-center gap-2 py-3 my-4 rounded-lg ${
        isPositive ? 'bg-green-50 border border-green-300' : 'bg-red-50 border border-red-300'
      }`}>
        {isPositive
          ? <ThumbsUp className="w-5 h-5 text-green-700" />
          : <ThumbsDown className="w-5 h-5 text-red-700" />}
        <h2 className={`text-xl font-bold ${isPositive ? 'text-green-800' : 'text-red-800'}`}>
          {isPositive ? 'إفادة شكر وتقدير' : 'إشعار ملاحظة سلوكية'}
        </h2>
      </div>

      {/* Student info table */}
      <table className="w-full text-base border-collapse mb-6">
        <tbody>
          <tr className="border-b border-gray-300">
            <td className="py-2 px-3 font-semibold bg-gray-50 w-1/4">اسم الطالب:</td>
            <td className="py-2 px-3">{note.student_name || '—'}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-2 px-3 font-semibold bg-gray-50">رقم الهوية:</td>
            <td className="py-2 px-3 font-mono" dir="ltr">{note.student_code || '—'}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-2 px-3 font-semibold bg-gray-50">الصف / الشعبة:</td>
            <td className="py-2 px-3">{note.grade_name || '—'} — {note.section_name || '—'}</td>
          </tr>
          <tr className="border-b border-gray-300">
            <td className="py-2 px-3 font-semibold bg-gray-50">التاريخ:</td>
            <td className="py-2 px-3">{dateStr}</td>
          </tr>
          <tr>
            <td className="py-2 px-3 font-semibold bg-gray-50">التصنيف:</td>
            <td className="py-2 px-3">{CATEGORY_LABELS[note.category || 'general'] || 'عام'}</td>
          </tr>
        </tbody>
      </table>

      {/* The note text — biggest visual element */}
      <div className="my-6">
        <p className="text-sm text-gray-600 mb-2">نص الملاحظة:</p>
        <div className={`min-h-[140px] p-6 rounded-lg border-2 text-lg leading-loose ${
          isPositive ? 'bg-green-50/40 border-green-300' : 'bg-red-50/40 border-red-300'
        }`}>
          {note.text}
        </div>
      </div>

      {/* Signatures */}
      <div className="grid grid-cols-3 gap-6 mt-12 pt-6 border-t border-gray-300 text-center text-sm">
        <div>
          <p className="font-semibold mb-12">المعلم</p>
          <div className="border-t border-gray-400 mx-4">
            <p className="text-xs text-gray-500 pt-1">التوقيع</p>
          </div>
        </div>
        <div>
          <p className="font-semibold mb-12">ولي الأمر</p>
          <div className="border-t border-gray-400 mx-4">
            <p className="text-xs text-gray-500 pt-1">التوقيع</p>
          </div>
        </div>
        <div>
          <p className="font-semibold mb-12">{settings?.principal_name ? `المدير / ${settings.principal_name}` : 'مدير المدرسة'}</p>
          <div className="border-t border-gray-400 mx-4">
            <p className="text-xs text-gray-500 pt-1">التوقيع والختم</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-gray-500 mt-6 pt-3 border-t border-gray-200">
        صدرت هذه الإفادة من نظام إدارة الحضور المدرسي
      </div>
    </div>
  );
}
