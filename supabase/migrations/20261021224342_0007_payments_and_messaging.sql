-- Payments (M-Pesa STK Push + paybill/C2B), messaging (SMS), phone verification.
-- Business rules live in the database so they are testable and cannot be bypassed from a browser.

-- ============ schools: display-only mode flag (only Super Admin / server may change it) ============
alter table public.schools add column mpesa_mode text not null default 'off' check (mpesa_mode in ('off', 'sandbox', 'live'));

create or replace function private.schools_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.is_super_admin() then
    if new.plan is distinct from old.plan or new.status is distinct from old.status
       or new.level is distinct from old.level or new.mpesa_mode is distinct from old.mpesa_mode then
      raise exception 'Only the platform Super Admin can change plan, status, level or M-Pesa mode' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ============ per-school M-Pesa credentials (secrets live in Vault; this table is server-only) ============
create table public.school_mpesa_config (
  school_id uuid primary key references public.schools (id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  shortcode text not null check (shortcode ~ '^[0-9]{5,7}$'),
  shortcode_type text not null default 'paybill' check (shortcode_type in ('paybill', 'till')),
  consumer_key_id uuid not null,
  consumer_secret_id uuid not null,
  passkey_id uuid not null,
  callback_token text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  c2b_registered boolean not null default false,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.school_mpesa_config enable row level security;      -- no policies, no grants: Edge Functions only
revoke all on public.school_mpesa_config from anon, authenticated;

create function public.mpesa_save_config(p_school uuid, p_env text, p_shortcode text, p_type text, p_key text, p_secret text, p_passkey text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.school_mpesa_config;
begin
  select * into c from public.school_mpesa_config where school_id = p_school;
  if found then
    perform vault.update_secret(c.consumer_key_id, p_key);
    perform vault.update_secret(c.consumer_secret_id, p_secret);
    perform vault.update_secret(c.passkey_id, p_passkey);
    update public.school_mpesa_config
      set environment = p_env, shortcode = p_shortcode, shortcode_type = p_type, verified_at = now(), updated_at = now()
      where school_id = p_school;
  else
    insert into public.school_mpesa_config (school_id, environment, shortcode, shortcode_type, consumer_key_id, consumer_secret_id, passkey_id, verified_at)
    values (p_school, p_env, p_shortcode, p_type,
            vault.create_secret(p_key, 'mpesa:' || p_school || ':key', 'Daraja consumer key'),
            vault.create_secret(p_secret, 'mpesa:' || p_school || ':secret', 'Daraja consumer secret'),
            vault.create_secret(p_passkey, 'mpesa:' || p_school || ':passkey', 'Daraja passkey'), now());
  end if;
  update public.schools set mpesa_mode = case when p_env = 'production' then 'live' else 'sandbox' end where id = p_school;
end $$;

create function public.mpesa_get_config(p_school uuid)
returns table (environment text, shortcode text, shortcode_type text, consumer_key text, consumer_secret text, passkey text, callback_token text, c2b_registered boolean)
language sql security definer set search_path = '' as $$
  select c.environment, c.shortcode, c.shortcode_type,
         (select decrypted_secret from vault.decrypted_secrets where id = c.consumer_key_id),
         (select decrypted_secret from vault.decrypted_secrets where id = c.consumer_secret_id),
         (select decrypted_secret from vault.decrypted_secrets where id = c.passkey_id),
         c.callback_token, c.c2b_registered
  from public.school_mpesa_config c where c.school_id = p_school
$$;

create function public.mpesa_remove_config(p_school uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.school_mpesa_config;
begin
  select * into c from public.school_mpesa_config where school_id = p_school;
  if found then
    delete from vault.secrets where id in (c.consumer_key_id, c.consumer_secret_id, c.passkey_id);
    delete from public.school_mpesa_config where school_id = p_school;
  end if;
  update public.schools set mpesa_mode = 'off' where id = p_school;
end $$;

create function public.mpesa_mark_c2b(p_school uuid, p_ok boolean) returns void
language sql security definer set search_path = '' as $$
  update public.school_mpesa_config set c2b_registered = p_ok where school_id = p_school
$$;

create function public.mpesa_token_ok(p_school uuid, p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.school_mpesa_config where school_id = p_school and callback_token = p_token)
$$;

-- ============ STK Push: create the pending payment (all checks happen here, never in the browser) ============
create function public.create_stk_payment(p_user uuid, p_student uuid, p_amount numeric, p_phone text)
returns table (payment_id uuid, school_id uuid, parent_id uuid, admission_no text, student_name text)
language plpgsql security definer set search_path = '' as $$
declare v_par public.parents; v_st public.students; v_bal numeric; v_phone text := private.normalize_ke_phone(p_phone); v_id uuid;
begin
  if p_amount is null or p_amount < 1 or p_amount > 250000 or p_amount <> trunc(p_amount) then
    raise exception 'Enter a whole amount between KES 1 and KES 250,000' using errcode = '22023';
  end if;
  if v_phone is null then raise exception 'Enter a valid Safaricom number' using errcode = '22023'; end if;
  select p.* into v_par from public.parents p
    join public.parent_students ps on ps.parent_id = p.id
    where p.user_id = p_user and ps.student_id = p_student and ps.status = 'active' limit 1;
  if not found then raise exception 'This child is not linked to your account' using errcode = '42501'; end if;
  select * into v_st from public.students where id = p_student and verified and active;
  if not found then raise exception 'This student is not active' using errcode = '42501'; end if;
  if not exists (select 1 from public.schools where id = v_st.school_id and status = 'active') then
    raise exception 'This school is not accepting payments right now' using errcode = '55000';
  end if;
  if not exists (select 1 from public.school_mpesa_config where school_id = v_st.school_id) then
    raise exception 'M-Pesa is not set up for this school yet' using errcode = '55000';
  end if;
  select balance into v_bal from public.student_balances where id = p_student;
  if coalesce(v_bal, 0) <= 0 then raise exception 'There is no balance to pay' using errcode = '22023'; end if;
  if p_amount > v_bal then
    raise exception 'The amount cannot exceed the balance of KES %', to_char(v_bal, 'FM999,999,990') using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where student_id = p_student and method = 'mpesa_stk' and status = 'pending'
             and created_at > now() - interval '90 seconds') then
    raise exception 'A payment request for this child is already in progress. Please wait a minute.' using errcode = '55006';
  end if;
  insert into public.payments (school_id, student_id, parent_id, amount, method, status, phone, account_reference)
  values (v_st.school_id, p_student, v_par.id, p_amount, 'mpesa_stk', 'pending', v_phone, v_st.admission_no)
  returning id into v_id;
  return query select v_id, v_st.school_id, v_par.id, v_st.admission_no, v_st.full_name;
end $$;

create function public.set_stk_request_result(p_payment uuid, p_merchant text, p_checkout text, p_ok boolean, p_desc text) returns void
language sql security definer set search_path = '' as $$
  update public.payments set
    merchant_request_id = case when p_ok then p_merchant else merchant_request_id end,
    checkout_request_id = case when p_ok then p_checkout else checkout_request_id end,
    status = case when p_ok then status else 'failed' end,
    result_desc = case when p_ok then result_desc else left(p_desc, 300) end
  where id = p_payment and method = 'mpesa_stk' and status = 'pending'
$$;

-- Idempotent completion: called by the Daraja callback and by the reconciliation job.
create function public.complete_stk_payment(p_checkout text, p_school uuid, p_amount numeric, p_receipt text, p_code integer, p_desc text, p_raw jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v public.payments;
begin
  select * into v from public.payments where checkout_request_id = p_checkout and school_id = p_school for update;
  if not found then return 'unknown'; end if;
  if v.status <> 'pending' then
    if v.status = 'completed' and v.mpesa_receipt is null and p_receipt is not null then
      begin update public.payments set mpesa_receipt = upper(btrim(p_receipt)) where id = v.id; exception when unique_violation then null; end;
    end if;
    return 'duplicate';
  end if;
  if p_code = 0 then
    if p_amount is not null and p_amount <> v.amount then
      update public.payments set result_code = p_code, result_desc = left('Amount mismatch: paid ' || p_amount || ', expected ' || v.amount, 300), raw_callback = p_raw where id = v.id;
      insert into public.audit_log (school_id, action, entity, entity_id, details)
      values (v.school_id, 'mpesa_amount_mismatch', 'payments', v.id::text, jsonb_build_object('paid', p_amount, 'expected', v.amount));
      return 'mismatch';
    end if;
    update public.payments set status = 'completed', mpesa_receipt = p_receipt, result_code = 0, result_desc = left(coalesce(p_desc, 'Paid'), 300), raw_callback = p_raw where id = v.id;
    return 'completed';
  end if;
  update public.payments set
    status = case p_code when 1032 then 'cancelled'::public.payment_status when 1037 then 'timeout'::public.payment_status else 'failed'::public.payment_status end,
    result_code = p_code, result_desc = left(coalesce(p_desc, 'Payment failed'), 300), raw_callback = p_raw
  where id = v.id;
  return 'failed';
exception when unique_violation then
  return 'duplicate';
end $$;

create function public.pending_stk_payments(p_min_age interval, p_max_age interval)
returns table (id uuid, school_id uuid, checkout_request_id text, amount numeric)
language sql stable security definer set search_path = '' as $$
  select p.id, p.school_id, p.checkout_request_id, p.amount from public.payments p
  where p.method = 'mpesa_stk' and p.status = 'pending' and p.checkout_request_id is not null
    and p.created_at <= now() - p_min_age and p.created_at > now() - p_max_age
  order by p.created_at limit 50
$$;

create function public.expire_stk_payments() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.payments set status = 'timeout', result_desc = 'No confirmation received from M-Pesa'
  where method = 'mpesa_stk' and status = 'pending'
    and ((checkout_request_id is null and created_at < now() - interval '10 minutes') or created_at < now() - interval '24 hours');
  get diagnostics n = row_count;
  return n;
end $$;

-- ============ paybill / C2B payments and the unmatched list ============
create table public.mpesa_unmatched (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  trans_id text not null unique,
  amount numeric(12,2) not null check (amount > 0),
  bill_ref text, msisdn text, payer_name text, trans_time timestamptz,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched')),
  matched_payment uuid references public.payments (id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index mpesa_unmatched_school_idx on public.mpesa_unmatched (school_id, status, created_at desc);
create index mpesa_unmatched_payment_idx on public.mpesa_unmatched (matched_payment);
alter table public.mpesa_unmatched enable row level security;
grant select on public.mpesa_unmatched to authenticated;
create policy mpesa_unmatched_select on public.mpesa_unmatched for select to authenticated
  using (school_id = (select private.my_school_id()));

-- Match an account reference to exactly ONE student (ignores case, spaces and dashes). Ambiguous = no match.
create function private.match_student(p_school uuid, p_ref text) returns uuid
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then (array_agg(s.id))[1] end
  from public.students s
  where s.school_id = p_school and s.verified and s.active
    and upper(regexp_replace(s.admission_no, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(coalesce(p_ref, ''), '[^A-Za-z0-9]', '', 'g'))
    and regexp_replace(coalesce(p_ref, ''), '[^A-Za-z0-9]', '', 'g') <> ''
$$;

create function public.c2b_account_valid(p_school uuid, p_ref text) returns boolean
language sql stable security definer set search_path = '' as $$ select private.match_student(p_school, p_ref) is not null $$;

create function public.record_c2b_payment(p_school uuid, p_trans_id text, p_amount numeric, p_bill_ref text, p_msisdn text, p_name text, p_trans_time timestamptz, p_raw jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v_student uuid; v_trans text := upper(btrim(p_trans_id));
begin
  if v_trans = '' or p_amount is null or p_amount <= 0 then return 'invalid'; end if;
  if exists (select 1 from public.payments where mpesa_receipt = v_trans) or exists (select 1 from public.mpesa_unmatched where trans_id = v_trans) then
    return 'duplicate';
  end if;
  v_student := private.match_student(p_school, p_bill_ref);
  if v_student is not null then
    insert into public.payments (school_id, student_id, amount, method, status, phone, account_reference, mpesa_receipt, raw_callback, completed_at)
    values (p_school, v_student, p_amount, 'mpesa_c2b', 'completed', p_msisdn, left(p_bill_ref, 60), v_trans, p_raw, coalesce(p_trans_time, now()));
    return 'matched';
  end if;
  insert into public.mpesa_unmatched (school_id, trans_id, amount, bill_ref, msisdn, payer_name, trans_time, raw)
  values (p_school, v_trans, p_amount, left(p_bill_ref, 60), p_msisdn, left(p_name, 120), p_trans_time, p_raw);
  insert into public.notifications (audience, school_id, type, title, body)
  values ('school', p_school, 'unmatched', 'Unmatched M-Pesa payment',
          'KES ' || to_char(p_amount, 'FM999,999,990.00') || ' (' || v_trans || ') used the account "' || coalesce(nullif(p_bill_ref, ''), 'none') || '". Match it under M-Pesa.');
  return 'unmatched';
end $$;

create function public.resolve_unmatched(p_unmatched uuid, p_student uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u public.mpesa_unmatched; v_school uuid := (select private.my_school_id()); v_pay uuid;
begin
  select * into u from public.mpesa_unmatched where id = p_unmatched and school_id = v_school and status = 'unmatched' for update;
  if not found then raise exception 'Transaction not found or already matched' using errcode = '42501'; end if;
  if not exists (select 1 from public.students where id = p_student and school_id = v_school) then
    raise exception 'Choose a student from your school' using errcode = '42501';
  end if;
  insert into public.payments (school_id, student_id, amount, method, status, phone, account_reference, mpesa_receipt, recorded_by, note, completed_at)
  values (v_school, p_student, u.amount, 'mpesa_c2b', 'completed', u.msisdn, u.bill_ref, u.trans_id, (select auth.uid()), 'Matched manually from the unmatched list', coalesce(u.trans_time, now()))
  returning id into v_pay;
  update public.mpesa_unmatched set status = 'matched', matched_payment = v_pay where id = u.id;
  return v_pay;
end $$;

create function public.rematch_unmatched() returns integer
language plpgsql security definer set search_path = '' as $$
declare u public.mpesa_unmatched; v_school uuid := (select private.my_school_id()); v_student uuid; v_pay uuid; n integer := 0;
begin
  if v_school is null then raise exception 'Only a school admin can do this' using errcode = '42501'; end if;
  for u in select * from public.mpesa_unmatched where school_id = v_school and status = 'unmatched' order by created_at loop
    v_student := private.match_student(v_school, u.bill_ref);
    if v_student is not null then
      insert into public.payments (school_id, student_id, amount, method, status, phone, account_reference, mpesa_receipt, recorded_by, note, completed_at)
      values (v_school, v_student, u.amount, 'mpesa_c2b', 'completed', u.msisdn, u.bill_ref, u.trans_id, (select auth.uid()), 'Matched automatically by admission number', coalesce(u.trans_time, now()))
      returning id into v_pay;
      update public.mpesa_unmatched set status = 'matched', matched_payment = v_pay where id = u.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ============ messaging: SMS log, campaign history, phone verification ============
create table public.sms_log (
  id bigint generated always as identity primary key,
  school_id uuid references public.schools (id) on delete cascade,
  student_id uuid, parent_id uuid,
  phone text not null,
  kind text not null check (kind in ('reminder', 'message', 'otp')),
  message text,
  status text not null check (status in ('sent', 'failed')),
  provider_ref text, error text,
  created_at timestamptz not null default now()
);
create index sms_log_school_idx on public.sms_log (school_id, created_at desc);
create index sms_log_student_idx on public.sms_log (student_id, kind, created_at desc);
alter table public.sms_log enable row level security;
grant select on public.sms_log to authenticated;
create policy sms_log_select on public.sms_log for select to authenticated
  using (school_id = (select private.my_school_id()));

alter table public.reminder_history
  add column kind text not null default 'reminder' check (kind in ('reminder', 'message')),
  add column title text,
  add column audience text,
  add column sms_sent integer not null default 0,
  add column sms_failed integer not null default 0;
grant insert (kind, title, audience, sms_sent, sms_failed) on public.reminder_history to authenticated;

create table public.phone_otps (
  parent_id uuid primary key references public.parents (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.phone_otps enable row level security;
revoke all on public.phone_otps from anon, authenticated;

-- Parent asks for a code: returns the parent's phone (the code itself is hashed by the Edge Function).
create function public.phone_otp_create(p_user uuid, p_parent uuid, p_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_verified boolean;
begin
  select phone, phone_verified into v_phone, v_verified from public.parents where id = p_parent and user_id = p_user;
  if not found then raise exception 'Parent account not found' using errcode = '42501'; end if;
  if v_verified then raise exception 'Your phone number is already verified' using errcode = '22023'; end if;
  if exists (select 1 from public.phone_otps where parent_id = p_parent and created_at > now() - interval '60 seconds') then
    raise exception 'Please wait a minute before asking for another code' using errcode = '55006';
  end if;
  insert into public.phone_otps (parent_id, code_hash, expires_at) values (p_parent, p_hash, now() + interval '10 minutes')
  on conflict (parent_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = now();
  return v_phone;
end $$;

-- Checks the code. On success: marks the phone verified and approves pending links whose guardian phone matches.
create function public.phone_otp_check(p_user uuid, p_parent uuid, p_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.phone_otps; v_phone text; n integer;
begin
  select phone into v_phone from public.parents where id = p_parent and user_id = p_user;
  if not found then return 'denied'; end if;
  select * into o from public.phone_otps where parent_id = p_parent for update;
  if not found or o.expires_at < now() then return 'expired'; end if;
  if o.attempts >= 5 then return 'locked'; end if;
  if o.code_hash <> p_hash then
    update public.phone_otps set attempts = attempts + 1 where parent_id = p_parent;
    return 'wrong';
  end if;
  update public.parents set phone_verified = true where id = p_parent;
  delete from public.phone_otps where parent_id = p_parent;
  update public.parent_students ps set status = 'active'
  from public.students s
  where ps.parent_id = p_parent and ps.status = 'pending' and s.id = ps.student_id and s.guardian_phone = v_phone;
  get diagnostics n = row_count;
  return 'ok:' || n;
end $$;

-- ============ SMS provider credentials (platform-wide, in Vault) ============
create function public.sms_save_config(p_username text, p_api_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name in ('sms:at:username', 'sms:at:key');
  perform vault.create_secret(p_username, 'sms:at:username', 'Africa''s Talking username');
  perform vault.create_secret(p_api_key, 'sms:at:key', 'Africa''s Talking API key');
  insert into public.platform_settings (key, value) values ('sms_enabled', 'true'::jsonb)
  on conflict (key) do update set value = 'true'::jsonb, updated_at = now();
end $$;
create function public.sms_get_config() returns table (username text, api_key text)
language sql security definer set search_path = '' as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'sms:at:username'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'sms:at:key')
$$;
create function public.sms_remove_config() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name in ('sms:at:username', 'sms:at:key');
  insert into public.platform_settings (key, value) values ('sms_enabled', 'false'::jsonb)
  on conflict (key) do update set value = 'false'::jsonb, updated_at = now();
end $$;

-- ============ reconciliation job auth ============
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'reconcile_token', 'Authenticates the scheduled M-Pesa reconciliation call');
create function public.reconcile_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'reconcile_token' and decrypted_secret = p_token)
$$;

-- ============ privileges: server-only functions are callable ONLY with the service role ============
do $$
declare f text;
begin
  foreach f in array array[
    'public.mpesa_save_config(uuid,text,text,text,text,text,text)', 'public.mpesa_get_config(uuid)', 'public.mpesa_remove_config(uuid)',
    'public.mpesa_mark_c2b(uuid,boolean)', 'public.mpesa_token_ok(uuid,text)',
    'public.create_stk_payment(uuid,uuid,numeric,text)', 'public.set_stk_request_result(uuid,text,text,boolean,text)',
    'public.complete_stk_payment(text,uuid,numeric,text,integer,text,jsonb)', 'public.pending_stk_payments(interval,interval)',
    'public.expire_stk_payments()', 'public.c2b_account_valid(uuid,text)',
    'public.record_c2b_payment(uuid,text,numeric,text,text,text,timestamptz,jsonb)',
    'public.phone_otp_create(uuid,uuid,text)', 'public.phone_otp_check(uuid,uuid,text)',
    'public.sms_save_config(text,text)', 'public.sms_get_config()', 'public.sms_remove_config()', 'public.reconcile_token_ok(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.resolve_unmatched(uuid,uuid)', 'public.rematch_unmatched()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.match_student(uuid, text) from public, anon, authenticated;

-- realtime: school admins see unmatched transactions arrive
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.mpesa_unmatched;
  end if;
end $$;
