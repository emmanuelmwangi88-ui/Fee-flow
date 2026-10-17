-- FeeFlow access matrix (added with migration 0005). Rolls back; success = an error message of only PASS lines.
-- Proves: the Super Admin sees platform totals but NOT students/payments/parents, while school admins and
-- parents keep exactly the access they need. Run in the Supabase SQL editor (as postgres).
do $$
declare
  r text := ''; n bigint; v numeric;
  sa uuid := '00000000-0000-0000-0000-0000000000a1'; sb uuid := '00000000-0000-0000-0000-0000000000b1';
  u_super uuid := '11111111-0000-0000-0000-000000000001'; u_admA uuid := '11111111-0000-0000-0000-00000000000a';
  u_admB uuid := '11111111-0000-0000-0000-00000000000b'; u_p uuid := '11111111-0000-0000-0000-0000000000a1';
  s1 uuid; s_b uuid; par uuid;
begin
  insert into public.schools (id, name, paybill) values (sa,'Alpha','123456'),(sb,'Beta','654321');
  insert into auth.users (id, email) values (u_super,'s@t.test'),(u_admA,'a@t.test'),(u_admB,'b@t.test'),(u_p,'p@t.test');
  insert into public.profiles (id, role, school_id) values (u_super,'super_admin',null),(u_admA,'school_admin',sa),(u_admB,'school_admin',sb);
  insert into public.students (school_id, admission_no, full_name, class_name) values (sa,'A-1','Kid A','Class 4') returning id into s1;
  insert into public.students (school_id, admission_no, full_name, class_name) values (sb,'B-1','Kid B','Class 4') returning id into s_b;
  update public.students set total_fee = 20000 where id = s1;
  insert into public.parents (user_id, school_id, full_name, phone) values (u_p, sa, 'Pat Parent', '254712345678') returning id into par;
  insert into public.profiles (id, role, full_name) values (u_p, 'parent', 'Pat Parent');
  insert into public.parent_students (parent_id, student_id, status) values (par, s1, 'active');
  insert into public.payments (school_id, student_id, parent_id, amount, method, status, recorded_by) values (sa, s1, par, 5000, 'cash', 'completed', u_admA);

  -- ===== Super Admin: totals yes, individual records no =====
  perform set_config('request.jwt.claim.sub', u_super::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.students;   r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' super admin sees 0 students (' || n || ')';
  select count(*) into n from public.payments;   r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' super admin sees 0 payments (' || n || ')';
  select count(*) into n from public.parents;    r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' super admin cannot read parents table directly (' || n || ')';
  select count(*) into n from public.parent_students; r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' super admin sees 0 parent-student links (' || n || ')';
  select count(*) into n from public.student_balances; r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' super admin sees 0 balances (' || n || ')';
  select count(*) into n from public.schools;    r := r || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || ' super admin sees all schools (' || n || ')';
  select count(*) into n from public.notifications where audience = 'super';
  r := r || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || ' super admin got a "School added" notification per school (' || n || ')';
  select count(*) into n from public.platform_overview();
  r := r || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || ' platform_overview returns one row per school (' || n || ')';
  select students into n from public.platform_overview() where school_id = sa;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' overview: school A has 1 student (' || n || ')';
  select parents into n from public.platform_overview() where school_id = sa;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' overview: school A has 1 parent (' || n || ')';
  select collection_rate into v from public.platform_overview() where school_id = sa;
  r := r || E'\n' || case when v = 25.0 then 'PASS' else 'FAIL' end || ' overview: collection rate 5,000 of 20,000 = 25% (' || v || ')';
  select collection_rate into v from public.platform_overview() where school_id = sb;
  r := r || E'\n' || case when v = 0 then 'PASS' else 'FAIL' end || ' overview: school with no fees = 0% (' || v || ')';
  select children into n from public.platform_parents() where full_name = 'Pat Parent';
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' platform_parents lists the parent with 1 child (' || coalesce(n::text,'none') || ')';

  -- ===== nobody else gets the platform totals =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_admA::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.platform_overview(); r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' school admin gets nothing from platform_overview (' || n || ')';
  select count(*) into n from public.platform_parents();  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' school admin gets nothing from platform_parents (' || n || ')';
  select count(*) into n from public.students;  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' REGRESSION adminA still sees own student only (' || n || ')';
  select count(*) into n from public.payments;  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' REGRESSION adminA still sees own payment only (' || n || ')';
  select count(*) into n from public.parents;   r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' REGRESSION adminA still sees own school''s parents (' || n || ')';
  select count(*) into n from public.parent_students; r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' REGRESSION adminA still sees own school''s links (' || n || ')';

  -- ===== parent still sees their own child =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_p::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.student_balances; r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' REGRESSION parent still sees own child (' || n || ')';
  select balance into v from public.student_balances;  r := r || E'\n' || case when v = 15000 then 'PASS' else 'FAIL' end || ' REGRESSION parent balance = 15,000 (' || v || ')';
  select count(*) into n from public.payments;         r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' REGRESSION parent still sees own payment (' || n || ')';
  select count(*) into n from public.parents;          r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' REGRESSION parent sees own parent row (' || n || ')';
  select count(*) into n from public.platform_parents(); r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' parent gets nothing from platform_parents (' || n || ')';

  -- ===== school admin B =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_admB::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.students where school_id = sa; r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' adminB sees 0 of school A''s students (' || n || ')';
  select count(*) into n from public.payments where school_id = sa; r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' adminB sees 0 of school A''s payments (' || n || ')';

  -- ===== anonymous =====
  execute 'reset role';
  execute 'set local role anon';
  begin perform * from public.platform_overview(); r := r || E'\nFAIL anon called platform_overview';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' anon cannot call platform_overview [' || sqlstate || ']'; end;
  begin perform * from public.platform_parents(); r := r || E'\nFAIL anon called platform_parents';
  exception when others then r := r || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL' end || ' anon cannot call platform_parents [' || sqlstate || ']'; end;

  execute 'reset role';
  raise exception E'ACCESS MATRIX (rolled back):%', r;
end $$;
