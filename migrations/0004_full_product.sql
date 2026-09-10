-- Full product schema. Tenant-owned rows are creator-scoped and protected with forced RLS.

CREATE TABLE IF NOT EXISTS creator_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  email text NOT NULL,
  role creator_role NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);
CREATE INDEX IF NOT EXISTS creator_invites_creator_email_idx ON creator_invites(creator_id,lower(email));

CREATE TABLE IF NOT EXISTS creator_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  note text NOT NULL CHECK(char_length(note) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  creator_id uuid PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 1 CHECK(current_step BETWEEN 1 AND 10),
  completed_steps integer[] NOT NULL DEFAULT '{}',
  launched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_customer_id text,
  provider_subscription_id text,
  plan_id uuid NOT NULL REFERENCES plans(id),
  billing_interval text NOT NULL CHECK(billing_interval IN ('monthly','annual')),
  status text NOT NULL CHECK(status IN ('trialing','active','past_due','grace','suspended','cancelled')),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(provider,provider_subscription_id)
);
CREATE INDEX IF NOT EXISTS platform_billing_creator_status_idx ON platform_billing_subscriptions(creator_id,status);

CREATE TABLE IF NOT EXISTS payment_provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  provider text NOT NULL,
  merchant_reference text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','restricted','disabled')),
  is_default boolean NOT NULL DEFAULT false,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  encrypted_config_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,provider,merchant_reference)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_default_idx ON payment_provider_accounts(creator_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS fans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  disabled_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fans_creator_email_unique ON fans(creator_id,lower(email));
CREATE INDEX IF NOT EXISTS fans_creator_created_idx ON fans(creator_id,created_at DESC);

CREATE TABLE IF NOT EXISTS fan_profiles (
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  display_name text,
  phone text,
  acquisition_source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referral_source text,
  marketing_consent boolean NOT NULL DEFAULT false,
  email_consent boolean NOT NULL DEFAULT false,
  sms_consent boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(creator_id,fan_id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fan_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fan_sessions_active_idx ON fan_sessions(creator_id,fan_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS fan_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('verify_email','reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS membership_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  monthly_price_minor integer NOT NULL CHECK(monthly_price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,slug)
);

CREATE TABLE IF NOT EXISTS creator_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  membership_tier_id uuid NOT NULL,
  payment_provider_account_id uuid,
  provider_subscription_id text,
  status text NOT NULL CHECK(status IN ('trialing','active','past_due','cancelled','expired','refunded')),
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,membership_tier_id) REFERENCES membership_tiers(creator_id,id),
  FOREIGN KEY(creator_id,payment_provider_account_id) REFERENCES payment_provider_accounts(creator_id,id)
);
CREATE INDEX IF NOT EXISTS creator_subscriptions_fan_idx ON creator_subscriptions(creator_id,fan_id,status);
CREATE INDEX IF NOT EXISTS creator_subscriptions_status_idx ON creator_subscriptions(creator_id,status,current_period_ends_at);

CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  owner_fan_id uuid,
  storage_provider text NOT NULL,
  object_key text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('image','video','audio','document','thumbnail')),
  content_type text NOT NULL,
  original_filename text,
  byte_size bigint NOT NULL CHECK(byte_size >= 0),
  width integer,
  height integer,
  duration_ms bigint,
  checksum_sha256 text,
  visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','quarantined','deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,object_key),
  FOREIGN KEY(creator_id,owner_fan_id) REFERENCES fans(creator_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS media_assets_creator_kind_idx ON media_assets(creator_id,kind,created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS content_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  title text,
  body text NOT NULL DEFAULT '',
  post_type text NOT NULL CHECK(post_type IN ('text','image','video','gallery','mixed','livestream_replay')),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','published','archived')),
  access_type text NOT NULL DEFAULT 'public' CHECK(access_type IN ('public','subscriber','membership','ppv')),
  ppv_price_minor integer CHECK(ppv_price_minor IS NULL OR ppv_price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  published_at timestamptz,
  scheduled_for timestamptz,
  archived_at timestamptz,
  created_by uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);
CREATE INDEX IF NOT EXISTS content_posts_feed_idx ON content_posts(creator_id,status,published_at DESC);

CREATE TABLE IF NOT EXISTS post_media (
  creator_id uuid NOT NULL,
  post_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY(creator_id,post_id,media_asset_id),
  FOREIGN KEY(creator_id,post_id) REFERENCES content_posts(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,media_asset_id) REFERENCES media_assets(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_access_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  post_id uuid NOT NULL,
  rule_type text NOT NULL CHECK(rule_type IN ('public','subscriber','membership','purchase')),
  membership_tier_id uuid,
  product_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,post_id) REFERENCES content_posts(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,membership_tier_id) REFERENCES membership_tiers(creator_id,id)
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  product_type text NOT NULL CHECK(product_type IN ('ppv','bundle','livestream','replay','digital')),
  price_minor integer NOT NULL CHECK(price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);

ALTER TABLE content_access_rules
  ADD CONSTRAINT content_access_rules_product_fk
  FOREIGN KEY(creator_id,product_id) REFERENCES products(creator_id,id);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  product_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','paid','failed','refunded','chargeback')),
  gross_minor integer NOT NULL CHECK(gross_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  purchased_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id),
  FOREIGN KEY(creator_id,product_id) REFERENCES products(creator_id,id)
);
CREATE INDEX IF NOT EXISTS purchases_fan_idx ON purchases(creator_id,fan_id,created_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  fan_id uuid,
  purchase_id uuid,
  creator_subscription_id uuid,
  payment_provider_account_id uuid,
  provider_transaction_id text,
  kind text NOT NULL CHECK(kind IN ('subscription','purchase','tip','refund','chargeback','adjustment')),
  status text NOT NULL CHECK(status IN ('pending','settled','failed','refunded','chargeback')),
  gross_minor integer NOT NULL DEFAULT 0,
  processor_fee_minor integer NOT NULL DEFAULT 0,
  refund_minor integer NOT NULL DEFAULT 0,
  chargeback_minor integer NOT NULL DEFAULT 0,
  platform_fee_minor integer NOT NULL DEFAULT 0,
  creator_net_minor integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id),
  FOREIGN KEY(creator_id,purchase_id) REFERENCES purchases(creator_id,id),
  FOREIGN KEY(creator_id,creator_subscription_id) REFERENCES creator_subscriptions(creator_id,id),
  FOREIGN KEY(creator_id,payment_provider_account_id) REFERENCES payment_provider_accounts(creator_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_provider_idempotency_idx ON transactions(payment_provider_account_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_provider_tx_idx ON transactions(payment_provider_account_id,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_creator_time_idx ON transactions(creator_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  transaction_id uuid,
  live_stream_id uuid,
  amount_minor integer NOT NULL CHECK(amount_minor > 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  message text CHECK(char_length(message) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id),
  FOREIGN KEY(creator_id,transaction_id) REFERENCES transactions(creator_id,id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  code text NOT NULL,
  discount_type text NOT NULL CHECK(discount_type IN ('percent','fixed','trial_days')),
  discount_value integer NOT NULL CHECK(discount_value >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer CHECK(max_redemptions IS NULL OR max_redemptions > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_creator_code_idx ON coupons(creator_id,lower(code));

CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  referrer_fan_id uuid,
  referred_fan_id uuid,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','qualified','rewarded','void')),
  reward_minor integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,referrer_fan_id) REFERENCES fans(creator_id,id),
  FOREIGN KEY(creator_id,referred_fan_id) REFERENCES fans(creator_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS referrals_creator_code_idx ON referrals(creator_id,code);

CREATE TABLE IF NOT EXISTS affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  code text NOT NULL,
  commission_bps integer NOT NULL DEFAULT 0 CHECK(commission_bps BETWEEN 0 AND 10000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,code)
);

CREATE TABLE IF NOT EXISTS crm_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,name)
);

CREATE TABLE IF NOT EXISTS fan_tags (
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(creator_id,fan_id,tag_id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,tag_id) REFERENCES crm_tags(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fan_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  author_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  note text NOT NULL CHECK(char_length(note) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name text NOT NULL,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,name)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL CHECK(channel IN ('email','sms','in_app')),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','sending','sent','paused','cancelled')),
  segment_id uuid,
  subject text,
  body text NOT NULL DEFAULT '',
  scheduled_for timestamptz,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,segment_id) REFERENCES segments(creator_id,id)
);

CREATE TABLE IF NOT EXISTS automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id)
);

CREATE TABLE IF NOT EXISTS automation_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  automation_id uuid NOT NULL,
  event_key text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,automation_id) REFERENCES automations(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  automation_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  field_key text NOT NULL,
  operator text NOT NULL,
  comparison_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,automation_id) REFERENCES automations(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  automation_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  action_key text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  delay_seconds integer NOT NULL DEFAULT 0 CHECK(delay_seconds >= 0),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,automation_id) REFERENCES automations(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  automation_id uuid NOT NULL,
  fan_id uuid,
  event_key text NOT NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,automation_id) REFERENCES automations(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  fan_id uuid,
  anonymous_id text,
  session_id text,
  event_name text NOT NULL,
  path text,
  content_id uuid,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referral_source text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS analytics_events_creator_event_time_idx ON analytics_events(creator_id,event_name,occurred_at DESC);

CREATE TABLE IF NOT EXISTS daily_creator_metrics (
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  page_views bigint NOT NULL DEFAULT 0,
  unique_visitors bigint NOT NULL DEFAULT 0,
  registrations bigint NOT NULL DEFAULT 0,
  new_subscribers bigint NOT NULL DEFAULT 0,
  cancellations bigint NOT NULL DEFAULT 0,
  ppv_sales bigint NOT NULL DEFAULT 0,
  tips_minor bigint NOT NULL DEFAULT 0,
  gross_revenue_minor bigint NOT NULL DEFAULT 0,
  net_revenue_minor bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(creator_id,metric_date)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  fan_id uuid,
  user_id uuid REFERENCES platform_users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK(channel IN ('email','sms','push','in_app')),
  template_key text,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','cancelled')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  reporter_fan_id uuid,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  reason_key text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','rejected','escalated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,reporter_fan_id) REFERENCES fans(creator_id,id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS takedown_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  requester_name text NOT NULL,
  requester_email text NOT NULL,
  content_reference text NOT NULL,
  basis text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','removed','rejected','restored')),
  legal_hold boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(creator_id,id)
);

CREATE TABLE IF NOT EXISTS blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  fan_id uuid,
  identifier_hash text,
  reason text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS banned_content_hashes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES creators(id) ON DELETE CASCADE,
  hash_type text NOT NULL,
  hash_value text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(hash_type,hash_value)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid REFERENCES creators(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'pending' CHECK(processing_status IN ('pending','processing','processed','failed','ignored')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider,provider_event_id)
);

CREATE TABLE IF NOT EXISTS live_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_stream_id text,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  thumbnail_asset_id uuid,
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('draft','scheduled','live','ended','cancelled','failed')),
  access_type text NOT NULL DEFAULT 'subscriber' CHECK(access_type IN ('public','subscriber','membership','ppv')),
  membership_tier_id uuid,
  ppv_price_minor integer CHECK(ppv_price_minor IS NULL OR ppv_price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  chat_enabled boolean NOT NULL DEFAULT true,
  scheduled_for timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  replay_post_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  UNIQUE(provider,provider_stream_id),
  FOREIGN KEY(creator_id,thumbnail_asset_id) REFERENCES media_assets(creator_id,id),
  FOREIGN KEY(creator_id,membership_tier_id) REFERENCES membership_tiers(creator_id,id),
  FOREIGN KEY(creator_id,replay_post_id) REFERENCES content_posts(creator_id,id)
);
CREATE INDEX IF NOT EXISTS live_streams_creator_status_idx ON live_streams(creator_id,status,scheduled_for);

ALTER TABLE tips
  ADD CONSTRAINT tips_live_stream_fk
  FOREIGN KEY(creator_id,live_stream_id) REFERENCES live_streams(creator_id,id);

CREATE TABLE IF NOT EXISTS live_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  fan_id uuid NOT NULL,
  purchase_id uuid,
  access_source text NOT NULL CHECK(access_source IN ('public','subscription','membership','purchase','gift','admin')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(creator_id,id),
  UNIQUE(creator_id,stream_id,fan_id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,purchase_id) REFERENCES purchases(creator_id,id)
);

CREATE TABLE IF NOT EXISTS live_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  fan_id uuid,
  participant_key text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  role text NOT NULL DEFAULT 'viewer' CHECK(role IN ('viewer','guest','cohost','moderator')),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS live_participants_stream_idx ON live_participants(creator_id,stream_id,joined_at);

CREATE TABLE IF NOT EXISTS live_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  fan_id uuid,
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS live_chat_stream_time_idx ON live_chat_messages(creator_id,stream_id,created_at);

CREATE TABLE IF NOT EXISTS live_moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  actor_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
  fan_id uuid,
  action text NOT NULL CHECK(action IN ('mute','unmute','block','unblock','delete_message','end_stream')),
  reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,fan_id) REFERENCES fans(creator_id,id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS live_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  provider_recording_id text,
  media_asset_id uuid,
  status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','ready','failed','deleted')),
  duration_ms bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE,
  FOREIGN KEY(creator_id,media_asset_id) REFERENCES media_assets(creator_id,id)
);

CREATE TABLE IF NOT EXISTS live_analytics_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid NOT NULL,
  concurrent_viewers integer NOT NULL DEFAULT 0 CHECK(concurrent_viewers >= 0),
  unique_viewers bigint NOT NULL DEFAULT 0 CHECK(unique_viewers >= 0),
  gross_revenue_minor bigint NOT NULL DEFAULT 0,
  sampled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS live_analytics_stream_time_idx ON live_analytics_samples(creator_id,stream_id,sampled_at DESC);

CREATE TABLE IF NOT EXISTS live_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  stream_id uuid,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_verified boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider,provider_event_id),
  FOREIGN KEY(creator_id,stream_id) REFERENCES live_streams(creator_id,id) ON DELETE CASCADE
);

-- Seed centralized plan feature entitlements. Limits are bytes/counts depending on key.
INSERT INTO plan_features(plan_id,feature_key,enabled,limit_value)
SELECT id,feature_key,enabled,limit_value FROM plans CROSS JOIN LATERAL (
  VALUES
    ('posts',true,NULL::bigint),('subscriptions',true,NULL),('customDomains',true,1),
    ('membershipTiers',true,1),('media',true,NULL),('basicAnalytics',true,NULL),
    ('ppv',code <> 'starter',NULL),('tips',code <> 'starter',NULL),('crm',code <> 'starter',NULL),
    ('discounts',code <> 'starter',NULL),('trials',code <> 'starter',NULL),('advancedAnalytics',code <> 'starter',NULL),
    ('referrals',code <> 'starter',NULL),('emailAutomation',code <> 'starter',NULL),
    ('live',code <> 'starter',NULL),('liveChat',code <> 'starter',NULL),('liveReplay',code <> 'starter',NULL),
    ('automation',code = 'elite',NULL),('sms',code = 'elite',NULL),('advancedAffiliates',code = 'elite',NULL),
    ('livePpv',code = 'elite',NULL),('livePrivateTiers',code = 'elite',NULL),('liveAdvancedModeration',code = 'elite',NULL),
    ('liveGifting',code = 'elite',NULL),('liveOffers',code = 'elite',NULL),('livePolls',code = 'elite',NULL),
    ('liveGuests',code = 'elite',NULL),('liveAdvancedAnalytics',code = 'elite',NULL),('liveAutomation',code = 'elite',NULL),
    ('maxStorageBytes',true,CASE code WHEN 'starter' THEN 53687091200::bigint WHEN 'pro' THEN 214748364800::bigint ELSE 536870912000::bigint END),
    ('maxVideoBytes',true,CASE code WHEN 'starter' THEN 1073741824::bigint WHEN 'pro' THEN 5368709120::bigint ELSE 10737418240::bigint END),
    ('maxAdmins',true,CASE code WHEN 'starter' THEN 2::bigint WHEN 'pro' THEN 5::bigint ELSE 20::bigint END)
) AS f(feature_key,enabled,limit_value)
ON CONFLICT(plan_id,feature_key) DO UPDATE SET enabled=excluded.enabled,limit_value=excluded.limit_value;

-- Helpful system CRM segments. These rows are creator-specific and are populated during onboarding.

-- Apply forced row level security to all new tenant-owned tables.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'creator_invites','creator_admin_notes','onboarding_progress','platform_billing_subscriptions','payment_provider_accounts',
    'fans','fan_profiles','fan_sessions','fan_verification_tokens','membership_tiers','creator_subscriptions','media_assets',
    'content_posts','post_media','content_access_rules','products','purchases','transactions','tips','coupons','referrals','affiliates',
    'crm_tags','fan_tags','fan_notes','segments','campaigns','automations','automation_triggers','automation_conditions','automation_actions',
    'automation_runs','analytics_events','daily_creator_metrics','notifications','reports','takedown_requests','blocked_users',
    'live_streams','live_admissions','live_participants','live_chat_messages','live_moderation_actions','live_recordings','live_analytics_samples','live_provider_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_tenant') THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (creator_id = nullif(current_setting(''app.creator_id'',true),'''')::uuid OR app_is_platform_admin()) WITH CHECK (creator_id = nullif(current_setting(''app.creator_id'',true),'''')::uuid OR app_is_platform_admin())',
        t||'_tenant',t
      );
    END IF;
  END LOOP;
END $$;

-- webhook_events and globally banned hashes are platform-owned; creator-scoped rows remain protected by application authorization.
CREATE INDEX IF NOT EXISTS webhook_events_creator_time_idx ON webhook_events(creator_id,received_at DESC);
CREATE INDEX IF NOT EXISTS reports_creator_status_idx ON reports(creator_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS takedown_creator_status_idx ON takedown_requests(creator_id,status,created_at DESC);
