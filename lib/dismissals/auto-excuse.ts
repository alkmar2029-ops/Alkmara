import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * After a dismissal is recorded, mark the student as 'excused' on every
 * period_session for their section that's already been recorded today AND
 * whose period starts at or after the dismissal time.
 *
 * Rationale:
 *   • Sessions a teacher already recorded BEFORE the dismissal time are
 *     historical truth — don't overwrite them.
 *   • Sessions for periods that start AFTER the dismissal: the student
 *     genuinely won't be there, so 'excused' is the correct status.
 *   • Sessions that don't exist yet (teacher hasn't recorded that period):
 *     left alone. The teacher will record them naturally; the dismissals
 *     log will tell them why the student is gone.
 *
 * Returns the number of period_absences rows touched (inserted or
 * upgraded). The caller stores this on the dismissal row for the receipt.
 */
export async function autoExcuseRemainingPeriods(
  supabase: SupabaseClient,
  args: { studentId: number; dismissalDate: string; dismissalTime: string },
): Promise<number> {
  const { studentId, dismissalDate, dismissalTime } = args;

  // 1. Resolve the student's section so we know which sessions to look at.
  const { data: student } = await supabase
    .from('students')
    .select('id, section_id')
    .eq('id', studentId)
    .maybeSingle();
  if (!student?.section_id) return 0;

  // 2. Pull every session for that section on the dismissal date along
  // with the period start_time so we can filter by "starts at or after
  // dismissal time" in JS — Supabase's filter API is awkward for the
  // joined column comparison.
  const { data: sessions } = await supabase
    .from('period_sessions')
    .select('id, period_id, periods(start_time)')
    .eq('section_id', student.section_id)
    .eq('attendance_date', dismissalDate);

  const targetSessionIds: number[] = [];
  for (const s of (sessions || []) as any[]) {
    const startTime = s.periods?.start_time as string | undefined;
    // No start_time defined on the period → conservative skip (we can't
    // tell whether it precedes or follows the dismissal). The teacher's
    // own recording remains authoritative.
    if (!startTime) continue;
    if (startTime >= dismissalTime) targetSessionIds.push(s.id);
  }

  if (targetSessionIds.length === 0) return 0;

  // 3. For each target session, upsert the student's absence row as
  // 'excused'. Using upsert so we override any 'present'/'absent'/'late'
  // mark a teacher may have set in advance — dismissal is the authoritative
  // truth at this moment.
  const rows = targetSessionIds.map((session_id) => ({
    session_id,
    student_id: studentId,
    status: 'excused' as const,
    notes: 'استئذان من المدرسة',
    recorded_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('period_absences')
    .upsert(rows, { onConflict: 'session_id,student_id' });
  if (error) {
    console.error('auto-excuse upsert failed:', error.message);
    return 0;
  }

  // 4. Bump each touched session's excused_count. Since we may have
  // converted a 'present' (no row) → 'excused' (new row), the counts
  // need a recompute. Fetch + update each session in parallel.
  await Promise.all(
    targetSessionIds.map(async (sid) => {
      const { count: ex } = await supabase
        .from('period_absences')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sid)
        .eq('status', 'excused');
      const { count: ab } = await supabase
        .from('period_absences')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sid)
        .eq('status', 'absent');
      const { count: la } = await supabase
        .from('period_absences')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sid)
        .eq('status', 'late');
      await supabase
        .from('period_sessions')
        .update({
          excused_count: ex ?? 0,
          absent_count: ab ?? 0,
          late_count: la ?? 0,
        })
        .eq('id', sid);
    }),
  );

  return targetSessionIds.length;
}
