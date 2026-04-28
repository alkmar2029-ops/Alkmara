'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import MessagesInbox from '@/components/messages/MessagesInbox';

export default function AdminMessagesPage() {
  const [role, setRole] = useState<'admin' | 'staff' | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const meta = (user?.app_metadata as any)?.role;
      if (meta === 'admin' || meta === 'staff') { setRole(meta); return; }
      const { data: profile } = await supabase
        .from('user_profiles').select('role').eq('user_id', user?.id || '').maybeSingle();
      if (profile?.role === 'admin' || profile?.role === 'staff') setRole(profile.role);
      else setRole('admin'); // sane default for /dashboard
    })();
  }, []);

  if (!role) return null;
  return <MessagesInbox role={role} />;
}
