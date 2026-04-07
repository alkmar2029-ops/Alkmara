'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Users, BookOpen, Fingerprint, ClipboardList, BarChart3,
  Menu, X, LogOut, ChevronLeft, Settings, GraduationCap,
} from 'lucide-react';

const navItems = [
  { path: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { path: '/dashboard/students', label: 'الطلاب', icon: Users },
  { path: '/dashboard/grades', label: 'الصفوف والشعب', icon: BookOpen },
  { path: '/dashboard/devices', label: 'أجهزة البصمة', icon: Fingerprint },
  { path: '/dashboard/attendance', label: 'سجل الحضور', icon: ClipboardList },
  { path: '/dashboard/reports', label: 'التقارير', icon: BarChart3 },
  { path: '/dashboard/promote', label: 'ترقية الطلاب', icon: GraduationCap },
  { path: '/dashboard/settings', label: 'إعدادات المدرسة', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success('تم تسجيل الخروج');
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen flex">
      {mobileOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <aside className={`fixed lg:static inset-y-0 right-0 z-50 bg-white border-s border-gray-200 transition-all duration-300 flex flex-col
        ${sidebarOpen ? 'w-64' : 'w-20'}
        ${mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}>

        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
          {sidebarOpen && <h1 className="text-lg font-bold text-blue-600">نظام الحضور</h1>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden lg:flex p-2 rounded-lg hover:bg-gray-100">
            <ChevronLeft className={`w-5 h-5 transition-transform ${!sidebarOpen ? 'rotate-180' : ''}`} />
          </button>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden p-2"><X className="w-5 h-5" /></button>
        </div>

        <nav aria-label="القائمة الرئيسية" className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.path || (item.path !== '/dashboard' && pathname.startsWith(item.path));
            const Icon = item.icon;
            return (
              <Link key={item.path} href={item.path} onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 p-3">
          <button onClick={handleLogout} className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-gray-600 hover:bg-red-50 hover:text-red-600 ${!sidebarOpen ? 'justify-center' : ''}`}>
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span>تسجيل خروج</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 lg:px-6">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100" aria-label="فتح القائمة">
            <Menu className="w-5 h-5" />
          </button>
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
