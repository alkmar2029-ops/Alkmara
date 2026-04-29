'use client';

import { useQuery } from '@tanstack/react-query';

export interface AssignedSection {
  id: number;
  name: string;
  grade_id: number;
  grade_name: string;
}

interface Result {
  /** Sections this teacher is assigned to (already sorted by grade then name). */
  sections: AssignedSection[];
  /** Distinct grades from the assigned sections — useful for cascading dropdowns. */
  grades: { id: number; name: string }[];
  /** Section ids the teacher can access (handy for filter checks). */
  allowedSectionIds: Set<number>;
  /** Section ids by grade — for the section dropdown filter. */
  sectionsByGrade: Map<number, AssignedSection[]>;
  isLoading: boolean;
  /** True when the teacher has zero assignments — UI should show empty state. */
  isUnassigned: boolean;
}

/**
 * Fetches the current teacher's assigned sections from
 * /api/teacher-assignments/me and exposes derived collections that the
 * portal pages need: distinct grade list, section-by-grade lookup, and
 * the allowed-id set.
 *
 * Returns empty collections (not undefined) for non-teachers and during
 * loading, so callers can use them without null-checking.
 */
export function useMyAssignedSections(): Result {
  const { data, isLoading } = useQuery<{ sections: AssignedSection[] }>({
    queryKey: ['my-assigned-sections'],
    queryFn: async () => {
      const r = await fetch('/api/teacher-assignments/me');
      if (!r.ok) return { sections: [] };
      return (await r.json()).data;
    },
    // Section assignments change rarely (term-level admin action), so a
    // generous staleTime cuts redundant requests as the teacher navigates.
    staleTime: 5 * 60_000,
  });

  const sections = data?.sections || [];

  // Build the distinct grades list. Preserves the input order which is
  // already grade-sorted by the API, so the dropdown reads top-down
  // الأول → الثاني → الثالث.
  const seen = new Set<number>();
  const grades: { id: number; name: string }[] = [];
  for (const s of sections) {
    if (!seen.has(s.grade_id)) {
      seen.add(s.grade_id);
      grades.push({ id: s.grade_id, name: s.grade_name });
    }
  }

  const allowedSectionIds = new Set(sections.map((s) => s.id));

  const sectionsByGrade = new Map<number, AssignedSection[]>();
  for (const s of sections) {
    const arr = sectionsByGrade.get(s.grade_id) || [];
    arr.push(s);
    sectionsByGrade.set(s.grade_id, arr);
  }

  return {
    sections,
    grades,
    allowedSectionIds,
    sectionsByGrade,
    isLoading,
    isUnassigned: !isLoading && sections.length === 0,
  };
}
