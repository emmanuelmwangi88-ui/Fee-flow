-- FeeFlow core schema: tables, types, helper functions (no policies yet; see 0003)

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.app_role as enum ('super_admin', 'school_admin', 'parent');
create type public.payment_status as enum ('pending', 'completed', 'failed', 'cancelled', 'timeout');
create type public.payment_method as enum ('mpesa_stk', 'mpesa_c2b', 'cash', 'bank', 'cheque');

create sequence private.receipt_seq;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Normalises Kenyan numbers to 2547XXXXXXXX / 2541XXXXXXXX (same rules as the front end). NULL if invalid.
create function private.normalize_ke_phone(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^254[71][0-9]{8}$' then return d;
  elsif d ~ '^0[71][0-9]{8}$' then return '254' || substr(d, 2);
  elsif d ~ '^[71][0-9]{8}$' then return '254' || d;
  end if;
  return null;
end $$;

-- Same normalisation the fee manager used in JS to match a student's class to a grade.
create function private.norm_grade(v text) returns text
language sql immutable set search_path = '' as $$
  select lower(btrim(regexp_replace(regexp_replace(coalesce(v, ''), '[A-Z]$', ''), '^Class ', 'Grade '), E' \t\r\n'))
$$;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) >= 2),
  location text,
  level text,
  paybill text check (paybill is null or paybill ~ '^[0-9]{5,7}$'),
  plan text not null default 'Trial' check (plan in ('Trial', 'Standard', 'Premium')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  sms_sender text check (sms_sender is null or char_length(sms_sender) <= 11),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null,
  school_id uuid references public.schools (id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  constraint profiles_school_admin_needs_school check (role <> 'school_admin' or school_id is not null)
);
create index profiles_school_id_idx on public.profiles (school_id);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  admission_no text not null check (char_length(btrim(admission_no)) >= 1),
  full_name text not null check (char_length(btrim(full_name)) >= 2),
  class_name text not null check (char_length(btrim(class_name)) >= 1),
  gender text,
  boarding boolean not null default false,
  guardian_name text,
  guardian_phone text,
  total_fee numeric(12,2) not null default 0 check (total_fee >= 0),
  adjustment numeric(12,2) not null default 0,
  verified boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index students_school_adm_key on public.students (school_id, upper(btrim(admission_no)));
create index students_school_class_idx on public.students (school_id, class_name);
create index students_guardian_phone_idx on public.students (school_id, guardian_phone);

create table public.parents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  full_name text not null,
  phone text not null,
  email text,
  phone_verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, school_id),
  unique (school_id, phone)
);

create table public.parent_students (
  parent_id uuid not null references public.parents (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  status text not null default 'pending' check (status in ('active', 'pending', 'rejected')),
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);
create index parent_students_student_idx on public.parent_students (student_id);

-- Admin's working copy of the fee structure (never visible to parents)
create table public.fee_structures (
  school_id uuid primary key references public.schools (id) on delete cascade,
  draft jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object'),
  term_names text[] not null default array['Term 1', 'Term 2', 'Term 3'] check (cardinality(term_names) = 3),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- What parents see. Writing here recomputes every student's total (see 0002)
create table public.fee_structure_published (
  school_id uuid primary key references public.schools (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  term_names text[] not null default array['Term 1', 'Term 2', 'Term 3'] check (cardinality(term_names) = 3),
  published_at timestamptz not null default now(),
  published_by uuid
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  parent_id uuid references public.parents (id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  method public.payment_method not null,
  status public.payment_status not null default 'pending',
  phone text,
  account_reference text,
  merchant_request_id text,
  checkout_request_id text,
  mpesa_receipt text,
  receipt_no text,
  result_code integer,
  result_desc text,
  raw_callback jsonb,
  note text,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint payments_manual_has_recorder check (method in ('mpesa_stk', 'mpesa_c2b') or recorded_by is not null)
);
create unique index payments_checkout_request_key on public.payments (checkout_request_id) where checkout_request_id is not null;
create unique index payments_mpesa_receipt_key on public.payments (mpesa_receipt) where mpesa_receipt is not null;
create unique index payments_receipt_no_key on public.payments (receipt_no) where receipt_no is not null;
create index payments_school_created_idx on public.payments (school_id, created_at desc);
create index payments_student_idx on public.payments (student_id);
create index payments_parent_idx on public.payments (parent_id);

create table public.notifications (
  id bigint generated always as identity primary key,
  audience text not null check (audience in ('parent', 'school', 'super')),
  school_id uuid references public.schools (id) on delete cascade,
  parent_id uuid references public.parents (id) on delete cascade,
  student_id uuid references public.students (id) on delete set null,
  type text not null,
  title text not null,
  body text,
  unread boolean not null default true,
  created_at timestamptz not null default now()
);
create index notifications_parent_idx on public.notifications (parent_id, created_at desc);
create index notifications_school_idx on public.notifications (school_id, created_at desc);
create index notifications_student_idx on public.notifications (student_id);

create table public.reminder_history (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools (id) on delete cascade,
  sent_by uuid,
  recipient_count integer not null check (recipient_count >= 0),
  channels text[] not null default array['website'],
  created_at timestamptz not null default now()
);
create index reminder_history_school_idx on public.reminder_history (school_id, created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  school_id uuid,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_school_created_idx on public.audit_log (school_id, created_at desc);

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value) values ('name', '"FeeFlow"');

create trigger schools_touch before update on public.schools for each row execute function private.touch_updated_at();
create trigger students_touch before update on public.students for each row execute function private.touch_updated_at();
create trigger fee_structures_touch before update on public.fee_structures for each row execute function private.touch_updated_at();
create trigger platform_settings_touch before update on public.platform_settings for each row execute function private.touch_updated_at();
