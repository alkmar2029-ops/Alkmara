'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import GlobalSearch from '@/components/search/GlobalSearch';
import {
  LayoutDashboard, Users, BookOpen, Fingerprint, ClipboardList, BarChart3,
  Menu, X, LogOut, ChevronLeft, Settings, GraduationCap, MessageCircle,
  Sun, Moon, Bell, Download, MessageSquarePlus, UserCog, ClipboardCheck, Mail,
  AlertTriangle, UserPlus, LogOut as ExitIcon, Shield, KeyRound, Crown,
  CalendarDays,
} from 'lucide-react';
import UnreadBadge from '@/components/ui/UnreadBadge';
import PendingRegistrationsBadge from '@/components/ui/PendingRegistrationsBadge';
import { useTheme } from '@/lib/hooks/useTheme';
import { useQuery } from '@tanstack/react-query';

// `superAdminOnly: true` hides the entry for plain admins. The header
// fetches /api/admin-assignments/me to know the current role; the list
// is then filtered before rendering.
// Sidebar organized into thematic groups. Each group has a label that
// renders as a small section header above its items. Empty groups
// (after RBAC filtering) are hidden so non-super_admin users don't see
// orphan headers.
//
// Order is workflow-driven: high-frequency daily operations first,
// supporting features in the middle, infrequent admin tooling last.
interface NavItem {
  path: string;
  label: string;
  icon: any;
  superAdminOnly?: boolean;
}

interface NavGroup {
  label: string | null;  // null = no header (used for the home item)
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { path: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    ],
  },
  {
    label: 'الطلاب والصفوف',
    items: [
      { path: '/dashboard/students', label: 'الطلاب', icon: Users },
      { path: '/dashboard/grades', label: 'الصفوف والشعب', icon: BookOpen, superAdminOnly: true },
      { path: '/dashboard/promote', label: 'ترقية الطلاب', icon: GraduationCap, superAdminOnly: true },
    ],
  },
  {
    label: 'الحضور اليومي',
    items: [
      // /dashboard/attendance (سجل الحضور) is intentionally hidden from
      // the sidebar — it's a legacy view of the attendance_records
      // table populated by the fingerprint device, which this school
      // doesn't currently use. The route + API stay live so the late-
      // notifications, reports, and device-sync pipelines that share
      // attendance_records keep working. Re-add this line when a
      // device gets connected.
      { path: '/dashboard/period-attendance', label: 'حضور الحصص', icon: ClipboardCheck },
      { path: '/dashboard/daily-attendance', label: 'كشف الغياب والهروب', icon: AlertTriangle },
      { path: '/dashboard/dismissals', label: 'استئذان الطلاب', icon: ExitIcon },
      { path: '/dashboard/late-notifications', label: 'إشعارات التأخير', icon: Bell },
    ],
  },
  {
    label: 'الجدول الذكي',
    items: [
      { path: '/dashboard/teacher-schedule', label: 'الجدول الذكي', icon: CalendarDays, superAdminOnly: true },
    ],
  },
  {
    label: 'الملاحظات والرسائل',
    items: [
      { path: '/dashboard/notes', label: 'الملاحظات', icon: MessageSquarePlus },
      { path: '/dashboard/messages', label: 'الرسائل الداخلية', icon: Mail },
    ],
  },
  {
    label: 'المعلمون',
    items: [
      { path: '/dashboard/teachers', label: 'المعلمون', icon: UserCog, superAdminOnly: true },
      { path: '/dashboard/teacher-assignments', label: 'تعيين الشعب للمعلمين', icon: UserCog, superAdminOnly: true },
      { path: '/dashboard/teacher-registrations', label: 'طلبات انضمام المعلمين', icon: UserPlus, superAdminOnly: true },
    ],
  },
  {
    label: 'الإداريون',
    items: [
      { path: '/dashboard/admin-assignments', label: 'تعيين الإداريين', icon: Shield, superAdminOnly: true },
      { path: '/dashboard/admin-invite-codes', label: 'رموز دعوة الإداريين', icon: KeyRound, superAdminOnly: true },
      { path: '/dashboard/admin-registrations', label: 'طلبات الإداريين', icon: UserPlus, superAdminOnly: true },
    ],
  },
  {
    label: 'التقارير',
    items: [
      { path: '/dashboard/reports/builder', label: 'التقارير', icon: BarChart3 },
    ],
  },
  {
    label: 'واتساب',
    items: [
      { path: '/dashboard/whatsapp', label: 'إعدادات WhatsApp', icon: MessageCircle, superAdminOnly: true },
      { path: '/dashboard/whatsapp-bulk-teachers', label: 'تذكير جماعي للمعلمين', icon: MessageCircle, superAdminOnly: true },
      { path: '/dashboard/whatsapp-log', label: 'سجل المحادثات', icon: MessageCircle, superAdminOnly: true },
      { path: '/dashboard/whatsapp-issues', label: 'أرقام تحتاج تحديث', icon: AlertTriangle, superAdminOnly: true },
    ],
  },
  {
    label: 'النظام',
    items: [
      { path: '/dashboard/devices', label: 'أجهزة البصمة', icon: Fingerprint, superAdminOnly: true },
      { path: '/dashboard/sync', label: 'سحب البيانات', icon: Download, superAdminOnly: true },
      { path: '/dashboard/settings', label: 'إعدادات المدرسة', icon: Settings, superAdminOnly: true },
    ],
  },
];

interface AdminPolicy {
  is_super_admin: boolean;
  sections: { id: number; name: string; grade_id: number; grade_name: string }[];
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Default closed on small screens; open on desktop. lg: utilities still open on desktop layouts.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { theme, toggle, mounted } = useTheme();

  // Fetch the current admin's scope. Drives:
  //   • Scope banner under the header for non-super admins.
  //   • Sidebar filtering — superAdminOnly entries hide for plain admins.
  // We use a 5-minute staleTime since assignments change rarely.
  const { data: policy } = useQuery<AdminPolicy>({
    queryKey: ['admin-policy-me'],
    queryFn: async () => (await (await fetch('/api/admin-assignments/me')).json()).data,
    staleTime: 5 * 60_000,
  });

  // Distinct grades with section counts for the scope banner.
  const scopeGrades = useMemo(() => {
    if (!policy || policy.is_super_admin) return [];
    const map = new Map<number, { name: string; count: number }>();
    for (const s of policy.sections) {
      const cur = map.get(s.grade_id);
      if (cur) cur.count++;
      else map.set(s.grade_id, { name: s.grade_name, count: 1 });
    }
    return Array.from(map.values());
  }, [policy]);

  // Filter the sidebar based on role. Super admin sees everything; plain
  // admins lose the superAdminOnly entries (school setup, teacher mgmt,
  // etc). When policy hasn't loaded yet, show the full menu — assuming
  // super_admin avoids a flash-of-narrow-menu for the principal.
  const visibleNavItems = useMemo(() => {
    const isSuper = !policy || policy.is_super_admin;
    // Filter each group's items, then drop groups that end up empty
    // (so plain admins don't see orphan section headers).
    return navGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => {
          if (item.superAdminOnly && !isSuper) return false;
          return true;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [policy]);

  // Register the service worker and check for updates periodically. Without
  // this, admins who installed the dashboard PWA never see new versions
  // until they manually clear cache. Same SW used by the teacher portal.
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // 30-min update polling — admins typically keep the dashboard tab
      // open all day so we don't want to force-refresh on every page nav.
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => { /* ignore */ });
  }, []);

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

        <nav aria-label="القائمة الرئيسية" className="flex-1 py-4 px-3 overflow-y-auto">
          {visibleNavItems.map((group, gi) => (
            <div
              key={group.label || `g-${gi}`}
              className={gi > 0 ? (sidebarOpen ? 'mt-4' : 'mt-3 pt-3 border-t border-gray-200 dark:border-gray-800') : ''}
            >
              {sidebarOpen && group.label && (
                <h2 className="px-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {group.label}
                </h2>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.path
                    || (item.path !== '/dashboard' && pathname.startsWith(item.path));
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
              </div>
            </div>
          ))}
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
        <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30 gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label="فتح القائمة"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Global search (Cmd+K). Component renders both the trigger
              button (in the topbar) and the modal (overlay) — it's
              keyed by an internal open state, so we only mount it once. */}
          <GlobalSearch />

          {/* Mobile theme toggle in header (sidebar is hidden) */}
          <button
            onClick={toggle}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          >
            {mounted && (theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />)}
          </button>
        </header>

        {/* Scope banner — super_admin: gold "Crown" badge; plain admin:
            blue scope summary; both let the user know their privilege level
            at a glance. Hidden until policy loads to avoid layout flicker. */}
        {policy && (
          policy.is_super_admin ? (
            <div className="bg-gradient-to-l from-yellow-100 to-amber-50 dark:from-yellow-500/10 dark:to-amber-500/5 border-b border-yellow-200 dark:border-yellow-500/30 px-4 py-1.5">
              <div className="flex items-center gap-2 text-xs">
                <Crown className="w-3.5 h-3.5 text-yellow-700 dark:text-yellow-400" />
                <span className="font-semibold text-yellow-900 dark:text-yellow-200">المدير العام (Super Admin)</span>
                <span className="text-yellow-700 dark:text-yellow-400">— ترى كل بيانات المدرسة</span>
              </div>
            </div>
          ) : (
            <div className="bg-purple-50 dark:bg-purple-500/10 border-b border-purple-200 dark:border-purple-500/30 px-4 py-1.5">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <Shield className="w-3.5 h-3.5 text-purple-700 dark:text-purple-400" />
                <span className="font-semibold text-purple-900 dark:text-purple-200">إداري</span>
                {scopeGrades.length === 0 ? (
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    ⚠️ لم يتم تعيينك على شعب — تواصل مع المدير
                  </span>
                ) : (
                  <span className="text-purple-700 dark:text-purple-300">
                    تُشرف على: {scopeGrades.map((g) => `${g.name} (${g.count})`).join(' • ')}
                  </span>
                )}
              </div>
            </div>
          )
        )}

        <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>

      {/* PWA install banner — Chrome/Edge fires beforeinstallprompt;
          iOS Safari shows a "tap Share → Add to Home Screen" hint instead.
          Auto-hides when the app is already running standalone. */}
      <InstallPrompt />
    </div>
  );
}
