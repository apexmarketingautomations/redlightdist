CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE creator_status AS ENUM ('draft','active','suspended','deleted'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE creator_role AS ENUM ('owner','admin','editor','analyst','support'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE billing_status AS ENUM ('trialing','active','grace','past_due','suspended','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE domain_status AS ENUM ('pending','verified','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, password_hash text NOT NULL,
  email_verified_at timestamptz, mfa_enabled boolean NOT NULL DEFAULT false,
  is_platform_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_users_email_unique ON platform_users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text, user_agent text, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password','mfa_recovery')),
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL,
  status creator_status NOT NULL DEFAULT 'draft', vertical text NOT NULL DEFAULT 'creator',
  launched_at timestamptz, suspended_at timestamptz, deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS creators_slug_unique ON creators(lower(slug)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS creator_users (
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  role creator_role NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (creator_id,user_id)
);

CREATE TABLE IF NOT EXISTS creator_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  hostname text NOT NULL, status domain_status NOT NULL DEFAULT 'pending', is_primary boolean NOT NULL DEFAULT false,
  verification_token_hash text, verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS creator_domains_hostname_unique ON creator_domains(lower(hostname));
CREATE UNIQUE INDEX IF NOT EXISTS creator_domains_primary_unique ON creator_domains(creator_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS creator_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  preset text NOT NULL CHECK (preset IN ('luxury','dark','minimal','glam','lifestyle')),
  tokens jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(creator_id,id)
);

CREATE TABLE IF NOT EXISTS creator_settings (
  creator_id uuid PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  theme_id uuid, bio text NOT NULL DEFAULT '', logo_asset_key text, profile_asset_key text, cover_asset_key text,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb, subscription_price_minor integer CHECK(subscription_price_minor IS NULL OR subscription_price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD', age_gate_enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(creator_id,theme_id) REFERENCES creator_themes(creator_id,id)
);

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE CHECK(code IN ('starter','pro','elite')),
  name text NOT NULL, monthly_price_minor integer NOT NULL CHECK(monthly_price_minor >= 0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS plan_features (
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE, feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true, limit_value bigint, PRIMARY KEY(plan_id,feature_key)
);
CREATE TABLE IF NOT EXISTS creator_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id), billing_status billing_status NOT NULL DEFAULT 'trialing',
  interval text NOT NULL DEFAULT 'monthly' CHECK(interval IN ('monthly','annual')),
  grace_ends_at timestamptz, current_period_ends_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(creator_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS creator_plans_current_unique ON creator_plans(creator_id) WHERE billing_status <> 'cancelled';
CREATE TABLE IF NOT EXISTS feature_overrides (
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE, feature_key text NOT NULL,
  enabled boolean, limit_value bigint, reason text NOT NULL, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(creator_id,feature_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid REFERENCES creators(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL, action text NOT NULL, target_type text NOT NULL,
  target_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, ip_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_creator_time_idx ON audit_logs(creator_id,created_at DESC);

CREATE TABLE IF NOT EXISTS compliance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  subject_type text NOT NULL, subject_id text NOT NULL, requirement_key text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','verified','rejected','expired','review_required')),
  provider_reference text, reviewed_by uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  expires_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);
CREATE INDEX IF NOT EXISTS compliance_records_subject_idx ON compliance_records(creator_id,subject_type,subject_id);

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  subject_type text NOT NULL, subject_id text NOT NULL, consent_key text NOT NULL, document_version text NOT NULL,
  granted boolean NOT NULL, evidence jsonb NOT NULL DEFAULT '{}'::jsonb, recorded_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  UNIQUE(creator_id,id)
);
CREATE INDEX IF NOT EXISTS consent_records_subject_idx ON consent_records(creator_id,subject_type,subject_id,recorded_at DESC);

INSERT INTO plans(code,name,monthly_price_minor) VALUES ('starter','Starter',14900),('pro','Pro',29900),('elite','Elite',59900)
ON CONFLICT(code) DO UPDATE SET name=excluded.name,monthly_price_minor=excluded.monthly_price_minor;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['creator_users','creator_domains','creator_themes','creator_settings','creator_plans','feature_overrides','compliance_records','consent_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_tenant') THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (creator_id = nullif(current_setting(''app.creator_id'',true),'''')::uuid) WITH CHECK (creator_id = nullif(current_setting(''app.creator_id'',true),'''')::uuid)',t||'_tenant',t);
    END IF;
  END LOOP;
END $$;
