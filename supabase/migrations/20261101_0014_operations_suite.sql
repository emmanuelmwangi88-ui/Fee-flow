-- 0014 — Operations suite
--   A. hardening + indexes (school admins can no longer edit id / created_at / registered_by / admin_note)
--   B. staff roles (owner, head, bursar, secretary) + invitations
--   C. bulk student import
--   D. class promotion / year rollover with arrears carried forward
--   E. payment reversals (maker-checker)
--   F. instalment plans
--   G. fee clearance certificates
--   H. subscription invoices (issued and settled by the Super Admin)
--   I. support tickets
--   J. platform health report for the Super Admin
-- Everything that changes money or records runs inside SECURITY DEFINER functions that check the caller's
-- school and staff role. The tables themselves are read-only to the browser.

-- ===================================================================== A
drop index if exists public.students_transport_idx;
drop index if exists public.students_meal_idx;
create index if not exists students_transport_route_idx on public.students (transport_route_id);
create index if not exists students_meal_plan_idx on public.students (meal_plan_id);
create index if not exists schools_registered_by_idx on public.schools (registered_by);

alter table public.schools add column if not exists trial_ends_at timestamptz default (now() + interval '30 days');

revoke update on public.schools from authenticated;
grant update (name, location, level, paybill, plan, status, sms_sender, updated_at, address, phone, settings, mpesa_mode, admin_note, trial_ends_at)
  on public.schools to authenticated;

create or replace function private.schools_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.is_super_admin() then
    if new.plan is distinct from old.plan or new.status is distinct from old.status
       or new.level is distinct from old.level or new.mpesa_mode is distinct from old.mpesa_mode
       or new.admin_note is distinct from old.admin_note or new.trial_ends_at is distinct from old.trial_ends_at then
      raise exception 'Only the platform Super Admin can change plan, status, level, M-Pesa mode, admin notes or trial dates' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ===================================================================== B
alter table public.profiles add column if not exists staff_role text not null default 'owner'
  check (staff_role in ('owner', 'head', 'bursar', 'secretary'));
grant select (staff_role) on public.profiles to authenticated;

create function private.require_staff(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_school uuid; v_role text;
begin
  select school_id, staff_role into v_school, v_role from public.profiles
   where id = (select auth.uid()) and role = 'school_admin';
  if v_school is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not (v_role = any (p_roles)) then
    raise exception 'Your staff role (%) cannot do this', v_role using errcode = '42501';
  end if;
  return v_school;
end $$;
revoke all on function private.require_staff(text[]) from public, anon, authenticated;

create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  staff_role text not null check (staff_role in ('owner', 'head', 'bursar', 'secretary')),
  invited_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid
);
create unique index staff_invites_open on public.staff_invites (school_id, email) where accepted_at is null;
create index staff_invites_email_idx on public.staff_invites (email) where accepted_at is null;
alter table public.staff_invites enable row level security;   -- no policies: every access goes through the functions below

create function public.list_staff() returns table (user_id uuid, invite_id uuid, full_name text, email text, staff_role text, since timestamptz, pending boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner', 'head', 'bursar', 'secretary']);
begin
  return query
    select p.id, null::uuid, p.full_name, u.email::text, p.staff_role, p.created_at, false
      from public.profiles p join auth.users u on u.id = p.id
     where p.school_id = v_school and p.role = 'school_admin'
    union all
    select null::uuid, i.id, null::text, i.email, i.staff_role, i.created_at, true
      from public.staff_invites i where i.school_id = v_school and i.accepted_at is null
    order by 7, 3;
end $$;

create function public.invite_staff(p_email text, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner']); v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if p_role not in ('owner', 'head', 'bursar', 'secretary') then raise exception 'Choose a role' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = '22023'; end if;
  if exists (select 1 from public.profiles p join auth.users u on u.id = p.id where p.school_id = v_school and lower(u.email) = v_email) then
    raise exception 'That person is already on your staff' using errcode = '23505';
  end if;
  insert into public.staff_invites (school_id, email, staff_role) values (v_school, v_email, p_role) returning id into v_id;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_school, (select auth.uid()), 'staff_invited', 'staff_invites', v_id::text, jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
exception when unique_violation then
  raise exception 'That email already has an open invitation' using errcode = '23505';
end $$;

create function public.cancel_staff_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner']);
begin
  delete from public.staff_invites where id = p_invite and school_id = v_school and accepted_at is null;
end $$;

create function public.set_staff_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner']); v_old text;
begin
  if p_role not in ('owner', 'head', 'bursar', 'secretary') then raise exception 'Choose a role' using errcode = '22023'; end if;
  select staff_role into v_old from public.profiles where id = p_user and school_id = v_school and role = 'school_admin';
  if v_old is null then raise exception 'That person is not on your staff' using errcode = 'P0002'; end if;
  if v_old = 'owner' and p_role <> 'owner'
     and (select count(*) from public.profiles where school_id = v_school and role = 'school_admin' and staff_role = 'owner') <= 1 then
    raise exception 'The school must keep at least one owner' using errcode = '23514';
  end if;
  update public.profiles set staff_role = p_role where id = p_user;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_school, (select auth.uid()), 'staff_role_changed', 'profiles', p_user::text, jsonb_build_object('from', v_old, 'to', p_role));
end $$;

create function public.remove_staff(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner']); v_old text;
begin
  if p_user = (select auth.uid()) then raise exception 'You cannot remove yourself' using errcode = '23514'; end if;
  select staff_role into v_old from public.profiles where id = p_user and school_id = v_school and role = 'school_admin';
  if v_old is null then raise exception 'That person is not on your staff' using errcode = 'P0002'; end if;
  delete from public.profiles where id = p_user;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_school, (select auth.uid()), 'staff_removed', 'profiles', p_user::text, jsonb_build_object('role', v_old));
end $$;

-- A person who signs up with an invited, CONFIRMED email address joins that school with the invited role.
create function public.accept_staff_invite(p_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; v_confirmed timestamptz; v_inv public.staff_invites;
begin
  if v_uid is null then raise exception 'You must be signed in' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'This account is already set up' using errcode = '23505';
  end if;
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null then raise exception 'Confirm your email address first' using errcode = '28000'; end if;
  select * into v_inv from public.staff_invites where email = v_email and accepted_at is null order by created_at limit 1;
  if v_inv.id is null then raise exception 'No staff invitation was found for this email address' using errcode = 'P0002'; end if;
  insert into public.profiles (id, role, school_id, full_name, staff_role)
  values (v_uid, 'school_admin', v_inv.school_id, coalesce(nullif(btrim(p_name), ''), split_part(v_email, '@', 1)), v_inv.staff_role);
  update public.staff_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_inv.school_id, v_uid, 'staff_joined', 'profiles', v_uid::text, jsonb_build_object('role', v_inv.staff_role));
  return v_inv.school_id;
end $$;

-- ===================================================================== C
create function public.import_students(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid := private.require_staff(array['owner', 'head', 'secretary']);
  r jsonb; i int := 0; ins int := 0; upd int := 0; errs jsonb := '[]'::jsonb;
  adm text; nm text; cls text; v_exists boolean; v_boarding boolean;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Send the rows as a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Import at most 2000 pupils at a time' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      adm := btrim(coalesce(r->>'admission_no', '')); nm := btrim(coalesce(r->>'full_name', '')); cls := btrim(coalesce(r->>'class_name', ''));
      if adm = '' or nm = '' or cls = '' then raise exception 'Admission number, name and class are required' using errcode = '22023'; end if;
      if char_length(nm) < 2 then raise exception 'The name is too short' using errcode = '22023'; end if;
      v_boarding := lower(coalesce(r->>'boarding', '')) in ('true', 'yes', 'y', '1', 'boarder', 'boarding');
      select exists (select 1 from public.students where school_id = v_school and upper(btrim(admission_no)) = upper(adm)) into v_exists;
      insert into public.students (school_id, admission_no, full_name, class_name, gender, boarding, guardian_name, guardian_phone)
      values (v_school, adm, nm, cls, nullif(btrim(coalesce(r->>'gender', '')), ''), v_boarding,
              nullif(btrim(coalesce(r->>'guardian_name', '')), ''), nullif(btrim(coalesce(r->>'guardian_phone', '')), ''))
      on conflict (school_id, (upper(btrim(admission_no)))) do update set
        full_name = excluded.full_name, class_name = excluded.class_name, boarding = excluded.boarding,
        gender = coalesce(excluded.gender, public.students.gender),
        guardian_name = coalesce(excluded.guardian_name, public.students.guardian_name),
        guardian_phone = coalesce(excluded.guardian_phone, public.students.guardian_phone),
        updated_at = now();
      if v_exists then upd := upd + 1; else ins := ins + 1; end if;
    exception when others then
      errs := errs || jsonb_build_object('row', i, 'admission_no', coalesce(r->>'admission_no', ''), 'message', sqlerrm);
    end;
  end loop;
  insert into public.audit_log (school_id, actor_id, action, entity, details)
  values (v_school, (select auth.uid()), 'students_imported', 'students', jsonb_build_object('added', ins, 'updated', upd, 'rejected', jsonb_array_length(errs)));
  return jsonb_build_object('inserted', ins, 'updated', upd, 'errors', errs);
end $$;

-- ===================================================================== D
create function public.promote_students(p_moves jsonb, p_carry boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid := private.require_staff(array['owner', 'head']);
  m jsonb; v_from text; v_to text; s record; v_new text; v_stream text; v_bal numeric; v_credit numeric;
  moved int := 0; leavers int := 0; carried int := 0; v_done uuid[] := '{}';
begin
  if p_moves is null or jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) = 0 then
    raise exception 'Choose at least one class to move' using errcode = '22023';
  end if;
  if jsonb_array_length(p_moves) > 60 then raise exception 'Too many classes in one run' using errcode = '22023'; end if;
  for m in select * from jsonb_array_elements(p_moves) loop
    v_from := btrim(coalesce(m->>'from', '')); v_to := btrim(coalesce(m->>'to', ''));
    if v_from = '' then raise exception 'Each move needs a class to move from' using errcode = '22023'; end if;
    for s in select id, class_name from public.students
              where school_id = v_school and active and private.norm_grade(class_name) = private.norm_grade(v_from)
                and not (id = any (v_done)) loop
      v_done := v_done || s.id;
      select balance, credit into v_bal, v_credit from public.student_balances where id = s.id;
      -- the new carry-forward replaces last year's, which is already inside the balance
      update public.fee_adjustments set active = false
       where student_id = s.id and active and (kind = 'arrears' or (kind = 'other' and source = 'system' and standing));
      if v_to = '' then
        update public.students set active = false, cycle_start = now() where id = s.id;
        leavers := leavers + 1;
      else
        v_stream := (regexp_match(s.class_name, '[0-9]([A-Z])$'))[1];
        v_new := v_to || coalesce(v_stream, '');
        update public.students set class_name = v_new, cycle_start = now() where id = s.id;
        moved := moved + 1;
      end if;
      if p_carry and coalesce(v_bal, 0) > 0 then
        insert into public.fee_adjustments (school_id, student_id, kind, amount, reason, standing, source)
        values (v_school, s.id, 'arrears', v_bal, 'Balance brought forward from ' || s.class_name, true, 'system');
        carried := carried + 1;
      end if;
      if coalesce(v_credit, 0) > 0 then
        insert into public.fee_adjustments (school_id, student_id, kind, amount, reason, standing, source)
        values (v_school, s.id, 'other', -v_credit, 'Credit brought forward from ' || s.class_name, true, 'system');
      end if;
      perform private.recalc_student_adjustment(s.id);
    end loop;
  end loop;
  insert into public.audit_log (school_id, actor_id, action, entity, details)
  values (v_school, (select auth.uid()), 'students_promoted', 'students',
          jsonb_build_object('moved', moved, 'left', leavers, 'arrears_carried', carried, 'carry', p_carry));
  return jsonb_build_object('moved', moved, 'left', leavers, 'arrears_carried', carried);
end $$;

-- ===================================================================== E
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
    -- the only way out of "completed" is an approved reversal (decide_payment_reversal sets this flag for its own transaction)
    if old.status = 'completed' and new.status <> 'completed'
       and not (new.status = 'cancelled' and coalesce(current_setting('feeflow.reversal', true), '') = 'on') then
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

create table public.payment_reversals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 5 and 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300)
);
create unique index payment_reversals_one_pending on public.payment_reversals (payment_id) where status = 'pending';
create index payment_reversals_school_idx on public.payment_reversals (school_id, status, requested_at desc);
alter table public.payment_reversals enable row level security;
create policy payment_reversals_select on public.payment_reversals for select to authenticated
  using (school_id = (select private.my_school_id()));
grant select on public.payment_reversals to authenticated;

create function public.request_payment_reversal(p_payment uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner', 'bursar']); v_pay public.payments; v_id uuid;
begin
  select * into v_pay from public.payments where id = p_payment and school_id = v_school;
  if v_pay.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if v_pay.status <> 'completed' then raise exception 'Only completed payments can be reversed' using errcode = '22023'; end if;
  insert into public.payment_reversals (school_id, payment_id, reason) values (v_school, p_payment, btrim(p_reason)) returning id into v_id;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_school, (select auth.uid()), 'reversal_requested', 'payments', p_payment::text, jsonb_build_object('reason', btrim(p_reason), 'amount', v_pay.amount));
  return v_id;
exception when unique_violation then
  raise exception 'A reversal is already waiting for approval on this payment' using errcode = '23505';
end $$;

create function public.decide_payment_reversal(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner', 'head']); v_rev public.payment_reversals; v_uid uuid := (select auth.uid()); v_staff int;
begin
  select * into v_rev from public.payment_reversals where id = p_id and school_id = v_school for update;
  if v_rev.id is null then raise exception 'Reversal not found' using errcode = 'P0002'; end if;
  if v_rev.status <> 'pending' then raise exception 'This reversal was already decided' using errcode = '22023'; end if;
  select count(*) into v_staff from public.profiles where school_id = v_school and role = 'school_admin';
  if p_approve and v_rev.requested_by = v_uid and v_staff > 1 then
    raise exception 'A different staff member must approve a reversal you requested' using errcode = '42501';
  end if;
  if p_approve then
    perform set_config('feeflow.reversal', 'on', true);
    update public.payments set status = 'cancelled',
           note = left(coalesce(note || ' · ', '') || 'Reversed: ' || v_rev.reason, 300)
     where id = v_rev.payment_id and status = 'completed';
    perform set_config('feeflow.reversal', '', true);
  end if;
  update public.payment_reversals set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_uid, decided_at = now(), decision_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300)
   where id = p_id;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_school, v_uid, case when p_approve then 'reversal_approved' else 'reversal_rejected' end, 'payments', v_rev.payment_id::text,
          jsonb_build_object('reason', v_rev.reason, 'self_approved', v_rev.requested_by = v_uid));
end $$;

-- ===================================================================== F
create table public.instalment_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  parts integer not null check (parts between 2 and 6),
  balance_at_creation numeric(12,2) not null check (balance_at_creation > 0),
  paid_at_creation numeric(12,2) not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index instalment_plans_student_idx on public.instalment_plans (student_id, active);
create index instalment_plans_school_idx on public.instalment_plans (school_id);
create table public.instalment_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.instalment_plans (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  seq integer not null check (seq >= 1),
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  unique (plan_id, seq)
);
create index instalment_items_student_idx on public.instalment_items (student_id);
create index instalment_items_school_idx on public.instalment_items (school_id);
alter table public.instalment_plans enable row level security;
alter table public.instalment_items enable row level security;
create policy instalment_plans_select on public.instalment_plans for select to authenticated
  using (school_id = (select private.my_school_id()) or (active and student_id in (select private.my_student_ids())));
create policy instalment_items_select on public.instalment_items for select to authenticated
  using (school_id = (select private.my_school_id()) or student_id in (select private.my_student_ids()));
grant select on public.instalment_plans, public.instalment_items to authenticated;

create function public.create_instalment_plan(p_student uuid, p_parts integer, p_first_due date, p_gap_days integer default 30) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner', 'head', 'bursar']); v_bal numeric; v_paid numeric; v_plan uuid; v_each numeric; i int; v_amt numeric;
begin
  if p_parts not between 2 and 6 then raise exception 'Choose 2 to 6 instalments' using errcode = '22023'; end if;
  if p_gap_days not between 7 and 120 then raise exception 'Instalments must be 7 to 120 days apart' using errcode = '22023'; end if;
  if p_first_due is null or p_first_due < (now() at time zone 'Africa/Nairobi')::date then raise exception 'The first due date cannot be in the past' using errcode = '22023'; end if;
  select balance, paid into v_bal, v_paid from public.student_balances where id = p_student and school_id = v_school;
  if v_bal is null then raise exception 'Pupil not found' using errcode = 'P0002'; end if;
  if v_bal <= 0 then raise exception 'This pupil has nothing outstanding' using errcode = '22023'; end if;
  update public.instalment_plans set active = false where student_id = p_student and active;
  insert into public.instalment_plans (school_id, student_id, parts, balance_at_creation, paid_at_creation)
  values (v_school, p_student, p_parts, v_bal, v_paid) returning id into v_plan;
  v_each := round(v_bal / p_parts, 2);
  for i in 1..p_parts loop
    v_amt := case when i = p_parts then v_bal - v_each * (p_parts - 1) else v_each end;
    insert into public.instalment_items (plan_id, school_id, student_id, seq, due_date, amount)
    values (v_plan, v_school, p_student, i, p_first_due + (i - 1) * p_gap_days, v_amt);
  end loop;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_school, (select auth.uid()), 'instalment_plan_created', 'students', p_student::text, jsonb_build_object('parts', p_parts, 'balance', v_bal));
  return v_plan;
end $$;

create function public.cancel_instalment_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner', 'head', 'bursar']);
begin
  update public.instalment_plans set active = false where id = p_plan and school_id = v_school;
end $$;

-- ===================================================================== G
create sequence private.clearance_seq;
create table public.clearance_certificates (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  serial text not null unique,
  label text,
  issued_by uuid default auth.uid(),
  issued_at timestamptz not null default now()
);
create index clearance_school_idx on public.clearance_certificates (school_id, issued_at desc);
create index clearance_student_idx on public.clearance_certificates (student_id);
alter table public.clearance_certificates enable row level security;
create policy clearance_select on public.clearance_certificates for select to authenticated
  using (school_id = (select private.my_school_id()) or student_id in (select private.my_student_ids()));
grant select on public.clearance_certificates to authenticated;

create function public.issue_clearance(p_student uuid, p_label text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner', 'head', 'bursar']); v_bal numeric; v_name text; v_adm text; v_serial text; v_at timestamptz;
begin
  select balance, full_name, admission_no into v_bal, v_name, v_adm from public.student_balances where id = p_student and school_id = v_school;
  if v_name is null then raise exception 'Pupil not found' using errcode = 'P0002'; end if;
  if v_bal > 0 then raise exception 'This pupil still owes KES %. Clearance is only issued when the balance is nil.', to_char(v_bal, 'FM999,999,990') using errcode = '22023'; end if;
  v_serial := 'CLR-' || to_char(now() at time zone 'Africa/Nairobi', 'YYYY') || '-' || lpad(nextval('private.clearance_seq')::text, 5, '0');
  insert into public.clearance_certificates (school_id, student_id, serial, label) values (v_school, p_student, v_serial, left(nullif(btrim(coalesce(p_label, '')), ''), 80))
    returning issued_at into v_at;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_school, (select auth.uid()), 'clearance_issued', 'students', p_student::text, jsonb_build_object('serial', v_serial));
  return jsonb_build_object('serial', v_serial, 'issued_at', v_at, 'full_name', v_name, 'admission_no', v_adm);
end $$;

-- ===================================================================== H
create sequence private.invoice_seq;
create table public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  number text not null unique,
  description text not null check (char_length(btrim(description)) between 3 and 200),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  due_date date not null,
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  payment_ref text,
  created_by uuid default auth.uid()
);
create index subscription_invoices_school_idx on public.subscription_invoices (school_id, issued_at desc);
alter table public.subscription_invoices enable row level security;
create policy subscription_invoices_select on public.subscription_invoices for select to authenticated
  using (school_id = (select private.my_school_id()) or (select private.is_super_admin()));
grant select on public.subscription_invoices to authenticated;

create function public.issue_invoice(p_school uuid, p_amount numeric, p_description text, p_due date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_no text;
begin
  if not (select private.is_super_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.schools where id = p_school) then raise exception 'School not found' using errcode = 'P0002'; end if;
  v_no := 'INV-' || to_char(now() at time zone 'Africa/Nairobi', 'YYYY') || '-' || lpad(nextval('private.invoice_seq')::text, 5, '0');
  insert into public.subscription_invoices (school_id, number, description, amount, due_date) values (p_school, v_no, btrim(p_description), p_amount, p_due) returning id into v_id;
  insert into public.notifications (audience, school_id, type, title, body)
  values ('school', p_school, 'billing', 'New invoice ' || v_no, 'KES ' || to_char(p_amount, 'FM999,999,990') || ' is due on ' || to_char(p_due, 'DD Mon YYYY') || '.');
  return v_id;
end $$;

create function public.settle_invoice(p_id uuid, p_paid boolean, p_ref text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_super_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.subscription_invoices
     set status = case when p_paid then 'paid' else 'void' end,
         paid_at = case when p_paid then now() else null end,
         payment_ref = case when p_paid then left(nullif(btrim(coalesce(p_ref, '')), ''), 60) else null end
   where id = p_id and status = 'unpaid';
end $$;

-- ===================================================================== I
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  created_by uuid default auth.uid(),
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  category text not null default 'general' check (category in ('general', 'payments', 'mpesa', 'data', 'billing', 'bug')),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_school_idx on public.support_tickets (school_id, updated_at desc);
create index support_tickets_status_idx on public.support_tickets (status, updated_at desc);
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  author_id uuid default auth.uid(),
  from_platform boolean not null default false,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
create index support_messages_school_idx on public.support_messages (school_id);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (school_id = (select private.my_school_id()) or (select private.is_super_admin()));
create policy support_messages_select on public.support_messages for select to authenticated
  using (school_id = (select private.my_school_id()) or (select private.is_super_admin()));
grant select on public.support_tickets, public.support_messages to authenticated;

create function public.open_ticket(p_subject text, p_category text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_school uuid := private.require_staff(array['owner', 'head', 'bursar', 'secretary']); v_id uuid; v_name text;
begin
  insert into public.support_tickets (school_id, subject, category) values (v_school, btrim(p_subject), coalesce(nullif(btrim(p_category), ''), 'general')) returning id into v_id;
  insert into public.support_messages (ticket_id, school_id, body) values (v_id, v_school, btrim(p_body));
  select name into v_name from public.schools where id = v_school;
  insert into public.notifications (audience, type, title, body) values ('super', 'support', 'Support request from ' || v_name, btrim(p_subject));
  return v_id;
end $$;

create function public.reply_ticket(p_ticket uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t public.support_tickets; v_super boolean := (select private.is_super_admin()); v_school uuid;
begin
  select * into v_t from public.support_tickets where id = p_ticket;
  if v_t.id is null then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  if not v_super then
    v_school := private.require_staff(array['owner', 'head', 'bursar', 'secretary']);
    if v_school <> v_t.school_id then raise exception 'Not allowed' using errcode = '42501'; end if;
  end if;
  if v_t.status = 'closed' then raise exception 'This ticket is closed. Open a new one.' using errcode = '22023'; end if;
  insert into public.support_messages (ticket_id, school_id, from_platform, body) values (p_ticket, v_t.school_id, v_super, btrim(p_body));
  update public.support_tickets set status = case when v_super then 'answered' else 'open' end, updated_at = now() where id = p_ticket;
  if v_super then
    insert into public.notifications (audience, school_id, type, title, body) values ('school', v_t.school_id, 'support', 'Reply to your support request', v_t.subject);
  end if;
end $$;

create function public.close_ticket(p_ticket uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t public.support_tickets; v_super boolean := (select private.is_super_admin());
begin
  select * into v_t from public.support_tickets where id = p_ticket;
  if v_t.id is null then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  if not v_super and v_t.school_id <> private.require_staff(array['owner', 'head', 'bursar', 'secretary']) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.support_tickets set status = 'closed', updated_at = now() where id = p_ticket;
end $$;

-- ===================================================================== J
create function public.platform_health() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_cron int;
begin
  if not (select private.is_super_admin()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  begin
    select count(*) into v_cron from cron.job_run_details where status = 'failed' and start_time > now() - interval '24 hours';
  exception when others then v_cron := null;
  end;
  select jsonb_build_object(
    'schools_active', (select count(*) from public.schools where status = 'active'),
    'schools_suspended', (select count(*) from public.schools where status = 'suspended'),
    'payments_pending_over_1h', (select count(*) from public.payments where status = 'pending' and created_at < now() - interval '1 hour'),
    'payments_failed_24h', (select count(*) from public.payments where status in ('failed', 'timeout') and created_at > now() - interval '24 hours'),
    'payments_completed_24h', (select count(*) from public.payments where status = 'completed' and completed_at > now() - interval '24 hours'),
    'tickets_open', (select count(*) from public.support_tickets where status = 'open'),
    'invoices_overdue', (select count(*) from public.subscription_invoices where status = 'unpaid' and due_date < current_date),
    'trials_ending_7d', (select count(*) from public.schools where plan = 'Trial' and trial_ends_at between now() and now() + interval '7 days'),
    'cron_failures_24h', v_cron,
    'checked_at', now()) into v;
  return v;
end $$;

-- ================================================================ grants
revoke all on function
  public.list_staff(), public.invite_staff(text, text), public.cancel_staff_invite(uuid), public.set_staff_role(uuid, text), public.remove_staff(uuid),
  public.accept_staff_invite(text), public.import_students(jsonb), public.promote_students(jsonb, boolean),
  public.request_payment_reversal(uuid, text), public.decide_payment_reversal(uuid, boolean, text),
  public.create_instalment_plan(uuid, integer, date, integer), public.cancel_instalment_plan(uuid), public.issue_clearance(uuid, text),
  public.issue_invoice(uuid, numeric, text, date), public.settle_invoice(uuid, boolean, text),
  public.open_ticket(text, text, text), public.reply_ticket(uuid, text), public.close_ticket(uuid), public.platform_health()
from public, anon;
grant execute on function
  public.list_staff(), public.invite_staff(text, text), public.cancel_staff_invite(uuid), public.set_staff_role(uuid, text), public.remove_staff(uuid),
  public.accept_staff_invite(text), public.import_students(jsonb), public.promote_students(jsonb, boolean),
  public.request_payment_reversal(uuid, text), public.decide_payment_reversal(uuid, boolean, text),
  public.create_instalment_plan(uuid, integer, date, integer), public.cancel_instalment_plan(uuid), public.issue_clearance(uuid, text),
  public.issue_invoice(uuid, numeric, text, date), public.settle_invoice(uuid, boolean, text),
  public.open_ticket(text, text, text), public.reply_ticket(uuid, text), public.close_ticket(uuid), public.platform_health()
to authenticated;
