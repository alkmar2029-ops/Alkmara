'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ArrowRight, User, Phone, Hash, BookOpen, MessageCircle,
  Loader2, AlertCircle, MessageSquarePlus, LogOut as ExitIcon,
  ClipboardCheck, Send, BarChart3,
} from 'lucide-react';

interface StudentDetail {
  id: number;
  student_id: string;
  first_name: string;
  father_name: string | null;
  last_name: string;
  phone: string | null;
  section_id: number;
  grade_id: number;
  is_active: boolean;
  grade_name?: string;
  section_name?: string;
  grades?: { name: string; stage?: string };
  sections?: { name: string };
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = parseInt(params.id, 10);

  const { data: student, isLoading, isError } = useQuery<StudentDetail>({
    queryKey: ['student-detail', id],
    queryFn: async () => {
      const r = await fetch(`/api/students/${id}`);
      if (!r.ok) throw new Error('not found');
      return (await r.json()).data;
    },
    enabled: !Number.isNaN(id),
  });

  if (isLoading) {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-6 h-6 animate-spin inline text-gray-400" />
      </div>
    );
  }

  if (isError || !student) {
    return (
      <div className="card text-center py-16">
        <AlertCircle className="w-10 h-10 mx-auto text-red-400 mb-2" />
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">لم يُعثَر على الطالب</p>
        <button
          onClick={() => router.push('/dashboard/students')}
          className="text-sm text-blue-600 dark:text-blue-400 underline"
        >
          العودة لقائمة الطلاب
        </button>
      </div>
    );
  }

  const fullName = [student.first_name, student.father_name, student.last_name]
    .filter(Boolean).join(' ').trim();
  const grade = student.grades?.name || student.grade_name || '';
  const section = student.sections?.name || student.section_name || '';

  return (
    <div className="space-y-3">
      {/* Back link */}
      <button
        onClick={() => router.back()}
        className="text-sm text-gray-600 dark:text-gray-300 hover:underline inline-flex items-center gap-1"
      >
        <ArrowRight className="w-4 h-4" /> رجوع
      </button>

      {/* Identity card */}
      <div className="card bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 border-blue-200 dark:border-blue-500/30">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
            <User className="w-8 h-8 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold mb-1">{fullName}</h1>
            <div className="flex items-center gap-2 flex-wrap text-sm text-gray-600 dark:text-gray-300">
              {(grade || section) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-medium">
                  <BookOpen className="w-3.5 h-3.5" />
                  {grade}{grade && section ? ' / ' : ''}{section}
                </span>
              )}
              <span className="inline-flex items-center gap-1 font-mono" dir="ltr">
                <Hash className="w-3.5 h-3.5" />
                {student.student_id}
              </span>
              {student.phone && (
                <span className="inline-flex items-center gap-1 font-mono" dir="ltr">
                  <Phone className="w-3.5 h-3.5" />
                  {student.phone}
                </span>
              )}
              {!student.is_active && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 text-xs font-medium">
                  معطَّل
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card">
        <h2 className="font-bold text-base mb-3">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <ActionTile
            href={`/dashboard/notes?student_id=${student.id}`}
            icon={MessageSquarePlus}
            label="ملاحظة جديدة"
            tone="purple"
          />
          <ActionTile
            href={`/dashboard/dismissals?student_id=${student.id}`}
            icon={ExitIcon}
            label="استئذان"
            tone="orange"
          />
          <ActionTile
            href={`/dashboard/period-attendance?section_id=${student.section_id}`}
            icon={ClipboardCheck}
            label="حضور شعبته"
            tone="blue"
          />
          {student.phone && (
            <ActionTile
              href={`https://wa.me/${student.phone.replace(/[^\d]/g, '')}`}
              icon={MessageCircle}
              label="واتساب الأهل"
              tone="emerald"
              external
            />
          )}
          <ActionTile
            href={`/dashboard/reports/builder?student_id=${student.id}`}
            icon={BarChart3}
            label="تقرير الطالب"
            tone="indigo"
          />
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card">
          <h3 className="font-semibold text-sm mb-2">البيانات الأساسية</h3>
          <dl className="text-sm space-y-1.5">
            <Row label="الاسم الكامل" value={fullName} />
            <Row label="رقم الهوية" value={student.student_id} mono />
            <Row label="الصف" value={grade || '—'} />
            <Row label="الشعبة" value={section || '—'} />
            <Row label="رقم الجوال" value={student.phone || '—'} mono />
            <Row label="الحالة" value={student.is_active ? 'نشط' : 'معطَّل'} />
          </dl>
        </div>

        <div className="card">
          <h3 className="font-semibold text-sm mb-2">صلات سريعة</h3>
          <ul className="text-sm space-y-1.5">
            <Link
              href={`/dashboard/period-attendance?section_id=${student.section_id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <ClipboardCheck className="w-4 h-4 text-blue-500" />
              <span>سجل حضور الشعبة كاملة</span>
            </Link>
            <Link
              href={`/dashboard/students?search=${encodeURIComponent(student.student_id)}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <User className="w-4 h-4 text-purple-500" />
              <span>تعديل بيانات الطالب</span>
            </Link>
            <Link
              href={`/dashboard/dismissals?student_id=${student.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <ExitIcon className="w-4 h-4 text-orange-500" />
              <span>استئذانات الطالب</span>
            </Link>
            <Link
              href={`/dashboard/notes?student_id=${student.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/60"
            >
              <MessageSquarePlus className="w-4 h-4 text-pink-500" />
              <span>ملاحظات الطالب</span>
            </Link>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={`text-sm font-medium ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  );
}

function ActionTile({
  href, icon: Icon, label, tone, external = false,
}: {
  href: string; icon: any; label: string; tone: string; external?: boolean;
}) {
  const cls: Record<string, string> = {
    blue:    'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 hover:bg-blue-100',
    orange:  'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 hover:bg-orange-100',
    purple:  'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 hover:bg-purple-100',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 hover:bg-emerald-100',
    indigo:  'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 hover:bg-indigo-100',
  };
  const props = external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  return (
    <Link
      href={href}
      {...props}
      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl transition-colors ${cls[tone]}`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-xs font-medium text-center">{label}</span>
    </Link>
  );
}
