-- =========================================================================
-- TELESHORT v2.1 — UNIVERSAL SUPABASE PRODUCTION SCHEMA
-- Supports both Standalone Frontend & Backend Gateway with Zero Permission Errors
-- =========================================================================

-- Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. DROP OLD TABLES (Clean slate migration)
-- =========================================================================
DROP TABLE IF EXISTS public.click_logs CASCADE;
DROP TABLE IF EXISTS public.clicks CASCADE;
DROP TABLE IF EXISTS public.ad_events CASCADE;
DROP TABLE IF EXISTS public.ad_sessions CASCADE;
DROP TABLE IF EXISTS public.broadcast_deliveries CASCADE;
DROP TABLE IF EXISTS public.broadcasts CASCADE;
DROP TABLE IF EXISTS public.fraud_events CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.admin_sessions CASCADE;
DROP TABLE IF EXISTS public.admin_users CASCADE;
DROP TABLE IF EXISTS public.force_join_channels CASCADE;
DROP TABLE IF EXISTS public.wallet_transactions CASCADE;
DROP TABLE IF EXISTS public.withdrawals CASCADE;
DROP TABLE IF EXISTS public.referrals CASCADE;
DROP TABLE IF EXISTS public.links CASCADE;
DROP TABLE IF EXISTS public.daily_stats CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.settings CASCADE;

-- =========================================================================
-- 2. CREATE TABLES
-- =========================================================================

-- 2.1 USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    username TEXT,
    first_name TEXT DEFAULT 'User',
    balance NUMERIC(12,4) DEFAULT 0.0000 CHECK (balance >= 0),
    today_earnings NUMERIC(12,4) DEFAULT 0.0000,
    total_earnings NUMERIC(12,4) DEFAULT 0.0000,
    total_earned NUMERIC(12,4) DEFAULT 0.0000,
    total_clicks INTEGER DEFAULT 0,
    today_clicks INTEGER DEFAULT 0,
    is_blocked BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON public.users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_is_blocked ON public.users(is_blocked);

-- 2.2 SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.settings (
    id BIGSERIAL PRIMARY KEY,
    cpm NUMERIC(10,2) DEFAULT 2.00,
    refer_percent INTEGER DEFAULT 10,
    ads_per_link INTEGER DEFAULT 1,
    ad_timer INTEGER DEFAULT 5,
    payment_methods TEXT DEFAULT 'UPI, Binance Pay, USDT TRC20',
    min_withdraw NUMERIC(10,2) DEFAULT 5.00,
    tg_channel_url TEXT DEFAULT 'https://t.me/myfileshareskbot',
    yt_channel_url TEXT DEFAULT '',
    privacy_url TEXT DEFAULT '',
    terms_url TEXT DEFAULT '',
    maintenance_mode BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert Default Settings Row
INSERT INTO public.settings (
    cpm, refer_percent, ads_per_link, ad_timer, 
    payment_methods, min_withdraw, tg_channel_url, 
    yt_channel_url, privacy_url, terms_url, maintenance_mode
) VALUES (
    2.00, 10, 1, 5, 
    'UPI, Binance Pay, USDT TRC20', 5.00, 'https://t.me/myfileshareskbot', 
    '', '', '', FALSE
);

-- 2.3 LINKS TABLE
CREATE TABLE IF NOT EXISTS public.links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_id TEXT UNIQUE NOT NULL,
    short_code TEXT,
    user_id BIGINT,
    owner_id BIGINT,
    original_url TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    earnings NUMERIC(12,4) DEFAULT 0.0000,
    total_earnings NUMERIC(12,4) DEFAULT 0.0000,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_links_short_id ON public.links(short_id);
CREATE INDEX IF NOT EXISTS idx_links_short_code ON public.links(short_code);
CREATE INDEX IF NOT EXISTS idx_links_user_id ON public.links(user_id);

-- 2.4 CLICK LOGS TABLE (For Dedup and Views Tracking)
CREATE TABLE IF NOT EXISTS public.click_logs (
    id BIGSERIAL PRIMARY KEY,
    link_id UUID REFERENCES public.links(id) ON DELETE CASCADE,
    clicker_tg_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_click_logs_link ON public.click_logs(link_id);
CREATE INDEX IF NOT EXISTS idx_click_logs_user ON public.click_logs(clicker_tg_id);
CREATE INDEX IF NOT EXISTS idx_click_logs_created ON public.click_logs(created_at);

-- 2.5 WITHDRAWALS TABLE
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT,
    username TEXT,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    method TEXT DEFAULT 'UPI',
    details TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON public.withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawals(status);

-- 2.6 REFERRALS TABLE
CREATE TABLE IF NOT EXISTS public.referrals (
    id BIGSERIAL PRIMARY KEY,
    referrer_tg_id BIGINT,
    referred_tg_id BIGINT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_tg_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON public.referrals(referred_tg_id);

-- =========================================================================
-- 3. PERMISSIONS & ROW LEVEL SECURITY (RLS)
-- Grants full access so client and server can read and write without 403 Forbidden
-- =========================================================================

-- Grant schema access
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.click_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Permissive RLS Policies for Anon and Authenticated
CREATE POLICY "Public full access on users" ON public.users FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public full access on settings" ON public.settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public full access on links" ON public.links FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public full access on click_logs" ON public.click_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public full access on withdrawals" ON public.withdrawals FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public full access on referrals" ON public.referrals FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- =========================================================================
-- SCHEMA CREATION COMPLETE (READY FOR TELESHORT)
-- =========================================================================
