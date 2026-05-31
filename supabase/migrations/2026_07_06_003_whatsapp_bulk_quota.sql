-- Durable daily quota for bulk WhatsApp recipient volume.
--
-- The short-window request limiter is intentionally in-process, but the
-- daily recipient cap protects real Wasender cost and must survive Vercel
-- multi-instance fanout and cold starts. This table stores one counter per
-- sender per school-local date. The API passes the Riyadh date explicitly.

CREATE TABLE IF NOT EXISTS whatsapp_bulk_usage (
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date       DATE NOT NULL,
  recipients_used  INTEGER NOT NULL DEFAULT 0 CHECK (recipients_used >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE whatsapp_bulk_usage ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON whatsapp_bulk_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE ON whatsapp_bulk_usage TO service_role;

DROP POLICY IF EXISTS "whatsapp_bulk_usage read own" ON whatsapp_bulk_usage;
CREATE POLICY "whatsapp_bulk_usage read own"
  ON whatsapp_bulk_usage FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

CREATE OR REPLACE FUNCTION reserve_whatsapp_bulk_quota(
  p_user_id UUID,
  p_usage_date DATE,
  p_recipient_count INTEGER,
  p_daily_limit INTEGER DEFAULT 1500
)
RETURNS TABLE (
  ok BOOLEAN,
  used_before INTEGER,
  used_after INTEGER,
  remaining INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_current INTEGER;
  v_after INTEGER;
BEGIN
  IF p_user_id IS NULL
     OR p_usage_date IS NULL
     OR p_recipient_count IS NULL
     OR p_recipient_count < 0
     OR p_daily_limit <= 0 THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0;
    RETURN;
  END IF;

  INSERT INTO whatsapp_bulk_usage (user_id, usage_date, recipients_used)
  VALUES (p_user_id, p_usage_date, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT recipients_used
    INTO v_current
    FROM whatsapp_bulk_usage
   WHERE user_id = p_user_id
     AND usage_date = p_usage_date
   FOR UPDATE;

  v_after := v_current + p_recipient_count;

  IF v_after > p_daily_limit THEN
    RETURN QUERY SELECT FALSE, v_current, v_current, GREATEST(0, p_daily_limit - v_current);
    RETURN;
  END IF;

  UPDATE whatsapp_bulk_usage
     SET recipients_used = v_after,
         updated_at = NOW()
   WHERE user_id = p_user_id
     AND usage_date = p_usage_date;

  RETURN QUERY SELECT TRUE, v_current, v_after, GREATEST(0, p_daily_limit - v_after);
END;
$$;

REVOKE ALL ON FUNCTION reserve_whatsapp_bulk_quota(UUID, DATE, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_whatsapp_bulk_quota(UUID, DATE, INTEGER, INTEGER) TO service_role;
