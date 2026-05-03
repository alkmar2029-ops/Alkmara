// Shared types for the teacher-schedule import flow.

export type DayOfWeek = 0 | 1 | 2 | 3 | 4;  // Sun=0 .. Thu=4 (Saudi school week)
export type DutyType = 'class' | 'monitoring' | 'free';

export const DAY_NAMES_AR: Record<DayOfWeek, string> = {
  0: 'الأحد',
  1: 'الإثنين',
  2: 'الثلاثاء',
  3: 'الأربعاء',
  4: 'الخميس',
};

// One slot in a teacher's weekly schedule. The parser produces one of
// these per (teacher × day × period).
export interface ParsedCell {
  day_of_week: DayOfWeek;
  period_number: number;
  duty_type: DutyType;
  // For 'class' rows:
  grade_label: string | null;       // "2"  (the digit before the slash)
  section_label: string | null;     // "3"  (the digit after the slash)
  subject: string | null;           // "الدراسات الاجتماعية"
  // For 'monitoring' rows:
  monitoring_target: number | null; // the N in "منتظر N"
  // The original text from the Excel cell — kept for the review UI so
  // an admin can reconcile odd cases (e.g., a cell with two assignments
  // separated by "/" gets parsed as the first; the second is in raw).
  raw: string;
}

export interface ParsedTeacher {
  rowIndex: number;                 // 1-based Excel row
  teacher_name: string;
  cells: ParsedCell[];              // length 35 = 5 days × 7 periods (or fewer)
  total_class_periods: number;      // count where duty_type='class'
  total_monitoring: number;
  total_free: number;
}

export interface ParseResult {
  teachers: ParsedTeacher[];
  warnings: string[];               // per-row issues, never fatal
  meta: {
    rows_scanned: number;
    days_detected: number;
    periods_per_day: number;
  };
}

// Result of running a teacher_name through the matcher.
export interface NameMatch {
  excel_name: string;
  status: 'exact' | 'partial' | 'none';
  candidates: Array<{
    user_id: string;
    full_name: string;
    score: number;     // 0..1, higher = better
  }>;
}

// Result of resolving a "X / Y" cell against the sections table.
export interface SectionMatch {
  grade_label: string;
  section_label: string;
  status: 'matched' | 'missing';
  section_id?: number;
  grade_name?: string;
}
