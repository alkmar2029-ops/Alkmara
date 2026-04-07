'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import toast from 'react-hot-toast';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { SkeletonTable } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

export default function ReportsPage() {
  const [tab, setTab] = useState<'daily' | 'section'>('daily');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [range, setRange] = useState({ from: date, to: date });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(r => r.json()).then(r => r.data),
  });

  const { data: grades } = useQuery({
    queryKey: ['grades', settings?.stage],
    queryFn: () => fetch(`/api/grades?stage=${settings?.stage}`).then(r => r.json()).then(r => r.data),
    enabled: !!settings?.stage,
  });

  const { data: sections } = useQuery({
    queryKey: ['sections', gradeId],
    queryFn: () => fetch(`/api/sections?grade_id=${gradeId}`).then(r => r.json()).then(r => r.data),
    enabled: !!gradeId,
  });

  const { data: dailyReport, isLoading: dailyLoading, isError: dailyError } = useQuery({
    queryKey: ['report-daily', date],
    queryFn: async () => {
      const params = new URLSearchParams({ type: 'daily', date });
      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) throw new Error('فشل في تحميل التقرير اليومي');
      const r = await res.json();
      return r.data;
    },
    enabled: tab === 'daily',
  });

  const { data: sectionReport, isLoading: sectionLoading, isError: sectionError } = useQuery({
    queryKey: ['report-section', sectionId, range],
    queryFn: async () => {
      const params = new URLSearchParams({ type: 'section', section_id: sectionId, from: range.from, to: range.to });
      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) throw new Error('فشل في تحميل تقرير الشعبة');
      const r = await res.json();
      return r.data;
    },
    enabled: tab === 'section' && !!sectionId,
  });

  const handleRangeChange = (field: 'from' | 'to', value: string) => {
    const newRange = { ...range, [field]: value };
    if (newRange.from > newRange.to) {
      toast.error('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
      return;
    }
    setRange(newRange);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">التقارير</h2>
      <div className="flex gap-2 border-b">
        <button onClick={() => setTab('daily')} className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${tab === 'daily' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>تقرير يومي</button>
        <button onClick={() => setTab('section')} className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${tab === 'section' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>تقرير بالشعبة</button>
      </div>

      {tab === 'daily' && (
        <>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input max-w-xs" />

          {dailyError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              حدث خطأ أثناء تحميل التقرير اليومي
            </div>
          )}

          {dailyLoading ? <SkeletonTable rows={4} cols={6} /> : (
            <>
              {dailyReport?.length > 0 && (
                <div className="card">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dailyReport} layout="vertical">
                      <XAxis type="number" /><YAxis dataKey="grade_name" type="category" width={100} /><Tooltip /><Legend />
                      <Bar dataKey="present" name="حاضر" fill="#22c55e" stackId="a" />
                      <Bar dataKey="late" name="متأخر" fill="#eab308" stackId="a" />
                      <Bar dataKey="absent" name="غائب" fill="#ef4444" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="overflow-x-auto">
                <div className="card p-0 overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="bg-gray-50 text-gray-600 text-sm font-semibold">
                      <th className="px-4 py-3 text-right">الصف</th><th className="px-4 py-3 text-right">الشعبة</th>
                      <th className="px-4 py-3 text-right">حاضر</th><th className="px-4 py-3 text-right">متأخر</th>
                      <th className="px-4 py-3 text-right">غائب</th><th className="px-4 py-3 text-right">النسبة</th>
                    </tr></thead>
                    <tbody>
                      {(dailyReport || []).map((r: any) => (
                        <tr key={r.section_id} className="border-b border-gray-100">
                          <td className="px-4 py-3">{r.grade_name}</td>
                          <td className="px-4 py-3">{r.section_name}</td>
                          <td className="px-4 py-3 text-green-600 font-medium">{r.present}</td>
                          <td className="px-4 py-3 text-yellow-600 font-medium">{r.late}</td>
                          <td className="px-4 py-3 text-red-600 font-medium">{r.absent}</td>
                          <td className="px-4 py-3">{r.attendance_rate}%</td>
                        </tr>
                      ))}
                      {(!dailyReport || dailyReport.length === 0) && (
                        <tr><td colSpan={6}>
                          <EmptyState title="لا توجد بيانات لهذا اليوم" />
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'section' && (
        <>
          <div className="flex gap-3 flex-wrap">
            <select value={gradeId} onChange={e => { setGradeId(e.target.value); setSectionId(''); }} className="input max-w-[180px]">
              <option value="">اختر الصف</option>
              {(grades || []).map((g: any) => <option key={g.id} value={g.id}>{g.name} {STAGE_LABELS[g.stage]}</option>)}
            </select>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)} className="input max-w-[150px]" disabled={!gradeId}>
              <option value="">اختر الشعبة</option>
              {(sections || []).map((s: any) => <option key={s.id} value={s.id}>شعبة {s.name}</option>)}
            </select>
            <input type="date" value={range.from} onChange={e => handleRangeChange('from', e.target.value)} className="input max-w-xs" />
            <input type="date" value={range.to} onChange={e => handleRangeChange('to', e.target.value)} className="input max-w-xs" />
          </div>

          {sectionError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              حدث خطأ أثناء تحميل تقرير الشعبة
            </div>
          )}

          {sectionLoading ? <SkeletonTable rows={4} cols={5} /> : sectionReport ? (
            <div className="overflow-x-auto">
              <div className="card p-0 overflow-hidden">
                <table className="w-full">
                  <thead><tr className="bg-gray-50 text-gray-600 text-sm font-semibold">
                    <th className="px-4 py-3 text-right">رقم الهوية</th><th className="px-4 py-3 text-right">الاسم</th>
                    <th className="px-4 py-3 text-right">حاضر</th><th className="px-4 py-3 text-right">متأخر</th><th className="px-4 py-3 text-right">غائب</th>
                  </tr></thead>
                  <tbody>
                    {sectionReport.map((s: any) => (
                      <tr key={s.id} className="border-b border-gray-100">
                        <td className="px-4 py-3 font-mono text-sm">{s.student_id}</td>
                        <td className="px-4 py-3">{s.first_name} {s.father_name ? s.father_name + ' ' : ''}{s.last_name}</td>
                        <td className="px-4 py-3 text-green-600">{s.summary.present}</td>
                        <td className="px-4 py-3 text-yellow-600">{s.summary.late}</td>
                        <td className="px-4 py-3 text-red-600">{s.summary.absent}</td>
                      </tr>
                    ))}
                    {(!sectionReport || sectionReport.length === 0) && (
                      <tr><td colSpan={5}>
                        <EmptyState title="لا توجد بيانات" description="اختر شعبة وفترة زمنية" />
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
