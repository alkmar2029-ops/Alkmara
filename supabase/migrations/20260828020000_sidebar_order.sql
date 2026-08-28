-- One school-wide sidebar order. Only the super-admin API may mutate it;
-- all authenticated roles read it through the existing settings RLS policy.
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS sidebar_order JSONB;

ALTER TABLE public.school_settings
  DROP CONSTRAINT IF EXISTS school_settings_sidebar_order_object;

ALTER TABLE public.school_settings
  ADD CONSTRAINT school_settings_sidebar_order_object
  CHECK (sidebar_order IS NULL OR jsonb_typeof(sidebar_order) = 'object');

COMMENT ON COLUMN public.school_settings.sidebar_order IS
  'Global fixed dashboard sidebar order. Written only by the super-admin API; ordinary users cannot customize it.';

CREATE OR REPLACE FUNCTION public.guard_sidebar_order_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
BEGIN
  IF NEW.sidebar_order IS DISTINCT FROM OLD.sidebar_order
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_profiles
       WHERE user_id = auth.uid()
         AND role = 'super_admin'
     )
     AND COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'sidebar order may only be changed by super_admin'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS school_settings_guard_sidebar_order ON public.school_settings;
CREATE TRIGGER school_settings_guard_sidebar_order
BEFORE UPDATE OF sidebar_order ON public.school_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_sidebar_order_update();

REVOKE ALL ON FUNCTION public.guard_sidebar_order_update() FROM PUBLIC;
