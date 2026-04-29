-- Restrict teacher notes to pre-built templates only.
--
-- When this flag is on, the teacher portal hides the free-text textarea
-- and the voice-to-text microphone — the teacher MUST pick a template
-- from the curated list (admin-managed via /dashboard/notes-templates).
-- This keeps the language consistent across messages, avoids inflammatory
-- ad-hoc wording, and gives the school a single audit trail of allowed
-- phrasings.
--
-- Default ON because that's the requested baseline. An admin toggle in
-- /dashboard/settings flips it back to free-text whenever a school
-- decides flexibility outweighs uniformity.
ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS teachers_notes_templates_only BOOLEAN NOT NULL DEFAULT TRUE;
