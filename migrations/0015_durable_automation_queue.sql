CREATE TABLE IF NOT EXISTS automation_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  run_id uuid NOT NULL,
  action_id uuid,
  action_key text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL DEFAULT 0,
  execute_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,run_id) REFERENCES automation_runs(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,action_id) REFERENCES automation_actions(creator_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS automation_steps_queue_idx ON automation_run_steps(status,execute_at,created_at) WHERE status IN ('queued','failed');
ALTER TABLE automation_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_run_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_run_steps_tenant ON automation_run_steps USING (creator_id=nullif(current_setting('app.creator_id',true),'')::uuid OR app_is_platform_admin()) WITH CHECK (creator_id=nullif(current_setting('app.creator_id',true),'')::uuid OR app_is_platform_admin());
GRANT SELECT,INSERT,UPDATE,DELETE ON automation_run_steps TO redlight_runtime;

-- Narrow queue claim function. Returns one tenant/job at a time without exposing other tenant data to request code.
CREATE OR REPLACE FUNCTION claim_automation_step(p_worker_id text)
RETURNS TABLE(step_id uuid,creator_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE picked record;
BEGIN
  SELECT id,automation_run_steps.creator_id INTO picked FROM automation_run_steps
   WHERE status IN ('queued','failed') AND execute_at<=now() AND attempts<5
   ORDER BY execute_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF picked.id IS NULL THEN RETURN; END IF;
  UPDATE automation_run_steps SET status='running',attempts=attempts+1,started_at=now(),last_error=NULL WHERE id=picked.id;
  RETURN QUERY SELECT picked.id,picked.creator_id;
END $$;
REVOKE ALL ON FUNCTION claim_automation_step(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_automation_step(text) TO redlight_runtime;
