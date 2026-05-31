// Substitute teacher suggester.
//
// Given an absent teacher's empty slot (day_of_week + period_number),
// returns the top N candidates ranked by:
//   - lowest class-period load today
//   - fewest substitution duties this week
//   - supervision today is a soft data point (not penalised)
//
// AVAILABILITY MODEL (Codex Sprint 2 fix):
//   The teacher_schedule import path SKIPS rows with duty_type='free'
//   (see app/api/teacher-schedule/commit/route.ts) — free is the
//   absence of a row, not a stored value. So we can't look up "free
//   teachers" by querying duty_type='free' (always empty result).
//
//   Correct definition of "available at slot S":
//     active teacher  AND  NOT busy at S  AND  NOT absent today
//   where "busy at S" = teacher_schedule row with duty_type IN
//   ('class','monitoring') at (day_of_week, period_number).
//
// HARD FILTERS (zero-tolerance):
//   - must be user_profiles.role='teacher' AND is_active=true
//   - must NOT have a busy row at the target slot
//   - must NOT be marked absent today
//   - cannot be the absent teacher themselves
//
// Subject matching is intentionally NOT implemented — there's no
// teacher_subjects table yet (deferred per م1.5 review).
//
// Caller passes the admin (service-role) Supabase client so the
// algorithm can read across all teachers regardless of RLS scope.

import type { SupabaseClient } from '@supabase/supabase-js';
import { startOfSaudiWeek, addDaysKsa } from '@/lib/dates/ksa';

export interface SuggestCandidate {
  user_id: string;
  full_name: string | null;
  periods_today: number;          // class periods scheduled today
  substitutions_this_week: number; // subs already assigned this week
  has_supervision_today: boolean;  // soft data point — VP decides
  score: number;                  // higher = better fit
  reasoning: string;              // short Arabic explanation for the UI
}

export interface SuggestParams {
  day_of_week: number;       // 0=Sun..4=Thu
  period_number: number;     // 1..8
  date: string;              // YYYY-MM-DD (used for absence + week-of)
  original_teacher_id?: string | null;
}

export async function suggestSubstitutes(
  // SupabaseClient typed loosely on purpose — keeps the algorithm
  // independent of the project's generated Database type.
  admin: SupabaseClient,
  params: SuggestParams,
  limit = 3,
): Promise<SuggestCandidate[]> {
  const { day_of_week, period_number, date, original_teacher_id } = params;

  // Step 1: universe = all active teachers.
  const teachersRes = await admin
    .from('user_profiles')
    .select('user_id, full_name')
    .eq('role', 'teacher')
    .eq('is_active', true);
  if (teachersRes.error) {
    throw new Error('lookup teachers: ' + teachersRes.error.message);
  }
  const allTeachers = (teachersRes.data ?? []) as Array<{
    user_id: string;
    full_name: string | null;
  }>;
  if (allTeachers.length === 0) return [];

  // Step 2: teachers BUSY at the target slot. duty_type IN ('class',
  // 'monitoring') — those are the rows stored in teacher_schedule.
  const busyRes = await admin
    .from('teacher_schedule')
    .select('teacher_user_id')
    .eq('day_of_week', day_of_week)
    .eq('period_number', period_number)
    .in('duty_type', ['class', 'monitoring']);
  if (busyRes.error) {
    throw new Error('lookup busy teachers: ' + busyRes.error.message);
  }
  const busySet = new Set(
    (busyRes.data ?? []).map((r: any) => r.teacher_user_id as string),
  );

  // Step 3a: teachers absent today.
  const absentRes = await admin
    .from('daily_teacher_absences')
    .select('teacher_user_id')
    .eq('absence_date', date);
  if (absentRes.error) {
    throw new Error('lookup absentees: ' + absentRes.error.message);
  }
  const absentSet = new Set(
    (absentRes.data ?? []).map((r: any) => r.teacher_user_id as string),
  );

  // Step 3b: teachers ALREADY booked as a substitute at this exact
  // date + period for some other absence. Without this, the suggester
  // would happily recommend someone the VP just assigned 30 seconds
  // ago to a different absent teacher's same-slot class (Codex Sprint
  // 2 fix — the DB-level UNIQUE catches it on write, but we should
  // hide the candidate from the start).
  const bookedRes = await admin
    .from('substitution_assignments')
    .select('substitute_user_id')
    .eq('assignment_date', date)
    .eq('period_number', period_number);
  if (bookedRes.error) {
    throw new Error('lookup existing assignments: ' + bookedRes.error.message);
  }
  const bookedSet = new Set(
    (bookedRes.data ?? []).map((r: any) => r.substitute_user_id as string),
  );

  // Available = active − busy − absent − already-booked − original.
  const candidates = allTeachers.filter(
    (t) =>
      !busySet.has(t.user_id) &&
      !absentSet.has(t.user_id) &&
      !bookedSet.has(t.user_id) &&
      t.user_id !== original_teacher_id,
  );
  if (candidates.length === 0) return [];

  const candidateIds = candidates.map((c) => c.user_id);

  // Step 4: per-candidate stats in parallel.
  const weekStart = startOfSaudiWeek(date);
  const weekEnd = addDaysKsa(weekStart, 7);

  const [periodsTodayRes, subsWeekRes, supervisionRes] = await Promise.all([
    // Class periods scheduled today, per candidate.
    admin
      .from('teacher_schedule')
      .select('teacher_user_id')
      .in('teacher_user_id', candidateIds)
      .eq('day_of_week', day_of_week)
      .eq('duty_type', 'class'),
    // Substitutions assigned this week, per candidate. Bounded by
    // [weekStart, weekStart+7d) in Riyadh local time.
    admin
      .from('substitution_assignments')
      .select('substitute_user_id, assigned_at')
      .in('substitute_user_id', candidateIds)
      .gte('assigned_at', `${weekStart}T00:00:00+03:00`)
      .lt('assigned_at', `${weekEnd}T00:00:00+03:00`),
    // Supervision duty on the same day — soft signal only.
    admin
      .from('supervision_assignments')
      .select('user_id')
      .in('user_id', candidateIds)
      .eq('day_of_week', day_of_week),
  ]);

  if (
    periodsTodayRes.error ||
    subsWeekRes.error ||
    supervisionRes.error
  ) {
    const err =
      periodsTodayRes.error ?? subsWeekRes.error ?? supervisionRes.error;
    throw new Error('candidate stats: ' + err!.message);
  }

  // Build the per-candidate maps.
  const periodsTodayMap = new Map<string, number>();
  for (const r of periodsTodayRes.data ?? []) {
    const id = (r as any).teacher_user_id as string;
    periodsTodayMap.set(id, (periodsTodayMap.get(id) ?? 0) + 1);
  }

  const subsWeekMap = new Map<string, number>();
  for (const r of subsWeekRes.data ?? []) {
    const id = (r as any).substitute_user_id as string;
    subsWeekMap.set(id, (subsWeekMap.get(id) ?? 0) + 1);
  }

  const supervisionSet = new Set(
    (supervisionRes.data ?? []).map((r: any) => r.user_id as string),
  );

  // Step 5: score + reasoning.
  // Weights chosen so a teacher with 0 periods + 0 subs scores 100,
  // a teacher with 4 periods + 3 subs scores 71 — wide enough to
  // surface the genuinely-light candidate first.
  const scored: SuggestCandidate[] = candidates.map((t) => {
    const periods = periodsTodayMap.get(t.user_id) ?? 0;
    const subs = subsWeekMap.get(t.user_id) ?? 0;
    const hasSupervision = supervisionSet.has(t.user_id);

    let score = 100;
    score -= periods * 5;
    score -= subs * 3;
    // Supervision intentionally NOT scored — too noisy. The VP sees
    // the flag in the reasoning and decides.

    const parts: string[] = [];
    parts.push(periods === 0 ? 'بلا حصص اليوم' : `${periods} حصص اليوم`);
    parts.push(subs === 0 ? 'بلا انتظار هذا الأسبوع' : `${subs} انتظار هذا الأسبوع`);
    if (hasSupervision) parts.push('⚠ عنده إشراف اليوم');

    return {
      user_id: t.user_id,
      full_name: t.full_name,
      periods_today: periods,
      substitutions_this_week: subs,
      has_supervision_today: hasSupervision,
      score,
      reasoning: parts.join(' • '),
    };
  });

  // Step 6: sort desc by score, ties broken by name for stable order.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ar');
  });

  return scored.slice(0, limit);
}
