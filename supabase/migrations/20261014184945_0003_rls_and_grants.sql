-- FeeFlow row-level security + least-privilege grants

alter table public.schools                  enable row level security;
alter table public.profiles                 enable row level security;
alter table public.students                 enable row level security;
alter table public.parents                  enable row level security;
alter table public.parent_students          enable row level security;
alter table public.fee_structures           enable row level security;
alter table public.fee_structure_published  enable row level security;
alter table public.payments                 enable row level security;
alter table public.notifications            enable row level security;
alter table public.reminder_history         enable row level security;
alter table public.audit_log                enable row level security;
alter table public.platform_settings        enable row level security;

-- ---------- start from zero access, then grant only what each role needs ----------
revoke all on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- anonymous visitors (login / registration screens): active schools, limited columns only
grant select (id, name, location, level) on public.schools to anon;
grant select on public.platform_settings to anon;

grant select, insert, update, delete on public.schools to authenticated;  -- narrowed by RLS + schools_guard trigger
grant select on public.profiles to authenticated;                         -- never writable from the client
grant select on public.parents to authenticated;
grant update (full_name, email) on public.parents to authenticated;       -- phone / verification are server-controlled
grant select on public.parent_students to authenticated;
grant update (status) on public.parent_students to authenticated;         -- school admin approves / rejects
grant select, delete on public.students to authenticated;
grant insert (school_id, admission_no, full_name, class_name, gender, boarding, guardian_name, guardian_phone, adjustment, verified, active)
  on public.students to authenticated;                                    -- total_fee is computed, never client-set
grant update (admission_no, full_name, class_name, gender, boarding, guardian_name, guardian_phone, adjustment, verified, active)
  on public.students to authenticated;
grant select on public.student_balances to authenticated;
grant select, insert, update on public.fee_structures to authenticated;
grant select, insert, update on public.fee_structure_published to authenticated;
grant select on public.payments to authenticated;                         -- payments are append-only for clients
grant insert (school_id, student_id, amount, method, status, note, recorded_by) on public.payments to authenticated;
grant select, delete on public.notifications to authenticated;
grant insert (audience, school_id, parent_id, student_id, type, title, body) on public.notifications to authenticated;
grant update (unread) on public.notifications to authenticated;
grant select, insert on public.reminder_history to authenticated;
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on public.platform_settings to authenticated;

-- ---------- schools ----------
create policy schools_select_anon on public.schools for select to anon
  using (status = 'active');
create policy schools_select_auth on public.schools for select to authenticated
  using (status = 'active' or (select private.is_super_admin()) or id = (select private.my_school_id()));
create policy schools_insert on public.schools for insert to authenticated
  with check ((select private.is_super_admin()));
create policy schools_update on public.schools for update to authenticated
  using ((select private.is_super_admin()) or id = (select private.my_school_id()))
  with check ((select private.is_super_admin()) or id = (select private.my_school_id()));
create policy schools_delete on public.schools for delete to authenticated
  using ((select private.is_super_admin()));

-- ---------- profiles (read-only for clients) ----------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_super_admin()));

-- ---------- parents ----------
create policy parents_select on public.parents for select to authenticated
  using (user_id = (select auth.uid())
         or (select private.is_super_admin())
         or school_id = (select private.my_school_id()));
create policy parents_update_own on public.parents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- students ----------
create policy students_select on public.students for select to authenticated
  using ((select private.is_super_admin())
         or school_id = (select private.my_school_id())
         or id in (select private.my_student_ids()));
create policy students_insert on public.students for insert to authenticated
  with check (school_id = (select private.my_school_id()));
create policy students_update on public.students for update to authenticated
  using (school_id = (select private.my_school_id()))
  with check (school_id = (select private.my_school_id()));
create policy students_delete on public.students for delete to authenticated
  using (school_id = (select private.my_school_id()));

-- ---------- parent <-> student links ----------
create policy parent_students_select on public.parent_students for select to authenticated
  using (parent_id in (select private.my_parent_ids())
         or (select private.is_super_admin())
         or exists (select 1 from public.students s
                    where s.id = parent_students.student_id and s.school_id = (select private.my_school_id())));
create policy parent_students_update on public.parent_students for update to authenticated
  using (exists (select 1 from public.students s
                 where s.id = parent_students.student_id and s.school_id = (select private.my_school_id())))
  with check (exists (select 1 from public.students s
                      where s.id = parent_students.student_id and s.school_id = (select private.my_school_id())));

-- ---------- fee structures ----------
create policy fee_structures_select on public.fee_structures for select to authenticated
  using (school_id = (select private.my_school_id()) or (select private.is_super_admin()));
create policy fee_structures_insert on public.fee_structures for insert to authenticated
  with check (school_id = (select private.my_school_id()));
create policy fee_structures_update on public.fee_structures for update to authenticated
  using (school_id = (select private.my_school_id()))
  with check (school_id = (select private.my_school_id()));

create policy fee_published_select on public.fee_structure_published for select to authenticated
  using (school_id = (select private.my_school_id())
         or (select private.is_super_admin())
         or school_id in (select private.my_parent_school_ids()));
create policy fee_published_insert on public.fee_structure_published for insert to authenticated
  with check (school_id = (select private.my_school_id()));
create policy fee_published_update on public.fee_structure_published for update to authenticated
  using (school_id = (select private.my_school_id()))
  with check (school_id = (select private.my_school_id()));

-- ---------- payments: read-only for clients; school admins may record cash/bank/cheque ----------
create policy payments_select on public.payments for select to authenticated
  using ((select private.is_super_admin())
         or school_id = (select private.my_school_id())
         or student_id in (select private.my_student_ids()));
create policy payments_insert_manual on public.payments for insert to authenticated
  with check (school_id = (select private.my_school_id())
              and method in ('cash', 'bank', 'cheque')
              and status = 'completed'
              and recorded_by = (select auth.uid()));

-- ---------- notifications ----------
create policy notifications_select on public.notifications for select to authenticated
  using ((audience = 'super' and (select private.is_super_admin()))
         or (audience = 'school' and school_id = (select private.my_school_id()))
         or (audience = 'parent' and parent_id in (select private.my_parent_ids())));
create policy notifications_update on public.notifications for update to authenticated
  using ((audience = 'super' and (select private.is_super_admin()))
         or (audience = 'school' and school_id = (select private.my_school_id()))
         or (audience = 'parent' and parent_id in (select private.my_parent_ids())))
  with check ((audience = 'super' and (select private.is_super_admin()))
         or (audience = 'school' and school_id = (select private.my_school_id()))
         or (audience = 'parent' and parent_id in (select private.my_parent_ids())));
create policy notifications_delete on public.notifications for delete to authenticated
  using ((audience = 'super' and (select private.is_super_admin()))
         or (audience = 'school' and school_id = (select private.my_school_id()))
         or (audience = 'parent' and parent_id in (select private.my_parent_ids())));
create policy notifications_insert on public.notifications for insert to authenticated
  with check ((select private.is_super_admin())
              or (school_id = (select private.my_school_id())
                  and audience in ('school', 'parent')
                  and (parent_id is null
                       or exists (select 1 from public.parents p
                                  where p.id = notifications.parent_id and p.school_id = (select private.my_school_id())))));

-- ---------- reminder history, audit log, platform settings ----------
create policy reminder_history_select on public.reminder_history for select to authenticated
  using (school_id = (select private.my_school_id()) or (select private.is_super_admin()));
create policy reminder_history_insert on public.reminder_history for insert to authenticated
  with check (school_id = (select private.my_school_id()));

create policy audit_log_select on public.audit_log for select to authenticated
  using ((select private.is_super_admin()) or school_id = (select private.my_school_id()));

create policy platform_settings_select on public.platform_settings for select to anon, authenticated
  using (true);
create policy platform_settings_insert on public.platform_settings for insert to authenticated
  with check ((select private.is_super_admin()));
create policy platform_settings_update on public.platform_settings for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));
create policy platform_settings_delete on public.platform_settings for delete to authenticated
  using ((select private.is_super_admin()));
