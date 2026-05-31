-- P1.5: production automation via Supabase Cron + pg_net.
--
-- Required one-time operator setup before these jobs can fire:
--
--   select vault.create_secret('https://YOUR-APP.example.com', 'app_base_url',
--                              'Public base URL for pg_cron worker calls');
--   select vault.create_secret('<same value as Vercel WORKER_SECRET>', 'worker_secret',
--                              'Worker endpoint shared secret');
--
-- The cron.job table stores this SQL text, not the secret values. Each run
-- reads the current values from vault.decrypted_secrets and sends
-- x-worker-secret through pg_net.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Idempotent reschedule.
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'zkteco-bulk-jobs-sweep',
  'zkteco-daily-campaigns-sweep',
  'zkteco-supervision-reminder',
  'zkteco-risk-scores-sweep'
);

SELECT cron.schedule(
  'zkteco-bulk-jobs-sweep',
  '* * * * *',
  $$
  WITH cfg AS (
    SELECT
      MAX(decrypted_secret) FILTER (WHERE name = 'app_base_url') AS app_base_url,
      MAX(decrypted_secret) FILTER (WHERE name = 'worker_secret') AS worker_secret
    FROM vault.decrypted_secrets
    WHERE name IN ('app_base_url', 'worker_secret')
  )
  SELECT net.http_post(
    url := app_base_url || '/api/whatsapp/bulk-jobs/sweep-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM cfg
  WHERE app_base_url IS NOT NULL
    AND worker_secret IS NOT NULL;
  $$
);

SELECT cron.schedule(
  'zkteco-daily-campaigns-sweep',
  '* * * * *',
  $$
  WITH cfg AS (
    SELECT
      MAX(decrypted_secret) FILTER (WHERE name = 'app_base_url') AS app_base_url,
      MAX(decrypted_secret) FILTER (WHERE name = 'worker_secret') AS worker_secret
    FROM vault.decrypted_secrets
    WHERE name IN ('app_base_url', 'worker_secret')
  )
  SELECT net.http_post(
    url := app_base_url || '/api/daily-attendance/campaigns/sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM cfg
  WHERE app_base_url IS NOT NULL
    AND worker_secret IS NOT NULL;
  $$
);

-- Safe every minute: /reminder/run enforces Riyadh 06:00-10:00, weekday,
-- WhatsApp toggle, and one-row-per-day idempotency.
SELECT cron.schedule(
  'zkteco-supervision-reminder',
  '* * * * *',
  $$
  WITH cfg AS (
    SELECT
      MAX(decrypted_secret) FILTER (WHERE name = 'app_base_url') AS app_base_url,
      MAX(decrypted_secret) FILTER (WHERE name = 'worker_secret') AS worker_secret
    FROM vault.decrypted_secrets
    WHERE name IN ('app_base_url', 'worker_secret')
  )
  SELECT net.http_post(
    url := app_base_url || '/api/supervision/reminder/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM cfg
  WHERE app_base_url IS NOT NULL
    AND worker_secret IS NOT NULL;
  $$
);

-- Daily 05:15 Asia/Riyadh (02:15 UTC). The endpoint still only processes
-- stale rows, so repeated manual calls are bounded by pending work.
SELECT cron.schedule(
  'zkteco-risk-scores-sweep',
  '15 2 * * *',
  $$
  WITH cfg AS (
    SELECT
      MAX(decrypted_secret) FILTER (WHERE name = 'app_base_url') AS app_base_url,
      MAX(decrypted_secret) FILTER (WHERE name = 'worker_secret') AS worker_secret
    FROM vault.decrypted_secrets
    WHERE name IN ('app_base_url', 'worker_secret')
  )
  SELECT net.http_post(
    url := app_base_url || '/api/admin/risk-scores/sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', worker_secret
    ),
    body := '{"limit":50}'::jsonb,
    timeout_milliseconds := 5000
  )
  FROM cfg
  WHERE app_base_url IS NOT NULL
    AND worker_secret IS NOT NULL;
  $$
);
