'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, X, Save, FileSpreadsheet,
  Calendar, Users, BookOpen,
} from 'lucide-react';
import type { ParseResult, NameMatch, SectionMatch, DayOfWeek } from '@/lib/schedule/types';

interface PreviewResponse {
  parsed: ParseResult;
  name_matches: NameMatch[];
  section_matches: SectionMatch[];
  summary: {
    teachers_in_excel: number;
    teachers_matched_exact: number;
    teachers_matched_partial: number;
    teachers_unmatched: number;
    sections_in_excel: number;
    sections_missing: number;
    cells_total: number;
  };
}

const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

export default function TeacherSchedulePage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  // Per Excel-row index → chosen teacher_user_id (null = skip).
  // Pre-filled from exact matches on preview load.
  const [teacherChoices, setTeacherChoices] = useState<Record<number, string | null>>({});

  const { data: current } = useQuery({
    queryKey: ['teacher-schedule'],
    queryFn: async () => {
      const r = await fetch('/api/teacher-schedule');
      if (!r.ok) return null;
      return (await r.json()).data;
    },
  });

  const previewMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/teacher-schedule', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل تحليل الملف');
      return d.data as PreviewResponse;
    },
    onSuccess: (d) => {
      setPreview(d);
      // Auto-pre-fill: exact matches go in immediately; partial → first
      // candidate (admin can change); unmatched → null.
      const init: Record<number, string | null> = {};
      d.parsed.teachers.forEach((t, i) => {
        const m = d.name_matches[i];
        if (m.status === 'exact' && m.candidates.length > 0) init[i] = m.candidates[0].user_id;
        else if (m.status === 'partial' && m.candidates.length > 0) init[i] = m.candidates[0].user_id;
        else init[i] = null;
      });
      setTeacherChoices(init);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const commitMut = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('لا توجد معاينة');
      // Build a section_id lookup from the section_matches list.
      const secMap = new Map<string, number>();
      for (const sm of preview.section_matches) {
        if (sm.status === 'matched' && sm.section_id) {
          secMap.set(`${sm.grade_label}/${sm.section_label}`, sm.section_id);
        }
      }

      const teachers = preview.parsed.teachers.map((t, i) => ({
        teacher_name: t.teacher_name,
        teacher_user_id: teacherChoices[i] ?? null,
        cells: t.cells.map((c) => ({
          day_of_week: c.day_of_week,
          period_number: c.period_number,
          duty_type: c.duty_type,
          section_id: c.duty_type === 'class' && c.grade_label && c.section_label
            ? secMap.get(`${c.grade_label}/${c.section_label}`) ?? null
            : null,
          subject: c.subject,
          monitoring_target: c.monitoring_target,
        })),
      }));

      const r = await fetch('/api/teacher-schedule/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teachers }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الحفظ');
      return d.data;
    },
    onSuccess: (d) => {
      toast.success(`✓ تم استيراد ${d.rows_inserted} خانة لـ ${d.teachers_committed} معلمًا`);
      setPreview(null);
      setTeacherChoices({});
      qc.invalidateQueries({ queryKey: ['teacher-schedule'] });
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) previewMut.mutate(file);
  };

  const validForCommit = preview &&
    preview.parsed.teachers.some((_, i) => teacherChoices[i] != null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
          <Calendar className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">الجدول الذكي</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            استيراد جدول المعلمين من Excel وربطه بنظام الحضور
          </p>
        </div>
      </div>

      {/* Current state */}
      {current?.summary && (
        <div className="card">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <div className="flex-1">
              <p className="font-semibold text-sm">الجدول الحالي</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {current.summary.teachers_count} معلم • {current.summary.cells_count} خانة •
                {current.summary.last_import_at
                  ? ` آخر استيراد: ${new Date(current.summary.last_import_at).toLocaleString('ar-SA')}`
                  : ' لم يُستورد بعد'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload */}
      {!preview && (
        <div className="card">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Upload className="w-4 h-4" />
            رفع جدول جديد
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            ⓘ سيستبدل الملف الجديد الجدول الحالي بالكامل. تنسيق الملف المتوقَّع:
            الصف ٢ يحتوي على أسماء الأيام، الصف ٣ على أرقام الحصص (١-٧)،
            ومن الصف ٤ تبدأ بيانات المعلمين.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            disabled={previewMut.isPending}
            className="block w-full text-sm text-gray-700 dark:text-gray-300
                       file:me-3 file:py-2 file:px-4 file:rounded-lg file:border-0
                       file:text-sm file:font-semibold
                       file:bg-purple-50 file:text-purple-700
                       hover:file:bg-purple-100 dark:file:bg-purple-500/15 dark:file:text-purple-300
                       disabled:opacity-50"
          />
          {previewMut.isPending && (
            <p className="text-xs text-gray-500 mt-2 inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> جارٍ تحليل الملف...
            </p>
          )}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <>
          <div className="card border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-sm">معاينة الاستيراد — راجع قبل التأكيد</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                  <Stat label="معلمون في الملف" value={preview.summary.teachers_in_excel} />
                  <Stat label="مطابقة كاملة" value={preview.summary.teachers_matched_exact} tone="green" />
                  <Stat label="مطابقة جزئية" value={preview.summary.teachers_matched_partial} tone="amber" />
                  <Stat label="غير مطابق" value={preview.summary.teachers_unmatched} tone="red" />
                </div>
                <p className="text-xs mt-2 text-gray-600 dark:text-gray-300">
                  📚 {preview.summary.sections_in_excel} شعبة في الملف
                  {preview.summary.sections_missing > 0
                    ? ` • ⚠️ ${preview.summary.sections_missing} شعبة غير موجودة في النظام`
                    : ' • كلها موجودة ✓'}
                </p>
              </div>
            </div>
          </div>

          {/* Missing sections warning */}
          {preview.section_matches.some((s) => s.status === 'missing') && (
            <div className="card border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10">
              <p className="text-sm font-semibold mb-1 text-amber-900 dark:text-amber-200">
                ⚠️ شعب في الإكسل غير موجودة في النظام
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                خانات هذه الشعب ستُتجاهل في الاستيراد. أضف الشعب أولاً من
                صفحة "الصفوف والشعب" ثم أعد الرفع.
              </p>
              <ul className="text-xs mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1 text-amber-900 dark:text-amber-200">
                {preview.section_matches
                  .filter((s) => s.status === 'missing')
                  .map((s) => (
                    <li key={`${s.grade_label}/${s.section_label}`} className="font-mono">
                      • {s.grade_label}/{s.section_label}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {/* Teacher matching review */}
          <div className="card">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" /> مراجعة المعلمين
            </h3>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {preview.parsed.teachers.map((t, i) => {
                const match = preview.name_matches[i];
                const choice = teacherChoices[i];
                const tone =
                  match.status === 'exact' ? 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10'
                  : match.status === 'partial' ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10'
                  : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10';
                return (
                  <div key={i} className={`border rounded-lg p-3 ${tone}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">📋 {t.teacher_name}</span>
                      <span className="text-xs text-gray-500">({t.total_class_periods} حصة)</span>
                      {match.status === 'exact' && <span className="text-xs text-green-700 dark:text-green-400">✓ مطابق</span>}
                      {match.status === 'partial' && <span className="text-xs text-amber-700 dark:text-amber-400">⚠️ جزئي</span>}
                      {match.status === 'none' && <span className="text-xs text-red-700 dark:text-red-400">❌ لا يوجد</span>}
                    </div>
                    {match.candidates.length > 0 ? (
                      <div className="mt-2">
                        <select
                          value={choice ?? ''}
                          onChange={(e) => setTeacherChoices({ ...teacherChoices, [i]: e.target.value || null })}
                          className="input text-sm py-1.5"
                        >
                          <option value="">— تخطّي هذا المعلم —</option>
                          {match.candidates.map((c) => (
                            <option key={c.user_id} value={c.user_id}>
                              {c.full_name} ({Math.round(c.score * 100)}٪)
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                        لا يوجد معلم مطابق في النظام. أنشئ المعلم أولاً ثم أعد الرفع.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="card sticky bottom-2 z-10 flex items-center justify-between gap-2 flex-wrap">
            <button
              onClick={() => { setPreview(null); setTeacherChoices({}); }}
              className="px-4 py-2 rounded-lg border text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              إلغاء
            </button>
            <button
              onClick={() => commitMut.mutate()}
              disabled={!validForCommit || commitMut.isPending}
              className="btn-primary inline-flex items-center gap-1 text-sm disabled:opacity-50"
            >
              {commitMut.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الحفظ...</>
                : <><Save className="w-4 h-4" /> تأكيد الاستيراد</>
              }
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'gray' | 'green' | 'amber' | 'red' }) {
  const cls = {
    gray:  'text-gray-700 dark:text-gray-300',
    green: 'text-green-700 dark:text-green-400',
    amber: 'text-amber-700 dark:text-amber-400',
    red:   'text-red-700 dark:text-red-400',
  }[tone];
  return (
    <div className="bg-white dark:bg-gray-900 border rounded p-2">
      <p className="text-[10px] text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${cls}`}>{value}</p>
    </div>
  );
}
