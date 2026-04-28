import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — list students whose recent WhatsApp messages failed because their
// phone isn't registered on WhatsApp ("JID does not exist"). Useful for a
// "needs phone update" admin queue.
//
// Strategy:
//   1. Pull recent failed wa_messages with the JID-not-exist signature
//   2. Resolve each phone → student row (matching student.phone)
//   3. Aggregate: latest failure timestamp + total fail count + last attempt
export async function GET() {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();

  // 1. Failed messages with the JID error (or generic "does not exist").
  const { data: failed, error } = await supabase
    .from('whatsapp_messages')
    .select('recipient_phone, recipient_name, error_message, sent_at, message_body')
    .eq('status', 'failed')
    .or(
      'error_message.ilike.%JID does not exist%,' +
      'error_message.ilike.%does not exist on WhatsApp%,' +
      'error_message.ilike.%not registered%'
    )
    .order('sent_at', { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: 'فشل جلب البيانات' }, { status: 500 });
  }

  // 2. Aggregate by phone.
  const byPhone = new Map<string, {
    phone: string;
    last_name: string | null;
    last_failed_at: string;
    fail_count: number;
    last_error: string;
  }>();
  for (const m of failed || []) {
    const phone = m.recipient_phone as string;
    const cur = byPhone.get(phone) || {
      phone,
      last_name: m.recipient_name as string | null,
      last_failed_at: m.sent_at as string,
      fail_count: 0,
      last_error: m.error_message as string,
    };
    cur.fail_count++;
    if (m.sent_at > cur.last_failed_at) {
      cur.last_failed_at = m.sent_at as string;
      cur.last_error = m.error_message as string;
    }
    byPhone.set(phone, cur);
  }

  // 3. Resolve to students. We try direct phone match first, then a fuzzy
  //    match (some numbers stored without country code).
  const phones = Array.from(byPhone.keys());
  if (phones.length === 0) {
    return NextResponse.json({ data: [] });
  }

  // Build candidate phone variants for the IN clause: as-is + with/without 966 prefix.
  const variants = new Set<string>();
  for (const p of phones) {
    variants.add(p);
    if (p.startsWith('966')) variants.add('0' + p.slice(3));
    if (p.startsWith('05')) variants.add('966' + p.slice(1));
  }

  const { data: students } = await supabase
    .from('students')
    .select(`
      id, student_id, first_name, father_name, last_name, phone,
      sections ( name, grades ( name ) )
    `)
    .in('phone', Array.from(variants))
    .eq('is_active', true);

  // Match each phone to one or more students.
  const studentByPhone = new Map<string, any[]>();
  for (const s of students || []) {
    const sPhone = (s as any).phone as string;
    if (!sPhone) continue;
    // Normalize so a single failed phone can match either format.
    const keys = [sPhone];
    if (sPhone.startsWith('966')) keys.push('0' + sPhone.slice(3));
    if (sPhone.startsWith('05')) keys.push('966' + sPhone.slice(1));
    for (const k of keys) {
      const arr = studentByPhone.get(k) || [];
      arr.push(s);
      studentByPhone.set(k, arr);
    }
  }

  const rows = Array.from(byPhone.values()).map((entry) => ({
    phone: entry.phone,
    last_name: entry.last_name,
    last_failed_at: entry.last_failed_at,
    fail_count: entry.fail_count,
    last_error: entry.last_error,
    students: (studentByPhone.get(entry.phone) || []).map((s: any) => ({
      id: s.id,
      student_id: s.student_id,
      name: [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ').trim(),
      phone: s.phone,
      grade: s.sections?.grades?.name ?? null,
      section: s.sections?.name ?? null,
    })),
  })).sort((a, b) => b.fail_count - a.fail_count);

  return NextResponse.json({ data: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
