-- Referral/affiliate integrity and operational case ownership.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES platform_users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical'));
ALTER TABLE takedown_requests ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES platform_users(id) ON DELETE SET NULL;
ALTER TABLE platform_alerts ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES platform_users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referral_commissions_referral_tx_unique ON referral_commissions(creator_id,transaction_id,referral_id) WHERE referral_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS referral_commissions_affiliate_tx_unique ON referral_commissions(creator_id,transaction_id,affiliate_id) WHERE affiliate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_assignee_status_idx ON reports(assigned_to,status,priority,created_at DESC);
CREATE INDEX IF NOT EXISTS takedowns_assignee_status_idx ON takedown_requests(assigned_to,status,created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_assignee_status_idx ON platform_alerts(assigned_to,status,severity,created_at DESC);
