-- Add a school-wide work start time used as the lateness baseline.
-- Run once via Supabase Dashboard → SQL Editor → "New query".

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS school_start_time TIME DEFAULT '06:45';

UPDATE school_settings
SET school_start_time = COALESCE(school_start_time, '06:45')
WHERE id = 1;
