import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// process.env.NEXT_PUBLIC_* is inlined by Next.js *only* when accessed as a
// literal property (process.env.NEXT_PUBLIC_FOO). Dynamic access (process.env[key])
// is not inlined and returns undefined in browser bundles. Reading each key
// directly is mandatory for it to ship to the client.
function trimmed(v: string | undefined): string {
  return (v || '').trim();
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    trimmed(process.env.NEXT_PUBLIC_SUPABASE_URL),
    trimmed(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
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
    trimmed(process.env.NEXT_PUBLIC_SUPABASE_URL),
    trimmed(process.env.SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
