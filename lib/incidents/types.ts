// Shared incident enums + Arabic labels for both API + UI.
//
// Values mirror the CHECK constraints on student_incidents (م3.1).
// Any change here MUST be reflected in 2026_06_03_001_student_incidents.sql
// or the DB will reject inserts/updates that the type system thinks
// are valid.
//
// `as const` arrays so z.enum(INCIDENT_TYPES) works at the API layer
// without a parallel type definition.

export const INCIDENT_TYPES = [
  'tardy',           // تأخير
  'absence',         // غياب غير مبرر
  'uniform',         // مخالفة زي
  'behavior',        // سلوك (شجار، إساءة)
  'academic',        // أكاديمي (غش، عدم تحضير)
  'property_damage', // إتلاف ممتلكات
  'other',           // أخرى
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  tardy: 'تأخير',
  absence: 'غياب غير مبرر',
  uniform: 'مخالفة زي',
  behavior: 'سلوك',
  academic: 'أكاديمي',
  property_damage: 'إتلاف ممتلكات',
  other: 'أخرى',
};

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
};

export const INCIDENT_STATUSES = [
  'submitted',
  'under_review',
  'dismissed',
  'actioned',
  'escalated',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  submitted: 'مُقدَّمة',
  under_review: 'قيد المراجعة',
  dismissed: 'مرفوضة',
  actioned: 'تم اتخاذ إجراء',
  escalated: 'صُعِّدت لحالة',
};
