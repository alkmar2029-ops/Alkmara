import type { Metadata } from 'next';
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.className}>
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <Providers>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
          <Toaster position="top-center" />
        </Providers>
      </body>
    </html>
  );
}
