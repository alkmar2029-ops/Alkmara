import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/supabase/auth';
import { normalizeSearch, detectIntent } from '@/lib/search/normalize';
import { todayInSchoolTz } from '@/lib/utils/school-time';

export const dynamic = 'force-dynamic';

// GET — global search across students, teachers, and sections.
// Returns results grouped by type plus a detected "intent" the UI
// can use to navigate (e.g., "1/3" → open section, "غياب احمد" →
// filter absences). Throttled to 20 results per type.
//
// Query params:
//   q        the user's input (trimmed, normalized server-side)
//   types    comma-separated whitelist (default: all)
//            valid values: students, teachers, sections
//   limit    max per type (default: 8, max: 20)
export async function GET(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff', 'viewer', 'teacher']);
  if (!auth.ok) return auth.res;

  const { searchParams } = new URL(request.url);
  const rawQuery = (searchParams.get('q') || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '8', 10)));
  const allowedTypes = (searchParams.get('types') || 'students,teachers,sections')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!rawQuery) {
    return NextResponse.json({
      data: { query: '', intent: { type: 'plain', value: '' }, results: { students: [], teachers: [], sections: [] } },
    });
  }

  const intent = detectIntent(rawQuery);
  const normalized = normalizeSearch(rawQuery);

  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  // PRIV-02 — counselors carry role='admin', so the base `students` RLS
  // lets them read EVERY student. We constrain their search to their
  // counselor_assignments scope. Two correctness rules (static-review
  // fixes):
  //   1. FAIL CLOSED on persona determination. Read role+persona via the
  //      SERVICE-ROLE client (authoritative; no RLS ambiguity on the
  //      caller's own row) and 500 on a read ERROR — never let "couldn't
  //      determine persona" silently downgrade a counselor to an
  //      unrestricted admin. A successful-but-null read via service-role
  //      authoritatively means "no profile → not a counselor".
  //   2. Scope at the QUERY (section_id IN scope), NOT as a post-filter
  //      after `.limit` — otherwise the first N matches could all be
  //      out-of-scope and hide valid in-scope rows beyond the limit.
  // `counselorSectionIds` stays null for super_admin / non-counselor
  // admins (unrestricted). For a counselor it's the exact section set;
  // an empty set (no assignments) scopes every query to zero rows.
  let counselorSectionIds: number[] | null = null;
  if (auth.ctx.role === 'admin') {
    const { data: caller, error: callerErr } = await admin
      .from('user_profiles')
      .select('role, permissions')
      .eq('user_id', auth.ctx.userId)
      .maybeSingle();
    if (callerErr) {
      return NextResponse.json(
        { error: 'تعذّر التحقق من نطاق المرشد' },
        { status: 500 },
      );
    }
    const perms = (caller?.permissions ?? {}) as Record<string, unknown>;
    if (caller?.role === 'admin' && perms.persona === 'counselor') {
      // Section set the counselor may see = directly-assigned sections ∪
      // every section in their grade-wide assignments. MIRRORS
      // counselor_can_see_student (section-direct OR grade-wide) — keep
      // in sync if that function's logic changes.
      const { data: assigns, error: aErr } = await admin
        .from('counselor_assignments')
        .select('section_id, grade_id')
        .eq('counselor_user_id', auth.ctx.userId);
      if (aErr) {
        return NextResponse.json(
          { error: 'تعذّر تحديد نطاق المرشد' },
          { status: 500 },
        );
      }
      const sectionIds = new Set<number>();
      const gradeIds: number[] = [];
      for (const a of assigns ?? []) {
        if (a.section_id != null) sectionIds.add(a.section_id as number);
        if (a.grade_id != null) gradeIds.push(a.grade_id as number);
      }
      if (gradeIds.length > 0) {
        const { data: gradeSecs, error: gErr } = await admin
          .from('sections')
          .select('id')
          .in('grade_id', gradeIds);
        if (gErr) {
          return NextResponse.json(
            { error: 'تعذّر تحديد نطاق المرشد' },
            { status: 500 },
          );
        }
        for (const sec of gradeSecs ?? []) sectionIds.add(sec.id as number);
      }
      counselorSectionIds = Array.from(sectionIds);
    }
  }

  // Promise dispatch — only fetch types the caller asked for.
  const results: any = { students: [], teachers: [], sections: [] };

  const promises: Promise<void>[] = [];

  // Students
  if (allowedTypes.includes('students')) {
    promises.push((async () => {
      // For phone/student_id intents, target those columns directly
      // (faster + more precise than trigram).
      // PRIV-02: when the caller is a scoped counselor, every student
      // query is constrained to their section set at the DB level, so
      // `.limit` applies to already-in-scope rows (no hide-after-limit).
      // A counselor with NO in-scope sections short-circuits to empty:
      // this sidesteps emitting a `.in('section_id', [])` query (the
      // PostgREST empty-IN edge) and saves a pointless round-trip. MUST
      // stay before the queries — the per-query guard below is
      // `if (counselorSectionIds)`, NOT `length > 0`, because skipping
      // `.in` on an empty set would return EVERY student (a leak).
      if (counselorSectionIds && counselorSectionIds.length === 0) {
        results.students = [];
        return;
      }
      if (intent.type === 'phone') {
        let q = supabase
          .from('students')
          .select('id, student_id, first_name, father_name, last_name, phone, section_id, sections(name, grades(name))')
          .ilike('phone', `%${intent.value.slice(-9)}%`)
          .eq('is_active', true);
        if (counselorSectionIds) q = q.in('section_id', counselorSectionIds);
        const { data } = await q.limit(limit);
        results.students = (data || []).map(shapeStudent);
        return;
      }
      if (intent.type === 'student_id') {
        let q = supabase
          .from('students')
          .select('id, student_id, first_name, father_name, last_name, phone, section_id, sections(name, grades(name))')
          .eq('student_id', intent.value)
          .eq('is_active', true);
        if (counselorSectionIds) q = q.in('section_id', counselorSectionIds);
        const { data } = await q.limit(limit);
        results.students = (data || []).map(shapeStudent);
        return;
      }
      // Plain / context — substring + trigram on search_text.
      const term = intent.type === 'context' ? intent.rest : normalized;
      if (!term) return;
      let q = supabase
        .from('students')
        .select('id, student_id, first_name, father_name, last_name, phone, section_id, sections(name, grades(name))')
        .ilike('search_text', `%${term}%`)
        .eq('is_active', true);
      if (counselorSectionIds) q = q.in('section_id', counselorSectionIds);
      const { data } = await q.limit(limit);
      let rows = (data || []).map(shapeStudent);

      // For context intents, layer the today's data filter on top.
      if (intent.type === 'context' && rows.length > 0) {
        const today = todayInSchoolTz();
        if (intent.keyword === 'dismissal') {
          const { data: dismissals } = await admin
            .from('student_dismissals')
            .select('student_id')
            .eq('dismissal_date', today)
            .in('student_id', rows.map((r) => r.id));
          const ids = new Set((dismissals || []).map((d: any) => d.student_id));
          rows = rows.filter((r) => ids.has(r.id));
        } else {
          // Absence / late / escape — derive from today's period_absences.
          const wantStatus = intent.keyword === 'late' ? 'late' : 'absent';
          const { data: sessions } = await admin
            .from('period_sessions')
            .select('id')
            .eq('attendance_date', today);
          const sessionIds = (sessions || []).map((s: any) => s.id);
          if (sessionIds.length > 0) {
            const { data: abs } = await admin
              .from('period_absences')
              .select('student_id, status, session_id')
              .in('session_id', sessionIds)
              .eq('status', wantStatus)
              .in('student_id', rows.map((r) => r.id));
            // For "escape": also filter to students with absences > 0 but not all
            const idsAbs = new Set((abs || []).map((a: any) => a.student_id));
            rows = rows.filter((r) => idsAbs.has(r.id));
          } else {
            rows = [];
          }
        }
      }

      results.students = rows;
    })());
  }

  // Teachers. Uses the service-role client for admin/staff search, so keep
  // teachers out explicitly instead of relying on RLS.
  if (allowedTypes.includes('teachers') && auth.ctx.role !== 'teacher') {
    promises.push((async () => {
      const term = intent.type === 'plain' ? normalized
                  : intent.type === 'context' ? intent.rest
                  : intent.type === 'phone' ? intent.value
                  : '';
      if (!term) return;
      const { data } = await admin
        .from('user_profiles')
        .select('user_id, full_name, phone, role')
        .eq('role', 'teacher')
        .eq('is_active', true)
        .ilike('search_text', `%${term}%`)
        .limit(limit);
      results.teachers = (data || []).map((t: any) => ({
        user_id: t.user_id,
        full_name: t.full_name,
        phone: t.phone,
      }));
    })());
  }

  // Sections. Uses the service-role client and exposes school structure, so
  // teachers receive an empty result for this type.
  if (allowedTypes.includes('sections') && auth.ctx.role !== 'teacher') {
    promises.push((async () => {
      if (intent.type === 'section') {
        // "1/3" pattern — find the section directly.
        const { data: secs } = await admin
          .from('sections')
          .select('id, name, grade_id, grades(name)')
          .eq('name', intent.section);
        const filtered = (secs || []).filter((s: any) => {
          const gn: string = s.grades?.name || '';
          if (/^\d+$/.test(intent.grade)) {
            const ords = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
            return gn.includes(ords[parseInt(intent.grade) - 1] || '___NOPE___');
          }
          return gn.includes(intent.grade);
        });
        results.sections = filtered.map((s: any) => ({
          id: s.id, name: s.name, grade_name: s.grades?.name || '',
        }));
        return;
      }
      const term = intent.type === 'plain' ? normalized : '';
      if (!term) return;
      const { data: secs } = await admin
        .from('sections')
        .select('id, name, grade_id, grades(name)');
      const filtered = (secs || []).filter((s: any) => {
        const combined = normalizeSearch(`${s.grades?.name || ''} ${s.name}`);
        return combined.includes(term);
      }).slice(0, limit);
      results.sections = filtered.map((s: any) => ({
        id: s.id, name: s.name, grade_name: s.grades?.name || '',
      }));
    })());
  }

  await Promise.all(promises);

  return NextResponse.json({
    data: { query: rawQuery, intent, results },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function shapeStudent(s: any) {
  return {
    id: s.id,
    student_id: s.student_id,
    name: [s.first_name, s.father_name, s.last_name].filter(Boolean).join(' ').trim(),
    phone: s.phone || null,
    section_id: s.section_id,
    section_name: s.sections?.name || null,
    grade_name: s.sections?.grades?.name || null,
  };
}
