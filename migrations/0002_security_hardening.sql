CREATE INDEX IF NOT EXISTS creator_users_user_idx ON creator_users(user_id, creator_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_token_active_idx ON sessions(token_hash) WHERE revoked_at IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'creator_users' AND policyname = 'creator_users_authenticated_self'
  ) THEN
    CREATE POLICY creator_users_authenticated_self ON creator_users
      FOR SELECT
      USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_logs' AND policyname = 'audit_logs_tenant'
  ) THEN
    CREATE POLICY audit_logs_tenant ON audit_logs
      USING (creator_id = nullif(current_setting('app.creator_id', true), '')::uuid)
      WITH CHECK (
        creator_id = nullif(current_setting('app.creator_id', true), '')::uuid
        AND actor_user_id = nullif(current_setting('app.user_id', true), '')::uuid
      );
  END IF;
END $$;
