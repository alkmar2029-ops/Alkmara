import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Vercel env vars added via CLI piping pick up trailing newlines on Windows.
// Trim defensively so a stray '\n' doesn't break URL parsing at build time.
function envTrimmed(key: string): string {
  return (process.env[key] || '').trim();
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    envTrimmed('NEXT_PUBLIC_SUPABASE_URL'),
    envTrimmed('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as any)
            );
          } catch {
            // Server Component
          }
        },
      },
    }
  );
}

export async function getAuthenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return { user, supabase };
}

export function createAdminSupabaseClient() {
  return createClient(
    envTrimmed('NEXT_PUBLIC_SUPABASE_URL'),
    envTrimmed('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
