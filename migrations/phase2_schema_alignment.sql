-- TeleShort Phase 2 — Database/schema foundation alignment
-- Idempotent compatibility migration for the production schema.
-- Existing data is preserved; this only fills documented schema drift.

ALTER TABLE IF EXISTS public.users
  ADD COLUMN IF NOT EXISTS referred_by BIGINT;

ALTER TABLE IF EXISTS public.links
  ADD COLUMN IF NOT EXISTS eligible_click_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.settings
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS value JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS settings_key_unique
  ON public.settings(key)
  WHERE key IS NOT NULL;

ALTER TABLE IF EXISTS public.withdrawals
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payout_address TEXT,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idempotency_key_unique
  ON public.withdrawals(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Core click/reward table required by the PRD. Existing production tables are left intact.
CREATE TABLE IF NOT EXISTS public.clicks (
  id BIGSERIAL PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
  visitor_telegram_id BIGINT,
  ip_hash VARCHAR(128),
  user_agent_hash TEXT,
  country VARCHAR(8),
  is_unique BOOLEAN NOT NULL DEFAULT TRUE,
  is_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  reward_amount NUMERIC(12,4) NOT NULL DEFAULT 0,
  fraud_score INTEGER NOT NULL DEFAULT 0 CHECK (fraud_score >= 0 AND fraud_score <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON public.clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_visitor ON public.clicks(visitor_telegram_id);
CREATE INDEX IF NOT EXISTS idx_clicks_created_at ON public.clicks(created_at);

-- Phase 2 security invariant: new tables must remain server-only.
ALTER TABLE public.clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.clicks FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.clicks TO service_role;
REVOKE ALL PRIVILEGES ON SEQUENCE public.clicks_id_seq FROM anon, authenticated;
GRANT ALL PRIVILEGES ON SEQUENCE public.clicks_id_seq TO service_role;

-- Document the schema contract without trusting client-supplied financial fields.
COMMENT ON TABLE public.clicks IS 'TeleShort eligible click ledger; writes are server-only.';
COMMENT ON COLUMN public.users.referred_by IS 'Verified Telegram ID of the referral owner.';
COMMENT ON COLUMN public.links.eligible_click_count IS 'Server-maintained count of reward-eligible clicks.';
COMMENT ON COLUMN public.withdrawals.idempotency_key IS 'Server-generated/request-scoped withdrawal idempotency key.';
