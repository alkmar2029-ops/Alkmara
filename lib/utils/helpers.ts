import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('ar-SA');
}

export function formatTime(date: string | Date) {
  return new Date(date).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

export const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  present: { label: 'حاضر', color: 'bg-green-100 text-green-800' },
  late: { label: 'متأخر', color: 'bg-yellow-100 text-yellow-800' },
  absent: { label: 'غائب', color: 'bg-red-100 text-red-800' },
  excused: { label: 'معذور', color: 'bg-blue-100 text-blue-800' },
  connected: { label: 'متصل', color: 'bg-green-100 text-green-800' },
  disconnected: { label: 'غير متصل', color: 'bg-gray-100 text-gray-800' },
  error: { label: 'خطأ', color: 'bg-red-100 text-red-800' },
};

// === Shared Constants ===

export const STAGE_LABELS: Record<string, string> = {
  elementary: 'المرحلة الابتدائية',
  middle: 'المرحلة المتوسطة',
  secondary: 'المرحلة الثانوية',
  high: 'المرحلة الثانوية',
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const STUDENT_ID_LENGTH = 10;
export const ZK_DEFAULT_PORT = 4370;
export const ZK_DEFAULT_MODEL = 'MB2000';

// === Date Helpers ===

export function getLocalToday(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}
