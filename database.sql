-- =========================================================================
-- TELESHORT v2.1 — PRODUCTION DATABASE SCHEMA & MIGRATION SCRIPT
-- PostgreSQL / Supabase Authoritative Schema (Monetag-Only Ad Engine)
-- 16 Tables (including ad_events), Strict RLS, SECURITY DEFINER Atomic Procedures
-- =========================================================================

-- Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. TABLES DEFINITIONS
-- =========================================================================

-- 1.1 USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id BIGINT PRIMARY KEY, -- Telegram User ID (Immutable unique identity)
    username TEXT,
    first_name TEXT NOT NULL,
    balance NUMERIC(12,4) DEFAULT 0.0000 CHECK (balance >= 0), -- Cached available/spendable balance
    total_earned NUMERIC(12,4) DEFAULT 0.0000 CHECK (total_earned >= 0),
    referred_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'BANNED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,
    CONSTRAINT chk_no_self_referral CHECK (referred_by != id)
);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON public.users(referred_by);
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);

-- 1.2 LINKS TABLE
CREATE TABLE IF NOT EXISTS public.links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_code VARCHAR(16) UNIQUE NOT NULL,
    owner_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    original_url TEXT NOT NULL,
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'EXPIRED', 'FLAGGED')),
    click_count INTEGER DEFAULT 0,
    eligible_click_count INTEGER DEFAULT 0,
    total_earnings NUMERIC(12,4) DEFAULT 0.0000,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_valid_url_protocol CHECK (original_url ~* '^https?://')
);
CREATE INDEX IF NOT EXISTS idx_links_short_code ON public.links(short_code);
CREATE INDEX IF NOT EXISTS idx_links_owner_id ON public.links(owner_id);
CREATE INDEX IF NOT EXISTS idx_links_status ON public.links(status);

-- 1.3 CLICKS TABLE (Auditable event log)
CREATE TABLE IF NOT EXISTS public.clicks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    link_id UUID NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
    visitor_telegram_id BIGINT,
    ip_hash VARCHAR(64) NOT NULL,
    user_agent_hash TEXT,
    country VARCHAR(4),
    is_unique BOOLEAN DEFAULT TRUE,
    is_eligible BOOLEAN DEFAULT FALSE,
    reward_amount NUMERIC(10,4) DEFAULT 0.0000,
    fraud_score INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON public.clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_dedup ON public.clicks(link_id, ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_clicks_visitor ON public.clicks(link_id, visitor_telegram_id, created_at);

-- 1.4 AD SESSIONS TABLE (State Machine: 10 State Stages)
CREATE TABLE IF NOT EXISTS public.ad_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id UUID NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
    visitor_telegram_id BIGINT NOT NULL,
    step INTEGER NOT NULL CHECK (step IN (1, 2)),
    network TEXT DEFAULT 'MONETAG',
    status TEXT DEFAULT 'CREATED' CHECK (status IN (
        'CREATED',
        'AD_1_STARTED',
        'AD_1_SIGNAL_RECEIVED',
        'AD_1_ELIGIBLE',
        'AD_2_STARTED',
        'AD_2_SIGNAL_RECEIVED',
        'AD_2_ELIGIBLE',
        'REWARD_ELIGIBLE',
        'REWARD_CLAIMED',
        'REWARD_HELD',
        'REWARD_REJECTED',
        'UNLOCKED',
        'FAILED',
        'EXPIRED'
    )),
    challenge_hash TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_ad_sessions_link_status ON public.ad_sessions(link_id, status);
CREATE INDEX IF NOT EXISTS idx_ad_sessions_visitor ON public.ad_sessions(visitor_telegram_id, created_at DESC);

-- 1.5 AD EVENTS TABLE (Provider Telemetry & Event Audit Trail)
CREATE TABLE IF NOT EXISTS public.ad_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_session_id UUID NOT NULL REFERENCES public.ad_sessions(id) ON DELETE CASCADE,
    visitor_telegram_id BIGINT NOT NULL,
    link_id UUID NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
    step INTEGER NOT NULL CHECK (step IN (1, 2)),
    network TEXT DEFAULT 'MONETAG',
    event_type TEXT NOT NULL CHECK (event_type IN ('AD_STARTED', 'AD_COMPLETED', 'AD_FAILED', 'AD_SKIPPED', 'AD_TIMEOUT')),
    event_id TEXT NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL, -- Prevents duplicate event ingestion
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_events_session ON public.ad_events(ad_session_id, step);
CREATE INDEX IF NOT EXISTS idx_ad_events_visitor ON public.ad_events(visitor_telegram_id, created_at DESC);

-- 1.6 WALLET TRANSACTIONS TABLE (Immutable Accounting Ledger - Source of Truth)
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'AD_REWARD', 
        'REFERRAL_REWARD', 
        'WITHDRAWAL_RESERVE', 
        'WITHDRAWAL_REFUND', 
        'ADMIN_ADJUSTMENT', 
        'BONUS', 
        'REVERSAL'
    )),
    amount NUMERIC(12,4) NOT NULL,
    currency VARCHAR(8) DEFAULT 'INR',
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    balance_before NUMERIC(12,4) NOT NULL,
    balance_after NUMERIC(12,4) NOT NULL,
    status TEXT DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'FAILED', 'PENDING')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB,
    UNIQUE(reference_type, reference_id) -- Strict idempotency enforcement
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON public.wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_ref ON public.wallet_transactions(reference_type, reference_id);

-- 1.7 REFERRALS TABLE
CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    referred_id BIGINT UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_no_self_ref_table CHECK (referrer_id != referred_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);

-- 1.8 WITHDRAWALS TABLE
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(32) NOT NULL,
    payout_address TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 
        'UNDER_REVIEW', 
        'APPROVED', 
        'PROCESSING', 
        'PAID', 
        'REJECTED', 
        'CANCELLED'
    )),
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON public.withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawals(status);

-- 1.9 FORCE JOIN CHANNELS TABLE
CREATE TABLE IF NOT EXISTS public.force_join_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id TEXT NOT NULL,
    channel_title TEXT,
    invite_link TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.10 SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.settings (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.11 ADMIN USERS TABLE (RBAC)
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN (
        'SUPER_ADMIN', 
        'FINANCE_ADMIN', 
        'SUPPORT_ADMIN', 
        'MARKETING_ADMIN', 
        'ANALYTICS_ADMIN'
    )),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.12 ADMIN SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON public.admin_sessions(admin_id);

-- 1.13 AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('ADMIN', 'SYSTEM', 'USER')),
    actor_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action, created_at DESC);

-- 1.14 FRAUD EVENTS TABLE (Gating & Score Records)
CREATE TABLE IF NOT EXISTS public.fraud_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    score_delta INTEGER NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fraud_events_user ON public.fraud_events(user_id, created_at DESC);

-- 1.15 BROADCASTS TABLE
CREATE TABLE IF NOT EXISTS public.broadcasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message TEXT NOT NULL,
    image_url TEXT,
    button_text TEXT,
    button_url TEXT,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 1.16 BROADCAST DELIVERIES TABLE
CREATE TABLE IF NOT EXISTS public.broadcast_deliveries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'BLOCKED')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_bc ON public.broadcast_deliveries(broadcast_id);

-- =========================================================================
-- 2. ROW LEVEL SECURITY (RLS) POLICIES (DENY DIRECT PUBLIC ACCESS)
-- =========================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.force_join_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_deliveries ENABLE ROW LEVEL SECURITY;

-- Deny all direct operations for anon/authenticated roles; service_role bypasses RLS automatically.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

-- =========================================================================
-- 3. SECURITY DEFINER ATOMIC PROCEDURES (WITH ROW LOCKS & IDEMPOTENCY)
-- =========================================================================

-- 3.1 ATOMIC REWARD CLAIM FUNCTION
CREATE OR REPLACE FUNCTION record_reward_claim(
    p_session_id UUID,
    p_link_id UUID,
    p_owner_id BIGINT,
    p_reward_amount NUMERIC,
    p_referral_percent NUMERIC,
    p_visitor_tg_id BIGINT,
    p_ip_hash VARCHAR,
    p_fraud_score INT DEFAULT 0
)
RETURNS JSONB 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_owner_bal_before NUMERIC(12,4);
    v_owner_bal_after NUMERIC(12,4);
    v_ref_id BIGINT;
    v_ref_bal_before NUMERIC(12,4);
    v_ref_bal_after NUMERIC(12,4);
    v_referral_commission NUMERIC(12,4) := 0.0000;
    v_ref_tx_id TEXT;
    v_reward_ref_id TEXT := p_session_id::TEXT;
    v_existing_tx UUID;
    v_result JSONB;
BEGIN
    -- 0. Check Idempotency: Has this session already been claimed?
    SELECT id INTO v_existing_tx 
    FROM public.wallet_transactions 
    WHERE reference_type = 'AD_REWARD' AND reference_id = v_reward_ref_id;

    IF FOUND THEN
        RAISE EXCEPTION 'DUPLICATE_CLAIM: Reward session % has already been claimed', p_session_id;
    END IF;

    -- 1. Lock owner row for update
    SELECT balance INTO v_owner_bal_before 
    FROM public.users 
    WHERE id = p_owner_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Owner user % not found', p_owner_id;
    END IF;

    v_owner_bal_after := v_owner_bal_before + p_reward_amount;

    -- 2. Insert owner ledger transaction
    INSERT INTO public.wallet_transactions (
        user_id, type, amount, reference_type, reference_id,
        balance_before, balance_after, status, metadata
    ) VALUES (
        p_owner_id, 'AD_REWARD', p_reward_amount, 'AD_REWARD', v_reward_ref_id,
        v_owner_bal_before, v_owner_bal_after, 'COMPLETED',
        jsonb_build_object('link_id', p_link_id, 'session_id', p_session_id, 'visitor_tg_id', p_visitor_tg_id, 'fraud_score', p_fraud_score)
    );

    -- 3. Update owner cached balance and total_earned
    UPDATE public.users 
    SET balance = v_owner_bal_after,
        total_earned = total_earned + p_reward_amount,
        updated_at = NOW()
    WHERE id = p_owner_id;

    -- 4. Update link statistics
    UPDATE public.links
    SET click_count = click_count + 1,
        eligible_click_count = eligible_click_count + 1,
        total_earnings = total_earnings + p_reward_amount,
        updated_at = NOW()
    WHERE id = p_link_id;

    -- 5. Record click event
    INSERT INTO public.clicks (
        link_id, visitor_telegram_id, ip_hash, is_unique, is_eligible,
        reward_amount, fraud_score, created_at
    ) VALUES (
        p_link_id, p_visitor_tg_id, p_ip_hash, TRUE, TRUE,
        p_reward_amount, p_fraud_score, NOW()
    );

    -- 6. Process Referral Commission (if owner has a valid referrer)
    IF p_referral_percent > 0 THEN
        SELECT referred_by INTO v_ref_id FROM public.users WHERE id = p_owner_id;

        IF v_ref_id IS NOT NULL AND v_ref_id != p_owner_id THEN
            SELECT balance INTO v_ref_bal_before FROM public.users WHERE id = v_ref_id FOR UPDATE;

            IF FOUND THEN
                v_referral_commission := ROUND(p_reward_amount * (p_referral_percent / 100.0), 4);
                v_ref_bal_after := v_ref_bal_before + v_referral_commission;
                v_ref_tx_id := 'REF_' || v_reward_ref_id;

                INSERT INTO public.wallet_transactions (
                    user_id, type, amount, reference_type, reference_id,
                    balance_before, balance_after, status, metadata
                ) VALUES (
                    v_ref_id, 'REFERRAL_REWARD', v_referral_commission, 'REFERRAL_COMMISSION', v_ref_tx_id,
                    v_ref_bal_before, v_ref_bal_after, 'COMPLETED',
                    jsonb_build_object('referred_user_id', p_owner_id, 'link_id', p_link_id, 'session_id', p_session_id)
                );

                UPDATE public.users
                SET balance = v_ref_bal_after,
                    total_earned = total_earned + v_referral_commission,
                    updated_at = NOW()
                WHERE id = v_ref_id;
            END IF;
        END IF;
    END IF;

    -- 7. Update Ad Session status to REWARD_CLAIMED
    UPDATE public.ad_sessions
    SET status = 'REWARD_CLAIMED',
        completed_at = NOW()
    WHERE id = p_session_id;

    v_result := jsonb_build_object(
        'success', TRUE,
        'session_id', p_session_id,
        'owner_id', p_owner_id,
        'reward_credited', p_reward_amount,
        'owner_new_balance', v_owner_bal_after,
        'referral_commission', v_referral_commission
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- 3.2 ATOMIC WITHDRAWAL RESERVATION FUNCTION
CREATE OR REPLACE FUNCTION reserve_withdrawal_balance(
    p_idempotency_key UUID,
    p_user_id BIGINT,
    p_amount NUMERIC,
    p_method VARCHAR,
    p_address TEXT
)
RETURNS JSONB 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bal_before NUMERIC(12,4);
    v_bal_after NUMERIC(12,4);
    v_withdrawal_id UUID := COALESCE(p_idempotency_key, gen_random_uuid());
    v_existing_w UUID;
    v_result JSONB;
BEGIN
    -- 0. Check Idempotency
    SELECT id INTO v_existing_w FROM public.withdrawals WHERE id = v_withdrawal_id;
    IF FOUND THEN
        RAISE EXCEPTION 'DUPLICATE_WITHDRAWAL: Withdrawal % already submitted', v_withdrawal_id;
    END IF;

    -- 1. Lock user row
    SELECT balance INTO v_bal_before
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND: User % not found', p_user_id;
    END IF;

    IF v_bal_before < p_amount THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE: Current available balance %, requested %', v_bal_before, p_amount;
    END IF;

    v_bal_after := v_bal_before - p_amount;

    -- 2. Deduct available balance atomically (moves to reserved)
    UPDATE public.users
    SET balance = v_bal_after,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- 3. Insert withdrawal request
    INSERT INTO public.withdrawals (
        id, user_id, amount, payment_method, payout_address, status, created_at
    ) VALUES (
        v_withdrawal_id, p_user_id, p_amount, p_method, p_address, 'PENDING', NOW()
    );

    -- 4. Record ledger transaction
    INSERT INTO public.wallet_transactions (
        user_id, type, amount, reference_type, reference_id,
        balance_before, balance_after, status, metadata
    ) VALUES (
        p_user_id, 'WITHDRAWAL_RESERVE', -p_amount, 'WITHDRAWAL', v_withdrawal_id::TEXT,
        v_bal_before, v_bal_after, 'COMPLETED',
        jsonb_build_object('method', p_method, 'payout_address', p_address)
    );

    v_result := jsonb_build_object(
        'withdrawal_id', v_withdrawal_id,
        'user_id', p_user_id,
        'amount', p_amount,
        'available_balance', v_bal_after,
        'status', 'PENDING'
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- 3.3 ATOMIC WITHDRAWAL DECISION FUNCTION
CREATE OR REPLACE FUNCTION process_withdrawal_decision(
    p_withdrawal_id UUID,
    p_new_status TEXT,
    p_admin_id TEXT,
    p_admin_notes TEXT DEFAULT NULL,
    p_payout_tx_id TEXT DEFAULT NULL
)
RETURNS JSONB 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id BIGINT;
    v_amount NUMERIC(10,2);
    v_cur_status TEXT;
    v_bal_before NUMERIC(12,4);
    v_bal_after NUMERIC(12,4);
    v_refund_ref_id TEXT := 'REFUND_' || p_withdrawal_id::TEXT;
    v_result JSONB;
BEGIN
    SELECT user_id, amount, status INTO v_user_id, v_amount, v_cur_status
    FROM public.withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'WITHDRAWAL_NOT_FOUND: Withdrawal % not found', p_withdrawal_id;
    END IF;

    -- Prevent modifying finalized withdrawals
    IF v_cur_status = 'PAID' THEN
        RAISE EXCEPTION 'ALREADY_PAID: Withdrawal % has already been paid out', p_withdrawal_id;
    END IF;
    IF v_cur_status = 'REJECTED' THEN
        RAISE EXCEPTION 'ALREADY_REJECTED: Withdrawal % has already been rejected and refunded', p_withdrawal_id;
    END IF;
    IF v_cur_status = 'CANCELLED' THEN
        RAISE EXCEPTION 'ALREADY_CANCELLED: Withdrawal % has already been cancelled', p_withdrawal_id;
    END IF;

    -- Handle Approval, Under Review, Processing, Paid
    IF p_new_status IN ('UNDER_REVIEW', 'APPROVED', 'PROCESSING') THEN
        UPDATE public.withdrawals
        SET status = p_new_status,
            admin_notes = COALESCE(p_admin_notes, admin_notes)
        WHERE id = p_withdrawal_id;

        INSERT INTO public.audit_logs (
            actor_type, actor_id, action, target_type, target_id, metadata
        ) VALUES (
            'ADMIN', p_admin_id, 'WITHDRAWAL_STATUS_' || p_new_status, 'WITHDRAWAL', p_withdrawal_id::TEXT,
            jsonb_build_object('user_id', v_user_id, 'amount', v_amount, 'previous_status', v_cur_status, 'new_status', p_new_status)
        );

    ELSIF p_new_status = 'PAID' THEN
        -- Final Payout Completion
        UPDATE public.withdrawals
        SET status = 'PAID',
            admin_notes = COALESCE(p_admin_notes, admin_notes),
            processed_at = NOW()
        WHERE id = p_withdrawal_id;

        INSERT INTO public.audit_logs (
            actor_type, actor_id, action, target_type, target_id, metadata
        ) VALUES (
            'ADMIN', p_admin_id, 'WITHDRAWAL_PAID', 'WITHDRAWAL', p_withdrawal_id::TEXT,
            jsonb_build_object('user_id', v_user_id, 'amount', v_amount, 'payout_tx_id', p_payout_tx_id, 'notes', p_admin_notes)
        );

    ELSIF p_new_status IN ('REJECTED', 'CANCELLED') THEN
        -- Refund reserved funds back to available balance
        SELECT balance INTO v_bal_before FROM public.users WHERE id = v_user_id FOR UPDATE;
        v_bal_after := v_bal_before + v_amount;

        UPDATE public.users
        SET balance = v_bal_after,
            updated_at = NOW()
        WHERE id = v_user_id;

        -- Record ledger refund with idempotency
        INSERT INTO public.wallet_transactions (
            user_id, type, amount, reference_type, reference_id,
            balance_before, balance_after, status, metadata
        ) VALUES (
            v_user_id, 'WITHDRAWAL_REFUND', v_amount, 'WITHDRAWAL_REFUND', v_refund_ref_id,
            v_bal_before, v_bal_after, 'COMPLETED',
            jsonb_build_object('withdrawal_id', p_withdrawal_id, 'reason', p_admin_notes, 'admin_id', p_admin_id)
        );

        UPDATE public.withdrawals
        SET status = p_new_status,
            admin_notes = COALESCE(p_admin_notes, admin_notes),
            processed_at = NOW()
        WHERE id = p_withdrawal_id;

        INSERT INTO public.audit_logs (
            actor_type, actor_id, action, target_type, target_id, metadata
        ) VALUES (
            'ADMIN', p_admin_id, 'WITHDRAWAL_' || p_new_status || '_REFUNDED', 'WITHDRAWAL', p_withdrawal_id::TEXT,
            jsonb_build_object('user_id', v_user_id, 'amount', v_amount, 'refunded', TRUE)
        );
    ELSE
        RAISE EXCEPTION 'INVALID_STATUS: Invalid status decision %', p_new_status;
    END IF;

    v_result := jsonb_build_object(
        'withdrawal_id', p_withdrawal_id,
        'user_id', v_user_id,
        'status', p_new_status
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- 4. INITIAL SEED DATA
-- =========================================================================

-- Insert Default Platform Settings (Publisher Payout CPM explicitly named)
INSERT INTO public.settings (key, value) VALUES
    ('publisher_payout_cpm', '{"rate_usd": 2.00, "rate_inr": 160.00, "description": "Fixed internal publisher payout CPM per 1000 eligible monetized views"}'::jsonb),
    ('ads_config', '{"network": "MONETAG", "ads_per_link": 2, "timer_delay_seconds": 5, "min_ad_duration_ms": 4500, "session_timeout_seconds": 300}'::jsonb),
    ('referral_config', '{"commission_percent": 10, "min_qualifying_actions": 1}'::jsonb),
    ('withdrawal_config', '{"min_threshold_inr": 100.00, "cooldown_hours": 24, "allowed_methods": ["UPI", "Binance Pay", "USDT TRC20", "PayPal"]}'::jsonb),
    ('force_join_config', '{"enabled": false, "channel_id": "@TeleShortOfficial", "cache_ttl_seconds": 3600}'::jsonb),
    ('maintenance_config', '{"enabled": false, "message": "System is currently undergoing scheduled maintenance."}'::jsonb),
    ('social_links', '{"telegram_channel": "https://t.me/TeleShortOfficial", "youtube_channel": "https://youtube.com", "privacy_policy": "", "terms_of_service": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Insert Initial Super Admin (Username: 'admin', Password: 'AdminPassword123!')
INSERT INTO public.admin_users (username, password_hash, role)
VALUES ('admin', '$2b$12$R.9M9c9WvhVepN9mNqL9E.wSg6e7vjN7y/G8z0E1sXb/QhK7E.6u2', 'SUPER_ADMIN')
ON CONFLICT (username) DO NOTHING;

-- =========================================================================
-- DATABASE SETUP COMPLETE (16 TABLES)
-- =========================================================================
