CREATE TABLE IF NOT EXISTS platform_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  creator_id uuid REFERENCES creators(id) ON DELETE SET NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'pending' CHECK(processing_status IN ('pending','processed','failed','ignored')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  UNIQUE(provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS platform_billing_events_creator_idx ON platform_billing_events(creator_id,received_at DESC);

CREATE TABLE IF NOT EXISTS admin_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 3 AND 1000),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);
CREATE INDEX IF NOT EXISTS admin_support_sessions_active_idx ON admin_support_sessions(actor_user_id,creator_id,expires_at) WHERE ended_at IS NULL;
ALTER TABLE admin_support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_support_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_support_sessions_platform_management ON admin_support_sessions USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
GRANT SELECT,INSERT,UPDATE ON admin_support_sessions TO redlight_runtime;
