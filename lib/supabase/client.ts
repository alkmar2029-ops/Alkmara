import { createBrowserClient } from '@supabase/ssr';

// Vercel env vars added via CLI piping pick up trailing newlines on Windows.
// Trim defensively so a stray '\n' doesn't break URL parsing at build time.
function envTrimmed(key: string): string {
  return (process.env[key] || '').trim();
}

export function createClient() {
  return createBrowserClient(
    envTrimmed('NEXT_PUBLIC_SUPABASE_URL'),
    envTrimmed('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}
