-- Tests for migration 0006 (school profile, terms, manual M-Pesa matching). Rolls back; success = only PASS lines.
-- Run in the Supabase SQL editor (as postgres).
do $$
declare
  r text := ''; n bigint; t text; v numeric;
  sa uuid := '00000000-0000-0000-0000-0000000000a1'; sb uuid := '00000000-0000-0000-0000-0000000000b1';
  u_admA uuid := '11111111-0000-0000-0000-00000000000a'; u_admB uuid := '11111111-0000-0000-0000-00000000000b'; u_p uuid := '11111111-0000-0000-0000-0000000000a1';
  s1 uuid; t1 uuid; t2 uuid;
begin
  insert into public.schools (id, name) values (sa,'Alpha'),(sb,'Beta');
  insert into auth.users (id, email) values (u_admA,'a@t.test'),(u_admB,'b@t.test'),(u_p,'p@t.test');
  insert into public.profiles (id, role, school_id) values (u_admA,'school_admin',sa),(u_admB,'school_admin',sb),(u_p,'parent',null);
  insert into public.parents (user_id, school_id, full_name, phone) values (u_p, sa, 'Pat Parent', '254712345678');
  insert into public.students (school_id, admission_no, full_name, class_name) values (sa,'A-1','Kid A','Class 4') returning id into s1;
  update public.students set total_fee = 20000 where id = s1;

  -- ===== school admin A =====
  perform set_config('request.jwt.claim.sub', u_admA::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.schools set address = 'P.O. Box 1, Kiambu', phone = '0712 345 678', settings = '{"notify":{"payment":true}}' where id = sa; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' adminA can save address, phone and settings (' || n || ')';
  begin update public.schools set address = repeat('x', 201) where id = sa; r := r || E'\nFAIL 201-char address accepted';
  exception when others then r := r || E'\n' || case when sqlstate='23514' then 'PASS' else 'FAIL' end || ' over-long address rejected [' || sqlstate || ']'; end;
  begin update public.schools set settings = '[1]'::jsonb where id = sa; r := r || E'\nFAIL non-object settings accepted';
  exception when others then r := r || E'\n' || case when sqlstate='23514' then 'PASS' else 'FAIL' end || ' non-object settings rejected [' || sqlstate || ']'; end;

  insert into public.terms (school_id, name, start_date, end_date, deadline) values (sa, 'Term 1', '2026-01-05', '2026-04-10', '2026-02-01') returning id into t1;
  insert into public.terms (school_id, name, start_date, end_date, deadline) values (sa, 'Term 2', '2026-05-04', '2026-08-07', '2026-06-01') returning id into t2;
  r := r || E'\n' || case when t1 is not null and t2 is not null then 'PASS' else 'FAIL' end || ' adminA created two terms';
  begin insert into public.terms (school_id, name, start_date, end_date) values (sa, 'Bad', '2026-05-04', '2026-05-01'); r := r || E'\nFAIL term ending before it starts accepted';
  exception when others then r := r || E'\n' || case when sqlstate='23514' then 'PASS' else 'FAIL' end || ' term ending before start rejected [' || sqlstate || ']'; end;
  perform public.set_active_term(t1);
  perform public.set_active_term(t2);
  select count(*) into n from public.terms where status = 'active';
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' exactly one active term after switching (' || n || ')';
  select name into t from public.terms where status = 'active';
  r := r || E'\n' || case when t = 'Term 2' then 'PASS' else 'FAIL' end || ' Term 2 is the active one (' || coalesce(t,'none') || ')';

  -- manual M-Pesa matching
  insert into public.payments (school_id, student_id, amount, method, status, recorded_by, mpesa_receipt) values (sa, s1, 5000, 'mpesa_c2b', 'completed', u_admA, '  rk7x2mnp4q ');
  select mpesa_receipt into t from public.payments where student_id = s1;
  r := r || E'\n' || case when t = 'RK7X2MNP4Q' then 'PASS' else 'FAIL' end || ' M-Pesa code normalised to upper-case (' || coalesce(t,'null') || ')';
  begin insert into public.payments (school_id, student_id, amount, method, status, recorded_by, mpesa_receipt) values (sa, s1, 5000, 'mpesa_c2b', 'completed', u_admA, 'RK7X2MNP4Q'); r := r || E'\nFAIL same M-Pesa code credited twice';
  exception when others then r := r || E'\n' || case when sqlstate='23505' then 'PASS' else 'FAIL' end || ' same M-Pesa code cannot be credited twice [' || sqlstate || ']'; end;
  begin insert into public.payments (school_id, student_id, amount, method, status, recorded_by, mpesa_receipt) values (sa, s1, 5000, 'mpesa_c2b', 'completed', u_admA, 'rk7x2mnp4q'); r := r || E'\nFAIL lower-case duplicate accepted';
  exception when others then r := r || E'\n' || case when sqlstate='23505' then 'PASS' else 'FAIL' end || ' lower-case duplicate also rejected [' || sqlstate || ']'; end;
  begin insert into public.payments (school_id, student_id, amount, method, status, recorded_by) values (sa, s1, 5000, 'mpesa_c2b', 'completed', u_admA); r := r || E'\nFAIL M-Pesa payment without a code accepted';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' M-Pesa payment without a code rejected [' || sqlstate || ']'; end;
  begin insert into public.payments (school_id, student_id, amount, method, status, recorded_by, mpesa_receipt) values (sa, s1, 5000, 'mpesa_stk', 'completed', u_admA, 'ZZ99'); r := r || E'\nFAIL admin forged an STK payment';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' admin still cannot forge an STK payment [' || sqlstate || ']'; end;
  insert into public.payments (school_id, student_id, amount, method, status, recorded_by, account_reference) values (sa, s1, 2000, 'cheque', 'completed', u_admA, 'CHQ-0042');
  select paid into v from public.student_balances where id = s1;
  r := r || E'\n' || case when v = 7000 then 'PASS' else 'FAIL' end || ' balance view counts both manual payments (paid ' || v || ')';

  -- ===== school admin B =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_admB::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.terms; r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' adminB sees 0 of school A''s terms (' || n || ')';
  begin insert into public.terms (school_id, name, start_date, end_date) values (sa, 'Intruder', '2026-01-01', '2026-02-01'); r := r || E'\nFAIL adminB added a term to school A';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminB cannot add terms to school A [' || sqlstate || ']'; end;
  perform public.set_active_term(t1);
  execute 'reset role';
  select status into t from public.terms where id = t1;
  r := r || E'\n' || case when t = 'upcoming' then 'PASS' else 'FAIL' end || ' adminB cannot switch school A''s active term (Term 1 is ' || t || ')';
  perform set_config('request.jwt.claim.sub', u_admB::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin insert into public.payments (school_id, student_id, amount, method, status, recorded_by) values (sa, s1, 100, 'cash', 'completed', u_admB); r := r || E'\nFAIL adminB recorded a payment at school A';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminB cannot record payments at school A [' || sqlstate || ']'; end;
  update public.schools set address = 'hijack' where id = sa; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' adminB cannot edit school A''s profile (' || n || ' rows)';

  -- ===== parent =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_p::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.terms; r := r || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || ' parent can read their school''s terms (' || n || ')';
  begin insert into public.terms (school_id, name, start_date, end_date) values (sa, 'Parent term', '2026-01-01', '2026-02-01'); r := r || E'\nFAIL parent added a term';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' parent cannot add terms [' || sqlstate || ']'; end;
  update public.schools set phone = '000' where id = sa; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' parent cannot edit the school profile (' || n || ' rows)';

  execute 'reset role';
  raise exception E'MIGRATION 0006 TESTS (rolled back):%', r;
end $$;
