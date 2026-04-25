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
-- Note: class_schedule_id is nullable because the K-12 model relies on
-- (section_id + attendance_date) as the unique key, while the original
-- university model used class_schedule_id. Both flows are supported.
CREATE TABLE attendance_records (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_schedule_id INTEGER REFERENCES class_schedules(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  punch_time TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'absent',
  minutes_late INTEGER DEFAULT 0,
  source VARCHAR(20) DEFAULT 'device',
  created_at TIMESTAMPTZ DEFAULT now()
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

-- Enable Realtime on attendance_records (idempotent — skip tables already added)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'attendance_records'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE attendance_records';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'devices'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE devices';
    END IF;
END $$;

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

-- ============================================
-- Role-Based Access Control (admin / staff / viewer)
-- ============================================

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'staff', 'viewer')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Auto-create a profile for new users (default role: viewer)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles (user_id, role)
    VALUES (NEW.id, COALESCE(NEW.raw_app_meta_data->>'role', 'viewer'))
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Helpers to read the current user's role from JWT or user_profiles.
-- Reads raw_app_meta_data.role first (set by admin via Supabase dashboard),
-- then falls back to user_profiles.role.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
    SELECT COALESCE(
        (auth.jwt() -> 'app_metadata' ->> 'role'),
        (SELECT role FROM public.user_profiles WHERE user_id = auth.uid()),
        'viewer'
    );
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$ SELECT current_user_role() = 'admin'; $$;

CREATE OR REPLACE FUNCTION is_staff_or_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$ SELECT current_user_role() IN ('admin', 'staff'); $$;

-- Enable RLS on all tables
ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sync_logs ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- RLS Policies (role-based: admin = full, staff = read+write, viewer = read)
-- =========================================================================

-- user_profiles: only admin manages, every user reads their own
DROP POLICY IF EXISTS "user_profiles read own" ON user_profiles;
CREATE POLICY "user_profiles read own" ON user_profiles
    FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS "user_profiles admin write" ON user_profiles;
CREATE POLICY "user_profiles admin write" ON user_profiles
    FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Drop legacy permissive policies if present
DROP POLICY IF EXISTS "Authenticated users can manage grades" ON grades;
DROP POLICY IF EXISTS "Authenticated users can manage sections" ON sections;
DROP POLICY IF EXISTS "Authenticated users can manage settings" ON school_settings;
DROP POLICY IF EXISTS "Authenticated users can manage students" ON students;
DROP POLICY IF EXISTS "Authenticated users can manage devices" ON devices;
DROP POLICY IF EXISTS "Authenticated users can manage attendance" ON attendance_records;
DROP POLICY IF EXISTS "Authenticated users can manage sync logs" ON device_sync_logs;

-- grades: read for any authenticated, write for admin only
DROP POLICY IF EXISTS "grades read" ON grades;
CREATE POLICY "grades read" ON grades FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "grades admin write" ON grades;
CREATE POLICY "grades admin write" ON grades FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "grades admin update" ON grades;
CREATE POLICY "grades admin update" ON grades FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "grades admin delete" ON grades;
CREATE POLICY "grades admin delete" ON grades FOR DELETE TO authenticated USING (is_admin());

-- sections: read for any authenticated, write for admin only
DROP POLICY IF EXISTS "sections read" ON sections;
CREATE POLICY "sections read" ON sections FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sections admin write" ON sections;
CREATE POLICY "sections admin write" ON sections FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "sections admin update" ON sections;
CREATE POLICY "sections admin update" ON sections FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "sections admin delete" ON sections;
CREATE POLICY "sections admin delete" ON sections FOR DELETE TO authenticated USING (is_admin());

-- school_settings: read for any authenticated, write for admin only
DROP POLICY IF EXISTS "settings read" ON school_settings;
CREATE POLICY "settings read" ON school_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "settings admin write" ON school_settings;
CREATE POLICY "settings admin write" ON school_settings FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "settings admin update" ON school_settings;
CREATE POLICY "settings admin update" ON school_settings FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "settings admin delete" ON school_settings;
CREATE POLICY "settings admin delete" ON school_settings FOR DELETE TO authenticated USING (is_admin());

-- students: read for any authenticated, write for staff/admin, delete for admin only
DROP POLICY IF EXISTS "students read" ON students;
CREATE POLICY "students read" ON students FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "students staff insert" ON students;
CREATE POLICY "students staff insert" ON students FOR INSERT TO authenticated WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "students staff update" ON students;
CREATE POLICY "students staff update" ON students FOR UPDATE TO authenticated USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "students admin delete" ON students;
CREATE POLICY "students admin delete" ON students FOR DELETE TO authenticated USING (is_admin());

-- devices: read for any authenticated, write/delete for admin only
DROP POLICY IF EXISTS "devices read" ON devices;
CREATE POLICY "devices read" ON devices FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "devices admin insert" ON devices;
CREATE POLICY "devices admin insert" ON devices FOR INSERT TO authenticated WITH CHECK (is_admin());
DROP POLICY IF EXISTS "devices admin update" ON devices;
CREATE POLICY "devices admin update" ON devices FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "devices admin delete" ON devices;
CREATE POLICY "devices admin delete" ON devices FOR DELETE TO authenticated USING (is_admin());

-- attendance_records: read for any authenticated, write for staff/admin
DROP POLICY IF EXISTS "attendance read" ON attendance_records;
CREATE POLICY "attendance read" ON attendance_records FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "attendance staff insert" ON attendance_records;
CREATE POLICY "attendance staff insert" ON attendance_records FOR INSERT TO authenticated WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "attendance staff update" ON attendance_records;
CREATE POLICY "attendance staff update" ON attendance_records FOR UPDATE TO authenticated USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "attendance admin delete" ON attendance_records;
CREATE POLICY "attendance admin delete" ON attendance_records FOR DELETE TO authenticated USING (is_admin());

-- device_sync_logs: read for any authenticated, write for staff/admin (server inserts)
DROP POLICY IF EXISTS "sync_logs read" ON device_sync_logs;
CREATE POLICY "sync_logs read" ON device_sync_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sync_logs staff insert" ON device_sync_logs;
CREATE POLICY "sync_logs staff insert" ON device_sync_logs FOR INSERT TO authenticated WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "sync_logs admin delete" ON device_sync_logs;
CREATE POLICY "sync_logs admin delete" ON device_sync_logs FOR DELETE TO authenticated USING (is_admin());

-- ============================================
-- Audit log for sensitive operations
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(50),
    target_id TEXT,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs admin read" ON audit_logs;
CREATE POLICY "audit_logs admin read" ON audit_logs FOR SELECT TO authenticated USING (is_admin());
DROP POLICY IF EXISTS "audit_logs staff insert" ON audit_logs;
CREATE POLICY "audit_logs staff insert" ON audit_logs FOR INSERT TO authenticated WITH CHECK (is_staff_or_admin());

-- Realtime for new tables (idempotent — skip tables already added)
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['grades', 'sections', 'school_settings'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public'
               AND tablename = v_table
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', v_table);
        END IF;
    END LOOP;
END $$;

-- Insert default settings
-- Add missing columns used by the settings page
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS principal_name VARCHAR(200);
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS section_type VARCHAR(20) DEFAULT 'letters' CHECK (section_type IN ('letters', 'numbers'));

INSERT INTO school_settings (id, school_name, stage, academic_year)
VALUES (1, 'المدرسة', 'elementary', '2025-2026')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- device_uid sequence (concurrency-safe)
-- ============================================
CREATE SEQUENCE IF NOT EXISTS students_device_uid_seq START WITH 1;

-- Bump the sequence past any pre-existing device_uid values so the next call
-- never collides with rows inserted before the sequence was introduced.
SELECT setval(
    'students_device_uid_seq',
    GREATEST((SELECT COALESCE(MAX(device_uid), 0) FROM students), 1),
    true
);

CREATE OR REPLACE FUNCTION next_device_uid()
RETURNS INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$ SELECT nextval('students_device_uid_seq')::INTEGER; $$;

CREATE OR REPLACE FUNCTION next_device_uids(n INTEGER)
RETURNS SETOF INTEGER
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
    SELECT nextval('students_device_uid_seq')::INTEGER
    FROM generate_series(1, GREATEST(n, 1));
$$;

GRANT EXECUTE ON FUNCTION next_device_uid() TO authenticated;
GRANT EXECUTE ON FUNCTION next_device_uids(INTEGER) TO authenticated;

-- ============================================
-- Atomic RPCs for multi-step operations
-- ============================================

-- Atomically replace the section list for a grade.
-- Drops sections that are no longer in the new list ONLY when they are unused
-- (no students, no attendance records). Upserts the rest with new sort_order.
CREATE OR REPLACE FUNCTION update_grade_sections(
    p_grade_id INTEGER,
    p_sections JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_existing RECORD;
    v_section JSONB;
    v_idx INTEGER := 1;
    v_kept_names TEXT[];
    v_skipped TEXT[] := ARRAY[]::TEXT[];
    v_in_use INTEGER;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'forbidden: admin role required';
    END IF;

    SELECT array_agg(value->>'name') INTO v_kept_names
    FROM jsonb_array_elements(p_sections);

    FOR v_existing IN
        SELECT id, name FROM sections WHERE grade_id = p_grade_id
    LOOP
        IF NOT (v_existing.name = ANY(v_kept_names)) THEN
            SELECT
                (SELECT COUNT(*) FROM students WHERE section_id = v_existing.id)
              + (SELECT COUNT(*) FROM attendance_records WHERE section_id = v_existing.id)
              INTO v_in_use;
            IF v_in_use = 0 THEN
                DELETE FROM sections WHERE id = v_existing.id;
            ELSE
                v_skipped := array_append(v_skipped, v_existing.name);
            END IF;
        END IF;
    END LOOP;

    FOR v_section IN SELECT * FROM jsonb_array_elements(p_sections) LOOP
        INSERT INTO sections (grade_id, name, sort_order)
        VALUES (p_grade_id, v_section->>'name', v_idx)
        ON CONFLICT (grade_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order;
        v_idx := v_idx + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'grade_id', p_grade_id,
        'count', v_idx - 1,
        'skipped', to_jsonb(v_skipped)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION update_grade_sections(INTEGER, JSONB) TO authenticated;

-- Atomically promote students to the next grade or graduate them.
-- Highest sort_order grade is graduated (soft delete via is_active=false).
-- All other grades are bumped by one sort_order.
CREATE OR REPLACE FUNCTION promote_students()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_stage TEXT;
    v_max_order INTEGER;
    v_grade RECORD;
    v_next_grade RECORD;
    v_section RECORD;
    v_match RECORD;
    v_promoted INTEGER := 0;
    v_deleted INTEGER := 0;
    v_count INTEGER;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'forbidden: admin role required';
    END IF;

    SELECT stage INTO v_stage FROM school_settings ORDER BY id LIMIT 1;
    IF v_stage IS NULL THEN
        RAISE EXCEPTION 'school stage not configured';
    END IF;

    SELECT MAX(sort_order) INTO v_max_order FROM grades WHERE stage = v_stage;
    IF v_max_order IS NULL THEN
        RAISE EXCEPTION 'no grades for stage %', v_stage;
    END IF;

    FOR v_grade IN
        SELECT id, name, sort_order FROM grades
        WHERE stage = v_stage ORDER BY sort_order DESC
    LOOP
        IF v_grade.sort_order = v_max_order THEN
            UPDATE students
              SET is_active = false, updated_at = now()
              WHERE grade_id = v_grade.id AND is_active = true;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_deleted := v_deleted + v_count;
        ELSE
            SELECT id, name INTO v_next_grade
              FROM grades
              WHERE stage = v_stage AND sort_order = v_grade.sort_order + 1
              LIMIT 1;
            IF v_next_grade.id IS NULL THEN CONTINUE; END IF;

            FOR v_section IN
                SELECT id, name FROM sections WHERE grade_id = v_grade.id
            LOOP
                SELECT id INTO v_match FROM sections
                  WHERE grade_id = v_next_grade.id AND name = v_section.name
                  LIMIT 1;

                UPDATE students SET
                    grade_id = v_next_grade.id,
                    section_id = v_match.id,
                    is_fingerprint_enrolled = false,
                    enrolled_at = NULL,
                    updated_at = now()
                  WHERE section_id = v_section.id AND is_active = true;
                GET DIAGNOSTICS v_count = ROW_COUNT;
                v_promoted := v_promoted + v_count;
            END LOOP;

            UPDATE students SET
                grade_id = v_next_grade.id,
                section_id = NULL,
                is_fingerprint_enrolled = false,
                enrolled_at = NULL,
                updated_at = now()
              WHERE grade_id = v_grade.id
                AND section_id IS NULL
                AND is_active = true;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            v_promoted := v_promoted + v_count;
        END IF;
    END LOOP;

    UPDATE devices
      SET status = 'disconnected', last_seen_at = NULL
      WHERE section_id IS NOT NULL;

    RETURN jsonb_build_object('promoted', v_promoted, 'deleted', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION promote_students() TO authenticated;

-- Allow staff/admin to update only the runtime fields of a device
-- (status, last_seen_at) without granting general UPDATE on the devices table.
-- Required by the connect/disconnect actions in the device action route.
CREATE OR REPLACE FUNCTION set_device_runtime_status(
    p_device_id INTEGER,
    p_status TEXT,
    p_touch_last_seen BOOLEAN DEFAULT FALSE
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT is_staff_or_admin() THEN
        RAISE EXCEPTION 'forbidden: staff or admin role required';
    END IF;

    IF p_status NOT IN ('connected', 'disconnected', 'error') THEN
        RAISE EXCEPTION 'invalid status: %', p_status;
    END IF;

    IF p_touch_last_seen THEN
        UPDATE devices
           SET status = p_status,
               last_seen_at = now(),
               updated_at = now()
         WHERE id = p_device_id;
    ELSE
        UPDATE devices
           SET status = p_status,
               updated_at = now()
         WHERE id = p_device_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_device_runtime_status(INTEGER, TEXT, BOOLEAN) TO authenticated;

-- ============================================
-- Migration block (idempotent — safe to re-run on existing databases)
-- ============================================

-- 1. Make class_schedule_id nullable (was NOT NULL in the original schema).
ALTER TABLE attendance_records ALTER COLUMN class_schedule_id DROP NOT NULL;

-- 2. Drop the legacy 3-column unique constraint that included class_schedule_id;
--    the K-12 model uses (student_id, attendance_date) instead.
DO $$
DECLARE
    v_name TEXT;
BEGIN
    SELECT conname INTO v_name
      FROM pg_constraint
     WHERE conrelid = 'attendance_records'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%class_schedule_id%attendance_date%';
    IF v_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE attendance_records DROP CONSTRAINT %I', v_name);
    END IF;
END $$;
