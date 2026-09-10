ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- Only authenticated platform-admin transactions may use the management policies.
CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.platform_admin', true) = 'true' AND EXISTS (
    SELECT 1 FROM platform_users WHERE id = nullif(current_setting('app.user_id', true), '')::uuid
      AND is_platform_admin AND disabled_at IS NULL
  )
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['creator_users','creator_domains','creator_themes','creator_settings','creator_plans','feature_overrides','compliance_records','consent_records','audit_logs'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin())',t||'_platform_management',t);
  END LOOP;
END $$;
