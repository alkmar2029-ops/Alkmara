'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import { ClipboardList, History, User, LogOut, Menu, X, MessageSquarePlus, FileText, Mail, Sun, Moon } from 'lucide-react';
import UnreadBadge from '@/components/ui/UnreadBadge';
import { useTheme } from '@/lib/hooks/useTheme';

const navItems = [
  { path: '/teacher',          label: 'تسجيل الغياب', Icon: ClipboardList },
  { path: '/teacher/notes',    label: 'الملاحظات',     Icon: MessageSquarePlus },
  { path: '/teacher/messages', label: 'الرسائل',       Icon: Mail },
  { path: '/teacher/history',  label: 'سجل حصصي',     Icon: History },
  { path: '/teacher/reports',  label: 'التقارير',     Icon: FileText },
  { path: '/teacher/profile',  label: 'ملفي',          Icon: User },
];

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const { theme, toggle: toggleTheme, mounted } = useTheme();

  // Show the teacher's name in the header.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const md = (user.user_metadata as any)?.full_name as string | undefined;
      if (md) { setName(md); return; }
      const { data: p } = await supabase
        .from('user_profiles')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();
      setName((p?.full_name as string) || user.email || '');
    })();
  }, [supabase]);

  // Online/offline indicator (drives the small dot in the header).
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Register the service worker once — only in production-ish contexts.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {/* ignore */});
    }
  }, []);

  const logout = async () => {
    if (!confirm('تسجيل الخروج؟')) return;
    await supabase.auth.signOut();
    toast.success('تم الخروج');
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="no-print sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 -m-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 sm:hidden"
            aria-label="Menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <ClipboardList className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{name || 'المعلم'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
              {online ? 'متصل' : 'غير متصل'}
            </p>
          </div>
          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1">
            {navItems.map(({ path, label, Icon }) => {
              const active = pathname === path;
              return (
                <Link
                  key={path}
                  href={path}
                  className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
                    active
                      ? 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                  {path === '/teacher/messages' && <UnreadBadge className="ms-1" />}
                </Link>
              );
            })}
            <button
              onClick={toggleTheme}
              className="ms-1 p-1.5 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
              aria-label={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
            >
              {mounted && (theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />)}
            </button>
            <button onClick={logout} className="ms-1 p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10" title="خروج">
              <LogOut className="w-4 h-4" />
            </button>
          </nav>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <nav className="sm:hidden border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            {navItems.map(({ path, label, Icon }) => {
              const active = pathname === path;
              return (
                <Link
                  key={path}
                  href={path}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800 ${
                    active ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium' : ''
                  }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                  {path === '/teacher/messages' && <UnreadBadge className="ms-1" />}
                </Link>
              );
            })}
            <button
              onClick={() => { toggleTheme(); }}
              className="w-full text-right flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-200"
            >
              {mounted && (theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />)}
              {theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
            </button>
            <button
              onClick={logout}
              className="w-full text-right flex items-center gap-2 px-4 py-3 text-red-600 dark:text-red-400"
            >
              <LogOut className="w-4 h-4" /> تسجيل الخروج
            </button>
          </nav>
        )}
      </header>

      {/* Main */}
      <main className="max-w-3xl mx-auto px-4 py-4">{children}</main>
    </div>
  );
}
