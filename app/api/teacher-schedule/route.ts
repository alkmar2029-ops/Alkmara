import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { parseScheduleWorkbook } from '@/lib/schedule/excel-parser';
import { matchAllTeachers } from '@/lib/schedule/name-matcher';
import type { SectionMatch } from '@/lib/schedule/types';

export const dynamic = 'force-dynamic';

// GET — return the current schedule (rolled-up), plus a tiny summary
// the dashboard uses to show "current import" status.
export async function GET() {
  const auth = await requireRole(['admin', 'staff', 'viewer']);
  if (!auth.ok) return auth.res;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('teacher_schedule')
    .select(`
      id, teacher_user_id, teacher_name, day_of_week, period_number,
      section_id, subject, duty_type, monitoring_target,
      imported_at, imported_by,
      sections ( id, name, grade_id, grades ( id, name ) )
    `);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Summary numbers shown on the upload page so the admin sees state at a glance.
  const teachers = new Set<string>();
  let lastImport: string | null = null;
  let lastImportedBy: string | null = null;
  for (const r of data || []) {
    teachers.add(r.teacher_name);
    if (!lastImport || r.imported_at > lastImport) {
      lastImport = r.imported_at;
      lastImportedBy = r.imported_by ?? null;
    }
  }

  return NextResponse.json({
    data: {
      rows: data || [],
      summary: {
        teachers_count: teachers.size,
        cells_count: (data || []).length,
        last_import_at: lastImport,
        last_import_by: lastImportedBy,
      },
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

// POST — preview an uploaded Excel without committing. The caller sends
// the file as multipart/form-data; we parse + match teachers + match
// sections and return everything for the review screen. No DB writes.
//
// We intentionally split preview vs commit into two requests so the
// review UI can show a diff before any data is touched.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'لم يُرفع ملف' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());

  // 1. Parse the workbook into teacher × cell records.
  const parsed = parseScheduleWorkbook(buffer);

  // 2. Match every teacher name against existing user_profiles rows.
  // We use the service-role client because RLS scopes user_profiles
  // reads in some configurations and we need the full pool for matching.
  const admin = createAdminSupabaseClient();
  const { data: teachers } = await admin
    .from('user_profiles')
    .select('user_id, full_name')
    .eq('role', 'teacher')
    .eq('is_active', true);

  const pool = (teachers || [])
    .filter((t) => t.full_name)
    .map((t) => ({ user_id: t.user_id, full_name: t.full_name as string }));

  const nameMatches = matchAllTeachers(
    parsed.teachers.map((t) => t.teacher_name),
    pool,
  );

  // 3. Match every distinct (grade_label / section_label) against the
  // sections table so the admin sees missing sections up front.
  const sectionPairs = new Set<string>();
  for (const t of parsed.teachers) {
    for (const c of t.cells) {
      if (c.duty_type === 'class' && c.grade_label && c.section_label) {
        sectionPairs.add(`${c.grade_label}/${c.section_label}`);
      }
    }
  }

  const { data: sections } = await admin
    .from('sections')
    .select('id, name, grade_id, grades ( id, name )');
  const sectionMatches: SectionMatch[] = Array.from(sectionPairs).map((pair) => {
    const [gradeLabel, sectionLabel] = pair.split('/');
    // Match grade by trailing-digit heuristic ("الأول" contains "ول",
    // "الثاني" contains "ثاني", "الثالث" contains "ثالث") OR by
    // numeric label match. Most schools name grades 1/2/3 for middle
    // school, so we do a soft match on the digit + Arabic ordinal.
    const wanted = (sections || []).find((s: any) => {
      const gradeName = (s.grades?.name as string) || '';
      const sectionMatchByLabel = (s.name as string)?.replace(/^.*\//, '').trim() === sectionLabel
        || (s.name as string) === sectionLabel;
      const gradeMatchByDigit = matchGradeByDigit(gradeName, gradeLabel);
      return gradeMatchByDigit && sectionMatchByLabel;
    });
    if (wanted) {
      return {
        grade_label: gradeLabel,
        section_label: sectionLabel,
        status: 'matched',
        section_id: wanted.id,
        grade_name: (wanted as any).grades?.name,
      };
    }
    return { grade_label: gradeLabel, section_label: sectionLabel, status: 'missing' };
  });

  return NextResponse.json({
    data: {
      parsed,
      name_matches: nameMatches,
      section_matches: sectionMatches,
      summary: {
        teachers_in_excel: parsed.teachers.length,
        teachers_matched_exact: nameMatches.filter((m) => m.status === 'exact').length,
        teachers_matched_partial: nameMatches.filter((m) => m.status === 'partial').length,
        teachers_unmatched: nameMatches.filter((m) => m.status === 'none').length,
        sections_in_excel: sectionMatches.length,
        sections_missing: sectionMatches.filter((m) => m.status === 'missing').length,
        cells_total: parsed.teachers.reduce((acc, t) => acc + t.cells.length, 0),
      },
    },
  });
}

// Match an Excel grade label like "1" / "2" / "3" against the grade
// names in the database, which are usually Arabic ordinals like
// "الأول متوسط". We accept both pure digits and ordinals.
function matchGradeByDigit(gradeName: string, label: string): boolean {
  const n = parseInt(label, 10);
  if (Number.isNaN(n)) return false;
  const ordinals = ['الأول', 'الاول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'];
  const expected = ordinals[n - 1];
  if (!expected) return false;
  return gradeName.includes(expected) || gradeName.includes(String(n));
}
