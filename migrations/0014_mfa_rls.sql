ALTER TABLE mfa_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_credentials_user ON mfa_credentials;
CREATE POLICY mfa_credentials_user ON mfa_credentials USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid OR app_is_platform_admin()) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid OR app_is_platform_admin());
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_recovery_codes_user ON mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_user ON mfa_recovery_codes USING (user_id=nullif(current_setting('app.user_id',true),'')::uuid OR app_is_platform_admin()) WITH CHECK (user_id=nullif(current_setting('app.user_id',true),'')::uuid OR app_is_platform_admin());
GRANT SELECT,INSERT,UPDATE,DELETE ON mfa_credentials,mfa_recovery_codes TO redlight_runtime;
