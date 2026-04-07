-- Semesters
CREATE TABLE semesters (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Departments
CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  code VARCHAR(20) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Students
CREATE TABLE students (
  id SERIAL PRIMARY KEY,
  student_id VARCHAR(50) NOT NULL UNIQUE,
  device_uid INTEGER NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(200) UNIQUE,
  phone VARCHAR(20),
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  is_fingerprint_enrolled BOOLEAN DEFAULT false,
  enrolled_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Devices
CREATE TABLE devices (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45) NOT NULL UNIQUE,
  port INTEGER DEFAULT 4370,
  serial_number VARCHAR(100),
  model VARCHAR(100) DEFAULT 'MB2000',
  location VARCHAR(200),
  status VARCHAR(20) DEFAULT 'disconnected',
  last_seen_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Classes
CREATE TABLE classes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  code VARCHAR(50) NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  semester_id INTEGER REFERENCES semesters(id) ON DELETE CASCADE,
  instructor_name VARCHAR(200),
  room VARCHAR(50),
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  late_threshold_min INTEGER DEFAULT 15,
  absent_threshold_min INTEGER DEFAULT 30,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(code, semester_id)
);

-- Class Enrollments
CREATE TABLE class_enrollments (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(class_id, student_id)
);

-- Class Schedules
CREATE TABLE class_schedules (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(class_id, day_of_week, start_time)
);

-- Attendance Records
CREATE TABLE attendance_records (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_schedule_id INTEGER NOT NULL REFERENCES class_schedules(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  punch_time TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'absent',
  minutes_late INTEGER DEFAULT 0,
  source VARCHAR(20) DEFAULT 'device',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, class_schedule_id, attendance_date)
);

CREATE INDEX idx_attendance_date ON attendance_records(attendance_date);
CREATE INDEX idx_attendance_schedule_date ON attendance_records(class_schedule_id, attendance_date);

-- Device Sync Logs
CREATE TABLE device_sync_logs (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sync_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Seed data
INSERT INTO semesters (name, start_date, end_date, is_active) VALUES
  ('الفصل الدراسي الأول 2025-2026', '2025-09-01', '2026-01-31', true);

INSERT INTO departments (name, code) VALUES
  ('علوم الحاسب', 'CS'),
  ('نظم المعلومات', 'IS'),
  ('هندسة البرمجيات', 'SE');

-- Enable Realtime on attendance_records
ALTER PUBLICATION supabase_realtime ADD TABLE attendance_records;
ALTER PUBLICATION supabase_realtime ADD TABLE devices;

-- ============================================
-- K-12 School Schema (used by the application)
-- ============================================

CREATE TABLE IF NOT EXISTS grades (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    stage VARCHAR(20) CHECK (stage IN ('elementary', 'middle', 'secondary')),
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sections (
    id SERIAL PRIMARY KEY,
    grade_id INTEGER REFERENCES grades(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    UNIQUE(grade_id, name)
);

CREATE TABLE IF NOT EXISTS school_settings (
    id SERIAL PRIMARY KEY,
    school_name VARCHAR(200),
    stage VARCHAR(20) CHECK (stage IN ('elementary', 'middle', 'secondary')),
    academic_year VARCHAR(20),
    late_threshold INTEGER DEFAULT 15,
    absent_threshold INTEGER DEFAULT 45,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns to students
ALTER TABLE students ADD COLUMN IF NOT EXISTS father_name VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS grade_id INTEGER REFERENCES grades(id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES sections(id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add missing column to devices
ALTER TABLE devices ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES sections(id);

-- Add missing column to attendance_records
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES sections(id);

-- Add unique constraint for student attendance per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_student_date
ON attendance_records(student_id, attendance_date);

-- Enable RLS on all tables
ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sync_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow authenticated users full access
CREATE POLICY "Authenticated users can manage grades" ON grades FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage sections" ON sections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage settings" ON school_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage students" ON students FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage devices" ON devices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage attendance" ON attendance_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage sync logs" ON device_sync_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE grades;
ALTER PUBLICATION supabase_realtime ADD TABLE sections;
ALTER PUBLICATION supabase_realtime ADD TABLE school_settings;

-- Insert default settings
INSERT INTO school_settings (id, school_name, stage, academic_year)
VALUES (1, 'المدرسة', 'elementary', '2025-2026')
ON CONFLICT (id) DO NOTHING;
