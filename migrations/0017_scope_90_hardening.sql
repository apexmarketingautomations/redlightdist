-- Follow-up hardening discovered during the 90% completion audit.

-- Pausing a campaign must preserve pending deliveries so resume can continue them.
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
    WHERE d.status IN ('queued','failed')
      AND EXISTS(SELECT 1 FROM campaigns c WHERE c.creator_id=d.creator_id AND c.id=d.campaign_id AND c.status='cancelled');

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

-- Ensure a poll vote cannot reference an option belonging to another poll.
CREATE UNIQUE INDEX IF NOT EXISTS live_poll_options_creator_poll_id_unique ON live_poll_options(creator_id,poll_id,id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='live_poll_votes_option_poll_fk') THEN
    ALTER TABLE live_poll_votes ADD CONSTRAINT live_poll_votes_option_poll_fk
      FOREIGN KEY(creator_id,poll_id,option_id) REFERENCES live_poll_options(creator_id,poll_id,id) ON DELETE CASCADE;
  END IF;
END $$;

-- Useful operational indexes for the new workflows.
CREATE INDEX IF NOT EXISTS subscription_change_requests_queue_idx ON subscription_change_requests(creator_id,status,requested_at);
CREATE INDEX IF NOT EXISTS content_holds_post_status_idx ON content_holds(creator_id,post_id,status);
CREATE INDEX IF NOT EXISTS live_polls_stream_status_idx ON live_polls(creator_id,stream_id,status);
CREATE INDEX IF NOT EXISTS live_offers_stream_status_idx ON live_offers(creator_id,stream_id,status);
