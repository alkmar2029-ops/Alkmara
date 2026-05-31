-- AUTH-12: replace the fragile `listUsers({ perPage: 1000 })` email scan
-- (which silently misses duplicates once the auth directory exceeds one page)
-- with a direct, indexed existence check against auth.users.
--
-- Used by the public teacher/admin registration submission and the
-- admin-registration approval to avoid registering an email that already
-- belongs to a real account. SECURITY DEFINER so it can read auth.users;
-- granted to service_role only (the API uses the admin client).

CREATE OR REPLACE FUNCTION public.email_is_registered(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = lower(p_email)
  );
$$;

REVOKE ALL ON FUNCTION public.email_is_registered(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_is_registered(TEXT) TO service_role;
