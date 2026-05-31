// GET /api/counselor/watchlist — Sprint 5 risk-score watchlist (м5.6).
//
// Read-only surface over the precomputed student_risk_scores rows.
// The endpoint does NOT compute. If a row is `is_stale=true` (or no
// row exists yet because the sweep hasn't run), it's either excluded
// (default) or surfaced with the stale flag set. The UI displays
// "لا توجد نتائج محسوبة بعد" when items is empty — never triggers
// a server-side compute.
//
// =====================================================================
// AUTH + RLS
// =====================================================================
// Gate: requireCounselorWorkspace (super_admin OR persona='counselor').
// User-bound client → м5.2's policy applies:
//   - super_admin sees all rows
//   - counselor sees rows for students in their counselor_assignments
//   - view_confidential_notes flag holders see NOTHING (deliberate
//     privacy decision — see م5.2 header)
//
// Service-role admin client is used ONLY to resolve display names
// (student / section / grade) for the rows RLS already authorised.
// Same pattern as the workspace summary + case detail surfaces.
//
// =====================================================================
// QUERY PARAMS
// =====================================================================
//   min_score      0-100, default 50  (the watchlist's whole point is
//                                       "students above threshold")
//   limit          1-200, default 100 (matches the watchlist's
//                                       typical density ceiling)
//   include_stale  default false      (true = surface uncomputed/
//                                       stale rows too, with the
//                                       is_stale=true flag visible)
//
// =====================================================================
// SORT
// =====================================================================
// total_score DESC, student_id ASC — highest risk first, tie-break
// deterministic so paginated views are stable.
//
// =====================================================================
// RESPONSE SHAPE
// =====================================================================
//   {
//     data: {
//       total: number,        // count of rows matching the filter
//                              // (before limit) — UI can show "X من Y"
//       items: [
//         {
//           student_id, student_name,
//           grade_name, section_name,
//           score, subscores: { behavior, engagement, attendance, velocity },
//           signals,           // raw counts for explainability
//           computed_at,       // null = never computed
//           is_stale,          // true = recompute pending
//         },
//         ...
//       ],
//     },
//   }

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from '@/lib/supabase/server';
import { requireCounselorWorkspace } from '@/lib/personas/auth-gate';
import { logConfidentialRead } from '@/lib/audit/confidential-read';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  min_score: z.coerce.number().int().min(0).max(100).default(50),
  limit:     z.coerce.number().int().min(1).max(200).default(100),
  // URL params are strings; "false" is truthy via Boolean(). Custom
  // transform so only the literal 'true' enables include_stale.
  include_stale: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
});

interface ScoreRow {
  student_id:       number;
  total_score:      number;
  behavior_score:   number;
  engagement_score: number;
  attendance_score: number;
  velocity_score:   number;
  signals:          unknown;
  computed_at:      string | null;
  is_stale:         boolean;
  section_id:       number | null;
}

interface WatchlistItem {
  student_id:    number;
  student_name:  string | null;
  grade_name:    string | null;
  section_name:  string | null;
  score:         number;
  subscores: {
    behavior:   number;
    engagement: number;
    attendance: number;
    velocity:   number;
  };
  signals:       unknown;
  computed_at:   string | null;
  is_stale:      boolean;
}

export async function GET(request: NextRequest) {
  const auth = await requireCounselorWorkspace();
  if (!auth.ok) return auth.res;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    min_score:     url.searchParams.get('min_score')     ?? undefined,
    limit:         url.searchParams.get('limit')         ?? undefined,
    include_stale: url.searchParams.get('include_stale') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'بيانات الفلتر غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const filters = parsed.data;

  // ----- User-bound scored rows -----
  // RLS handles scope. count:'exact' so the UI can show the total
  // BEFORE limit ("X من Y").
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from('student_risk_scores')
    .select(
      'student_id, total_score, behavior_score, engagement_score, attendance_score, velocity_score, signals, computed_at, is_stale, section_id',
      { count: 'exact' },
    )
    .gte('total_score', filters.min_score)
    .order('total_score', { ascending: false })
    .order('student_id', { ascending: true })
    .limit(filters.limit);

  // Default: hide stale rows. They reflect upstream signals that have
  // changed since the last compute — surfacing them would mislead the
  // counselor into acting on potentially-outdated risk numbers.
  if (!filters.include_stale) {
    query = query.eq('is_stale', false);
  }

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: 'فشل تحميل قائمة المتابعة: ' + error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as ScoreRow[];

  // Fast path — nothing to enrich.
  if (rows.length === 0) {
    const logged = await logConfidentialRead({
      accessedBy: auth.ctx.userId,
      request,
      entries: [{
        tableName: 'student_risk_scores',
        recordId: 'watchlist',
        studentId: null,
      }],
    });
    if (!logged.ok) return logged.res;

    return NextResponse.json(
      { data: { total: count ?? 0, items: [] } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // ----- Resolve display names via admin client -----
  // RLS already authorised the rows; surfacing names is in-scope info.
  // Two-step lookup: students → first/last name, sections → name +
  // grade_id, then grades → name.
  const studentIds = Array.from(new Set(rows.map((r) => r.student_id)));
  const sectionIds = Array.from(
    new Set(rows.map((r) => r.section_id).filter((x): x is number => x !== null)),
  );

  const admin = createAdminSupabaseClient();
  const [studentsRes, sectionsRes] = await Promise.all([
    admin
      .from('students')
      .select('id, first_name, last_name')
      .in('id', studentIds),
    sectionIds.length > 0
      ? admin
          .from('sections')
          .select('id, name, grade_id')
          .in('id', sectionIds)
      : Promise.resolve({ data: [] as Array<{ id: number; name: string; grade_id: number | null }>, error: null }),
  ]);

  if (studentsRes.error || sectionsRes.error) {
    const err = studentsRes.error ?? sectionsRes.error;
    return NextResponse.json(
      { error: 'فشل جلب أسماء الطلاب/الفصول: ' + err!.message },
      { status: 500 },
    );
  }

  const sectionsData = (sectionsRes.data ?? []) as Array<{
    id: number; name: string; grade_id: number | null;
  }>;
  const gradeIds = Array.from(
    new Set(sectionsData.map((s) => s.grade_id).filter((x): x is number => x !== null)),
  );
  const gradesRes = gradeIds.length > 0
    ? await admin.from('grades').select('id, name').in('id', gradeIds)
    : { data: [] as Array<{ id: number; name: string }>, error: null };

  if (gradesRes.error) {
    return NextResponse.json(
      { error: 'فشل جلب أسماء الصفوف: ' + gradesRes.error.message },
      { status: 500 },
    );
  }

  // Lookup maps
  const studentMap = new Map<number, string | null>();
  for (const s of studentsRes.data ?? []) {
    const name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim();
    studentMap.set(s.id, name || null);
  }
  const sectionMap = new Map<number, { name: string; grade_id: number | null }>();
  for (const s of sectionsData) {
    sectionMap.set(s.id, { name: s.name, grade_id: s.grade_id });
  }
  const gradeMap = new Map<number, string>();
  for (const g of (gradesRes.data ?? []) as Array<{ id: number; name: string }>) {
    gradeMap.set(g.id, g.name);
  }

  // ----- Build response items -----
  const items: WatchlistItem[] = rows.map((r) => {
    const sect = r.section_id !== null ? sectionMap.get(r.section_id) : undefined;
    const gradeName = sect?.grade_id != null ? gradeMap.get(sect.grade_id) ?? null : null;
    return {
      student_id:   r.student_id,
      student_name: studentMap.get(r.student_id) ?? null,
      grade_name:   gradeName,
      section_name: sect?.name ?? null,
      score:        r.total_score,
      subscores: {
        behavior:   r.behavior_score,
        engagement: r.engagement_score,
        attendance: r.attendance_score,
        velocity:   r.velocity_score,
      },
      signals:      r.signals,
      computed_at:  r.computed_at,
      is_stale:     r.is_stale,
    };
  });

  const logged = await logConfidentialRead({
    accessedBy: auth.ctx.userId,
    request,
    entries: [{
      tableName: 'student_risk_scores',
      recordId: 'watchlist',
      studentId: null,
    }],
  });
  if (!logged.ok) return logged.res;

  return NextResponse.json(
    { data: { total: count ?? items.length, items } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
