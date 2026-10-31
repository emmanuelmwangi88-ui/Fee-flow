-- School profile fields, academic terms (fee deadlines drive "overdue"), and manual M-Pesa matching.

alter table public.schools
  add column address text check (address is null or char_length(address) <= 200),
  add column phone text check (phone is null or char_length(phone) <= 30),
  add column settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object');

-- ---------- academic terms ----------
create table public.terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  start_date date not null,
  end_date date not null,
  deadline date,
  status text not null default 'upcoming' check (status in ('active', 'upcoming')),
  created_at timestamptz not null default now(),
  constraint terms_dates_ordered check (end_date >= start_date)
);
create index terms_school_idx on public.terms (school_id, start_date desc);
alter table public.terms enable row level security;

grant select, insert, update, delete on public.terms to authenticated;
create policy terms_select on public.terms for select to authenticated
  using (school_id = (select private.my_school_id()) or school_id in (select private.my_parent_school_ids()));
create policy terms_insert on public.terms for insert to authenticated
  with check (school_id = (select private.my_school_id()));
create policy terms_update on public.terms for update to authenticated
  using (school_id = (select private.my_school_id()))
  with check (school_id = (select private.my_school_id()));
create policy terms_delete on public.terms for delete to authenticated
  using (school_id = (select private.my_school_id()));

-- Makes exactly one term of the caller's school active, atomically. Runs with the caller's rights (RLS applies).
create function public.set_active_term(p_term uuid) returns void
language sql security invoker set search_path = '' as $$
  update public.terms t
  set status = case when t.id = p_term then 'active' else 'upcoming' end
  where t.school_id = (select school_id from public.terms where id = p_term)
$$;
revoke execute on function public.set_active_term(uuid) from public, anon;
grant execute on function public.set_active_term(uuid) to authenticated;

-- ---------- manual M-Pesa matching (statement reconciliation) ----------
-- A school admin may record an M-Pesa payment they found on their paybill statement, but only with its
-- M-Pesa code (unique platform-wide, so the same transaction can never be credited twice).
drop policy payments_insert_manual on public.payments;
create policy payments_insert_manual on public.payments for insert to authenticated
  with check (school_id = (select private.my_school_id())
              and status = 'completed'
              and recorded_by = (select auth.uid())
              and (method in ('cash', 'bank', 'cheque')
                   or (method = 'mpesa_c2b' and mpesa_receipt is not null and btrim(mpesa_receipt) <> '')));
grant insert (mpesa_receipt, account_reference, phone) on public.payments to authenticated;

-- Normalise M-Pesa codes (trim + upper-case) so " rk7x " and "RK7X" are the same transaction.
create or replace function private.payments_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_school uuid;
begin
  if new.mpesa_receipt is not null then
    new.mpesa_receipt := upper(btrim(new.mpesa_receipt));
    if new.mpesa_receipt = '' then new.mpesa_receipt := null; end if;
  end if;

  if tg_op = 'INSERT' then
    select school_id into v_school from public.students where id = new.student_id;
    if v_school is null or v_school <> new.school_id then
      raise exception 'The student does not belong to this school' using errcode = '23514';
    end if;
  else
    if new.school_id <> old.school_id or new.student_id <> old.student_id or new.amount <> old.amount then
      raise exception 'Core payment fields cannot be changed' using errcode = '23514';
    end if;
    if old.status = 'completed' and new.status <> 'completed' then
      raise exception 'A completed payment cannot be changed' using errcode = '23514';
    end if;
  end if;

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    if new.receipt_no is null then
      new.receipt_no := 'FF-' || to_char(now() at time zone 'Africa/Nairobi', 'YYMM') || '-'
                        || lpad(nextval('private.receipt_seq')::text, 6, '0');
    end if;
  end if;
  return new;
end $$;
