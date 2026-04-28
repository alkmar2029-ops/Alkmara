import type { Metadata, Viewport } from 'next';
import { Cairo } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import { Providers } from './providers';
import ErrorBoundary from '@/components/ui/ErrorBoundary';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'نظام الحضور الذكي',
    template: '%s | نظام الحضور',
  },
  description: 'نظام إدارة حضور الطلاب باستخدام أجهزة البصمة',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'حضور المعلم' },
  // Modern equivalent of apple-mobile-web-app-capable (the legacy tag is
  // emitted automatically by Next from appleWebApp; we add the standard one
  // alongside it to silence the deprecation console warning).
  other: { 'mobile-web-app-capable': 'yes' },
  icons: {
    icon: [
      { url: '/icon-192.svg', type: 'image/svg+xml', sizes: '192x192' },
      { url: '/icon-512.svg', type: 'image/svg+xml', sizes: '512x512' },
    ],
    shortcut: '/icon-192.svg',
    apple: '/icon-192.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
};

// Inline before hydration to apply the saved theme and avoid flash.
const themeInitScript = `
(function(){try{
  var t = localStorage.getItem('theme');
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (t === 'dark' || (!t && prefersDark)) document.documentElement.classList.add('dark');
  document.documentElement.classList.add('theme-ready');
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline theme-init script mutates <html>
    // (adds `dark` / `theme-ready`) before React hydrates, by design.
    <html lang="ar" dir="rtl" className={cairo.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 min-h-screen transition-colors">
        <Providers>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
          <Toaster
            position="top-center"
            toastOptions={{
              className: '!bg-white !text-gray-900 dark:!bg-gray-800 dark:!text-gray-100',
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
