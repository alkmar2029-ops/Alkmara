'use client';
import { ChevronRight, ChevronLeft } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (_page: number) => void;
}

export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="btn-secondary disabled:opacity-50"
        aria-label="الصفحة السابقة"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <span className="text-sm text-gray-600">
        صفحة {page} من {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="btn-secondary disabled:opacity-50"
        aria-label="الصفحة التالية"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    </div>
  );
}
