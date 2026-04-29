'use client';

import { useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Printer, ArrowRight, ThumbsUp, ThumbsDown, Loader2, Send, MessageCircle } from 'lucide-react';

interface NoteRow {
  id: number;
  text: string;
  type: 'positive' | 'negative';
  category: string | null;
  recorded_at: string;
  student_code: string | null;
  student_name: string | null;
  grade_name: string | null;
  section_name: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  academic: 'أكاديمي', behavior: 'سلوكي', attendance: 'حضور', participation: 'مشاركة', general: 'عام',
};

export default function TeacherNotesPrintPage() {
  const params = useParams<{ batchId: string }>();
  const router = useRouter();
  const batchId = params?.batchId;

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await (await fetch('/api/settings')).json()).data,
  });

  // WhatsApp toggle — read from the public-facing settings endpoint so the
  // teacher's UI mirrors the admin switch. If the flag is OFF the send button
  // is hidden entirely (no point teasing a feature the API will reject).
  const { data: waSettings } = useQuery<{ teachers_can_send_whatsapp: boolean }>({
    queryKey: ['public-whatsapp-toggle'],
    queryFn: async () => {
      // /api/whatsapp/settings is admin-only; we expose just the relevant
      // flag through a tiny GET-allowed view that the teacher sidebar uses.
      // For simplicity we hit /api/settings + /api/whatsapp/policy here; if
      // either request fails we conservatively assume the toggle is OFF.
      try {
        const r = await fetch('/api/whatsapp/teacher-policy');
        if (!r.ok) return { teachers_can_send_whatsapp: false };
        const d = await r.json();
        return { teachers_can_send_whatsapp: !!d.data?.teachers_can_send_whatsapp };
      } catch {
        return { teachers_can_send_whatsapp: false };
      }
    },
    staleTime: 60_000,
  });

  const { data: notes, isLoading, isError } = useQuery<NoteRow[]>({
    queryKey: ['notes-batch-teacher', batchId],
    queryFn: async () => {
      const r = await fetch(`/api/student-notes?batch_id=${batchId}`);
      if (!r.ok) throw new Error('فشل تحميل الملاحظات');
      return (await r.json()).data;
    },
    enabled: !!batchId,
  });

  // Send WhatsApp to parents for the batch. Same endpoint admin uses; the
  // server enforces the toggle for teacher callers.
  const sendWaMut = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/whatsapp/send-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإرسال');
      return d.data as { sent: number; failed: number; skipped: number };
    },
    onSuccess: (d) => {
      if (d.failed === 0 && d.skipped === 0) {
        toast.success(`✓ تم إرسال ${d.sent} رسالة لأولياء الأمور`);
      } else {
        toast(`أُرسل ${d.sent} • فشل ${d.failed} • تخطّي ${d.skipped}`, { icon: '⚠️', duration: 5000 });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

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

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  if (isError || !notes || notes.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <p>لا توجد ملاحظات لهذه الدفعة.</p>
        <button onClick={() => router.push('/teacher/notes')} className="btn-secondary mt-4 inline-flex items-center gap-1">
          <ArrowRight className="w-4 h-4" /> رجوع
        </button>
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; }
          .no-print { display: none !important; }
          .note-page { page-break-after: always; break-after: page; min-height: calc(100vh - 24mm); }
          .note-page:last-child { page-break-after: auto; break-after: auto; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 -mx-4 -mt-4 px-4 py-3 mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-bold">معاينة الطباعة</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{notes.length} ورقة • {formattedDate}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => router.push('/teacher/notes')} className="btn-secondary inline-flex items-center gap-1 text-sm">
            <ArrowRight className="w-4 h-4" /> رجوع
          </button>
          {waSettings?.teachers_can_send_whatsapp && notes && notes.length > 0 && (
            <button
              onClick={() => {
                const msg = `سيتم إرسال ${notes.length} رسالة واتساب لأولياء الأمور.\nالوقت المتوقّع: ${Math.ceil(notes.length * 5.5)} ثانية.\n\nهل تريد المتابعة؟`;
                if (confirm(msg)) sendWaMut.mutate();
              }}
              disabled={sendWaMut.isPending}
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
            >
              {sendWaMut.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الإرسال...</>
                : <><MessageCircle className="w-4 h-4" /> إرسال واتساب لأولياء الأمور ({notes.length})</>
              }
            </button>
          )}
          <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1 text-sm">
            <Printer className="w-4 h-4" /> طباعة / حفظ PDF
          </button>
        </div>
      </div>

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
      <div className="text-center pb-4 border-b-2 border-gray-800">
        <p className="text-sm text-gray-600 mb-1">المملكة العربية السعودية — وزارة التعليم</p>
        <h1 className="text-2xl font-bold">{settings?.school_name || 'المدرسة'}</h1>
        {settings?.principal_name && (
          <p className="text-sm text-gray-700 mt-1">المدير: {settings.principal_name}</p>
        )}
      </div>

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

      <div className="my-6">
        <p className="text-sm text-gray-600 mb-2">نص الملاحظة:</p>
        <div className={`min-h-[140px] p-6 rounded-lg border-2 text-lg leading-loose ${
          isPositive ? 'bg-green-50/40 border-green-300' : 'bg-red-50/40 border-red-300'
        }`}>
          {note.text}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 mt-12 pt-6 border-t border-gray-300 text-center text-sm">
        <div>
          <p className="font-semibold mb-12">المعلم</p>
          <div className="border-t border-gray-400 mx-4"><p className="text-xs text-gray-500 pt-1">التوقيع</p></div>
        </div>
        <div>
          <p className="font-semibold mb-12">ولي الأمر</p>
          <div className="border-t border-gray-400 mx-4"><p className="text-xs text-gray-500 pt-1">التوقيع</p></div>
        </div>
        <div>
          <p className="font-semibold mb-12">{settings?.principal_name ? `المدير / ${settings.principal_name}` : 'مدير المدرسة'}</p>
          <div className="border-t border-gray-400 mx-4"><p className="text-xs text-gray-500 pt-1">التوقيع والختم</p></div>
        </div>
      </div>

      <div className="text-center text-xs text-gray-500 mt-6 pt-3 border-t border-gray-200">
        صدرت هذه الإفادة من نظام إدارة الحضور المدرسي
      </div>
    </div>
  );
}
