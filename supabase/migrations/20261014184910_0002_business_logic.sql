-- FeeFlow business logic: helpers, fee totals, payment rules, notifications, views, RPCs

-- ---------- role helpers used by RLS policies ----------
create function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create function private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'super_admin')
$$;

create function private.my_school_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select school_id from public.profiles where id = (select auth.uid()) and role = 'school_admin'
$$;

create function private.my_parent_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.parents where user_id = (select auth.uid())
$$;

create function private.my_parent_school_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select school_id from public.parents where user_id = (select auth.uid())
$$;

create function private.my_student_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select ps.student_id
  from public.parent_students ps
  join public.parents p on p.id = ps.parent_id
  where p.user_id = (select auth.uid()) and ps.status = 'active'
$$;

-- ---------- fee totals (replaces the browser-side calculation in the fee manager) ----------
-- Returns NULL when the school has no published grade matching the class.
create function private.compute_total_fee(p_school uuid, p_class text, p_boarding boolean) returns numeric
language sql stable security definer set search_path = '' as $$
  with grade as (
    select g
    from public.fee_structure_published fp,
         jsonb_array_elements(coalesce(fp.data -> 'levels', '[]'::jsonb)) lvl,
         jsonb_array_elements(coalesce(lvl -> 'grades', '[]'::jsonb)) g
    where fp.school_id = p_school
      and private.norm_grade(g ->> 'name') = private.norm_grade(p_class)
    limit 1
  ),
  amts as (
    select f, a
    from grade,
         jsonb_array_elements(coalesce(grade.g -> 'fees', '[]'::jsonb)) f,
         jsonb_array_elements_text(coalesce(f -> 'amounts', '[]'::jsonb)) a
  )
  select case when exists (select 1 from grade) then
    coalesce(sum(case
      when (f ->> 'boarderOnly') in ('true', 't', '1') and not coalesce(p_boarding, false) then 0
      when a ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then a::numeric
      else 0 end), 0)
  end
  from amts
$$;

-- ---------- students ----------
create function private.students_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_fee numeric;
begin
  new.admission_no := btrim(new.admission_no);
  new.full_name := btrim(new.full_name);
  new.class_name := btrim(new.class_name);

  if new.guardian_phone is not null and btrim(new.guardian_phone) <> '' then
    new.guardian_phone := private.normalize_ke_phone(new.guardian_phone);
    if new.guardian_phone is null then
      raise exception 'Invalid guardian phone number' using errcode = '22023';
    end if;
  else
    new.guardian_phone := null;
  end if;

  if tg_op = 'UPDATE' and new.school_id <> old.school_id then
    raise exception 'A student cannot move between schools' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or new.class_name is distinct from old.class_name or new.boarding is distinct from old.boarding then
    v_fee := private.compute_total_fee(new.school_id, new.class_name, new.boarding);
    if v_fee is not null then
      new.total_fee := v_fee;
    elsif tg_op = 'INSERT' then
      new.total_fee := 0;
    end if;
  end if;
  return new;
end $$;
create trigger students_before_write before insert or update on public.students
  for each row execute function private.students_before_write();

-- ---------- payments: integrity, receipt numbers, notifications ----------
create function private.payments_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_school uuid;
begin
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
create trigger payments_before_write before insert or update on public.payments
  for each row execute function private.payments_before_write();

create function private.payments_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_amt text;
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    select full_name into v_name from public.students where id = new.student_id;
    v_amt := 'KES ' || to_char(new.amount, 'FM999,999,999,990.00');

    insert into public.notifications (audience, school_id, parent_id, student_id, type, title, body)
    values ('school', new.school_id, new.parent_id, new.student_id, 'payment', 'Payment Received — Receipt Ready',
            v_amt || ' received for ' || v_name || '. Receipt ' || new.receipt_no || ' is ready.');

    insert into public.notifications (audience, school_id, parent_id, student_id, type, title, body)
    select 'parent', new.school_id, ps.parent_id, new.student_id, 'payment', 'Payment Confirmed',
           v_amt || ' received for ' || v_name || '. Receipt ' || new.receipt_no || ' is ready.'
    from public.parent_students ps
    where ps.student_id = new.student_id and ps.status = 'active';

    insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
    values (new.school_id, (select auth.uid()), 'payment_completed', 'payments', new.id::text,
            jsonb_build_object('amount', new.amount, 'method', new.method,
                               'receipt_no', new.receipt_no, 'student_id', new.student_id));
  end if;
  return null;
end $$;
create trigger payments_after_write after insert or update on public.payments
  for each row execute function private.payments_after_write();

-- ---------- publishing a fee structure recomputes every student's total ----------
create function private.fee_published_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.students s
  set total_fee = t.fee, updated_at = now()
  from (
    select class_name, boarding, private.compute_total_fee(new.school_id, class_name, boarding) as fee
    from public.students
    where school_id = new.school_id
    group by class_name, boarding
  ) t
  where s.school_id = new.school_id
    and s.class_name = t.class_name
    and s.boarding = t.boarding
    and t.fee is not null;

  insert into public.notifications (audience, school_id, parent_id, type, title, body)
  select 'parent', p.school_id, p.id, 'fee-report', 'New Fee Structure Published',
         sc.name || ' published an updated fee structure. Open Fee Reports to view it.'
  from public.parents p
  join public.schools sc on sc.id = p.school_id
  where p.school_id = new.school_id;

  insert into public.audit_log (school_id, actor_id, action, entity, entity_id)
  values (new.school_id, (select auth.uid()), 'fee_structure_published', 'fee_structure_published', new.school_id::text);
  return null;
end $$;
create trigger fee_published_after after insert or update on public.fee_structure_published
  for each row execute function private.fee_published_after();

-- ---------- approving a parent-child link ----------
create function private.parent_students_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.students set verified = true where id = new.student_id and verified = false;

    insert into public.notifications (audience, school_id, parent_id, student_id, type, title, body)
    select 'parent', s.school_id, new.parent_id, s.id, 'link-approved', 'Child linked',
           s.full_name || ' is now linked to your account.'
    from public.students s where s.id = new.student_id;

    insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
    select s.school_id, (select auth.uid()), 'parent_link_approved', 'parent_students', new.student_id::text,
           jsonb_build_object('parent_id', new.parent_id)
    from public.students s where s.id = new.student_id;
  end if;
  return null;
end $$;
create trigger parent_students_after_update after update of status on public.parent_students
  for each row execute function private.parent_students_after_update();

-- ---------- schools: only Super Admin may change plan / status / level; audit trail ----------
create function private.schools_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.is_super_admin() then
    if new.plan is distinct from old.plan or new.status is distinct from old.status or new.level is distinct from old.level then
      raise exception 'Only the platform Super Admin can change plan, status or level' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger schools_guard before update on public.schools
  for each row execute function private.schools_guard();

create function private.schools_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if tg_op = 'DELETE' then v_id := old.id; else v_id := new.id; end if;
  insert into public.audit_log (school_id, actor_id, action, entity, entity_id, details)
  values (v_id, (select auth.uid()), 'school_' || lower(tg_op), 'schools', v_id::text,
          case tg_op
            when 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
            when 'INSERT' then to_jsonb(new)
            else to_jsonb(old)
          end);
  return null;
end $$;
create trigger schools_audit after insert or update or delete on public.schools
  for each row execute function private.schools_audit();

-- ---------- balances are always derived from CONFIRMED payments ----------
create view public.student_balances with (security_invoker = true) as
select
  s.id, s.school_id, s.admission_no, s.full_name, s.class_name, s.gender, s.boarding,
  s.guardian_name, s.guardian_phone, s.verified, s.active,
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

-- ---------- parent self-service (the only way a parent row / link is created) ----------
create function public.register_parent(p_school_id uuid, p_name text, p_phone text, p_email text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_phone text;
  v_role public.app_role;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;
  v_phone := private.normalize_ke_phone(p_phone);
  if v_phone is null then
    raise exception 'Enter a valid Kenyan phone number' using errcode = '22023';
  end if;
  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'Enter your full name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.schools where id = p_school_id and status = 'active') then
    raise exception 'School not found' using errcode = '22023';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is not null and v_role <> 'parent' then
    raise exception 'This account cannot be used as a parent account' using errcode = '42501';
  end if;
  if v_role is null then
    insert into public.profiles (id, role, full_name, phone) values (v_uid, 'parent', btrim(p_name), v_phone);
  end if;

  insert into public.parents (user_id, school_id, full_name, phone, email)
  values (v_uid, p_school_id, btrim(p_name), v_phone, nullif(btrim(coalesce(p_email, '')), ''))
  returning id into v_id;

  insert into public.notifications (audience, school_id, parent_id, type, title, body)
  select 'parent', p_school_id, v_id, 'system', 'Registration Complete!',
         btrim(p_name) || ' registered as a parent for ' || sc.name || '.'
  from public.schools sc where sc.id = p_school_id;

  return v_id;
exception when unique_violation then
  raise exception 'A parent account with this phone number or login already exists at this school' using errcode = '23505';
end $$;

-- Returns 'active' (linked) or 'pending' (needs school approval). Never reveals whether an admission number exists.
create function public.claim_child(p_parent_id uuid, p_admission_no text, p_child_name text, p_class text, p_gender text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_parent public.parents;
  v_student public.students;
  v_adm text := btrim(coalesce(p_admission_no, ''));
  v_status text;
begin
  if v_uid is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;
  select * into v_parent from public.parents where id = p_parent_id and user_id = v_uid;
  if not found then
    raise exception 'Parent account not found' using errcode = '42501';
  end if;
  if v_adm = '' then
    raise exception 'Enter the admission number' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_child_name, ''))) < 2 then
    raise exception 'Enter the child''s name' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_class, ''))) < 1 then
    raise exception 'Select the child''s class' using errcode = '22023';
  end if;
  if (select count(*) from public.parent_students where parent_id = v_parent.id and status = 'pending') >= 10 then
    raise exception 'Too many pending link requests. Please wait for the school to review them.' using errcode = '54000';
  end if;

  select * into v_student from public.students
  where school_id = v_parent.school_id and upper(btrim(admission_no)) = upper(v_adm);

  if found then
    if v_parent.phone_verified and v_student.guardian_phone is not null and v_student.guardian_phone = v_parent.phone then
      v_status := 'active';
    else
      v_status := 'pending';
    end if;
  else
    insert into public.students (school_id, admission_no, full_name, class_name, gender, verified)
    values (v_parent.school_id, v_adm, btrim(p_child_name), btrim(p_class), nullif(btrim(coalesce(p_gender, '')), ''), false)
    returning * into v_student;
    v_status := 'pending';
  end if;

  insert into public.parent_students (parent_id, student_id, status)
  values (v_parent.id, v_student.id, v_status)
  on conflict (parent_id, student_id) do nothing;

  if v_status = 'pending' then
    insert into public.notifications (audience, school_id, parent_id, student_id, type, title, body)
    values ('school', v_parent.school_id, v_parent.id, v_student.id, 'link-request', 'Parent link request',
            v_parent.full_name || ' asked to link a child (adm. ' || v_adm || '). Review it under Students.');
  end if;
  return v_status;
end $$;

-- ---------- function privileges ----------
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.current_app_role(), private.is_super_admin(), private.my_school_id(),
  private.my_parent_ids(), private.my_parent_school_ids(), private.my_student_ids()
  to authenticated;

revoke execute on function public.register_parent(uuid, text, text, text) from public, anon;
revoke execute on function public.claim_child(uuid, text, text, text, text) from public, anon;
grant execute on function public.register_parent(uuid, text, text, text) to authenticated;
grant execute on function public.claim_child(uuid, text, text, text, text) to authenticated;

-- ---------- realtime (parent screen waits for payment confirmation) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.payments;
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
