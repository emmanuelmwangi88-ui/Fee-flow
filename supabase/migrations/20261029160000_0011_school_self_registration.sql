-- Schools register themselves, then wait for the platform Super Admin to approve them.
alter table public.schools drop constraint schools_status_check;
alter table public.schools add constraint schools_status_check check (status in ('pending', 'active', 'suspended', 'rejected'));
alter table public.schools add column if not exists registered_by uuid references auth.users (id) on delete set null;
alter table public.schools add column if not exists admin_note text;

-- Called by the new user right after sign-up / first sign-in. Creates a PENDING school and links the caller as its admin.
create or replace function public.register_school(p_name text, p_level text, p_location text, p_phone text, p_admin_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_phone text := nullif(btrim(p_phone), '');
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'This account is already set up' using errcode = '23505';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 3 or char_length(p_name) > 120 then
    raise exception 'Enter the full school name' using errcode = '22023';
  end if;
  if p_level not in ('Primary Only', 'Secondary Only', 'Primary & Secondary') then
    raise exception 'Choose whether the school is primary, secondary or both' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_admin_name, ''))) < 2 then raise exception 'Enter your name' using errcode = '22023'; end if;
  if v_phone is not null then
    v_phone := private.normalize_ke_phone(v_phone);
    if v_phone is null then raise exception 'Enter a valid phone number' using errcode = '22023'; end if;
  end if;
  insert into public.schools (name, level, location, phone, status, plan, registered_by)
  values (btrim(p_name), p_level, nullif(btrim(coalesce(p_location, '')), ''), v_phone, 'pending', 'Trial', v_uid)
  returning id into v_id;
  insert into public.profiles (id, role, school_id, full_name, phone) values (v_uid, 'school_admin', v_id, btrim(p_admin_name), v_phone);
  return v_id;
end $$;
revoke all on function public.register_school(text, text, text, text, text) from public, anon;
grant execute on function public.register_school(text, text, text, text, text) to authenticated;

create or replace function private.schools_notify_super() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (audience, type, title, body)
  values ('super', 'platform',
          case when new.status = 'pending' then 'New school waiting for approval' else 'School added' end,
          case when new.status = 'pending' then new.name || ' registered and is waiting for your approval.' else new.name || ' was added to the platform.' end);
  return null;
end $$;
