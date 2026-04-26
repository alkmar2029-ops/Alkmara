'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { STATUS_MAP, STAGE_LABELS } from '@/lib/utils/helpers';
import { SkeletonTable } from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import EmptyState from '@/components/ui/EmptyState';

export default function AttendancePage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [gradeFilter, setGradeFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [page, setPage] = useState(1);

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
    queryKey: ['sections', gradeFilter],
    queryFn: () => fetch(`/api/sections?grade_id=${gradeFilter}`).then(r => r.json()).then(r => r.data),
    enabled: !!gradeFilter,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['attendance', date, gradeFilter, sectionFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (sectionFilter) params.set('section_id', sectionFilter);
      if (gradeFilter) params.set('grade_id', gradeFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      return fetch(`/api/attendance?${params}`).then(r => r.json());
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">سجل الحضور</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-center">
        <input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(1); }} className="input w-full" />
        <select value={gradeFilter} onChange={e => { setGradeFilter(e.target.value); setSectionFilter(''); setPage(1); }} className="input w-full">
          <option value="">كل الصفوف</option>
          {(grades || []).map((g: any) => <option key={g.id} value={g.id}>{g.name} {STAGE_LABELS[g.stage]}</option>)}
        </select>
        <select value={sectionFilter} onChange={e => { setSectionFilter(e.target.value); setPage(1); }} className="input w-full" disabled={!gradeFilter}>
          <option value="">كل الشعب</option>
          {(sections || []).map((s: any) => <option key={s.id} value={s.id}>شعبة {s.name}</option>)}
        </select>
      </div>

      <div className="card p-0 overflow-hidden">
        {isLoading ? <SkeletonTable /> : isError ? (
          <div className="text-center py-12 text-red-500 dark:text-red-400">حدث خطأ في تحميل البيانات. حاول تحديث الصفحة.</div>
        ) : (!data?.data || data.data.length === 0) ? (
          <EmptyState title="لا توجد سجلات حضور" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-sm font-semibold">
                <th className="px-4 py-3 text-right">رقم الهوية</th>
                <th className="px-4 py-3 text-right">الاسم</th>
                <th className="px-4 py-3 text-right">الصف</th>
                <th className="px-4 py-3 text-right">الشعبة</th>
                <th className="px-4 py-3 text-right">التاريخ</th>
                <th className="px-4 py-3 text-right">وقت البصمة</th>
                <th className="px-4 py-3 text-right">الحالة</th>
                <th className="px-4 py-3 text-right">التأخير</th>
              </tr></thead>
              <tbody>
                {(data.data).map((r: any) => {
                  const st = STATUS_MAP[r.status] || { label: r.status, color: 'bg-gray-100 dark:bg-gray-800 dark:text-gray-200' };
                  return (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                      <td className="px-4 py-3 font-mono text-sm">{r.student_code}</td>
                      <td className="px-4 py-3">{r.first_name} {r.father_name ? r.father_name + ' ' : ''}{r.last_name}</td>
                      <td className="px-4 py-3 text-sm">{r.grade_name || '-'}</td>
                      <td className="px-4 py-3 text-sm">{r.section_name || '-'}</td>
                      <td className="px-4 py-3 text-sm">{r.attendance_date}</td>
                      <td className="px-4 py-3 text-sm">{r.punch_time ? new Date(r.punch_time).toLocaleTimeString('ar-SA') : '-'}</td>
                      <td className="px-4 py-3"><span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span></td>
                      <td className="px-4 py-3 text-sm">{r.minutes_late > 0 ? `${r.minutes_late} دقيقة` : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && <Pagination page={page} totalPages={data.totalPages} onPageChange={setPage} />}
    </div>
  );
}
