'use client';

import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, X, Save, FileSpreadsheet,
  Calendar, Users, BookOpen, UserPlus,
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
      // Build the success toast — mention duplicates if any, since the
      // admin should know we silently dropped some cells.
      let msg = `✓ تم استيراد ${d.rows_inserted} خانة لـ ${d.teachers_committed} معلمًا`;
      if (d.duplicates_dropped > 0) {
        msg += ` • تجاهل ${d.duplicates_dropped} خانة مكرَّرة`;
      }
      toast.success(msg, { duration: 5000 });
      if (d.conflicts && d.conflicts.length > 0) {
        // Surface the first conflict in a separate toast so the admin
        // knows where to look in the Excel file.
        const c = d.conflicts[0];
        toast(
          `⚠️ تعارض: "${c.teacher_names.join('" و"')}" يشيران لنفس المعلم`,
          { icon: '⚠️', duration: 8000 },
        );
      }
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

  // Detect duplicate user_id mappings — if two Excel rows point to the
  // same user, the unique constraint will explode at commit time. Show
  // the admin upfront so they can change one of the picks.
  const duplicateUserIds = useMemo(() => {
    if (!preview) return new Map<string, string[]>();
    const m = new Map<string, string[]>();
    preview.parsed.teachers.forEach((t, i) => {
      const uid = teacherChoices[i];
      if (!uid) return;
      const arr = m.get(uid) || [];
      arr.push(t.teacher_name);
      m.set(uid, arr);
    });
    // Keep only entries with > 1 Excel name pointing to the same user.
    const out = new Map<string, string[]>();
    for (const [uid, names] of m) {
      if (names.length > 1) out.set(uid, names);
    }
    return out;
  }, [preview, teacherChoices]);

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

          {/* Bulk-create panel for unmatched teachers — lets the admin
              instantly create accounts for Excel teachers who don't
              exist in user_profiles yet, instead of skipping them. */}
          <BulkCreateTeachersPanel
            preview={preview}
            onSuccess={() => {
              // Re-trigger the upload so the matching refreshes with the
              // newly-created users included.
              if (fileInputRef.current?.files?.[0]) {
                previewMut.mutate(fileInputRef.current.files[0]);
              }
            }}
          />

          {/* Duplicate-mapping warning */}
          {duplicateUserIds.size > 0 && (
            <div className="card border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10">
              <p className="text-sm font-semibold mb-1 text-amber-900 dark:text-amber-200">
                ⚠️ تعارض في المطابقة — أكثر من اسم Excel يشير لنفس المعلم في النظام
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">
                الاستيراد سيستمر لكن سيُستبقى أوّل معلم لكل خانة، والباقي سيُتجاهل.
                لو كانوا فعلًا أشخاصًا مختلفين، عدِّل الاختيار قبل التأكيد.
              </p>
              <ul className="text-xs space-y-1">
                {Array.from(duplicateUserIds.entries()).map(([uid, names]) => (
                  <li key={uid} className="text-amber-900 dark:text-amber-200">
                    • {names.join('  ↔  ')}
                  </li>
                ))}
              </ul>
            </div>
          )}

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

// =============== Bulk-create teachers panel ===============
// Surfaces every Excel teacher whose name didn't match an existing
// user_profiles row, lets the admin add a phone per row, then creates
// them all in one shot via /api/teachers/bulk. After success, the
// schedule preview is re-run so the new accounts show as exact
// matches and can be committed to the schedule.
function BulkCreateTeachersPanel({
  preview, onSuccess,
}: {
  preview: PreviewResponse;
  onSuccess: () => void;
}) {
  const unmatched = preview.parsed.teachers
    .map((t, i) => ({ teacher: t, match: preview.name_matches[i], idx: i }))
    .filter((x) => x.match.status === 'none');

  // Local edits keyed by Excel row index. Phone is editable; email is
  // optional (auto-generated if empty).
  const [phones, setPhones] = useState<Record<number, string>>({});
  const [emails, setEmails] = useState<Record<number, string>>({});
  const [results, setResults] = useState<{
    summary: { requested: number; created: number; skipped: number; failed: number };
    outcomes: Array<{ full_name: string; status: string; error?: string; password?: string | null; whatsapp_sent?: boolean }>;
  } | null>(null);

  const createMut = useMutation({
    mutationFn: async () => {
      const teachers = unmatched.map(({ teacher, idx }) => ({
        full_name: teacher.teacher_name,
        phone: phones[idx]?.trim() || null,
        email: emails[idx]?.trim() || null,
      }));
      const r = await fetch('/api/teachers/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teachers, skip_existing_names: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل الإنشاء الجماعي');
      return d.data;
    },
    onSuccess: (d) => {
      setResults(d);
      const { created, skipped, failed } = d.summary;
      if (failed === 0) {
        toast.success(`✓ تم إنشاء ${created} حساب${skipped > 0 ? ` • تخطّي ${skipped}` : ''}`);
      } else {
        toast(`أُنشئ ${created} • فشل ${failed}`, { icon: '⚠️', duration: 6000 });
      }
      // Refresh the schedule preview so the just-created teachers
      // become exact matches and can be committed alongside.
      setTimeout(onSuccess, 500);
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (unmatched.length === 0) {
    return null;  // nothing to surface
  }

  return (
    <div className="card border-purple-200 dark:border-purple-500/30 bg-purple-50/40 dark:bg-purple-500/5">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2 text-purple-900 dark:text-purple-200">
            <UserPlus className="w-4 h-4" /> تسجيل المعلمين الناقصين ({unmatched.length})
          </h3>
          <p className="text-xs text-purple-800 dark:text-purple-300 mt-0.5">
            هؤلاء أسماؤهم في Excel لكن لا يوجد لهم حسابات في النظام. أضِف رقم الجوال (اختياري) ثم اضغط "إنشاء كلهم".
          </p>
        </div>
      </div>

      {results ? (
        // Success / failure breakdown
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="أُنشئ" value={results.summary.created} tone="green" />
            <Stat label="تُخُطِّي" value={results.summary.skipped} tone="amber" />
            <Stat label="فشل" value={results.summary.failed} tone="red" />
          </div>
          <ul className="space-y-1 max-h-72 overflow-y-auto text-xs">
            {results.outcomes.map((o, i) => (
              <li key={i} className={`flex items-center gap-2 px-2 py-1 rounded ${
                o.status === 'created' ? 'bg-green-50 dark:bg-green-500/10' :
                o.status === 'skipped_existing' ? 'bg-amber-50 dark:bg-amber-500/10' :
                'bg-red-50 dark:bg-red-500/10'
              }`}>
                {o.status === 'created' ? '✓' : o.status === 'skipped_existing' ? '⊝' : '✗'}
                <span className="flex-1 font-medium">{o.full_name}</span>
                {o.password && (
                  <span className="font-mono text-[10px] bg-white dark:bg-gray-900 border px-1 py-0.5 rounded" dir="ltr" title="كلمة المرور (لم تُرسل عبر واتساب — انسخها يدويًا)">
                    🔑 {o.password}
                  </span>
                )}
                {o.whatsapp_sent && <span className="text-green-700 dark:text-green-400 text-[10px]">✓ واتساب</span>}
                {o.error && <span className="text-red-700 dark:text-red-400 truncate max-w-[40%]" title={o.error}>{o.error}</span>}
              </li>
            ))}
          </ul>
          <button
            onClick={() => { setResults(null); setPhones({}); setEmails({}); }}
            className="text-xs underline text-purple-700 dark:text-purple-300"
          >
            إعادة المحاولة لمن فشل
          </button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs min-w-[500px]">
              <thead>
                <tr className="text-gray-600 dark:text-gray-400 border-b">
                  <th className="px-2 py-1 text-start">الاسم</th>
                  <th className="px-2 py-1 text-start">رقم الجوال (اختياري)</th>
                  <th className="px-2 py-1 text-start hidden sm:table-cell">البريد (اختياري)</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map(({ teacher, idx }) => (
                  <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-2 py-1 font-medium">{teacher.teacher_name}</td>
                    <td className="px-2 py-1">
                      <input
                        type="tel"
                        placeholder="05xxxxxxxx"
                        value={phones[idx] || ''}
                        onChange={(e) => setPhones({ ...phones, [idx]: e.target.value })}
                        className="input text-xs py-1 font-mono"
                        dir="ltr"
                      />
                    </td>
                    <td className="px-2 py-1 hidden sm:table-cell">
                      <input
                        type="email"
                        placeholder="(تلقائي)"
                        value={emails[idx] || ''}
                        onChange={(e) => setEmails({ ...emails, [idx]: e.target.value })}
                        className="input text-xs py-1"
                        dir="ltr"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {Object.values(phones).filter((p) => p?.trim()).length} رقم مُدخل من {unmatched.length}.
              من بدون رقم → الحساب يُنشأ بدون إرسال واتساب وكلمة المرور تظهر هنا.
            </p>
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="btn-primary inline-flex items-center gap-1 text-sm disabled:opacity-50"
            >
              {createMut.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الإنشاء...</>
                : <><UserPlus className="w-4 h-4" /> إنشاء كلهم ({unmatched.length})</>
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
