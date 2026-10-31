-- Schools register themselves, then log in.
--
-- Before this migration the only way a school could exist was a Super Admin
-- running the `admin-create-school` edge function, so a brand-new school was
-- stuck at a 401 (the function checks for a super_admin profile, which the new
-- account does not have). This gives the sign-up flow a database function it is
-- allowed to call: `public.register_school`.
--
-- Called right after `supabase.auth.signUp()` from portal.html, i.e. the caller
-- is the brand-new authenticated user and nothing else:
--   * creates the school (status active, Trial plan, paybill if given)
--   * creates that user's profile as `school_admin` of that school
--   * seeds the three academic terms the school will fill in
--   * writes the school a welcome notification
--
-- SECURITY DEFINER on purpose: the `schools_insert` RLS policy in 0003 is
-- super-admin only, so an ordinary authenticated user cannot insert a school
-- directly. Everything this function writes is scoped to `auth.uid()`, which is
-- the caller's own brand-new account — it can never touch another school.

create or replace function public.register_school(
  p_name        text,
  p_admin_name  text,
  p_location    text default null,
  p_level       text default null,
  p_paybill     text default null,
  p_phone       text default null,
  p_address     text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_school   uuid;
  v_role     public.app_role;
  v_phone    text;
  v_paybill  text;
  v_level    text;
  v_year     int := extract(year from now())::int;
  v_admin    text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to register a school' using errcode = '28000';
  end if;

  -- One school per login: a fresh account has no profile yet, and an account
  -- that already has one must not be able to create a second school.
  select role into v_role from public.profiles where id = v_uid;
  if v_role is not null then
    raise exception 'This account is already set up as a % — log in with a new account to register another school', v_role
      using errcode = '23505';
  end if;

  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'Enter the school name' using errcode = '22023';
  end if;
  v_admin := btrim(coalesce(p_admin_name, ''));
  if char_length(v_admin) < 2 then
    raise exception 'Enter the administrator''s full name' using errcode = '22023';
  end if;

  v_paybill := nullif(btrim(coalesce(p_paybill, '')), '');
  if v_paybill is not null and v_paybill !~ '^[0-9]{5,7}$' then
    raise exception 'The M-Pesa paybill number must be 5 to 7 digits' using errcode = '22023';
  end if;

  v_phone := case
    when coalesce(btrim(coalesce(p_phone, '')), '') = '' then null
    else private.normalize_ke_phone(p_phone)
  end;
  if coalesce(btrim(coalesce(p_phone, '')), '') <> '' and v_phone is null then
    raise exception 'Enter a valid Kenyan phone number, e.g. 0712 345 678' using errcode = '22023';
  end if;

  v_level := nullif(btrim(coalesce(p_level, '')), '');
  if v_level is not null and v_level !~* '^(primary|secondary)' then
    raise exception 'Choose whether this is a primary or a secondary school' using errcode = '22023';
  end if;

  -- ---------- the school ----------
  insert into public.schools (name, location, level, paybill, phone, address, plan, status)
  values (btrim(p_name), nullif(btrim(coalesce(p_location, '')), ''), v_level,
          v_paybill, v_phone, nullif(btrim(coalesce(p_address, '')), ''), 'Trial', 'active')
  returning id into v_school;

  -- ---------- this user becomes its school admin ----------
  insert into public.profiles (id, role, school_id, full_name, phone)
  values (v_uid, 'school_admin', v_school, v_admin, v_phone);

  -- ---------- three terms of the current school year (the school edits them) ----------
  insert into public.terms (school_id, name, start_date, end_date, status)
  values
    (v_school, 'Term 1', make_date(v_year, 1, 5),  make_date(v_year, 4, 4),  'active'),
    (v_school, 'Term 2', make_date(v_year, 5, 5),  make_date(v_year, 8, 1),  'upcoming'),
    (v_school, 'Term 3', make_date(v_year, 9, 1),  make_date(v_year, 11, 21), 'upcoming');

  -- ---------- say hello ----------
  insert into public.notifications (audience, school_id, type, title, body)
  values ('school', v_school, 'system', 'Welcome to FeeFlow',
          'Your school is registered. Next: add your students, then publish your fee structure so parents can see what to pay.');

  -- the Super Admin is told by the schools_notify_super trigger in 0005.

  return v_school;

exception when unique_violation then
  raise exception 'A school with these details already exists' using errcode = '23505';
end $$;

revoke execute on function public.register_school(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.register_school(text, text, text, text, text, text, text) to authenticated;
