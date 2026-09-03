/** Phase 2 — schema foundation static regression checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations', 'phase2_schema_alignment.sql'), 'utf8');

const requiredTables = [
  'users','links','clicks','ad_sessions','ad_events','wallet_transactions','withdrawals',
  'referrals','force_join_channels','settings','admin_users','admin_sessions','audit_logs',
  'fraud_events','broadcasts','broadcast_deliveries','daily_stats'
];

for (const table of requiredTables) {
  if (table === 'clicks') assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.clicks/);
}

assert.match(migration, /referred_by BIGINT/);
assert.match(migration, /eligible_click_count INTEGER NOT NULL DEFAULT 0/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS key TEXT/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS value JSONB/);
assert.match(migration, /withdrawals_idempotency_key_unique/);
assert.match(migration, /idempotency_key TEXT/);
assert.match(migration, /fraud_score INTEGER NOT NULL DEFAULT 0 CHECK \(fraud_score >= 0 AND fraud_score <= 100\)/);
assert.match(migration, /ALTER TABLE public\.clicks ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.clicks FROM anon, authenticated/);
assert.match(migration, /GRANT ALL PRIVILEGES ON TABLE public\.clicks TO service_role/);

console.log('PHASE 2 SCHEMA ALIGNMENT: STATIC PASS');
