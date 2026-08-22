-- Make the students list filters and deterministic pagination scale to
-- tens of thousands of rows.
--
-- `has_blocked_pickup` is STORED so PostgREST can filter it before LIMIT /
-- OFFSET and calculate an exact count. The CASE deliberately tolerates old
-- or manually-written JSON where blocked_pickup is not an array.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS has_blocked_pickup BOOLEAN
  GENERATED ALWAYS AS (
    CASE
      WHEN jsonb_typeof(social_info -> 'blocked_pickup') = 'array'
        THEN jsonb_array_length(social_info -> 'blocked_pickup') > 0
      ELSE FALSE
    END
  ) STORED;

COMMENT ON COLUMN public.students.has_blocked_pickup IS
  'Derived from social_info.blocked_pickup. Queryable flag for exact, paginated student-list filtering.';

-- The unfiltered active-students list is ordered by these columns. Including
-- id makes the order unique and prevents rows moving between offset pages
-- when students share the same full name.
CREATE INDEX IF NOT EXISTS students_active_name_page_idx
  ON public.students (first_name, father_name NULLS LAST, last_name, id)
  WHERE is_active = TRUE;

-- Administrators frequently browse an entire grade before narrowing to a
-- section. Foreign-key columns are not indexed automatically.
CREATE INDEX IF NOT EXISTS students_active_grade_name_page_idx
  ON public.students (grade_id, first_name, father_name NULLS LAST, last_name, id)
  WHERE is_active = TRUE;

-- A blocked-pickup list is normally very small. This partial index contains
-- only those rows and already matches the API's display order.
CREATE INDEX IF NOT EXISTS students_active_blocked_pickup_page_idx
  ON public.students (first_name, father_name NULLS LAST, last_name, id)
  WHERE is_active = TRUE AND has_blocked_pickup = TRUE;

-- Section rosters are the highest-volume filtered call (teacher pages request
-- up to 500 rows). The FK itself does not create an index in PostgreSQL.
CREATE INDEX IF NOT EXISTS students_active_section_name_page_idx
  ON public.students (section_id, first_name, father_name NULLS LAST, last_name, id)
  WHERE is_active = TRUE;
