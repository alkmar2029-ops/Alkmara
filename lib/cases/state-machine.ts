// Pure case-status state-machine helpers (م4.22).
//
// All functions are deterministic, side-effect-free, and frozen
// against the data CHECK constraints on student_cases. The API layer
// consumes these and translates rule violations into HTTP 422.
//
// Lifecycle:
//
//     ┌──────────────► in_progress ──┐
//     │                              │
//     │    ┌─ resolved ◄──────────── ┘
//   open ──┤
//     │    └─ closed   ◄─────────────┐
//     │                              │
//     ▲          (reopen)            │
//     └──────── resolved/closed ─────┘
//
// Edges (8):
//   open → in_progress | resolved | closed
//   in_progress → open | resolved | closed
//   resolved → open                       (reopen — bumps reopen_count)
//   closed   → open                       (reopen — bumps reopen_count)
//
// Forbidden:
//   resolved ↔ closed                     (not a real workflow path;
//                                          counselor must reopen first)
//   any terminal → terminal               (same reason)
//   any → same                            (no-op; surface as 422 in API)

export const CASE_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

const ALLOWED: Record<CaseStatus, CaseStatus[]> = {
  open:        ['in_progress', 'resolved', 'closed'],
  in_progress: ['open', 'resolved', 'closed'],
  resolved:    ['open'],
  closed:      ['open'],
};

export function isCaseTransitionAllowed(from: CaseStatus, to: CaseStatus): boolean {
  if (from === to) return false;
  return ALLOWED[from]?.includes(to) ?? false;
}

/**
 * Returns the list of statuses the caller may move TO from `from`.
 * Used by the UI to render only the legal action buttons.
 */
export function allowedNextStatuses(from: CaseStatus): CaseStatus[] {
  return ALLOWED[from] ?? [];
}

/**
 * Per-transition body rules. Mirrors the DB CHECK constraints + the
 * м4.22 design (reopen_reason ≥ 10 on terminal→open).
 *
 *   → resolved : resolution    ≥ 20 chars
 *   → closed   : close_reason  ≥ 5  chars
 *   → open (from resolved/closed) : reopen_reason ≥ 10 chars
 *   → open (from in_progress)     : no reason field required (rollback)
 *   open ↔ in_progress (non-reopen) : no reason field required
 *
 * Returns null when the body satisfies the rule, or a `{field, message}`
 * pair for the API to surface as 422.
 */
export function validateCaseTransitionBody(
  from: CaseStatus,
  to: CaseStatus,
  body: {
    resolution?: string | null;
    close_reason?: string | null;
    reopen_reason?: string | null;
  },
): { field: 'resolution' | 'close_reason' | 'reopen_reason'; message: string } | null {
  if (to === 'resolved') {
    const r = (body.resolution ?? '').trim();
    if (r.length < 20) {
      return { field: 'resolution', message: 'قرار الحل مطلوب (20 حرفًا على الأقل)' };
    }
  } else if (to === 'closed') {
    const r = (body.close_reason ?? '').trim();
    if (r.length < 5) {
      return { field: 'close_reason', message: 'سبب الإغلاق مطلوب (5 أحرف على الأقل)' };
    }
  } else if (to === 'open' && (from === 'resolved' || from === 'closed')) {
    const r = (body.reopen_reason ?? '').trim();
    if (r.length < 10) {
      return { field: 'reopen_reason', message: 'سبب إعادة الفتح مطلوب (10 أحرف على الأقل)' };
    }
  }
  return null;
}

/**
 * True when this transition is a reopen (terminal → open). The API
 * uses this to bump reopen_count + set is_reopened atomically with
 * the status UPDATE. The trigger (migration 010) keys off the same
 * (NEW.status, OLD.status) pair to read reopen_reason for the audit.
 */
export function isReopen(from: CaseStatus, to: CaseStatus): boolean {
  return to === 'open' && (from === 'resolved' || from === 'closed');
}
