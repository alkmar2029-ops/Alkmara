// Pure plan-status state-machine helpers (م4.22 / plans).
//
// All functions are deterministic + side-effect-free + client-safe
// (no Next.js / server-only imports). Mirrors the case state-machine
// pattern from lib/cases/state-machine.ts.
//
// Lifecycle:
//
//     active ⇄ on_hold
//        │  ╲    ╱
//        │   ╲  ╱
//        ▼    ▼▼
//    completed  cancelled       (terminal — no exits)
//
// Edges (6):
//   active   → on_hold | completed | cancelled
//   on_hold  → active  | completed | cancelled
//   completed / cancelled → (none — terminal lock, no UI override)
//
// Hard rule: NO transitions out of completed/cancelled via the API.
// Manual SQL fix is the documented escape hatch for the rare
// correction case; the counselor surface does not expose it.
//
// No `reason` field is required on any plan transition (per м4.22
// design — plans are operational, not subject to the same audit
// expectations as case lifecycle changes).

export const PLAN_STATUSES = ['active', 'on_hold', 'completed', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

const ALLOWED: Record<PlanStatus, PlanStatus[]> = {
  active:    ['on_hold', 'completed', 'cancelled'],
  on_hold:   ['active', 'completed', 'cancelled'],
  completed: [],   // terminal
  cancelled: [],   // terminal
};

export function isPlanTransitionAllowed(from: PlanStatus, to: PlanStatus): boolean {
  if (from === to) return false;
  return ALLOWED[from]?.includes(to) ?? false;
}

/**
 * Statuses the caller may move TO from `from`. Empty for terminal
 * states — UI uses that to render no action buttons on
 * completed / cancelled plans.
 */
export function allowedNextPlanStatuses(from: PlanStatus): PlanStatus[] {
  return ALLOWED[from] ?? [];
}

/**
 * True when the target is a terminal status (completed/cancelled).
 * The API uses this to set the appropriate timestamp atomically
 * with the status UPDATE; the DB CHECK constraint
 * `plans_terminal_timestamps_exclusive` (м4.5) is the last line of
 * defense.
 */
export function isTerminal(status: PlanStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}
