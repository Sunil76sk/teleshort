-- TeleShort v2.2 — lock financial/business tables behind the server service role.
-- The API server is the only application data path; browser clients must not reach public tables directly.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'users','settings','links','click_logs','clicks','withdrawals','referrals',
        'ad_sessions','ad_events','wallet_transactions','audit_logs','fraud_events',
        'force_join_channels','admin_users','admin_sessions','broadcasts','broadcast_deliveries','daily_stats'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Explicitly deny the public client roles. service_role continues to bypass RLS server-side.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

revoke all on function public.process_withdrawal_decision(uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.record_reward_claim(uuid,uuid,bigint,numeric,integer,bigint,text,integer,text) from public, anon, authenticated;
revoke all on function public.reserve_withdrawal_balance(text,bigint,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

grant execute on function public.process_withdrawal_decision(uuid,text,text,text,text,text) to service_role;
grant execute on function public.record_reward_claim(uuid,uuid,bigint,numeric,integer,bigint,text,integer,text) to service_role;
grant execute on function public.reserve_withdrawal_balance(text,bigint,numeric,text,text,text) to service_role;

notify pgrst, 'reload schema';
