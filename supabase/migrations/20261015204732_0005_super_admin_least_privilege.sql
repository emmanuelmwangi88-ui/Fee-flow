-- The platform Super Admin sees platform TOTALS, never individual students, parents' links or payments.
-- (The original app states: "School payment transactions are intentionally private from Super Admin".)

drop policy payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (school_id = (select private.my_school_id())
         or student_id in (select private.my_student_ids()));

drop policy students_select on public.students;
create policy students_select on public.students for select to authenticated
  using (school_id = (select private.my_school_id())
         or id in (select private.my_student_ids()));

drop policy parent_students_select on public.parent_students;
create policy parent_students_select on public.parent_students for select to authenticated
  using (parent_id in (select private.my_parent_ids())
         or exists (select 1 from public.students s
                    where s.id = parent_students.student_id and s.school_id = (select private.my_school_id())));

drop policy parents_select on public.parents;
create policy parents_select on public.parents for select to authenticated
  using (user_id = (select auth.uid()) or school_id = (select private.my_school_id()));

drop policy fee_published_select on public.fee_structure_published;
create policy fee_published_select on public.fee_structure_published for select to authenticated
  using (school_id = (select private.my_school_id())
         or school_id in (select private.my_parent_school_ids()));

-- Per-school counts + collection percentage. No amounts, names or transactions are returned.
create function public.platform_overview()
returns table (school_id uuid, students bigint, parents bigint, collection_rate numeric)
language sql stable security definer set search_path = '' as $$
  select sc.id,
         (select count(*) from public.students s where s.school_id = sc.id and s.verified and s.active),
         (select count(*) from public.parents p where p.school_id = sc.id),
         case when coalesce(d.due, 0) > 0 then round(least(coalesce(pd.paid, 0) / d.due, 1) * 100, 1) else 0 end
  from public.schools sc
  left join lateral (select sum(s.total_fee + s.adjustment) as due from public.students s
                     where s.school_id = sc.id and s.verified and s.active) d on true
  left join lateral (select sum(py.amount) as paid from public.payments py
                     where py.school_id = sc.id and py.status = 'completed') pd on true
  where (select private.is_super_admin())
$$;

-- Registered parent accounts across the platform (name, phone, school, number of linked children).
create function public.platform_parents()
returns table (id uuid, full_name text, phone text, email text, school_id uuid, school_name text, children bigint, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.phone, p.email, p.school_id, sc.name,
         (select count(*) from public.parent_students ps where ps.parent_id = p.id and ps.status = 'active'),
         p.created_at
  from public.parents p
  join public.schools sc on sc.id = p.school_id
  where (select private.is_super_admin())
  order by p.created_at desc
$$;

revoke execute on function public.platform_overview() from public, anon;
revoke execute on function public.platform_parents() from public, anon;
grant execute on function public.platform_overview() to authenticated;
grant execute on function public.platform_parents() to authenticated;

-- Tell the Super Admin when a school is added (shown in Recent Activity / Notifications)
create function private.schools_notify_super() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (audience, type, title, body)
  values ('super', 'platform', 'School added', new.name || ' was added to the platform.');
  return null;
end $$;
create trigger schools_notify_super after insert on public.schools
  for each row execute function private.schools_notify_super();
