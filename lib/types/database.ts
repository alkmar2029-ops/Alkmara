// === Union / Enum Types ===

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';
export type DeviceStatus = 'connected' | 'disconnected' | 'error' | 'syncing';
export type SchoolStage = 'elementary' | 'middle' | 'secondary';
export type NoteType = 'positive' | 'negative';
export type NoteCategory = 'academic' | 'behavior' | 'attendance' | 'participation' | 'general';
export type NoteAudience = 'admin' | 'teacher' | 'both';

// === Table Types ===

export interface Grade {
  id: number;
  name: string;
  stage: SchoolStage;
  sort_order: number;
}

export interface Section {
  id: number;
  grade_id: number;
  name: string;
  sort_order: number;
  device_id: number | null;
  // joined
  grade_name?: string;
  device_name?: string;
}

export interface Student {
  id: number;
  student_id: string;
  device_uid: number;
  first_name: string;
  last_name: string;
  father_name: string;
  email: string | null;
  phone: string | null;
  grade_id: number;
  section_id: number;
  is_fingerprint_enrolled: boolean;
  enrolled_at: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // joined
  grade_name?: string;
  section_name?: string;
}

export interface Device {
  id: number;
  name: string;
  ip_address: string;
  port: number;
  serial_number: string | null;
  model: string;
  location: string | null;
  status: DeviceStatus;
  section_id: number | null;
  last_seen_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // joined
  section_name?: string;
}

export interface AttendanceRecord {
  id: number;
  student_id: number;
  section_id: number;
  device_id: number | null;
  attendance_date: string;
  punch_time: string | null;
  status: AttendanceStatus;
  minutes_late: number;
  source: 'device' | 'manual' | 'sync';
  created_at: string;
  // joined
  first_name?: string;
  last_name?: string;
  student_code?: string;
  section_name?: string;
  grade_name?: string;
}

export interface SchoolSettings {
  id: number;
  school_name: string;
  principal_name: string | null;
  phone: string | null;
  stage: SchoolStage;
  academic_year: string;
  section_type: 'letters' | 'numbers';
  late_threshold: number;
  absent_threshold: number;
  /** School-wide work start time as 'HH:MM' (24h). Default '06:45'. */
  school_start_time: string | null;
  updated_at: string;
}

export type WhatsappStatus = 'connected' | 'disconnected' | 'connecting' | 'scanning' | 'error' | 'unknown';

export type PeriodAttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface Period {
  id: number;
  number: number;
  name: string;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface PeriodSession {
  id: number;
  section_id: number;
  period_id: number;
  attendance_date: string;
  recorded_by: string | null;
  recorded_at: string;
  absent_count: number;
  late_count: number;
  excused_count: number;
  total_count: number;
  notes: string | null;
}

export interface PeriodAbsence {
  id: number;
  session_id: number;
  student_id: number;
  status: 'absent' | 'late' | 'excused';
  notes: string | null;
  recorded_at: string;
}

export interface TeacherProfile {
  user_id: string;
  role: 'teacher';
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  // From auth.users
  email?: string;
}

export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

export interface TeacherRegistration {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  status: RegistrationStatus;
  notes: string | null;
  user_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  created_at: string;
}

export type MessageType = 'general' | 'student_referral' | 'student_notice' | 'reply';
export type MessageStatus = 'sent' | 'read' | 'archived' | 'closed';
export type MessageRecipientRole = 'admin' | 'teacher' | 'staff';

export interface InternalMessage {
  id: number;
  thread_id: string;
  type: MessageType;
  sender_id: string;
  recipient_id: string | null;
  recipient_role: MessageRecipientRole | null;
  student_id: number | null;
  subject: string | null;
  body: string;
  parent_message_id: number | null;
  status: MessageStatus;
  read_at: string | null;
  created_at: string;
  // Joined / derived
  sender_name?: string | null;
  recipient_name?: string | null;
  student_name?: string | null;
  student_code?: string | null;
  student_grade?: string | null;
  student_section?: string | null;
  is_mine?: boolean;
}

export interface NoteTemplate {
  id: number;
  text: string;
  type: NoteType;
  category: NoteCategory;
  audience: NoteAudience;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type NoteSource = 'template' | 'text' | 'voice';

export interface StudentNote {
  id: number;
  student_id: number;
  template_id: number | null;
  text: string;
  type: NoteType;
  category: NoteCategory | null;
  source: NoteSource;
  recorded_by: string | null;
  recorded_at: string;
  batch_id: string | null;
  whatsapp_sent_at: string | null;
  printed_at: string | null;
  created_at: string;
  // Joined for display
  student_name?: string;
  grade_name?: string;
  section_name?: string;
}

export interface WhatsappSettings {
  id: number;
  // api_key is intentionally returned as a masked string (e.g. "••••AB12") to the client
  api_key: string | null;
  api_key_set: boolean;
  session_id: string | null;
  phone_number: string | null;
  status: WhatsappStatus;
  last_checked_at: string | null;
  updated_at: string;
}

export interface DeviceSyncLog {
  id: number;
  device_id: number;
  sync_type: string;
  status: 'in_progress' | 'completed' | 'failed';
  records_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

// === Computed / Dashboard Types ===

export interface DashboardStats {
  school_name: string;
  stage: SchoolStage;
  totalStudents: number;
  totalDevices: number;
  onlineDevices: number;
  attendance: {
    present: number;
    late: number;
    absent: number;
    excused: number;
    total: number;
    rate: number;
  };
}
