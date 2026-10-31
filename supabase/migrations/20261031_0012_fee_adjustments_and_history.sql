-- 0012 — fee adjustments, arrears & late fees, transport/meal charges, fee-structure history
--
-- Design note: public.student_balances derives total_due as (total_fee + adjustment).
-- Rather than change that view, every kind of charge adjustment below is written into
-- ONE table (public.fee_adjustments) and students.adjustment is kept as the sum of the
-- active rows by a trigger. One source of truth, and the view keeps working untouched.
--
-- Kinds and their sign:
--   discount_sibling, discount_staff, scholarship, waiver  -> negative (reduces the bill)
--   arrears, late_fee, transport, meals                    -> positive (increases the bill)
--
-- Requires: 0001 (core), 0002 (student_balances), 0003 (RLS/grant pattern)

-- ---------------------------------------------------------------- adjustments --
create table if not exists public.fee_adjustments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  kind text not null check (kind in (
    'discount_sibling', 'discount_staff', 'scholarship', 'waiver',
    'arrears', 'late_fee', 'transport', 'meals', 'other'
  )),
  -- signed: negative = money off, positive = money on
  amount numeric(12,2) not null check (amount <> 0),
  reason text not null check (char_length(btrim(reason)) >= 3),
  -- which term this charge belongs to; null = applies every term (e.g. a standing waiver)
  term_name text,
  -- standing rows (a scholarship) survive rollover; one-off rows do not
  standing boolean not null default false,
  active boolean not null default true,
  expires_on date,                              -- e.g. a one-term scholarship
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fee_adjustments_student_idx on public.fee_adjustments (student_id) where active;
create index if not exists fee_adjustments_school_idx on public.fee_adjustments (school_id, kind);
comment on table public.fee_adjustments is
  'Every charge that is not a plain fee item: discounts, bursaries, waivers, carried arrears, late fees, transport and meal charges. Each row carries the reason, so the school can explain any figure on a statement.';

-- ------------------------------------------------------------- fee rules ------
-- What the school decides once, rather than per student.
create table if not exists public.school_fee_rules (
  school_id uuid primary key references public.schools (id) on delete cascade,
  -- automatic discounts
  sibling_from_child integer not null default 2 check (sibling_from_child between 2 and 10),
  sibling_discount_percent numeric(5,2) not null default 0 check (sibling_discount_percent between 0 and 100),
  staff_discount_percent numeric(5,2) not null default 0 check (staff_discount_percent between 0 and 100),
  scholarship_percent numeric(5,2) not null default 0 check (scholarship_percent between 0 and 100),
  -- late fees
  late_fee_enabled boolean not null default false,
  late_fee_kind text not null default 'percent' check (late_fee_kind in ('percent', 'flat')),
  late_fee_value numeric(12,2) not null default 0 check (late_fee_value >= 0),
  late_fee_grace_days integer not null default 0 check (late_fee_grace_days between 0 and 365),
  -- arrears
  carry_arrears boolean not null default true,   -- move unpaid balances into next term
  arrears_term_name text,                        -- the term the carried balance came from
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.school_fee_rules is
  'School-wide fee policy: whether late fees apply, how they are calculated, and whether unpaid balances carry forward.';

-- --------------------------------------------------- transport & meal plans ---
-- A route or plan is charged to whoever is assigned to it. Amounts are per term.
create table if not exists public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (char_length(btrim(name)) >= 2),
  vehicle text,
  driver_name text,
  driver_phone text,
  -- one amount per term, in term order
  amounts numeric(12,2)[] not null default array[0, 0, 0] check (cardinality(amounts) = 3),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists transport_routes_name_key on public.transport_routes (school_id, lower(btrim(name)));
create index if not exists transport_routes_school_idx on public.transport_routes (school_id) where active;

create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (char_length(btrim(name)) >= 2),
  description text,
  amounts numeric(12,2)[] not null default array[0, 0, 0] check (cardinality(amounts) = 3),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists meal_plans_name_key on public.meal_plans (school_id, lower(btrim(name)));
create index if not exists meal_plans_school_idx on public.meal_plans (school_id) where active;

-- which route / plan a pupil is on. Changing it writes a new adjustment row.
alter table public.students
  add column if not exists transport_route_id uuid references public.transport_routes (id) on delete set null,
  add column if not exists meal_plan_id uuid references public.meal_plans (id) on delete set null,
  add column if not exists staff_child boolean not null default false,
  add column if not exists scholar boolean not null default false;
create index if not exists students_transport_idx on public.students (school_id, transport_route_id) where transport_route_id is not null;
create index if not exists students_meal_idx on public.students (school_id, meal_plan_id) where meal_plan_id is not null;

-- The balances view is what every page reads, so the new pupil flags ride along with it.
create or replace view public.student_balances with (security_invoker = true) as
select
  s.id, s.school_id, s.admission_no, s.full_name, s.class_name, s.gender, s.boarding,
  s.guardian_name, s.guardian_phone, s.verified, s.active,
  s.transport_route_id, s.meal_plan_id, s.staff_child, s.scholar,
  s.total_fee, s.adjustment,
  (s.total_fee + s.adjustment) as total_due,
  coalesce(p.paid, 0) as paid,
  greatest((s.total_fee + s.adjustment) - coalesce(p.paid, 0), 0) as balance,
  greatest(coalesce(p.paid, 0) - (s.total_fee + s.adjustment), 0) as credit,
  case
    when (s.total_fee + s.adjustment) <= 0 and coalesce(p.paid, 0) = 0 then 'no_fee'
    when coalesce(p.paid, 0) >= (s.total_fee + s.adjustment) then 'paid'
    when coalesce(p.paid, 0) > 0 then 'partial'
    else 'unpaid'
  end as fee_status,
  p.last_payment_at,
  s.created_at
from public.students s
left join lateral (
  select sum(amount) as paid, max(completed_at) as last_payment_at
  from public.payments
  where student_id = s.id and status = 'completed'
) p on true;

-- ------------------------------------------------- fee-structure history ------
-- A full copy of what was published, so the school can show what each term's fees were.
create table if not exists public.fee_structure_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  version integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  term_names text[] not null default array['Term 1', 'Term 2', 'Term 3'] check (cardinality(term_names) = 3),
  published_at timestamptz not null default now(),
  published_by uuid,
  superseded_at timestamptz
);
create unique index if not exists fee_structure_history_version_key on public.fee_structure_history (school_id, version);
create index if not exists fee_structure_history_school_idx on public.fee_structure_history (school_id, published_at desc);

-- ------------------------------------------------------------- functions ------

-- Keep students.adjustment equal to the sum of active, unexpired adjustments.
-- Called by the trigger below; also safe to call directly after a bulk import.
create or replace function private.recalc_student_adjustment(p_student uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.students s
     set adjustment = coalesce((
           select sum(fa.amount)
             from public.fee_adjustments fa
            where fa.student_id = s.id
              and fa.active
              and (fa.expires_on is null or fa.expires_on >= current_date)
         ), 0),
         updated_at = now()
   where s.id = p_student;
$$;

create or replace function private.recalc_adjustment_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.student_id, old.student_id);
begin
  perform private.recalc_student_adjustment(target);
  return coalesce(new, old);
end $$;

drop trigger if exists fee_adjustments_recalc on public.fee_adjustments;
create trigger fee_adjustments_recalc
  after insert or update or delete on public.fee_adjustments
  for each row execute function private.recalc_adjustment_trigger();

-- Changing a pupil's route or plan writes (or refreshes) the matching adjustment row,
-- so a bus-route fee can never silently go missing.
create or replace function private.sync_service_charges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_term text := (select coalesce(t.name, 'Term 1') from public.terms t where t.school_id = new.school_id order by t.start_date desc nulls last limit 1);
  v_route public.transport_routes;
  v_plan public.meal_plans;
begin
  if new.transport_route_id is distinct from old.transport_route_id then
    update public.fee_adjustments
       set active = false, updated_at = now()
     where student_id = new.id and kind = 'transport' and standing = false;

    if new.transport_route_id is not null then
      select * into v_route from public.transport_routes where id = new.transport_route_id;
      if v_route.id is not null and coalesce(v_route.amounts[1], 0) <> 0 then
        insert into public.fee_adjustments
          (school_id, student_id, kind, amount, reason, term_name)
        values
          (new.school_id, new.id, 'transport', v_route.amounts[1],
           'Transport — ' || v_route.name, v_term);
      end if;
    end if;
  end if;

  if new.meal_plan_id is distinct from old.meal_plan_id then
    update public.fee_adjustments
       set active = false, updated_at = now()
     where student_id = new.id and kind = 'meals' and standing = false;

    if new.meal_plan_id is not null then
      select * into v_plan from public.meal_plans where id = new.meal_plan_id;
      if v_plan.id is not null and coalesce(v_plan.amounts[1], 0) <> 0 then
        insert into public.fee_adjustments
          (school_id, student_id, kind, amount, reason, term_name)
        values
          (new.school_id, new.id, 'meals', v_plan.amounts[1],
           'Meals — ' || v_plan.name, v_term);
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists students_sync_service_charges on public.students;
create trigger students_sync_service_charges
  after update of transport_route_id, meal_plan_id on public.students
  for each row execute function private.sync_service_charges();

-- Late fees: applied only once per student per term, only after the grace period.
-- Returns the number of students charged. Safe to call repeatedly.
create or replace function public.apply_late_fees(p_school_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules public.school_fee_rules;
  v_term public.terms;
  v_deadline date;
  v_charged integer := 0;
  v_row record;
begin
  select * into v_rules from public.school_fee_rules where school_id = p_school_id;
  if v_rules.school_id is null or not v_rules.late_fee_enabled or v_rules.late_fee_value <= 0 then
    return 0;
  end if;

  select * into v_term
    from public.terms t
   where t.school_id = p_school_id
   order by t.start_date desc nulls last
   limit 1;
  if v_term.school_id is null or v_term.deadline is null then
    return 0;
  end if;

  v_deadline := v_term.deadline + v_rules.late_fee_grace_days;
  if current_date <= v_deadline then
    return 0;   -- still inside the grace window
  end if;

  for v_row in
    select s.id, sb.balance
      from public.students s
      join public.student_balances sb on sb.id = s.id
     where s.school_id = p_school_id
       and s.active
       and sb.balance > 0
       -- not already charged a late fee for this term
       and not exists (
         select 1 from public.fee_adjustments fa
          where fa.student_id = s.id
            and fa.kind = 'late_fee'
            and fa.active
            and fa.term_name is not distinct from v_term.name
       )
  loop
    insert into public.fee_adjustments
      (school_id, student_id, kind, amount, reason, term_name)
    values
      (p_school_id, v_row.id, 'late_fee',
       case when v_rules.late_fee_kind = 'percent'
            then round(v_row.balance * v_rules.late_fee_value / 100.0, 2)
            else v_rules.late_fee_value end,
       'Late fee — payment overdue since ' || to_char(v_deadline, 'DD Mon YYYY'),
       v_term.name);
    v_charged := v_charged + 1;
  end loop;

  return v_charged;
end $$;

-- Archive a copy of every published structure, so past terms can be shown.
create or replace function private.archive_fee_structure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid;
  v_data jsonb;
  v_terms text[];
  v_version integer;
begin
  if tg_op = 'INSERT' then
    v_school := new.school_id;
    v_data   := new.data;
    v_terms  := new.term_names;
  else
    -- nothing actually changed: skip the archive
    if new.data is not distinct from old.data and new.term_names = old.term_names then
      return new;
    end if;
    v_school := old.school_id;
    v_data   := old.data;
    v_terms  := old.term_names;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.fee_structure_history
   where school_id = v_school;

  -- whatever is current right now stops being current
  update public.fee_structure_history
     set superseded_at = now()
   where school_id = v_school
     and superseded_at is null;

  insert into public.fee_structure_history
    (school_id, version, data, term_names, published_at, published_by)
  values
    (v_school, v_version, v_data, v_terms, now(), auth.uid());

  return coalesce(new, old);
end $$;

drop trigger if exists fee_published_archive on public.fee_structure_published;
create trigger fee_published_archive
  after insert or update on public.fee_structure_published
  for each row execute function private.archive_fee_structure();

-- ------------------------------------------------------------------ grants ----
revoke all on function public.apply_late_fees(uuid) from public, anon;
grant execute on function public.apply_late_fees(uuid) to authenticated;

grant select, insert, update, delete on public.fee_adjustments to authenticated;
grant select, insert, update on public.school_fee_rules to authenticated;
grant select, insert, update on public.transport_routes to authenticated;
grant select, insert, update on public.meal_plans to authenticated;
grant select on public.fee_structure_history to authenticated;

-- -------------------------------------------------------------------- RLS -----
-- Same shape as 0003/0005: school-scoped reads, staff-only writes, super-admin allowed.
-- Note: app_role currently holds only super_admin | school_admin | parent, so "staff"
-- means a school_admin (or the super-admin). Separate bursar/head-teacher/secretary
-- logins are deliberately out of scope here.
alter table public.fee_adjustments        enable row level security;
alter table public.school_fee_rules       enable row level security;
alter table public.transport_routes       enable row level security;
alter table public.meal_plans             enable row level security;
alter table public.fee_structure_history  enable row level security;

do $$
declare
  t text;
begin
  -- writes are staff-only: a school_admin (or the super-admin). Parents can read but never write.
  for t in
    select unnest(array['fee_adjustments', 'school_fee_rules', 'transport_routes', 'meal_plans'])
  loop
    execute format($fmt$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (school_id = (select private.my_school_id()) or (select private.is_super_admin()))
    $fmt$, t);

    execute format($fmt$
      create policy %1$s_write on public.%1$I
        for all to authenticated
        using (
          (select private.my_school_id()) is not null
          and school_id = (select private.my_school_id())
        )
        or (select private.is_super_admin())
        with check (
          (select private.my_school_id()) is not null
          and school_id = (select private.my_school_id())
        )
        or (select private.is_super_admin())
    $fmt$, t);
  end loop;
end $$;

-- History is written only by the archive trigger, never by a client.
create policy fee_structure_history_select on public.fee_structure_history
  for select to authenticated
  using (school_id = (select private.my_school_id()) or (select private.is_super_admin()));
revoke insert, update, delete on public.fee_structure_history from authenticated;
