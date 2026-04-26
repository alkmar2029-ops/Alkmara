'use client';

import { useQuery } from '@tanstack/react-query';
import { Users, BookOpen, Fingerprint, CheckCircle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { SkeletonPage } from '@/components/ui/Skeleton';

const COLORS = ['#22c55e', '#eab308', '#ef4444', '#3b82f6'];

export default function DashboardPage() {
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      return data.data;
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  if (isLoading) return <SkeletonPage />;

  if (isError) return <div className="text-center py-12 text-red-500">حدث خطأ في تحميل البيانات. حاول تحديث الصفحة.</div>;

  const chartData = stats ? [
    { name: 'حاضر', value: stats.todayAttendance.present },
    { name: 'متأخر', value: stats.todayAttendance.late },
    { name: 'غائب', value: stats.todayAttendance.absent },
    { name: 'معذور', value: stats.todayAttendance.excused },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">لوحة التحكم</h2>
        {stats?.schoolName && (
          <p className="text-gray-500 dark:text-gray-400 mt-1">{stats.schoolName} - {STAGE_LABELS[stats.stage] || ''}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="إجمالي الطلاب" value={stats?.totalStudents || 0} color="blue" />
        <StatCard icon={BookOpen} label="الشعب الدراسية" value={stats?.totalSections || 0} color="purple" />
        <StatCard icon={Fingerprint} label="الأجهزة المتصلة" value={`${stats?.onlineDevices || 0}/${stats?.totalDevices || 0}`} color="green" />
        <StatCard icon={CheckCircle} label="نسبة الحضور اليوم" value={`${stats?.todayAttendance?.rate || 0}%`} color="yellow" />
      </div>

      <div className="card">
        <h3 className="font-semibold text-lg mb-4">حضور اليوم</h3>
        {chartData.some(d => d.value > 0) ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={chartData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                {chartData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-center text-gray-400 dark:text-gray-500 py-12">لا توجد بيانات حضور اليوم</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400',
    yellow: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-400',
  };
  return (
    <div className="card flex items-center gap-4 min-w-0">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}><Icon className="w-6 h-6" /></div>
      <div className="min-w-0"><p className="text-sm text-gray-500 dark:text-gray-400 truncate">{label}</p><p className="text-2xl font-bold truncate">{value}</p></div>
    </div>
  );
}
