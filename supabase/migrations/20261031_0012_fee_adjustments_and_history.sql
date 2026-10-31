-- 0012: fee adjustments (bursaries, waivers, discounts, arrears, late fees), transport & meal charges, fee-structure history.
--
-- Design: every charge that is not a plain fee item is a row in public.fee_adjustments. students.adjustment is kept equal to the
-- sum of the active rows by a trigger, so the existing balance view keeps working and every figure has a reason on record.
--
--   discount_sibling, discount_staff, scholarship, waiver  -> negative (reduces the bill)
--   arrears, late_fee, transport, meals                    -> positive (increases the bill)
--   other                                                  -> either sign
--
-- Security: school-scoped by Row Level Security. The platform Super Admin deliberately has NO access (school money data is private,
-- see 0005). Clients can only insert adjustments and switch one off; amounts of existing rows can never be edited.

-- ---------------------------------------------------------------- tables ----
create table public.fee_adjustments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  kind text not null check (kind in ('discount_sibling', 'discount_staff', 'scholarship', 'waiver', 'arrears', 'late_fee', 'transport', 'meals', 'other')),
  amount numeric(12,2) not null check (amount <> 0 and abs(amount) <= 10000000),
  reason text not null check (char_length(btrim(reason)) >= 3 and char_length(reason) <= 300),
  term_name text,                                       -- null = applies to the whole year
  standing boolean not null default false,              -- survives a year rollover (e.g. a scholarship)
  source text not null default 'manual' check (source in ('manual', 'rule', 'system')),
  active boolean not null default true,
  expires_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_adjustments_sign check (
    (kind in ('discount_sibling', 'discount_staff', 'scholarship', 'waiver') and amount < 0)
    or (kind in ('arrears', 'late_fee', 'transport', 'meals') and amount > 0)
    or kind = 'other')
);
create index fee_adjustments_student_idx on public.fee_adjustments (student_id) where active;
create index fee_adjustments_school_idx on public.fee_adjustments (school_id, kind);
create unique index fee_adjustments_late_once on public.fee_adjustments (student_id, coalesce(term_name, '')) where kind = 'late_fee' and active;
comment on table public.fee_adjustments is 'Every charge that is not a plain fee item. Each row carries its reason so any figure on a statement can be explained.';

create table public.school_fee_rules (
  school_id uuid primary key references public.schools (id) on delete cascade,
  sibling_from_child integer not null default 2 check (sibling_from_child between 2 and 10),
  sibling_discount_percent numeric(5,2) not null default 0 check (sibling_discount_percent between 0 and 100),
  staff_discount_percent numeric(5,2) not null default 0 check (staff_discount_percent between 0 and 100),
  scholarship_percent numeric(5,2) not null default 0 check (scholarship_percent between 0 and 100),
  late_fee_enabled boolean not null default false,
  late_fee_kind text not null default 'percent' check (late_fee_kind in ('percent', 'flat')),
  late_fee_value numeric(12,2) not null default 0 check (late_fee_value >= 0),
  late_fee_grace_days integer not null default 0 check (late_fee_grace_days between 0 and 365),
  carry_arrears boolean not null default true,
  arrears_term_name text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (char_length(btrim(name)) >= 2),
  vehicle text, driver_name text, driver_phone text,
  amounts numeric(12,2)[] not null default array[0, 0, 0] check (cardinality(amounts) = 3 and 0 <= all (amounts)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index transport_routes_name_key on public.transport_routes (school_id, lower(btrim(name))) where active;

create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (char_length(btrim(name)) >= 2),
  description text,
  amounts numeric(12,2)[] not null default array[0, 0, 0] check (cardinality(amounts) = 3 and 0 <= all (amounts)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index meal_plans_name_key on public.meal_plans (school_id, lower(btrim(name))) where active;

create table public.fee_structure_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  version integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  term_names text[] not null default array['Term 1', 'Term 2', 'Term 3'] check (cardinality(term_names) = 3),
  published_at timestamptz not null default now(),
  published_by uuid,
  superseded_at timestamptz,
  unique (school_id, version)
);
create index fee_structure_history_school_idx on public.fee_structure_history (school_id, published_at desc);

-- ------------------------------------------------------- student columns ----
alter table public.students
  add column transport_route_id uuid references public.transport_routes (id) on delete set null,
  add column meal_plan_id uuid references public.meal_plans (id) on delete set null,
  add column staff_child boolean not null default false,
  add column scholar boolean not null default false,
  add column cycle_start timestamptz not null default '-infinity';      -- payments / one-off adjustments before this belong to a closed year
create index students_transport_idx on public.students (school_id, transport_route_id) where transport_route_id is not null;
create index students_meal_idx on public.students (school_id, meal_plan_id) where meal_plan_id is not null;

-- adjustments only through fee_adjustments (audited, with a reason); the browser may only flag staff child / scholar / route / plan
revoke insert (adjustment), update (adjustment) on public.students from authenticated;
grant update (transport_route_id, meal_plan_id, staff_child, scholar) on public.students to authenticated;

-- new columns are appended at the END (Postgres does not allow inserting columns into the middle of a view)
drop view public.student_balances;
create view public.student_balances with (security_invoker = true) as
select s.id, s.school_id, s.admission_no, s.full_name, s.class_name, s.gender, s.boarding, s.guardian_name, s.guardian_phone, s.verified, s.active,
  s.total_fee, s.adjustment, (s.total_fee + s.adjustment) as total_due,
  coalesce(p.paid, 0::numeric) as paid,
  greatest(s.total_fee + s.adjustment - coalesce(p.paid, 0), 0) as balance,
  greatest(coalesce(p.paid, 0) - (s.total_fee + s.adjustment), 0) as credit,
  case when (s.total_fee + s.adjustment) <= 0 and coalesce(p.paid, 0) = 0 then 'no_fee'
       when coalesce(p.paid, 0) >= (s.total_fee + s.adjustment) then 'paid'
       when coalesce(p.paid, 0) > 0 then 'partial' else 'unpaid' end as fee_status,
  p.last_payment_at, s.created_at,
  s.transport_route_id, s.meal_plan_id, s.staff_child, s.scholar, s.cycle_start
from public.students s
left join lateral (select sum(py.amount) as paid, max(py.completed_at) as last_payment_at from public.payments py
                   where py.student_id = s.id and py.status = 'completed' and py.completed_at >= s.cycle_start) p on true;
grant select on public.student_balances to authenticated;

-- ------------------------------------------------------------- functions ----
-- students.adjustment = sum of this pupil's active, unexpired adjustments (one-off rows only count for the current year)
create function private.recalc_student_adjustment(p_student uuid) returns void language sql security definer set search_path = '' as $$
  update public.students s set adjustment = coalesce((
      select sum(fa.amount) from public.fee_adjustments fa
      where fa.student_id = s.id and fa.active
        and (fa.expires_on is null or fa.expires_on >= (now() at time zone 'Africa/Nairobi')::date)
        and (fa.standing or fa.created_at >= s.cycle_start)), 0), updated_at = now()
  where s.id = p_student
$$;

create function private.fee_adjustments_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.students s where s.id = new.student_id and s.school_id = new.school_id) then
      raise exception 'The pupil does not belong to this school' using errcode = '23514';
    end if;
  else
    -- amounts are never edited by a user; the one exception is a route/plan price change refreshing its own system rows (nested trigger)
    if new.school_id <> old.school_id or new.student_id <> old.student_id or new.kind <> old.kind
       or (new.amount <> old.amount and not (old.source = 'system' and pg_trigger_depth() > 1)) then
      raise exception 'An adjustment cannot be edited. Remove it and add a new one.' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger fee_adjustments_guard before insert or update on public.fee_adjustments for each row execute function private.fee_adjustments_guard();

create function private.fee_adjustments_after() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform private.recalc_student_adjustment(old.student_id); return null; end if;
  perform private.recalc_student_adjustment(new.student_id);
  if tg_op = 'INSERT' then
    insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
    values (new.school_id, (select auth.uid()), 'fee_adjustment_added', 'fee_adjustments', new.id::text,
            jsonb_build_object('kind', new.kind, 'amount', new.amount, 'reason', new.reason, 'student_id', new.student_id));
  elsif tg_op = 'UPDATE' and new.active is distinct from old.active then
    insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
    values (new.school_id, (select auth.uid()), case when new.active then 'fee_adjustment_restored' else 'fee_adjustment_removed' end, 'fee_adjustments', new.id::text,
            jsonb_build_object('kind', new.kind, 'amount', new.amount, 'student_id', new.student_id));
  end if;
  return null;
end $$;
create trigger fee_adjustments_after after insert or update or delete on public.fee_adjustments for each row execute function private.fee_adjustments_after();

-- one row per service: the whole year's charge (sum of the three term amounts). Re-assigning replaces the old row.
create function private.sync_service_charges() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_route public.transport_routes; v_plan public.meal_plans; v_amt numeric;
begin
  if new.transport_route_id is distinct from old.transport_route_id then
    update public.fee_adjustments set active = false where student_id = new.id and kind = 'transport' and source = 'system' and active;
    if new.transport_route_id is not null then
      select * into v_route from public.transport_routes where id = new.transport_route_id and school_id = new.school_id and active;
      select coalesce(sum(a), 0) into v_amt from unnest(coalesce(v_route.amounts, '{}')) a;
      if v_route.id is not null and v_amt > 0 then
        insert into public.fee_adjustments (school_id, student_id, kind, amount, reason, source, standing) values (new.school_id, new.id, 'transport', v_amt, 'Transport: ' || v_route.name, 'system', false);
      end if;
    end if;
  end if;
  if new.meal_plan_id is distinct from old.meal_plan_id then
    update public.fee_adjustments set active = false where student_id = new.id and kind = 'meals' and source = 'system' and active;
    if new.meal_plan_id is not null then
      select * into v_plan from public.meal_plans where id = new.meal_plan_id and school_id = new.school_id and active;
      select coalesce(sum(a), 0) into v_amt from unnest(coalesce(v_plan.amounts, '{}')) a;
      if v_plan.id is not null and v_amt > 0 then
        insert into public.fee_adjustments (school_id, student_id, kind, amount, reason, source, standing) values (new.school_id, new.id, 'meals', v_amt, 'Meals: ' || v_plan.name, 'system', false);
      end if;
    end if;
  end if;
  return null;
end $$;
create trigger students_sync_service_charges after update of transport_route_id, meal_plan_id on public.students for each row execute function private.sync_service_charges();

-- a route/plan must belong to the pupil's own school
create function private.students_service_check() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.transport_route_id is not null and not exists (select 1 from public.transport_routes r where r.id = new.transport_route_id and r.school_id = new.school_id) then
    raise exception 'That bus route belongs to another school' using errcode = '23514';
  end if;
  if new.meal_plan_id is not null and not exists (select 1 from public.meal_plans m where m.id = new.meal_plan_id and m.school_id = new.school_id) then
    raise exception 'That meal plan belongs to another school' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger students_service_check before update of transport_route_id, meal_plan_id on public.students for each row execute function private.students_service_check();

-- editing a route/plan's prices updates the pupils on it; removing it takes them off
create function private.service_changed() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_amt numeric := (select coalesce(sum(a), 0) from unnest(new.amounts) a); v_kind text := case tg_table_name when 'transport_routes' then 'transport' else 'meals' end;
begin
  if not new.active and old.active then
    if v_kind = 'transport' then update public.students set transport_route_id = null where transport_route_id = new.id;
    else update public.students set meal_plan_id = null where meal_plan_id = new.id; end if;
  elsif new.amounts is distinct from old.amounts or new.name is distinct from old.name then
    update public.fee_adjustments fa set amount = v_amt, reason = case v_kind when 'transport' then 'Transport: ' else 'Meals: ' end || new.name
    from public.students s
    where fa.student_id = s.id and fa.kind = v_kind and fa.source = 'system' and fa.active and v_amt > 0
      and ((v_kind = 'transport' and s.transport_route_id = new.id) or (v_kind = 'meals' and s.meal_plan_id = new.id));
    perform private.recalc_student_adjustment(s.id) from public.students s where (v_kind = 'transport' and s.transport_route_id = new.id) or (v_kind = 'meals' and s.meal_plan_id = new.id);
  end if;
  return null;
end $$;
create trigger transport_routes_changed after update on public.transport_routes for each row execute function private.service_changed();
create trigger meal_plans_changed after update on public.meal_plans for each row execute function private.service_changed();

-- late fees: only the pupil's own school, once per pupil per term, only after the term deadline + grace days
create function public.apply_late_fees(p_school_id uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare v_rules public.school_fee_rules; v_term public.terms; v_deadline date; v_charged integer;
begin
  if (select private.my_school_id()) is distinct from p_school_id then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into v_rules from public.school_fee_rules where school_id = p_school_id;
  if v_rules.school_id is null or not v_rules.late_fee_enabled or v_rules.late_fee_value <= 0 then return 0; end if;
  select * into v_term from public.terms t where t.school_id = p_school_id and t.deadline is not null and t.deadline < (now() at time zone 'Africa/Nairobi')::date
    order by t.deadline desc limit 1;
  if v_term.id is null then return 0; end if;
  v_deadline := v_term.deadline + v_rules.late_fee_grace_days;
  if (now() at time zone 'Africa/Nairobi')::date <= v_deadline then return 0; end if;
  with ins as (
    insert into public.fee_adjustments (school_id, student_id, kind, amount, reason, term_name, source)
    select p_school_id, sb.id, 'late_fee',
           round(case when v_rules.late_fee_kind = 'percent' then sb.balance * v_rules.late_fee_value / 100.0 else v_rules.late_fee_value end, 2),
           'Late fee: payment overdue since ' || to_char(v_deadline, 'DD Mon YYYY'), v_term.name, 'system'
    from public.student_balances sb
    where sb.school_id = p_school_id and sb.active and sb.verified and sb.balance > 0
      and round(case when v_rules.late_fee_kind = 'percent' then sb.balance * v_rules.late_fee_value / 100.0 else v_rules.late_fee_value end, 2) > 0
    on conflict do nothing returning 1)
  select count(*) into v_charged from ins;
  return v_charged;
end $$;

-- every published version is kept: the NEW structure becomes the latest version, the previous one is marked superseded
create function private.archive_fee_structure() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data and new.term_names is not distinct from old.term_names then return null; end if;
  select coalesce(max(version), 0) + 1 into v_version from public.fee_structure_history where school_id = new.school_id;
  update public.fee_structure_history set superseded_at = now() where school_id = new.school_id and superseded_at is null;
  insert into public.fee_structure_history (school_id, version, data, term_names, published_at, published_by)
  values (new.school_id, v_version, new.data, new.term_names, coalesce(new.published_at, now()), new.published_by);
  return null;
end $$;
create trigger fee_published_archive after insert or update on public.fee_structure_published for each row execute function private.archive_fee_structure();
insert into public.fee_structure_history (school_id, version, data, term_names, published_at, published_by)
select school_id, 1, data, term_names, published_at, published_by from public.fee_structure_published;

-- adjustments with an expiry date switch themselves off the day after
create function private.expire_adjustments() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with e as (update public.fee_adjustments set active = false where active and expires_on is not null and expires_on < (now() at time zone 'Africa/Nairobi')::date returning 1)
  select count(*) into n from e;
  return n;
end $$;
select cron.schedule('feeflow-expire-adjustments', '5 21 * * *', 'select private.expire_adjustments()');

-- ------------------------------------------------------ privileges and RLS --
revoke all on function public.apply_late_fees(uuid) from public, anon;
grant execute on function public.apply_late_fees(uuid) to authenticated;
revoke all on function private.recalc_student_adjustment(uuid), private.expire_adjustments() from public, anon, authenticated;

grant select, update (active), delete on public.fee_adjustments to authenticated;
grant insert (school_id, student_id, kind, amount, reason, term_name, standing, source, expires_on) on public.fee_adjustments to authenticated;
grant select, insert, update on public.school_fee_rules to authenticated;
grant select, insert, update on public.transport_routes to authenticated;
grant select, insert, update on public.meal_plans to authenticated;
grant select on public.fee_structure_history to authenticated;

alter table public.fee_adjustments enable row level security;
alter table public.school_fee_rules enable row level security;
alter table public.transport_routes enable row level security;
alter table public.meal_plans enable row level security;
alter table public.fee_structure_history enable row level security;

create policy fee_adjustments_select on public.fee_adjustments for select to authenticated
  using (school_id = (select private.my_school_id()) or (active and student_id in (select private.my_student_ids())));
create policy fee_adjustments_insert on public.fee_adjustments for insert to authenticated with check (school_id = (select private.my_school_id()));
create policy fee_adjustments_update on public.fee_adjustments for update to authenticated using (school_id = (select private.my_school_id())) with check (school_id = (select private.my_school_id()));
create policy fee_adjustments_delete on public.fee_adjustments for delete to authenticated using (school_id = (select private.my_school_id()) and source = 'rule');

create policy school_fee_rules_all on public.school_fee_rules for all to authenticated using (school_id = (select private.my_school_id())) with check (school_id = (select private.my_school_id()));
create policy transport_routes_all on public.transport_routes for all to authenticated using (school_id = (select private.my_school_id())) with check (school_id = (select private.my_school_id()));
create policy meal_plans_all on public.meal_plans for all to authenticated using (school_id = (select private.my_school_id())) with check (school_id = (select private.my_school_id()));
create policy fee_structure_history_select on public.fee_structure_history for select to authenticated using (school_id = (select private.my_school_id()));
