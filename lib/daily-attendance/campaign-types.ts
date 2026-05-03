// Shared types for the multi-phase daily-attendance campaign flow.

export type PhaseKey = 'absence' | 'escape_after_first' | 'mid_day_departure' | 'selective_skip';

export type CampaignStatus =
  | 'pending'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const PHASE_LABELS: Record<PhaseKey, string> = {
  absence:            '🔴 الغياب الكامل',
  escape_after_first: '🟠 هروب بعد التحضير',
  mid_day_departure:  '🔵 انصراف منتصف اليوم',
  selective_skip:     '🟡 تهرّب من حصص محددة',
};

export const PHASE_ORDER: Record<PhaseKey, number> = {
  absence:            1,
  escape_after_first: 2,
  mid_day_departure:  3,
  selective_skip:     4,
};

// What the API returns about each phase's state. Stored as JSONB on
// the campaign row so polling gets a single-query snapshot.
export interface PhaseState {
  total: number;
  sent: number;
  failed: number;
  status: 'pending' | 'running' | 'done' | 'skipped';
}

export type PhasesState = Record<PhaseKey, PhaseState>;

export interface CampaignSnapshot {
  id: number;
  attendance_date: string;
  status: CampaignStatus;
  total: number;
  sent: number;
  failed: number;
  current_phase: PhaseKey | null;
  phases_state: PhasesState;
  custom_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  paused_at: string | null;
  cancelled_at: string | null;
  last_recipient_name: string | null;
  last_sent_at: string | null;
  error_message: string | null;
}

// Recipient as sent to the API when creating a campaign.
export interface CampaignRecipient {
  student_id: number;
  student_name: string;
  phone: string | null;
  grade_name: string | null;
  section_name: string | null;
  // Only populated for escape-category recipients.
  absent_periods?: number[];
}

// One phase's full recipient list for the create payload.
export interface CreateCampaignPhase {
  key: PhaseKey;
  recipients: CampaignRecipient[];
}

export interface CreateCampaignInput {
  attendance_date: string;
  phases: CreateCampaignPhase[];
  custom_message?: string;
}

// Init helper — empty per-phase state.
export function emptyPhasesState(): PhasesState {
  return {
    absence:            { total: 0, sent: 0, failed: 0, status: 'pending' },
    escape_after_first: { total: 0, sent: 0, failed: 0, status: 'pending' },
    mid_day_departure:  { total: 0, sent: 0, failed: 0, status: 'pending' },
    selective_skip:     { total: 0, sent: 0, failed: 0, status: 'pending' },
  };
}
