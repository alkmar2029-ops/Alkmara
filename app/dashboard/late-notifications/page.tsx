'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Bell, Send, Trash2, RefreshCw, Save, FileText, Phone, AlertCircle, CheckCircle2, MessageCircle,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { TEMPLATE_PLACEHOLDERS, renderTemplate, formatPunchDateTime } from '@/lib/whatsapp/template';

const TEMPLATE_NAME = 'late_notification';

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function LateNotificationsPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [gradeId, setGradeId] = useState<string>('');
  const [sectionId, setSectionId] = useState<string>('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [templateBody, setTemplateBody] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);

  // ---------- queries ----------
  const { data: grades } = useQuery({
    queryKey: ['grades-list'],
    queryFn: async () => {
      const r = await fetch('/api/grades');
      if (!r.ok) throw new Error('فشل تحميل الصفوف');
      return (await r.json()).data as any[];
    },
  });

  const { data: sections } = useQuery({
    queryKey: ['sections-by-grade', gradeId],
    queryFn: async () => {
      const url = gradeId ? `/api/sections?grade_id=${gradeId}` : '/api/sections';
      const r = await fetch(url);
      if (!r.ok) throw new Error('فشل تحميل الشعب');
      return (await r.json()).data as any[];
    },
    enabled: true,
  });

  const { data: devices } = useQuery({
    queryKey: ['devices-list'],
    queryFn: async () => {
      const r = await fetch('/api/devices');
      if (!r.ok) return [] as any[];
      return ((await r.json()).data || []) as any[];
    },
  });

  const lateQuery = useQuery({
    queryKey: ['late-attendance', date, gradeId, sectionId, deviceId],
    queryFn: async () => {
      const params = new URLSearchParams({ date });
      if (gradeId) params.set('grade_id', gradeId);
      if (sectionId) params.set('section_id', sectionId);
      if (deviceId) params.set('device_id', deviceId);
      const r = await fetch(`/api/attendance/late?${params}`);
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل تحميل التأخيرات');
      }
      return (await r.json()).data as any[];
    },
  });

  const templateQuery = useQuery({
    queryKey: ['template', TEMPLATE_NAME],
    queryFn: async () => {
      const r = await fetch(`/api/templates/${TEMPLATE_NAME}`);
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل تحميل القالب');
      }
      return (await r.json()).data;
    },
  });

  useEffect(() => {
    if (templateQuery.data && !templateBody) {
      setTemplateBody(templateQuery.data.body || '');
    }
  }, [templateQuery.data, templateBody]);

  const { data: whatsappSettings } = useQuery({
    queryKey: ['whatsapp-settings'],
    queryFn: async () => {
      const r = await fetch('/api/whatsapp/settings');
      if (!r.ok) return null;
      return (await r.json()).data;
    },
  });

  // ---------- mutations ----------
  const saveTemplate = useMutation({
    mutationFn: async (body: string) => {
      const r = await fetch(`/api/templates/${TEMPLATE_NAME}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل الحفظ');
      }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['template', TEMPLATE_NAME] }); toast.success('تم حفظ القالب'); },
    onError: (e: any) => toast.error(e?.message || 'فشل الحفظ'),
  });

  const bulkDelete = useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await fetch('/api/attendance', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل الحذف');
      }
      return r.json();
    },
    onSuccess: (r) => {
      const n = r?.data?.deleted ?? 0;
      toast.success(`تم حذف ${n} سجل`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['late-attendance'] });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل الحذف'),
  });

  const bulkSend = useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await fetch('/api/whatsapp/send-late', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_ids: ids, template_name: TEMPLATE_NAME, date }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || 'فشل الإرسال');
      }
      return r.json();
    },
    onSuccess: (r) => {
      const { sent = 0, failed = 0 } = r?.data || {};
      if (failed === 0) toast.success(`تم إرسال ${sent} رسالة`);
      else toast(`تم إرسال ${sent} رسالة، وفشل ${failed}`, { icon: '⚠️' });
    },
    onError: (e: any) => toast.error(e?.message || 'فشل الإرسال'),
  });

  // ---------- helpers ----------
  const rows = useMemo(() => lateQuery.data || [], [lateQuery.data]);
  const allSelected = rows.length > 0 && rows.every((r: any) => selected.has(r.id));
  const someSelected = selected.size > 0;
  const selectedRows = useMemo(() => rows.filter((r: any) => selected.has(r.id)), [rows, selected]);
  const selectedWithoutPhone = selectedRows.filter((r: any) => !r.phone).length;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r: any) => r.id)));
  };
  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const previewMessage = useMemo(() => {
    const sample = rows[0];
    if (!sample) {
      return renderTemplate(templateBody, {
        student_name: 'أحمد محمد علي',
        grade: 'الأول متوسط',
        section: '1',
        date: date,
        punch_time: '07:35:21',
        minutes_late: 15,
      });
    }
    const fullName = [sample.first_name, sample.father_name, sample.last_name].filter(Boolean).join(' ').trim();
    const { date: d, time } = formatPunchDateTime(sample.punch_time);
    return renderTemplate(templateBody, {
      student_name: fullName,
      grade: sample.grade_name,
      section: sample.section_name,
      date: d || sample.attendance_date,
      punch_time: time || sample.punch_time,
      minutes_late: sample.minutes_late,
    });
  }, [templateBody, rows, date]);

  // ---------- render ----------
  if (lateQuery.isLoading || templateQuery.isLoading) return <SkeletonPage />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">إشعارات التأخير</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">إرسال WhatsApp لأولياء الأمور بناءً على بصمات الأجهزة</p>
          </div>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['late-attendance'] })}
          className="btn-secondary inline-flex items-center justify-center gap-2 w-full sm:w-auto"
        >
          <RefreshCw className={`w-4 h-4 ${lateQuery.isFetching ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </div>

      {/* Connectivity warning */}
      {whatsappSettings && whatsappSettings.status !== 'connected' && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-500/15 border border-yellow-200 dark:border-yellow-500/30 text-yellow-800 dark:text-yellow-300 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            حالة WhatsApp الحالية: <strong>{whatsappSettings.status}</strong>. تأكد من ربط الجلسة من{' '}
            <a className="underline" href="/dashboard/whatsapp">إعدادات WhatsApp</a> قبل الإرسال.
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">فلاتر</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">التاريخ</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">الصف</label>
            <select value={gradeId} onChange={(e) => { setGradeId(e.target.value); setSectionId(''); }} className="input">
              <option value="">كل الصفوف</option>
              {(grades || []).map((g: any) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
          </div>
          <div>
            <label className="label">الشعبة</label>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="input">
              <option value="">كل الشعب</option>
              {(sections || []).filter((s: any) => !gradeId || String(s.grade_id) === gradeId).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">الجهاز</label>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="input">
              <option value="">كل الأجهزة</option>
              {(devices || []).map((d: any) => (<option key={d.id} value={d.id}>{d.name}</option>))}
            </select>
          </div>
        </div>
      </div>

      {/* Template editor */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            قالب رسالة التأخير
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="btn-secondary text-sm inline-flex items-center justify-center gap-1 w-full sm:w-auto"
            >
              {showPreview ? 'إخفاء المعاينة' : 'معاينة'}
            </button>
            <button
              onClick={() => saveTemplate.mutate(templateBody)}
              disabled={saveTemplate.isPending || templateBody === (templateQuery.data?.body || '')}
              className="btn-primary text-sm inline-flex items-center justify-center gap-1 w-full sm:w-auto"
            >
              <Save className="w-4 h-4" />
              {saveTemplate.isPending ? 'جارٍ الحفظ...' : 'حفظ القالب'}
            </button>
          </div>
        </div>

        <textarea
          value={templateBody}
          onChange={(e) => setTemplateBody(e.target.value)}
          rows={8}
          className="input font-mono text-sm leading-relaxed"
          placeholder="نص الرسالة..."
        />

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400 ms-1">المتغيرات المتاحة:</span>
          {TEMPLATE_PLACEHOLDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setTemplateBody((prev) => `${prev}{{${p.key}}}`)}
              className="text-xs px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300 font-mono"
              title={p.label}
            >
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>

        {showPreview && (
          <div className="mt-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">معاينة (بأول طالب من القائمة):</p>
            <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 font-sans">{previewMessage}</pre>
          </div>
        )}
      </div>

      {/* Late list */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            التأخيرات لـ{date} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({rows.length} سجل)</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => bulkDelete.mutate(Array.from(selected))}
              disabled={!someSelected || bulkDelete.isPending}
              className="btn-danger text-sm inline-flex items-center justify-center gap-1 w-full sm:w-auto"
            >
              <Trash2 className="w-4 h-4" />
              حذف المختار ({selected.size})
            </button>
            <button
              onClick={() => bulkSend.mutate(Array.from(selected))}
              disabled={!someSelected || bulkSend.isPending}
              className="btn-success text-sm inline-flex items-center justify-center gap-1 w-full sm:w-auto"
            >
              <Send className={`w-4 h-4 ${bulkSend.isPending ? 'animate-pulse' : ''}`} />
              {bulkSend.isPending ? 'جارٍ الإرسال...' : `إرسال WhatsApp (${selected.size})`}
            </button>
          </div>
        </div>

        {someSelected && selectedWithoutPhone > 0 && (
          <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-2 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            {selectedWithoutPhone} من المختارين بدون رقم جوال — سيتم تخطّيهم
          </p>
        )}

        {lateQuery.isError && (
          <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-3 text-red-700 dark:text-red-400 text-sm">
            {(lateQuery.error as Error)?.message || 'حدث خطأ'}
          </div>
        )}

        {!lateQuery.isError && rows.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500" />
            لا توجد سجلات تأخير لهذا التاريخ والفلاتر
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-right">
                  <th className="px-3 py-2 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="اختر الكل" />
                  </th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">رقم الهوية</th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الاسم</th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الصف / الشعبة</th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">وقت البصمة</th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">الجوال</th>
                  <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">دقائق التأخير</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {rows.map((r: any) => {
                  const fullName = [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ');
                  const { time } = formatPunchDateTime(r.punch_time);
                  return (
                    <tr key={r.id} className={`${selected.has(r.id) ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleOne(r.id)}
                          aria-label="اختر"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-900 dark:text-gray-100" dir="ltr">{r.student_code}</td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{fullName}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                        {r.grade_name} <span className="text-gray-400">/</span> {r.section_name}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300" dir="ltr">{time || r.punch_time}</td>
                      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300" dir="ltr">
                        {r.phone ? (
                          <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{r.phone}</span>
                        ) : (
                          <span className="text-red-500 dark:text-red-400 text-xs">غير متوفر</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{r.minutes_late}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Send result outcomes */}
        {bulkSend.data?.data?.outcomes && bulkSend.data.data.outcomes.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-sm">
            <p className="font-medium text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-1">
              <MessageCircle className="w-4 h-4" />
              نتائج الإرسال — تم: {bulkSend.data.data.sent} | فشل: {bulkSend.data.data.failed}
            </p>
            {bulkSend.data.data.failed > 0 && (
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {bulkSend.data.data.outcomes.filter((o: any) => !o.ok).map((o: any) => (
                  <li key={o.attendance_id} className="text-xs text-red-700 dark:text-red-400">
                    {o.student_name || o.student_code}: {o.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
