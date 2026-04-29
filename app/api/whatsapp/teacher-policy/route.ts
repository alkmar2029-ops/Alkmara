import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — exposes the WhatsApp-related toggles relevant to a teacher's UI.
// Returns just the boolean flags — no API keys or other secrets — so it's
// safe to surface to the teacher portal. Uses the admin client to bypass
// the whatsapp_settings RLS (admin-only) for this *narrow, non-sensitive*
// read; the response shape is whitelisted to booleans.
//
// Auth is still required so we don't expose this to unauthenticated callers
// (limits the trivial information disclosure surface).
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const [{ data: wa }, { data: school }] = await Promise.all([
    admin.from('whatsapp_settings')
      .select('teachers_can_send_whatsapp, teachers_enabled')
      .eq('id', 1).maybeSingle(),
    admin.from('school_settings')
      .select('teachers_notes_templates_only')
      .eq('id', 1).maybeSingle(),
  ]);

  return NextResponse.json({
    data: {
      teachers_can_send_whatsapp: wa?.teachers_can_send_whatsapp === true,
      teachers_enabled: wa?.teachers_enabled !== false,
      // When true, the teacher portal locks notes to the curated templates
      // (no free-text typing or voice-to-text). Defaults to true on
      // pre-migration databases — matches the new baseline behavior.
      teachers_notes_templates_only: school?.teachers_notes_templates_only !== false,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
