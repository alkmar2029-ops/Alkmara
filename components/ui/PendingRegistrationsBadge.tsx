'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Red dot showing the count of pending teacher-registration applications.
 * Polls every 60s. Returns null when zero so it doesn't take layout space.
 *
 * Hits the same endpoint the page uses; the API returns `pendingCount`
 * regardless of which status was queried, so a `?status=pending&limit=0`-style
 * call would also work, but reusing the existing endpoint keeps it simple.
 */
export default function PendingRegistrationsBadge({ className = '' }: { className?: string }) {
  const { data } = useQuery<{ pendingCount: number }>({
    queryKey: ['teacher-registrations-pending-count'],
    queryFn: async () => {
      const r = await fetch('/api/teacher-registrations?status=pending');
      if (!r.ok) return { pendingCount: 0 };
      const d = await r.json();
      return { pendingCount: d.pendingCount ?? 0 };
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const count = data?.pendingCount ?? 0;
  if (count <= 0) return null;

  return (
    <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
