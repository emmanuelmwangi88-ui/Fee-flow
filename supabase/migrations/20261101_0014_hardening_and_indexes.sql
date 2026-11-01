-- Hardening + performance.
-- 1. Foreign-key indexes the advisor flagged (partial indexes do not count as covering).
-- 2. A school admin could previously UPDATE every column of their own school row, including
--    id, created_at, registered_by and the Super Admin's private admin_note. Narrow the column grant
--    and extend the guard trigger so admin_note is Super-Admin-only too.

drop index if exists public.students_transport_idx;
drop index if exists public.students_meal_idx;
create index if not exists students_transport_route_idx on public.students (transport_route_id);
create index if not exists students_meal_plan_idx on public.students (meal_plan_id);
create index if not exists schools_registered_by_idx on public.schools (registered_by);

revoke update on public.schools from authenticated;
grant update (name, location, level, paybill, plan, status, sms_sender, updated_at, address, phone, settings, mpesa_mode, admin_note)
  on public.schools to authenticated;

create or replace function private.schools_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.is_super_admin() then
    if new.plan is distinct from old.plan or new.status is distinct from old.status
       or new.level is distinct from old.level or new.mpesa_mode is distinct from old.mpesa_mode
       or new.admin_note is distinct from old.admin_note then
      raise exception 'Only the platform Super Admin can change plan, status, level, M-Pesa mode or admin notes' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
