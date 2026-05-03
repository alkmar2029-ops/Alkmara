-- Search infrastructure for the global Cmd+K search and the
-- students-page facet filters. Adds:
--   • pg_trgm extension for fuzzy matching (tolerates misspellings)
--   • normalize_search_text(s) — Arabic normalization helper:
--       أإآ → ا, ة → ه, ى → ي, drop diacritics + tatweel
--   • search_text column on students + user_profiles, kept up to
--     date by a BEFORE INSERT/UPDATE trigger
--   • GIN trigram indexes on search_text for sub-millisecond LIKE/%
--     queries even on tens of thousands of rows
--
-- The application layer applies the same normalize_search_text to
-- the user's query before comparing, so "احمد" matches "أحمد" and
-- "اخمد" (typo) ranks high via trigram similarity.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============== normalize_search_text ==============
-- Standard Arabic-text normalization. IMMUTABLE so it can appear in
-- index expressions and generated columns.
CREATE OR REPLACE FUNCTION normalize_search_text(s TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT LOWER(
    REGEXP_REPLACE(
      TRANSLATE(s, 'أإآةى', 'اااهي'),
      '[ً-ْٰـ]', '', 'g'
    )
  );
$$;

-- ============== students.search_text ==============
ALTER TABLE students ADD COLUMN IF NOT EXISTS search_text TEXT;

CREATE OR REPLACE FUNCTION students_update_search_text() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_text := normalize_search_text(
    COALESCE(NEW.first_name, '') || ' ' ||
    COALESCE(NEW.father_name, '') || ' ' ||
    COALESCE(NEW.last_name, '') || ' ' ||
    COALESCE(NEW.student_id, '') || ' ' ||
    COALESCE(NEW.phone, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_search_text_trg ON students;
CREATE TRIGGER students_search_text_trg
  BEFORE INSERT OR UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION students_update_search_text();

-- Backfill existing rows.
UPDATE students SET search_text = normalize_search_text(
  COALESCE(first_name, '') || ' ' ||
  COALESCE(father_name, '') || ' ' ||
  COALESCE(last_name, '') || ' ' ||
  COALESCE(student_id, '') || ' ' ||
  COALESCE(phone, '')
);

CREATE INDEX IF NOT EXISTS students_search_trgm_idx
  ON students USING GIN (search_text gin_trgm_ops);

-- ============== user_profiles.search_text ==============
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS search_text TEXT;

CREATE OR REPLACE FUNCTION user_profiles_update_search_text() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_text := normalize_search_text(
    COALESCE(NEW.full_name, '') || ' ' ||
    COALESCE(NEW.phone, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_profiles_search_text_trg ON user_profiles;
CREATE TRIGGER user_profiles_search_text_trg
  BEFORE INSERT OR UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION user_profiles_update_search_text();

UPDATE user_profiles SET search_text = normalize_search_text(
  COALESCE(full_name, '') || ' ' ||
  COALESCE(phone, '')
);

CREATE INDEX IF NOT EXISTS user_profiles_search_trgm_idx
  ON user_profiles USING GIN (search_text gin_trgm_ops);
