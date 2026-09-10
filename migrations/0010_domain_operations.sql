ALTER TABLE creator_domains ADD COLUMN IF NOT EXISTS ssl_status text NOT NULL DEFAULT 'pending' CHECK(ssl_status IN ('pending','provisioning','active','error'));
ALTER TABLE creator_domains ADD COLUMN IF NOT EXISTS redirect_to_primary boolean NOT NULL DEFAULT false;
ALTER TABLE creator_domains ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE creator_domains ADD COLUMN IF NOT EXISTS last_error text;
CREATE INDEX IF NOT EXISTS creator_domains_status_idx ON creator_domains(creator_id,status,ssl_status);
