'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Users, BookOpen, Fingerprint, ClipboardList, BarChart3,
  Menu, X, LogOut, ChevronLeft, Settings, GraduationCap, MessageCircle,
  Sun, Moon, Bell, Download, MessageSquarePlus, UserCog, ClipboardCheck, Mail,
  AlertTriangle, UserPlus, LogOut as ExitIcon,
} from 'lucide-react';
import UnreadBadge from '@/components/ui/UnreadBadge';
import PendingRegistrationsBadge from '@/components/ui/PendingRegistrationsBadge';
import { useTheme } from '@/lib/hooks/useTheme';

const navItems = [
  { path: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { path: '/dashboard/students', label: 'الطلاب', icon: Users },
  { path: '/dashboard/grades', label: 'الصفوف والشعب', icon: BookOpen },
  { path: '/dashboard/devices', label: 'أجهزة البصمة', icon: Fingerprint },
  { path: '/dashboard/sync', label: 'سحب البيانات', icon: Download },
  { path: '/dashboard/attendance', label: 'سجل الحضور', icon: ClipboardList },
  { path: '/dashboard/late-notifications', label: 'إشعارات التأخير', icon: Bell },
  { path: '/dashboard/notes', label: 'الملاحظات', icon: MessageSquarePlus },
  { path: '/dashboard/teachers', label: 'المعلمون', icon: UserCog },
  { path: '/dashboard/teacher-assignments', label: 'تعيين الشعب للمعلمين', icon: UserCog },
  { path: '/dashboard/teacher-registrations', label: 'طلبات انضمام المعلمين', icon: UserPlus },
  { path: '/dashboard/messages', label: 'الرسائل الداخلية', icon: Mail },
  { path: '/dashboard/period-attendance', label: 'حضور الحصص', icon: ClipboardCheck },
  { path: '/dashboard/daily-attendance', label: 'كشف الغياب والهروب', icon: AlertTriangle },
  { path: '/dashboard/dismissals', label: 'استئذان الطلاب', icon: ExitIcon },
  { path: '/dashboard/reports/builder', label: 'التقارير', icon: BarChart3 },
  { path: '/dashboard/promote', label: 'ترقية الطلاب', icon: GraduationCap },
  { path: '/dashboard/whatsapp', label: 'إعدادات WhatsApp', icon: MessageCircle },
  { path: '/dashboard/whatsapp-bulk-teachers', label: 'تذكير جماعي للمعلمين', icon: MessageCircle },
  { path: '/dashboard/whatsapp-log', label: 'سجل المحادثات', icon: MessageCircle },
  { path: '/dashboard/whatsapp-issues', label: 'أرقام تحتاج تحديث', icon: AlertTriangle },
  { path: '/dashboard/settings', label: 'إعدادات المدرسة', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Default closed on small screens; open on desktop. lg: utilities still open on desktop layouts.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { theme, toggle, mounted } = useTheme();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success('تم تسجيل الخروج');
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 right-0 z-50 bg-white dark:bg-gray-900 border-s border-gray-200 dark:border-gray-800 transition-all duration-300 flex flex-col
          ${sidebarOpen ? 'w-64' : 'w-20'}
          ${mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
        aria-label="الشريط الجانبي"
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          {sidebarOpen && <h1 className="text-lg font-bold text-blue-600 dark:text-blue-400">نظام الحضور</h1>}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden lg:flex p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label={sidebarOpen ? 'طي الشريط' : 'توسيع الشريط'}
          >
            <ChevronLeft className={`w-5 h-5 transition-transform ${!sidebarOpen ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-2 text-gray-600 dark:text-gray-300"
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="القائمة الرئيسية" className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.path || (item.path !== '/dashboard' && pathname.startsWith(item.path));
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={() => setMobileOpen(false)}
                title={!sidebarOpen ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-500/15 dark:text-blue-300'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                } ${!sidebarOpen ? 'justify-center' : ''}`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="truncate flex-1">{item.label}</span>}
                {item.path === '/dashboard/messages' && <UnreadBadge />}
                {item.path === '/dashboard/teacher-registrations' && <PendingRegistrationsBadge />}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 dark:border-gray-800 p-3 space-y-1 shrink-0">
          <button
            onClick={toggle}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 ${!sidebarOpen ? 'justify-center' : ''}`}
            aria-label={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
            title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          >
            {mounted && (theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />)}
            {sidebarOpen && <span>{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>}
          </button>
          <button
            onClick={handleLogout}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-gray-600 hover:bg-red-50 hover:text-red-600 dark:text-gray-300 dark:hover:bg-red-500/10 dark:hover:text-red-400 ${!sidebarOpen ? 'justify-center' : ''}`}
          >
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span>تسجيل خروج</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label="فتح القائمة"
          >
            <Menu className="w-5 h-5" />
          </button>
          {/* Mobile theme toggle in header (sidebar is hidden) */}
          <button
            onClick={toggle}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          >
            {mounted && (theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />)}
          </button>
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
