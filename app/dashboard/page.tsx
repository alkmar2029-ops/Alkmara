'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Users, BookOpen, Fingerprint, CheckCircle, AlertTriangle, Clock,
  LogOut as ExitIcon, ClipboardCheck, MessageCircle, BarChart3, Calendar,
  Bell, ArrowUp, ArrowDown, Wifi, WifiOff, Phone, AlertCircle,
  TrendingUp, Award, Zap, Loader2,
} from 'lucide-react';
import { SkeletonPage } from '@/components/ui/Skeleton';
import CampaignProgressPanel from '@/components/daily-attendance/CampaignProgressPanel';

interface DashboardSummary {
  user: { name: string };
  school: { name: string; stage: string; principal: string };
  today: {
    date: string;
    attendance_percent: number;
    present_count: number;
    absent_count: number;
    late_count: number;
    excused_count: number;
    dismissal_count: number;
    escape_count: number;
    total_students: number;
    total_sections: number;
    total_devices: number;
    recorded_sessions: number;
    compare: { absent_diff: number; late_diff: number };
    current_period: { number: number; start_time: string | null; end_time: string | null } | null;
  };
  alerts: Array<{
    type: string;
    severity: 'red' | 'orange' | 'yellow' | 'blue' | 'purple';
    label: string;
    count: number;
    href: string;
  }>;
  trend_7d: Array<{ date: string; percent: number }>;
  top_sections: Array<{ section_id: number; grade_name: string; section_name: string; percent: number }>;
  worst_sections: Array<{ section_id: number; grade_name: string; section_name: string; percent: number }>;
  health: {
    device_online: boolean;
    devices_connected: number;
    devices_total: number;
    whatsapp_api_ok: boolean;
    whatsapp_status: string;
    active_teachers: number;
    bad_phones_count: number;
  };
  active_campaign: { id: number; status: string; total: number; sent: number; failed: number } | null;
}

function arabicGreeting(): string {
  // Riyadh local hour for the greeting line.
  const h = parseInt(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', timeZone: 'Asia/Riyadh' }), 10);
  if (h < 5) return 'تصبح على خير';
  if (h < 12) return 'صباح الخير';
  if (h < 18) return 'مساء الخير';
  return 'مساء النور';
}

function arabicWeekday(date: string): string {
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return days[new Date(date).getDay()] || '';
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: async () => {
      const r = await fetch('/api/dashboard/summary');
      if (!r.ok) throw new Error('Failed');
      return (await r.json()).data;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  if (isLoading) return <SkeletonPage />;
  if (isError || !data) {
    return <div className="text-center py-12 text-red-500">حدث خطأ في تحميل البيانات. حاول تحديث الصفحة.</div>;
  }

  return (
    <div className="space-y-4">
      {/* ============== Welcome header ============== */}
      <div className="card bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 border-blue-200 dark:border-blue-500/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">
              {arabicGreeting()}{data.user.name ? `، ${data.user.name.split(' ').slice(0, 2).join(' ')}` : ''}! 🌟
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {arabicWeekday(data.today.date)} • {data.today.date}
              {data.today.current_period && (
                <span className="me-2 text-blue-700 dark:text-blue-400 font-medium">
                  • الحصة {data.today.current_period.number} الآن
                </span>
              )}
            </p>
            {data.school.name && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {data.school.name}
                {data.school.principal && ` • المدير: ${data.school.principal}`}
              </p>
            )}
          </div>
          <div className="text-end">
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              التحديث التلقائي كل 30 ثانية
            </p>
          </div>
        </div>
      </div>

      {/* ============== Active campaign (if any) ============== */}
      {data.active_campaign && (
        <CampaignProgressPanel
          campaignId={data.active_campaign.id}
          onDismiss={() => { /* will hide on next refresh */ }}
        />
      )}

      {/* ============== Phase 1: Today's pulse — 5 cards ============== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <PulseCard
          label="نسبة الحضور"
          value={`${data.today.attendance_percent}%`}
          sub={`${data.today.present_count}/${data.today.total_students}`}
          tone="green"
          icon={CheckCircle}
        />
        <PulseCard
          label="غياب"
          value={data.today.absent_count}
          sub={diffLabel(data.today.compare.absent_diff)}
          diffTone={data.today.compare.absent_diff > 0 ? 'bad' : data.today.compare.absent_diff < 0 ? 'good' : 'neutral'}
          tone="red"
          icon={AlertCircle}
        />
        <PulseCard
          label="تأخّر"
          value={data.today.late_count}
          sub={diffLabel(data.today.compare.late_diff)}
          diffTone={data.today.compare.late_diff > 0 ? 'bad' : data.today.compare.late_diff < 0 ? 'good' : 'neutral'}
          tone="amber"
          icon={Clock}
        />
        <PulseCard
          label="استئذان"
          value={data.today.dismissal_count}
          sub="جديد اليوم"
          tone="purple"
          icon={ExitIcon}
        />
        <PulseCard
          label="هروب"
          value={data.today.escape_count}
          sub={data.today.escape_count > 0 ? '⚠️ يحتاج إشعار' : 'لا يوجد'}
          tone="orange"
          icon={AlertTriangle}
        />
      </div>

      {/* ============== Phase 2: Smart alerts ============== */}
      {data.alerts.length > 0 && (
        <div className="card border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="font-bold text-base">يحتاج إجراء عاجل</h2>
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-500/30 text-amber-800 dark:text-amber-300 font-mono">
              {data.alerts.length}
            </span>
          </div>
          <ul className="space-y-2">
            {data.alerts.map((alert, i) => (
              <li key={i}>
                <Link
                  href={alert.href}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors ${SEVERITY_CLASS[alert.severity]}`}
                >
                  <span className="text-lg">{SEVERITY_DOT[alert.severity]}</span>
                  <span className="flex-1 text-sm font-medium">{alert.label}</span>
                  <span className="text-xs underline opacity-90">عرض ←</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ============== Phase 3: Quick actions ============== */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-yellow-500" />
          <h2 className="font-bold text-base">إجراءات سريعة</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <QuickAction href="/dashboard/period-attendance" icon={ClipboardCheck} label="حضور الحصص" tone="blue" />
          <QuickAction href="/dashboard/daily-attendance" icon={AlertTriangle} label="كشف الغياب" tone="orange" />
          <QuickAction href="/dashboard/dismissals" icon={ExitIcon} label="استئذان" tone="purple" />
          <QuickAction href="/dashboard/messages" icon={MessageCircle} label="رسالة" tone="cyan" />
          <QuickAction href="/dashboard/reports/builder" icon={BarChart3} label="تقرير" tone="emerald" />
          <QuickAction href="/dashboard/teacher-schedule" icon={Calendar} label="الجدول" tone="indigo" />
        </div>
      </div>

      {/* ============== Phase 4: 7-day trend ============== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-base">اتجاه الحضور — آخر ٧ أيام</h2>
          </div>
          <TrendChart data={data.trend_7d} />
        </div>

        {/* ============== Phase 5: Technical health ============== */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Wifi className="w-5 h-5 text-emerald-500" />
            <h2 className="font-bold text-base">الحالة الفنية</h2>
          </div>
          <ul className="space-y-2 text-sm">
            <HealthRow
              icon={data.health.device_online ? Wifi : WifiOff}
              label="جهاز البصمة"
              value={`${data.health.devices_connected}/${data.health.devices_total}`}
              ok={data.health.device_online}
            />
            <HealthRow
              icon={MessageCircle}
              label="واتساب"
              value={data.health.whatsapp_api_ok ? 'متّصل' : 'غير مضبوط'}
              ok={data.health.whatsapp_api_ok}
            />
            <HealthRow
              icon={Users}
              label="معلمون نشطون"
              value={`${data.health.active_teachers}`}
              ok={data.health.active_teachers > 0}
            />
            <HealthRow
              icon={Phone}
              label="أرقام تحتاج تحديث"
              value={`${data.health.bad_phones_count}`}
              ok={data.health.bad_phones_count === 0}
            />
            <HealthRow
              icon={BookOpen}
              label="إجمالي الشعب"
              value={`${data.today.total_sections}`}
              ok={data.today.total_sections > 0}
            />
          </ul>
        </div>
      </div>

      {/* ============== Phase 5b: Top / Worst sections ============== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankCard
          title="🏆 أفضل الشعب اليوم"
          icon={Award}
          tone="green"
          rows={data.top_sections}
          medals
          empty="لم تُسجَّل بيانات حضور لأي شعبة بعد"
        />
        <RankCard
          title="⚠️ الأكثر غيابًا اليوم"
          icon={AlertTriangle}
          tone="red"
          rows={data.worst_sections}
          empty="لم تُسجَّل بيانات حضور لأي شعبة بعد"
        />
      </div>
    </div>
  );
}

// ============== Helper components ==============

const SEVERITY_CLASS: Record<string, string> = {
  red:    'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20',
  orange: 'border-orange-200 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/10 hover:bg-orange-100 dark:hover:bg-orange-500/20',
  yellow: 'border-yellow-200 dark:border-yellow-500/30 bg-yellow-50 dark:bg-yellow-500/10 hover:bg-yellow-100 dark:hover:bg-yellow-500/20',
  blue:   'border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20',
  purple: 'border-purple-200 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 hover:bg-purple-100 dark:hover:bg-purple-500/20',
};

const SEVERITY_DOT: Record<string, string> = {
  red: '🔴', orange: '🟠', yellow: '🟡', blue: '🔵', purple: '🟣',
};

function diffLabel(diff: number): string {
  if (diff === 0) return 'مطابق للأمس';
  if (diff > 0) return `⬆ ${diff} عن الأمس`;
  return `⬇ ${Math.abs(diff)} عن الأمس`;
}

function PulseCard({
  label, value, sub, tone, icon: Icon, diffTone,
}: {
  label: string;
  value: any;
  sub?: string;
  tone: 'green' | 'red' | 'amber' | 'purple' | 'orange' | 'blue';
  icon: any;
  diffTone?: 'good' | 'bad' | 'neutral';
}) {
  const cls = {
    green:  'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400 border-green-200 dark:border-green-500/30',
    red:    'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 border-red-200 dark:border-red-500/30',
    amber:  'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 border-purple-200 dark:border-purple-500/30',
    orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 border-orange-200 dark:border-orange-500/30',
    blue:   'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
  }[tone];
  const subCls = {
    good: 'text-green-700 dark:text-green-400',
    bad:  'text-red-700 dark:text-red-400',
    neutral: 'text-gray-500 dark:text-gray-400',
  }[diffTone || 'neutral'];
  return (
    <div className={`card border ${cls}`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs opacity-90">{label}</p>
        <Icon className="w-4 h-4 opacity-60" />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${subCls}`}>{sub}</p>}
    </div>
  );
}

function QuickAction({
  href, icon: Icon, label, tone,
}: {
  href: string; icon: any; label: string; tone: string;
}) {
  const cls: Record<string, string> = {
    blue:    'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/25',
    orange:  'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-500/25',
    purple:  'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/25',
    cyan:    'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-cyan-500/25',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/25',
    indigo:  'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/25',
  };
  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl transition-colors ${cls[tone]}`}
    >
      <Icon className="w-6 h-6" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}

function HealthRow({
  icon: Icon, label, value, ok,
}: {
  icon: any; label: string; value: string; ok: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${ok ? 'text-green-500' : 'text-red-500'}`} />
      <span className="flex-1 text-sm">{label}</span>
      <span className={`text-xs font-mono ${ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
        {ok ? '🟢' : '🔴'} {value}
      </span>
    </li>
  );
}

function RankCard({
  title, icon: Icon, tone, rows, medals = false, empty,
}: {
  title: string;
  icon: any;
  tone: 'green' | 'red';
  rows: Array<{ section_id: number; grade_name: string; section_name: string; percent: number }>;
  medals?: boolean;
  empty: string;
}) {
  const headerCls = tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  const medalEmojis = ['🥇', '🥈', '🥉'];
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-5 h-5 ${headerCls}`} />
        <h2 className="font-bold text-base">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.section_id} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-center font-bold">
                {medals ? medalEmojis[i] || `${i + 1}.` : `${i + 1}.`}
              </span>
              <span className="flex-1">{r.grade_name} / {r.section_name}</span>
              <span className={`font-mono font-bold ${
                r.percent >= 90 ? 'text-green-700 dark:text-green-400'
                : r.percent >= 70 ? 'text-amber-700 dark:text-amber-400'
                : 'text-red-700 dark:text-red-400'
              }`}>
                {r.percent}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrendChart({ data }: { data: Array<{ date: string; percent: number }> }) {
  const max = useMemo(() => Math.max(...data.map((d) => d.percent), 100), [data]);
  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const isToday = i === data.length - 1;
        const w = max > 0 ? Math.max(2, (d.percent / max) * 100) : 0;
        const tone =
          d.percent === 0 ? 'bg-gray-300 dark:bg-gray-700'
          : d.percent >= 90 ? 'bg-green-500'
          : d.percent >= 80 ? 'bg-blue-500'
          : d.percent >= 70 ? 'bg-amber-500'
          : 'bg-red-500';
        return (
          <div key={d.date} className="flex items-center gap-2">
            <span className={`w-16 text-xs ${isToday ? 'font-bold text-blue-700 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
              {arabicWeekday(d.date)}
              {isToday && <span className="block text-[9px] opacity-70">اليوم</span>}
            </span>
            <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
              <div
                className={`h-full ${tone} transition-all flex items-center justify-end pr-2`}
                style={{ width: `${w}%` }}
              >
                {d.percent > 0 && (
                  <span className="text-[10px] text-white font-bold">{d.percent}%</span>
                )}
              </div>
            </div>
            {d.percent === 0 && (
              <span className="text-[10px] text-gray-400 w-12">لا بيانات</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
