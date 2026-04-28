import { createBrowserClient } from '@supabase/ssr';

// Vercel env vars added via CLI piping can pick up trailing newlines.
// Trim defensively so a stray '\n' doesn't break URL parsing.
function envTrimmed(key: string): string {
  // process.env.NEXT_PUBLIC_* is statically replaced by Next.js at build time
  // when referenced as a literal property. Reading via dynamic key (process.env[key])
  // *does not* get inlined — it returns undefined at runtime in the browser.
  // So we must read each key as a literal expression.
  let v: string | undefined;
  if (key === 'NEXT_PUBLIC_SUPABASE_URL') v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  else if (key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') v = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return (v || '').trim();
}

export function createClient() {
  return createBrowserClient(
    envTrimmed('NEXT_PUBLIC_SUPABASE_URL'),
    envTrimmed('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}
