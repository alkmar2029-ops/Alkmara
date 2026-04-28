'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Tiny red dot showing unread message count. Polls every 30s.
 * Returns null when there are no unread messages so it doesn't take layout
 * space.
 */
export default function UnreadBadge({ className = '' }: { className?: string }) {
  const { data } = useQuery<{ count: number }>({
    queryKey: ['messages-unread'],
    queryFn: async () => {
      const r = await fetch('/api/messages/unread-count');
      if (!r.ok) return { count: 0 };
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const count = data?.count ?? 0;
  if (count <= 0) return null;

  return (
    <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
