import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET — public endpoint used by /register/admin?code=XXXX-YYYY to verify
// a code before showing the form. Returns minimal info — invitee name and
// suggested sections — so the candidate sees they're at the right place.
//
// Not authenticated — middleware allowlists this path. Always returns the
// same response shape for invalid/expired/used codes (with `valid: false`)
// so a malicious caller can't probe for which codes exist.
export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const code = (params.code || '').toUpperCase().trim();
  if (!code || !/^[A-Z0-9-]{3,30}$/.test(code)) {
    return NextResponse.json({ data: { valid: false, reason: 'invalid_format' } });
  }

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('admin_invite_codes')
    .select('id, invitee_name, invitee_phone, suggested_section_ids, expires_at, used_at, revoked_at')
    .eq('code', code)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ data: { valid: false, reason: 'not_found' } });
  }

  const now = new Date();
  if (data.revoked_at) {
    return NextResponse.json({ data: { valid: false, reason: 'revoked' } });
  }
  if (data.used_at) {
    return NextResponse.json({ data: { valid: false, reason: 'already_used' } });
  }
  if (new Date(data.expires_at) <= now) {
    return NextResponse.json({ data: { valid: false, reason: 'expired' } });
  }

  // Resolve suggested section labels for nicer UX on the form.
  let suggestedSections: any[] = [];
  if (data.suggested_section_ids?.length) {
    const { data: sections } = await admin
      .from('sections')
      .select('id, name, grades(name)')
      .in('id', data.suggested_section_ids);
    suggestedSections = (sections || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      grade_name: s.grades?.name || '—',
    }));
  }

  return NextResponse.json({
    data: {
      valid: true,
      invitee_name: data.invitee_name,
      invitee_phone: data.invitee_phone,
      suggested_sections: suggestedSections,
      expires_at: data.expires_at,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
