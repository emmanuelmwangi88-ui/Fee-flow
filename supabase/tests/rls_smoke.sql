-- FeeFlow RLS / business-rule smoke tests.
-- Safe to run any time: everything happens in one transaction that ends with a deliberate
-- RAISE EXCEPTION, so nothing is committed. Success = an error message listing only PASS lines.
-- Run in the Supabase SQL editor (as postgres) or via the MCP execute_sql tool.
do $$
declare
  r text := '';
  n bigint; v numeric; t text;
  sch_a uuid := '00000000-0000-0000-0000-0000000000a1';
  sch_b uuid := '00000000-0000-0000-0000-0000000000b1';
  u_super uuid := '11111111-0000-0000-0000-000000000001';
  u_admA  uuid := '11111111-0000-0000-0000-00000000000a';
  u_admB  uuid := '11111111-0000-0000-0000-00000000000b';
  u_pA1   uuid := '11111111-0000-0000-0000-0000000000a1';
  u_pA2   uuid := '11111111-0000-0000-0000-0000000000a2';
  s1 uuid; s2 uuid; s3 uuid; s_b uuid; par1 uuid; par2 uuid; pay_id uuid; stk_id uuid;
begin
  -- ===== fixtures (as postgres) =====
  insert into public.schools (id, name, paybill, level) values (sch_a,'Alpha Academy','123456','Primary'),(sch_b,'Beta School','654321','Secondary');
  insert into auth.users (id, email) values (u_super,'super@t.test'),(u_admA,'adma@t.test'),(u_admB,'admb@t.test'),(u_pA1,'pa1@t.test'),(u_pA2,'pa2@t.test');
  insert into public.profiles (id, role, school_id) values (u_super,'super_admin',null),(u_admA,'school_admin',sch_a),(u_admB,'school_admin',sch_b);
  insert into public.students (school_id, admission_no, full_name, class_name) values (sch_b,'B-001','Other School Kid','Form 2') returning id into s_b;

  -- ===== anon =====
  execute 'set local role anon';
  select count(*) into n from public.schools;
  r := r || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || ' anon lists the 2 active schools (' || n || ')';
  begin perform plan from public.schools; r := r || E'\nFAIL anon could read schools.plan';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' anon cannot read schools.plan [' || sqlstate || ']'; end;
  begin perform 1 from public.students; r := r || E'\nFAIL anon could read students';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' anon cannot read students [' || sqlstate || ']'; end;
  begin perform public.register_parent(sch_a,'X Y','0712345678'); r := r || E'\nFAIL anon could call register_parent';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' anon cannot call register_parent [' || sqlstate || ']'; end;
  execute 'reset role';

  -- ===== school admin A =====
  perform set_config('request.jwt.claim.sub', u_admA::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.students (school_id, admission_no, full_name, class_name, boarding, guardian_phone) values (sch_a,'A-001','Kid One','Grade 4A',false,'0712 345 678') returning id into s1;
  insert into public.students (school_id, admission_no, full_name, class_name, boarding) values (sch_a,'A-002','Kid Two','Grade 4A',true) returning id into s2;
  insert into public.students (school_id, admission_no, full_name, class_name) values (sch_a,'A-003','Kid Three','Form 1') returning id into s3;
  select guardian_phone into t from public.students where id = s1;
  r := r || E'\n' || case when t = '254712345678' then 'PASS' else 'FAIL' end || ' guardian phone normalised (' || coalesce(t,'null') || ')';
  begin insert into public.students (school_id, admission_no, full_name, class_name) values (sch_b,'X-1','Intruder','Grade 1'); r := r || E'\nFAIL adminA inserted a student into school B';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminA cannot add students to school B [' || sqlstate || ']'; end;
  begin insert into public.students (school_id, admission_no, full_name, class_name, total_fee) values (sch_a,'A-009','Hacker','Grade 4',1); r := r || E'\nFAIL adminA set total_fee directly';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminA cannot set total_fee directly [' || sqlstate || ']'; end;
  begin insert into public.students (school_id, admission_no, full_name, class_name, guardian_phone) values (sch_a,'A-010','Bad Phone','Grade 4','12345'); r := r || E'\nFAIL invalid phone accepted';
  exception when others then r := r || E'\n' || case when sqlstate='22023' then 'PASS' else 'FAIL' end || ' invalid guardian phone rejected [' || sqlstate || ']'; end;
  begin insert into public.students (school_id, admission_no, full_name, class_name) values (sch_a,' a-001 ','Dup Kid','Grade 4'); r := r || E'\nFAIL duplicate admission number accepted';
  exception when others then r := r || E'\n' || case when sqlstate='23505' then 'PASS' else 'FAIL' end || ' duplicate admission number rejected (case/space-insensitive) [' || sqlstate || ']'; end;
  begin update public.schools set plan = 'Premium' where id = sch_a; r := r || E'\nFAIL adminA changed own plan';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminA cannot change plan [' || sqlstate || ']'; end;
  update public.schools set name = 'Hijacked' where id = sch_b; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' adminA cannot edit school B (' || n || ' rows)';
  update public.schools set location = 'Nairobi' where id = sch_a; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' adminA can edit own school (' || n || ' row)';

  -- publish a fee structure: totals must be computed server-side
  insert into public.fee_structure_published (school_id, data, published_by) values (sch_a,
    '{"levels":[{"name":"Primary","grades":[{"name":"Grade 4","fees":[{"name":"Tuition","amounts":[10000,8000,7000]},{"name":"Boarding","boarderOnly":true,"amounts":["5000","5000","5000"]}]}]}]}'::jsonb, u_admA);
  select total_fee into v from public.students where id = s1;
  r := r || E'\n' || case when v = 25000 then 'PASS' else 'FAIL' end || ' day scholar total = 25000 (' || v || ')';
  select total_fee into v from public.students where id = s2;
  r := r || E'\n' || case when v = 40000 then 'PASS' else 'FAIL' end || ' boarder total = 40000 (' || v || ')';
  select total_fee into v from public.students where id = s3;
  r := r || E'\n' || case when v = 0 then 'PASS' else 'FAIL' end || ' unmatched class stays 0 (' || v || ')';
  update public.students set class_name = 'Grade 4B' where id = s3;
  select total_fee into v from public.students where id = s3;
  r := r || E'\n' || case when v = 25000 then 'PASS' else 'FAIL' end || ' changing class recomputes total (' || v || ')';

  -- ===== school admin B =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_admB::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.students where school_id = sch_a;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' adminB sees 0 of school A''s students (' || n || ')';
  select count(*) into n from public.fee_structure_published where school_id = sch_a;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' adminB cannot read school A''s published fees (' || n || ')';
  begin insert into public.fee_structure_published (school_id, data) values (sch_a, '{}'::jsonb); r := r || E'\nFAIL adminB published fees for school A';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminB cannot publish fees for school A [' || sqlstate || ']'; end;

  -- ===== parent A1 =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_pA1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pA1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  par1 := public.register_parent(sch_a, 'Jane Parent', '0712345678', 'jane@t.test');
  r := r || E'\n' || case when par1 is not null then 'PASS' else 'FAIL' end || ' parent registered';
  t := public.claim_child(par1, 'a-001', 'Kid One', 'Grade 4A');
  r := r || E'\n' || case when t = 'pending' then 'PASS' else 'FAIL' end || ' claim on a real child is PENDING while phone unverified (' || t || ')';
  t := public.claim_child(par1, 'A-777', 'Ghost Child', 'Grade 4');
  r := r || E'\n' || case when t = 'pending' then 'PASS' else 'FAIL' end || ' claim on an unknown admission no. is PENDING (' || t || ')';
  select count(*) into n from public.student_balances;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' parent sees 0 children before approval (' || n || ')';
  update public.parent_students set status = 'active'; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' parent cannot self-approve a link (' || n || ' rows)';
  begin update public.parents set phone_verified = true; r := r || E'\nFAIL parent set phone_verified';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' parent cannot set phone_verified [' || sqlstate || ']'; end;
  begin update public.profiles set role = 'super_admin' where id = u_pA1; r := r || E'\nFAIL parent promoted themselves';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' parent cannot change own role [' || sqlstate || ']'; end;
  begin insert into public.profiles (id, role) values (u_pA2, 'super_admin'); r := r || E'\nFAIL parent inserted a profile';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' parent cannot create profiles [' || sqlstate || ']'; end;
  begin insert into public.students (school_id, admission_no, full_name, class_name) values (sch_a,'P-1','Fake','Grade 4'); r := r || E'\nFAIL parent inserted a student';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' parent cannot insert students [' || sqlstate || ']'; end;
  begin insert into public.payments (school_id, student_id, amount, method, status, recorded_by) values (sch_a, s1, 5000, 'cash', 'completed', u_pA1); r := r || E'\nFAIL parent forged a payment';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' parent cannot forge a payment [' || sqlstate || ']'; end;

  -- ===== parent A2 =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_pA2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pA2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.register_parent(sch_a, 'Impostor', '0712345678'); r := r || E'\nFAIL same phone registered twice at one school';
  exception when others then r := r || E'\n' || case when sqlstate='23505' then 'PASS' else 'FAIL' end || ' same phone cannot register twice at a school [' || sqlstate || ']'; end;
  par2 := public.register_parent(sch_a, 'Peter Parent', '0722000111');
  select count(*) into n from public.notifications where parent_id = par1;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' parent A2 cannot read parent A1''s notifications (' || n || ')';

  -- ===== school admin A approves the link, records a cash payment =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_admA::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.parent_students set status = 'active' where parent_id = par1 and student_id = s1; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' adminA approved the parent link (' || n || ' row)';
  insert into public.payments (school_id, student_id, amount, method, status, recorded_by) values (sch_a, s1, 10000, 'cash', 'completed', u_admA) returning id into pay_id;
  select receipt_no into t from public.payments where id = pay_id;
  r := r || E'\n' || case when t like 'FF-%' then 'PASS' else 'FAIL' end || ' receipt number assigned by the database (' || coalesce(t,'null') || ')';
  begin update public.payments set amount = 1 where id = pay_id; r := r || E'\nFAIL adminA edited a payment';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminA cannot edit a payment [' || sqlstate || ']'; end;
  begin delete from public.payments where id = pay_id; r := r || E'\nFAIL adminA deleted a payment';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminA cannot delete a payment [' || sqlstate || ']'; end;
  begin insert into public.payments (school_id, student_id, amount, method, status) values (sch_a, s1, 100, 'mpesa_stk', 'completed'); r := r || E'\nFAIL adminA forged an M-Pesa payment';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' adminA cannot forge an M-Pesa payment [' || sqlstate || ']'; end;
  begin insert into public.payments (school_id, student_id, amount, method, status, recorded_by) values (sch_a, s_b, 100, 'cash', 'completed', u_admA); r := r || E'\nFAIL payment accepted for another school''s student';
  exception when others then r := r || E'\n' || case when sqlstate='23514' then 'PASS' else 'FAIL' end || ' payment for another school''s student rejected [' || sqlstate || ']'; end;
  select fee_status into t from public.student_balances where id = s1;
  r := r || E'\n' || case when t = 'partial' then 'PASS' else 'FAIL' end || ' status partial after 10,000 of 25,000 (' || coalesce(t,'null') || ')';
  select count(*) into n from public.notifications where audience = 'school';
  r := r || E'\n' || case when n >= 2 then 'PASS' else 'FAIL' end || ' school admin got link-request + payment notifications (' || n || ')';

  -- ===== parent A1 now sees exactly one child =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_pA1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_pA1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.student_balances;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' parent sees only their approved child (' || n || ')';
  select balance into v from public.student_balances where id = s1;
  r := r || E'\n' || case when v = 15000 then 'PASS' else 'FAIL' end || ' balance = 15,000 (' || v || ')';
  select count(*) into n from public.payments;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' parent sees the payment for their child only (' || n || ')';
  select count(*) into n from public.notifications where type = 'payment' and audience = 'parent';
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' parent got a payment notification (' || n || ')';
  update public.notifications set unread = false where audience = 'parent'; get diagnostics n = row_count;
  r := r || E'\n' || case when n >= 1 then 'PASS' else 'FAIL' end || ' parent can mark notifications read (' || n || ')';
  begin update public.notifications set title = 'Hacked' where audience = 'parent'; r := r || E'\nFAIL parent edited a notification title';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' parent cannot edit notification text [' || sqlstate || ']'; end;

  -- ===== school admin B cannot see school A's money =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_admB::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.payments where school_id = sch_a;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' adminB sees 0 of school A''s payments (' || n || ')';

  -- ===== super admin =====
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_super::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_super, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.payments;
  r := r || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' super admin cannot read school payments (privacy, migration 0005) (' || n || ')';
  update public.schools set plan = 'Premium' where id = sch_a; get diagnostics n = row_count;
  r := r || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' super admin can change a school plan (' || n || ')';
  begin insert into public.students (school_id, admission_no, full_name, class_name) values (sch_a,'S-1','Super Kid','Grade 4'); r := r || E'\nFAIL super admin inserted a student';
  exception when others then r := r || E'\n' || case when sqlstate='42501' then 'PASS' else 'FAIL' end || ' super admin cannot edit school data directly [' || sqlstate || ']'; end;

  -- ===== server-side M-Pesa lifecycle (what the Edge Functions will do, as service role) =====
  execute 'reset role';
  insert into public.payments (school_id, student_id, parent_id, amount, method, status, phone, checkout_request_id)
    values (sch_a, s1, par1, 5000, 'mpesa_stk', 'pending', '254712345678', 'ws_CO_TEST_1') returning id into stk_id;
  select receipt_no into t from public.payments where id = stk_id;
  r := r || E'\n' || case when t is null then 'PASS' else 'FAIL' end || ' pending STK payment has no receipt yet';
  select balance into v from public.student_balances where id = s1;
  r := r || E'\n' || case when v = 15000 then 'PASS' else 'FAIL' end || ' pending payment does NOT reduce the balance (' || v || ')';
  update public.payments set status = 'completed', mpesa_receipt = 'QWE123RTY4', result_code = 0 where id = stk_id;
  select receipt_no into t from public.payments where id = stk_id;
  r := r || E'\n' || case when t like 'FF-%' then 'PASS' else 'FAIL' end || ' receipt number issued on callback success (' || coalesce(t,'null') || ')';
  select balance into v from public.student_balances where id = s1;
  r := r || E'\n' || case when v = 10000 then 'PASS' else 'FAIL' end || ' confirmed payment reduces balance to 10,000 (' || v || ')';
  select count(*) into n from public.notifications where audience = 'parent' and type = 'payment' and parent_id = par1;
  update public.payments set result_desc = 'replayed callback' where id = stk_id;
  select count(*) into v from public.notifications where audience = 'parent' and type = 'payment' and parent_id = par1;
  r := r || E'\n' || case when v = n then 'PASS' else 'FAIL' end || ' replayed callback does not duplicate notifications (' || n || ' -> ' || v || ')';
  begin insert into public.payments (school_id, student_id, amount, method, status, checkout_request_id) values (sch_a, s1, 1, 'mpesa_stk', 'pending', 'ws_CO_TEST_1'); r := r || E'\nFAIL duplicate CheckoutRequestID accepted';
  exception when others then r := r || E'\n' || case when sqlstate='23505' then 'PASS' else 'FAIL' end || ' duplicate CheckoutRequestID rejected [' || sqlstate || ']'; end;
  begin update public.payments set mpesa_receipt = 'QWE123RTY4' where id = pay_id; r := r || E'\nFAIL duplicate M-Pesa receipt accepted';
  exception when others then r := r || E'\n' || case when sqlstate='23505' then 'PASS' else 'FAIL' end || ' duplicate M-Pesa receipt number rejected [' || sqlstate || ']'; end;
  begin update public.payments set status = 'failed' where id = stk_id; r := r || E'\nFAIL completed payment reverted';
  exception when others then r := r || E'\n' || case when sqlstate='23514' then 'PASS' else 'FAIL' end || ' completed payment cannot be reverted [' || sqlstate || ']'; end;

  raise exception E'RLS TEST RESULTS (rolled back):%', r;
end $$;
