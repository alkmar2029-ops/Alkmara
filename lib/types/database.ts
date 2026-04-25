// === Union / Enum Types ===

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';
export type DeviceStatus = 'connected' | 'disconnected' | 'error' | 'syncing';
export type SchoolStage = 'elementary' | 'middle' | 'secondary';

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
