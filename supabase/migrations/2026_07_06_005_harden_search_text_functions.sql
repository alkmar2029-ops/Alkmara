-- DB-08: `students_update_search_text()` and `user_profiles_update_search_text()`
-- were the only trigger functions in the schema without `SET search_path` /
-- `SECURITY DEFINER`, and they called `normalize_search_text()` unqualified.
-- A poisoned `search_path` could in principle resolve that helper (or the
-- LOWER/TRANSLATE calls inside it) to a planted function. Re-create both to
-- match the hardened pattern every other trigger already uses: SECURITY DEFINER
-- + pinned search_path + schema-qualified helper.
--
-- `CREATE OR REPLACE` keeps the same function name/signature, so the existing
-- `students_search_text_trg` / `user_profiles_search_text_trg` triggers keep
-- working unchanged. Bodies are otherwise identical to 2026_05_04.

CREATE OR REPLACE FUNCTION students_update_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.search_text := public.normalize_search_text(
    COALESCE(NEW.first_name, '') || ' ' ||
    COALESCE(NEW.father_name, '') || ' ' ||
    COALESCE(NEW.last_name, '') || ' ' ||
    COALESCE(NEW.student_id, '') || ' ' ||
    COALESCE(NEW.phone, '')
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION user_profiles_update_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.search_text := public.normalize_search_text(
    COALESCE(NEW.full_name, '') || ' ' ||
    COALESCE(NEW.phone, '')
  );
  RETURN NEW;
END;
$$;
