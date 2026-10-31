-- STK pushes whose callback never arrives must be settled (asked of Safaricom) or expired.
-- fee-callback?r=reconcile does that; this schedules it every 2 minutes with pg_cron + pg_net.
create extension if not exists pg_cron;

create or replace function private.run_reconcile() returns void
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'reconcile_token';
  if v_token is null then return; end if;
  perform net.http_post(
    url := 'https://kwuhuvkxvylgzohkrcqt.supabase.co/functions/v1/fee-callback?r=reconcile',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reconcile-token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000);
end $$;
revoke all on function private.run_reconcile() from public, anon, authenticated;

select cron.schedule('feeflow-reconcile', '*/2 * * * *', 'select private.run_reconcile()');
