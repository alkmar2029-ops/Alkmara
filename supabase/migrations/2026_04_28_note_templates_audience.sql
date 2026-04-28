-- Restrict who sees each note template:
--   admin   → only admin/staff portal users
--   teacher → only teacher portal users
--   both    → everyone (default)

ALTER TABLE note_templates
  ADD COLUMN IF NOT EXISTS audience VARCHAR(10) NOT NULL DEFAULT 'both'
  CHECK (audience IN ('admin', 'teacher', 'both'));

CREATE INDEX IF NOT EXISTS note_templates_audience_idx
  ON note_templates (audience, type, is_active, sort_order);
