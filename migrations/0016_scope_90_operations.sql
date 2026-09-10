-- Provider-independent operational depth for the 90% completion pass.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_audience integer NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0;
ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;

CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','skipped','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  execute_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  provider_message_id text,
  last_error text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,campaign_id,fan_id),
  UNIQUE(creator_id,idempotency_key),
  FOREIGN KEY(creator_id,campaign_id) REFERENCES campaigns(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS campaign_deliveries_queue_idx ON campaign_deliveries(status,execute_at,created_at) WHERE status IN ('queued','failed');

CREATE TABLE IF NOT EXISTS subscription_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  creator_subscription_id uuid NOT NULL,
  request_type text NOT NULL CHECK(request_type IN ('cancel','renew')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed','cancelled')),
  reason text,
  provider_reference text,
  last_error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,creator_subscription_id) REFERENCES creator_subscriptions(creator_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_change_pending_unique ON subscription_change_requests(creator_id,creator_subscription_id,request_type) WHERE status IN ('pending','processing');

CREATE TABLE IF NOT EXISTS referral_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  referral_id uuid,
  affiliate_id uuid,
  transaction_id uuid NOT NULL,
  beneficiary_fan_id uuid,
  basis_minor integer NOT NULL DEFAULT 0 CHECK(basis_minor >= 0),
  commission_minor integer NOT NULL DEFAULT 0 CHECK(commission_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'accrued' CHECK(status IN ('accrued','approved','payable','paid','reversed','void')),
  payout_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  paid_at timestamptz,
  reversed_at timestamptz,
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,transaction_id,referral_id,affiliate_id),
  FOREIGN KEY(creator_id,referral_id) REFERENCES referrals(creator_id,id) ON DELETE SET NULL,
  FOREIGN KEY(creator_id,affiliate_id) REFERENCES affiliates(creator_id,id) ON DELETE SET NULL,
  FOREIGN KEY(creator_id,transaction_id) REFERENCES transactions(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,beneficiary_fan_id) REFERENCES fans(creator_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS referral_commissions_status_idx ON referral_commissions(creator_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS content_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  post_id uuid NOT NULL,
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','released')),
  placed_by uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  released_at timestamptz,
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,post_id) REFERENCES content_posts(creator_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS content_holds_active_unique ON content_holds(creator_id,post_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS compliance_case_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  case_type text NOT NULL CHECK(case_type IN ('report','takedown','compliance','domain','billing','other')),
  case_id text NOT NULL,
  author_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  note text NOT NULL CHECK(char_length(note) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);
CREATE INDEX IF NOT EXISTS compliance_case_notes_case_idx ON compliance_case_notes(creator_id,case_type,case_id,created_at DESC);

CREATE TABLE IF NOT EXISTS live_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  question text NOT NULL CHECK(char_length(question) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS live_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  poll_id uuid NOT NULL,
  label text NOT NULL CHECK(char_length(label) BETWEEN 1 AND 200),
  position integer NOT NULL DEFAULT 0,
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,poll_id) REFERENCES live_polls(creator_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS live_poll_votes (
  creator_id uuid NOT NULL,
  poll_id uuid NOT NULL,
  option_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(creator_id,poll_id,fan_id),
  FOREIGN KEY(creator_id,poll_id) REFERENCES live_polls(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,option_id) REFERENCES live_poll_options(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS live_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  product_id uuid NOT NULL,
  headline text NOT NULL CHECK(char_length(headline) BETWEEN 1 AND 300),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pinned','ended')),
  pinned_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,product_id) REFERENCES products(creator_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS live_guest_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  guest_label text NOT NULL CHECK(char_length(guest_label) BETWEEN 1 AND 200),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked','expired')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS live_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  transaction_id uuid,
  gift_key text NOT NULL CHECK(char_length(gift_key) BETWEEN 1 AND 100),
  amount_minor integer NOT NULL CHECK(amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  message text CHECK(char_length(message) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,transaction_id) REFERENCES transactions(creator_id,id) ON DELETE SET NULL
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaign_deliveries','subscription_change_requests','referral_commissions','content_holds','compliance_case_notes','live_polls','live_poll_options','live_poll_votes','live_offers','live_guest_invites','live_gifts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_tenant') THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (creator_id=nullif(current_setting(''app.creator_id'',true),'''')::uuid OR app_is_platform_admin()) WITH CHECK (creator_id=nullif(current_setting(''app.creator_id'',true),'''')::uuid OR app_is_platform_admin())',t||'_tenant',t);
    END IF;
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO redlight_runtime',t);
  END LOOP;
END $$;

-- Failed earlier steps block later steps. Interrupted workers are reclaimable after ten minutes.
CREATE OR REPLACE FUNCTION claim_automation_step(p_worker_id text)
RETURNS TABLE(step_id uuid,creator_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE picked record;
BEGIN
  UPDATE automation_run_steps
     SET status='failed',last_error=coalesce(last_error,'Worker interrupted; retry scheduled.'),execute_at=now(),started_at=NULL
   WHERE status='running' AND started_at < now()-interval '10 minutes' AND attempts < 5;

  SELECT s.id,s.creator_id INTO picked
    FROM automation_run_steps s
   WHERE s.status IN ('queued','failed') AND s.execute_at<=now() AND s.attempts<5
     AND NOT EXISTS (
       SELECT 1 FROM automation_run_steps earlier
        WHERE earlier.creator_id=s.creator_id AND earlier.run_id=s.run_id
          AND earlier.position<s.position AND earlier.status NOT IN ('completed','cancelled')
     )
   ORDER BY s.execute_at,s.created_at
   FOR UPDATE SKIP LOCKED LIMIT 1;
  IF picked.id IS NULL THEN RETURN; END IF;
  UPDATE automation_run_steps SET status='running',attempts=attempts+1,started_at=now(),last_error=NULL WHERE id=picked.id;
  RETURN QUERY SELECT picked.id,picked.creator_id;
END $$;
REVOKE ALL ON FUNCTION claim_automation_step(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_automation_step(text) TO redlight_runtime;

CREATE OR REPLACE FUNCTION claim_campaign_delivery(p_worker_id text)
RETURNS TABLE(delivery_id uuid,creator_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE picked record;
BEGIN
  UPDATE campaign_deliveries d
     SET status='failed',last_error=coalesce(last_error,'Worker interrupted; retry scheduled.'),execute_at=now(),started_at=NULL,updated_at=now()
   WHERE d.status='sending' AND d.started_at<now()-interval '10 minutes' AND d.attempts<5;
  UPDATE campaign_deliveries d SET status='cancelled',completed_at=now(),updated_at=now()
    WHERE d.status IN ('queued','failed') AND EXISTS(SELECT 1 FROM campaigns c WHERE c.creator_id=d.creator_id AND c.id=d.campaign_id AND c.status IN ('paused','cancelled'));

  SELECT d.id,d.creator_id INTO picked FROM campaign_deliveries d
    JOIN campaigns c ON c.creator_id=d.creator_id AND c.id=d.campaign_id
   WHERE d.status IN ('queued','failed') AND d.execute_at<=now() AND d.attempts<5 AND c.status IN ('scheduled','sending')
   ORDER BY d.execute_at,d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1;
  IF picked.id IS NULL THEN RETURN; END IF;
  UPDATE campaign_deliveries SET status='sending',attempts=attempts+1,started_at=now(),last_error=NULL,updated_at=now() WHERE id=picked.id;
  RETURN QUERY SELECT picked.id,picked.creator_id;
END $$;
REVOKE ALL ON FUNCTION claim_campaign_delivery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_campaign_delivery(text) TO redlight_runtime;

-- Publishes due content only when there is no active platform hold.
CREATE OR REPLACE FUNCTION publish_due_content(p_limit integer DEFAULT 25)
RETURNS TABLE(post_id uuid,creator_id uuid)
LANGUAGE sql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  WITH picked AS (
    SELECT p.id FROM content_posts p
     WHERE p.status='scheduled' AND p.scheduled_for<=now()
       AND NOT EXISTS(SELECT 1 FROM content_holds h WHERE h.creator_id=p.creator_id AND h.post_id=p.id AND h.status='active')
     ORDER BY p.scheduled_for,p.created_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(coalesce(p_limit,25),100))
  ), changed AS (
    UPDATE content_posts p SET status='published',published_at=coalesce(p.published_at,now()),scheduled_for=NULL,updated_at=now()
      FROM picked WHERE p.id=picked.id RETURNING p.id,p.creator_id
  ) SELECT id,creator_id FROM changed;
$$;
REVOKE ALL ON FUNCTION publish_due_content(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_due_content(integer) TO redlight_runtime;

-- Rebuilds first-party daily metrics for a bounded date window. No fan-level data is returned.
CREATE OR REPLACE FUNCTION refresh_daily_creator_metrics(p_from date,p_to date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE affected integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>90 THEN RAISE EXCEPTION 'Invalid rollup range'; END IF;
  INSERT INTO daily_creator_metrics(creator_id,metric_date,page_views,unique_visitors,registrations,new_subscribers,cancellations,ppv_sales,tips_minor,gross_revenue_minor,net_revenue_minor)
  SELECT c.id,d::date,
    (SELECT count(*) FROM analytics_events a WHERE a.creator_id=c.id AND a.event_name='page_view' AND a.occurred_at>=d AND a.occurred_at<d+interval '1 day'),
    (SELECT count(DISTINCT coalesce(a.fan_id::text,a.anonymous_id,a.session_id)) FROM analytics_events a WHERE a.creator_id=c.id AND a.event_name='page_view' AND a.occurred_at>=d AND a.occurred_at<d+interval '1 day'),
    (SELECT count(*) FROM fans f WHERE f.creator_id=c.id AND f.created_at>=d AND f.created_at<d+interval '1 day'),
    (SELECT count(*) FROM creator_subscriptions s WHERE s.creator_id=c.id AND s.created_at>=d AND s.created_at<d+interval '1 day'),
    (SELECT count(*) FROM creator_subscriptions s WHERE s.creator_id=c.id AND s.cancelled_at>=d AND s.cancelled_at<d+interval '1 day'),
    (SELECT count(*) FROM purchases p JOIN products pr ON pr.creator_id=p.creator_id AND pr.id=p.product_id WHERE p.creator_id=c.id AND p.status='paid' AND pr.product_type='ppv' AND p.purchased_at>=d AND p.purchased_at<d+interval '1 day'),
    (SELECT coalesce(sum(t.amount_minor),0) FROM tips t WHERE t.creator_id=c.id AND t.created_at>=d AND t.created_at<d+interval '1 day'),
    (SELECT coalesce(sum(t.gross_minor),0) FROM transactions t WHERE t.creator_id=c.id AND t.status='settled' AND t.occurred_at>=d AND t.occurred_at<d+interval '1 day'),
    (SELECT coalesce(sum(t.creator_net_minor),0) FROM transactions t WHERE t.creator_id=c.id AND t.status='settled' AND t.occurred_at>=d AND t.occurred_at<d+interval '1 day')
  FROM creators c CROSS JOIN generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d
  WHERE c.deleted_at IS NULL
  ON CONFLICT(creator_id,metric_date) DO UPDATE SET page_views=excluded.page_views,unique_visitors=excluded.unique_visitors,registrations=excluded.registrations,new_subscribers=excluded.new_subscribers,cancellations=excluded.cancellations,ppv_sales=excluded.ppv_sales,tips_minor=excluded.tips_minor,gross_revenue_minor=excluded.gross_revenue_minor,net_revenue_minor=excluded.net_revenue_minor;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION refresh_daily_creator_metrics(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_daily_creator_metrics(date,date) TO redlight_runtime;
