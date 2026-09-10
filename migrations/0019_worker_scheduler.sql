-- Durable worker checkpoints prevent expensive periodic jobs from running on every queue poll.
CREATE TABLE IF NOT EXISTS platform_worker_checkpoints (
  job_key text PRIMARY KEY,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  locked_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platform_worker_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_worker_checkpoints FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_worker_checkpoints' AND policyname='platform_worker_checkpoints_admin') THEN
    CREATE POLICY platform_worker_checkpoints_admin ON platform_worker_checkpoints USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION claim_worker_checkpoint(p_job_key text,p_every_seconds integer,p_lease_seconds integer DEFAULT 300)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE claimed boolean := false;
BEGIN
  IF p_job_key IS NULL OR length(trim(p_job_key))=0 OR p_every_seconds<1 OR p_lease_seconds<30 THEN RETURN false; END IF;
  INSERT INTO platform_worker_checkpoints(job_key,last_started_at,locked_until,updated_at)
  VALUES(p_job_key,now(),now()+(p_lease_seconds::text||' seconds')::interval,now())
  ON CONFLICT(job_key) DO UPDATE SET
    last_started_at=now(),locked_until=now()+(p_lease_seconds::text||' seconds')::interval,last_error=NULL,updated_at=now()
  WHERE (platform_worker_checkpoints.locked_until IS NULL OR platform_worker_checkpoints.locked_until<now())
    AND (platform_worker_checkpoints.last_completed_at IS NULL OR platform_worker_checkpoints.last_completed_at<=now()-(p_every_seconds::text||' seconds')::interval)
  RETURNING true INTO claimed;
  RETURN coalesce(claimed,false);
END $$;

CREATE OR REPLACE FUNCTION complete_worker_checkpoint(p_job_key text,p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  UPDATE platform_worker_checkpoints SET
    last_completed_at=CASE WHEN p_error IS NULL THEN now() ELSE last_completed_at END,
    locked_until=NULL,last_error=left(p_error,1000),updated_at=now()
  WHERE job_key=p_job_key;
$$;

REVOKE ALL ON TABLE platform_worker_checkpoints FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_worker_checkpoint(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_worker_checkpoint(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_worker_checkpoint(text,integer,integer) TO redlight_runtime;
GRANT EXECUTE ON FUNCTION complete_worker_checkpoint(text,text) TO redlight_runtime;
