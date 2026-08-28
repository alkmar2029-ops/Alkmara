-- Allow schools to configure up to 30 sections per grade.
-- This replaces only the per-grade RPC; the batch RPC delegates to it.

CREATE OR REPLACE FUNCTION public.update_grade_sections(
  p_grade_id INTEGER,
  p_sections JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing RECORD;
  v_section JSONB;
  v_dependency RECORD;
  v_idx INTEGER := 1;
  v_requested_names TEXT[];
  v_skipped TEXT[] := ARRAY[]::TEXT[];
  v_dependency_count BIGINT;
  v_in_use BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.grades WHERE id = p_grade_id) THEN
    RAISE EXCEPTION 'grade not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_sections IS NULL
     OR jsonb_typeof(p_sections) <> 'array'
     OR jsonb_array_length(p_sections) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'sections must be an array containing 1 to 30 items'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_sections) AS item(value)
    WHERE jsonb_typeof(value) <> 'object'
       OR NULLIF(btrim(value->>'name'), '') IS NULL
       OR length(btrim(value->>'name')) > 50
  ) THEN
    RAISE EXCEPTION 'every section must have a name between 1 and 50 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(btrim(value->>'name') ORDER BY ordinality)
    INTO v_requested_names
  FROM jsonb_array_elements(p_sections) WITH ORDINALITY AS item(value, ordinality);

  IF cardinality(v_requested_names) <> (
    SELECT count(DISTINCT name)
    FROM unnest(v_requested_names) AS requested(name)
  ) THEN
    RAISE EXCEPTION 'section names must be unique within a grade'
      USING ERRCODE = '23505';
  END IF;

  FOR v_existing IN
    SELECT id, name
    FROM public.sections
    WHERE grade_id = p_grade_id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF NOT (v_existing.name = ANY(v_requested_names)) THEN
      v_in_use := 0;

      FOR v_dependency IN
        SELECT
          c.conrelid AS table_oid,
          a.attname AS column_name
        FROM pg_catalog.pg_constraint AS c
        JOIN pg_catalog.pg_attribute AS a
          ON a.attrelid = c.conrelid
         AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND c.confrelid = 'public.sections'::regclass
          AND array_length(c.conkey, 1) = 1
          AND array_length(c.confkey, 1) = 1
      LOOP
        EXECUTE format(
          'SELECT count(*) FROM %s WHERE %I = $1',
          v_dependency.table_oid::regclass,
          v_dependency.column_name
        )
        INTO v_dependency_count
        USING v_existing.id;

        IF v_dependency_count > 0 THEN
          v_in_use := v_in_use + v_dependency_count;
        END IF;
      END LOOP;

      IF v_in_use = 0 THEN
        DELETE FROM public.sections WHERE id = v_existing.id;
      ELSE
        v_skipped := array_append(v_skipped, v_existing.name);
      END IF;
    END IF;
  END LOOP;

  FOR v_section IN SELECT value FROM jsonb_array_elements(p_sections)
  LOOP
    INSERT INTO public.sections (grade_id, name, sort_order)
    VALUES (p_grade_id, btrim(v_section->>'name'), v_idx)
    ON CONFLICT (grade_id, name)
    DO UPDATE SET sort_order = EXCLUDED.sort_order;
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'grade_id', p_grade_id,
    'requested_count', cardinality(v_requested_names),
    'actual_count', (SELECT count(*) FROM public.sections WHERE grade_id = p_grade_id),
    'skipped', to_jsonb(v_skipped)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_grade_sections(INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_grade_sections(INTEGER, JSONB) TO authenticated;

COMMENT ON FUNCTION public.update_grade_sections(INTEGER, JSONB) IS
  'Atomically replaces one grade section list, allowing 1 to 30 sections. A removed section is retained when any FK-dependent row exists.';
