import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// GET — count parents eligible for a bulk send under given filters.
// Powers the "سيُرسل لـ N ولي أمر" live counter on the form.
//
// Query params (all optional; combine for narrower targeting):
//   ?audience=all|grade|section|students    default 'all'
//   ?grade_id=N
//   ?section_id=N
//   ?student_ids=1,2,3                      comma-separated
//
// Returns: {
//   total, with_phone, without_phone,
//   sample: [{ student_id, name, phone }] (first 5 rows for preview)
// }
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const audience = (searchParams.get('audience') || 'all') as 'all' | 'grade' | 'section' | 'students';
  const gradeId = searchParams.get('grade_id');
  const sectionId = searchParams.get('section_id');
  const studentIdsRaw = searchParams.get('student_ids');

  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from('students')
    .select('id, first_name, father_name, last_name, phone, grade_id, section_id', { count: 'exact' })
    .eq('is_active', true);

  if (audience === 'grade' && gradeId)   q = q.eq('grade_id', parseInt(gradeId, 10));
  if (audience === 'section' && sectionId) q = q.eq('section_id', parseInt(sectionId, 10));
  if (audience === 'students' && studentIdsRaw) {
    const ids = studentIdsRaw.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
    if (ids.length === 0) return NextResponse.json({ data: { total: 0, with_phone: 0, without_phone: 0, sample: [] } });
    q = q.in('id', ids);
  }

  // Cap response at 5000 — even the largest school is well below this,
  // and an unbounded query on a misconfigured filter could OOM.
  q = q.range(0, 4999);

  const { data, count } = await q;
  const rows = data || [];
  const withPhone = rows.filter((r: any) => !!(r.phone && String(r.phone).trim()));
  const withoutPhone = rows.length - withPhone.length;
  const sample = withPhone.slice(0, 5).map((r: any) => ({
    student_id: r.id,
    name: [r.first_name, r.father_name, r.last_name].filter(Boolean).join(' ').trim(),
    phone: r.phone,
  }));

  return NextResponse.json({
    data: {
      total: count ?? rows.length,
      with_phone: withPhone.length,
      without_phone: withoutPhone,
      sample,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
