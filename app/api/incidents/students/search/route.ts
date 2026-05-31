// GET /api/incidents/students/search?q=...&limit=...
//
// Dedicated student picker for the incident submission form (م3.12).
//
// Why a dedicated endpoint instead of reusing /api/students:
//   /api/students relies on the existing student-table RLS to scope
//   teachers via teacher_section_assignments. If staging or
//   production has drift (e.g. an older `USING (true)` policy still
//   wins ALTER ordering), a teacher would see EVERY student in the
//   picker — a privacy + correctness regression even if the
//   subsequent INSERT would still be RLS-blocked. This endpoint
//   does the scope JOIN explicitly using the service-role client
//   so the visibility no longer depends on the students table's
//   own RLS state (Codex Sprint 3 fifth review).
//
// Scope rules:
//   - teacher        — query joins teacher_section_assignments;
//                      only students in the teacher's assigned
//                      sections come back
//   - admin / super  — all active students (broader legitimate
//                      need; the eventual INSERT still enforces
//                      the new persona-aware RLS gate)
//
// Response shape matches the StudentPicker's expected fields:
//   { id, first_name, father_name, last_name, grade_name, section_name }

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

// PostgREST `or()` and `ilike()` filters interpret some characters
// specially. Strip them before stitching into the query string —
// same sanitiser as /api/students.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,.*()\\%_]/g, '');
}

const querySchema = z.object({
  q: z.string().min(2).max(60),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

interface StudentRow {
  id: number;
  first_name: string;
  father_name: string | null;
  last_name: string;
  grades: { name: string | null } | { name: string | null }[] | null;
  sections: { name: string | null } | { name: string | null }[] | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(['teacher', 'admin', 'super_admin']);
  if (!auth.ok) return auth.res;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get('q') ?? '',
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات البحث غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const search = sanitizeSearch(parsed.data.q);
  const limit = parsed.data.limit ?? 10;

  // Empty after sanitisation (e.g. user typed only special chars) —
  // return empty rather than running a wildcard match.
  if (search.length < 2) {
    return NextResponse.json(
      { data: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const admin = createAdminSupabaseClient();
  const orClause = [
    `first_name.ilike.%${search}%`,
    `father_name.ilike.%${search}%`,
    `last_name.ilike.%${search}%`,
    `student_id.ilike.%${search}%`,
  ].join(',');

  let query = admin
    .from('students')
    .select('id, first_name, father_name, last_name, grades(name), sections(name)')
    .eq('is_active', true)
    .or(orClause)
    .order('first_name', { ascending: true })
    .limit(limit);

  // Teachers see ONLY their assigned sections' students. We fetch
  // the section_ids first and `.in()` the students query — two
  // round trips but each query is fast (small N, indexed columns).
  if (auth.ctx.role === 'teacher') {
    const sectionsRes = await admin
      .from('teacher_section_assignments')
      .select('section_id')
      .eq('teacher_user_id', auth.ctx.userId);

    if (sectionsRes.error) {
      return NextResponse.json(
        { error: 'فشل تحميل شعبك: ' + sectionsRes.error.message },
        { status: 500 },
      );
    }
    const sectionIds = (sectionsRes.data ?? []).map((s) => s.section_id);
    if (sectionIds.length === 0) {
      // Teacher with no section assignments → empty picker, not an
      // error. The submission would fail at the INSERT step anyway.
      return NextResponse.json(
        { data: [] },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    query = query.in('section_id', sectionIds);
  }

  // Admin / super_admin: no scope narrowing — they have legitimate
  // broader access. The INSERT later enforces the persona-aware
  // RLS gate (super_admin / teacher_teaches / reviewer / counselor).

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: 'فشل البحث عن الطلاب: ' + error.message },
      { status: 500 },
    );
  }

  // PostgREST may return embedded relations as a single object OR
  // as an array depending on the inferred cardinality. The schema
  // gives us many-to-one (student → grade, student → section), but
  // the type is loose. Unwrap defensively.
  const unwrap = <T,>(v: T | T[] | null | undefined): T | null => {
    if (!v) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
  };

  const flattened = ((data ?? []) as StudentRow[]).map((s) => {
    const grade = unwrap(s.grades);
    const section = unwrap(s.sections);
    return {
      id: s.id,
      first_name: s.first_name,
      father_name: s.father_name,
      last_name: s.last_name,
      grade_name: grade?.name ?? null,
      section_name: section?.name ?? null,
    };
  });

  return NextResponse.json(
    { data: flattened },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
