import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Public school info — used by the public teacher-registration page so it can
 * personalize the welcome ("you're joining <school name>") without requiring
 * an authenticated session.
 *
 * Returns ONLY non-sensitive fields. Anything stage-internal (academic year,
 * etc.) stays behind /api/settings which is auth-protected.
 */
export async function GET() {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('school_settings')
    .select('school_name, principal_name')
    .eq('id', 1)
    .maybeSingle();

  return NextResponse.json(
    {
      data: {
        school_name: (data?.school_name as string) || '',
        principal_name: (data?.principal_name as string) || '',
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } },  // 5 min CDN cache
  );
}
