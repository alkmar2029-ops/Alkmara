-- م4.1 — Enable pgcrypto extension.
--
-- Prerequisite for the encrypted counseling session content
-- (м4.4 counseling_sessions). pgp_sym_encrypt / pgp_sym_decrypt
-- live in this extension. Kept as its own migration so the
-- dependency is explicit + the file is trivially auditable.
--
-- Idempotent — `IF NOT EXISTS` makes re-running safe across
-- environments where pgcrypto may already be enabled (e.g.
-- Supabase often ships it on by default; production may differ).
--
-- Numbering: _002_ runs after _001_student_cases and BEFORE any
-- migration that calls pgp_sym_* (counseling_sessions = _004_).
-- The alphabetical sort guarantees this order on every fresh
-- restore.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

COMMENT ON EXTENSION pgcrypto IS
  'Required for encrypted counseling session content in Sprint 4.';
