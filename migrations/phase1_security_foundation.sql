-- TeleShort Phase 1 — Security Foundation hardening
-- Apply after the existing schema. This migration is intentionally idempotent.
-- The application uses the server-side Supabase service/secret key; anon/authenticated
-- clients must not have direct CRUD access to financial, auth, admin, or reward tables.

DO $$
DECLARE
  table_name text;
  policy_name text;
  protected_tables constant text[] := ARRAY[
    'users',
    'settings',
    'links',
    'clicks',
    'click_logs',
    'ad_sessions',
    'ad_events',
    'wallet_transactions',
    'withdrawals',
    'referrals',
    'force_join_channels',
    'admin_users',
    'admin_sessions',
    'audit_logs',
    'fraud_events',
    'broadcasts',
    'broadcast_deliveries',
    'daily_stats'
  ];
BEGIN
  -- Remove any legacy/permissive policies from protected tables.
  FOREACH table_name IN ARRAY protected_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      FOR policy_name IN
        SELECT pol.polname
        FROM pg_policy pol
        JOIN pg_class cls ON cls.oid = pol.polrelid
        JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
        WHERE nsp.nspname = 'public' AND cls.relname = table_name
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
      END LOOP;

      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', table_name);
    END IF;
  END LOOP;

  -- No client role receives sequence write access either.
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

  -- Prevent future tables/sequences from inheriting broad client privileges.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
END $$;

-- Keep the service role as the server-side data path. Supabase service_role bypasses RLS.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO service_role;
