CREATE TABLE IF NOT EXISTS auth_rate_limits (
  creator_id uuid REFERENCES creators(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(creator_id,scope,key_hash)
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_cleanup_idx ON auth_rate_limits(updated_at);

CREATE TABLE IF NOT EXISTS favorites (
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  post_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(creator_id,fan_id,post_id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,post_id) REFERENCES content_posts(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fan_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  consent_key text NOT NULL,
  document_version text NOT NULL,
  granted boolean NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fan_consents_fan_idx ON fan_consents(creator_id,fan_id,consent_key,recorded_at DESC);

CREATE TABLE IF NOT EXISTS platform_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES creators(id) ON DELETE SET NULL,
  severity text NOT NULL CHECK(severity IN ('info','warning','critical')),
  alert_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS platform_alerts_status_idx ON platform_alerts(status,severity,created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['auth_rate_limits','favorites','fan_consents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_tenant') THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (creator_id = nullif(current_setting(''app.creator_id'',true),'''')::uuid OR app_is_platform_admin()) WITH CHECK (creator_id = nullif(current_setting(''app.creator_id'',true),'''')::uuid OR app_is_platform_admin())',t||'_tenant',t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE platform_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_alerts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_alerts' AND policyname='platform_alerts_admin') THEN
    CREATE POLICY platform_alerts_admin ON platform_alerts USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
  END IF;
END $$;

-- Existing creators pre-dating the onboarding wizard receive a Starter trial so centralized entitlements are deterministic.
INSERT INTO creator_plans(creator_id,plan_id,billing_status,interval)
SELECT c.id,p.id,'trialing','monthly'
  FROM creators c CROSS JOIN plans p
 WHERE p.code='starter' AND c.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM creator_plans cp WHERE cp.creator_id=c.id AND cp.billing_status<>'cancelled')
ON CONFLICT DO NOTHING;

-- Seed standard CRM segments for creators that already exist. New creators receive them from onboarding actions.
INSERT INTO segments(creator_id,name,rules,is_system)
SELECT c.id,s.name,s.rules::jsonb,true
FROM creators c CROSS JOIN (VALUES
 ('New subscribers','{"subscriptionStatus":"active","subscriptionAgeDays":{"lte":30}}'),
 ('VIP fans','{"lifetimeSpendMinor":{"gte":50000}}'),
 ('High spenders','{"lifetimeSpendMinor":{"gte":25000}}'),
 ('Expired subscribers','{"subscriptionStatus":"expired"}'),
 ('Cancelled subscribers','{"subscriptionStatus":"cancelled"}'),
 ('Inactive fans','{"daysSinceLastLogin":{"gte":30}}'),
 ('PPV buyers','{"ppvPurchases":{"gte":1}}'),
 ('Non-PPV buyers','{"ppvPurchases":0}'),
 ('Trial users','{"subscriptionStatus":"trialing"}'),
 ('At-risk subscribers','{"riskFlag":true}')
) AS s(name,rules)
WHERE c.deleted_at IS NULL
ON CONFLICT(creator_id,name) DO NOTHING;

GRANT SELECT,INSERT,UPDATE,DELETE ON auth_rate_limits,favorites,fan_consents TO redlight_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON platform_alerts TO redlight_runtime;
