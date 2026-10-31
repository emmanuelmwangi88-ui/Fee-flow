-- Behaviour + security tests for migrations 0012 and 0013.
-- Everything runs inside one transaction that is rolled back at the end (the final RAISE carries the report).
-- Note: total_fee is computed by a trigger from the published fee structure, so pupils here have total_fee 0 and
-- the assertions look at the adjustment (total_due = adjustment).
-- Run in the Supabase SQL editor or via execute_sql. Expected: every line starts with PASS.
do $t$
declare
  r text := '';
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); up uuid := gen_random_uuid();
  sa uuid; sb uuid; stu_a uuid; stu_b uuid; adj uuid; route uuid; n int; v numeric; ok boolean;

begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (ua, 'a-'||ua||'@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (ub, 'b-'||ub||'@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (up, 'p-'||up||'@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  -- 0013: self-registration creates an ACTIVE school, admin profile, 3 terms
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  sa := public.register_school('Test School A', 'Admin A', 'Thika', 'Primary Only', '174379', '0712345678', null);
  reset role;
  r := r || chr(10) || (case when (select status from public.schools where id = sa) = 'active'
                   and (select count(*) from public.terms where school_id = sa) = 3
                   and (select role::text from public.profiles where id = ua) = 'school_admin'
                  then 'PASS register_school: active school + admin + 3 terms' else 'FAIL register_school' end);

  -- cannot register twice with the same account
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.register_school('Second School', 'Admin A');
    reset role; r := r || chr(10) || 'FAIL second registration allowed';
  exception when others then reset role; r := r || chr(10) || 'PASS second registration refused';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  sb := public.register_school('Test School B', 'Admin B');
  reset role;

  insert into public.students (school_id, admission_no, full_name, class_name, total_fee) values (sa, 'A1', 'Pupil A', 'Grade 4', 10000) returning id into stu_a;
  insert into public.students (school_id, admission_no, full_name, class_name, total_fee) values (sb, 'B1', 'Pupil B', 'Grade 4', 10000) returning id into stu_b;

  -- school A admin adds a waiver -> adjustment recalculated
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.fee_adjustments (school_id, student_id, kind, amount, reason) values (sa, stu_a, 'waiver', -1000, 'Hardship waiver') returning id into adj;
  select total_due into v from public.student_balances where id = stu_a;
  reset role;
  r := r || chr(10) || (case when v = -1000 then 'PASS waiver lowers total due by 1000' else 'FAIL waiver total '||coalesce(v::text,'null') end);

  -- sign constraint
  begin
    insert into public.fee_adjustments (school_id, student_id, kind, amount, reason) values (sa, stu_a, 'waiver', 500, 'wrong sign');
    r := r || chr(10) || 'FAIL positive waiver allowed';
  exception when check_violation then r := r || chr(10) || 'PASS waiver must be negative';
  end;

  -- amounts cannot be edited
  begin
    update public.fee_adjustments set amount = -1 where id = adj;
    r := r || chr(10) || 'FAIL amount edit allowed';
  exception when others then r := r || chr(10) || 'PASS amount cannot be edited';
  end;

  -- cross-school: A cannot add an adjustment for B's pupil, cannot see B's data
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.fee_adjustments (school_id, student_id, kind, amount, reason) values (sa, stu_b, 'waiver', -10, 'cross school');
    r := r || chr(10) || 'FAIL cross-school insert allowed';
  exception when others then r := r || chr(10) || 'PASS cross-school insert refused';
  end;
  begin
    insert into public.fee_adjustments (school_id, student_id, kind, amount, reason) values (sb, stu_b, 'waiver', -10, 'other school');
    r := r || chr(10) || 'FAIL inserted into other school';
  exception when others then r := r || chr(10) || 'PASS cannot insert into another school';
  end;
  select count(*) into n from public.student_balances where school_id = sb;
  r := r || chr(10) || (case when n = 0 then 'PASS school A cannot read school B pupils' else 'FAIL reads other school' end);
  -- apply_late_fees ownership
  begin
    perform public.apply_late_fees(sb);
    r := r || chr(10) || 'FAIL apply_late_fees ran for another school';
  exception when sqlstate '42501' then r := r || chr(10) || 'PASS apply_late_fees ownership check (42501)';
  end;
  reset role;

  -- transport route sync
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.transport_routes (school_id, name, amounts) values (sa, 'Route 1', array[1000,1000,1000]) returning id into route;
  update public.students set transport_route_id = route where id = stu_a;
  select total_due into v from public.student_balances where id = stu_a;
  r := r || chr(10) || (case when v = 2000 then 'PASS transport adds 3000' else 'FAIL transport total '||coalesce(v::text,'null') end);
  update public.transport_routes set amounts = array[2000,2000,2000] where id = route;
  select total_due into v from public.student_balances where id = stu_a;
  r := r || chr(10) || (case when v = 5000 then 'PASS route price change reprices pupils' else 'FAIL reprice '||coalesce(v::text,'null') end);
  update public.students set transport_route_id = null where id = stu_a;
  select total_due into v from public.student_balances where id = stu_a;
  r := r || chr(10) || (case when v = -1000 then 'PASS unassigning removes charge' else 'FAIL unassign '||coalesce(v::text,'null') end);
  reset role;

  -- late fee: once per pupil per term
  insert into public.fee_adjustments (school_id, student_id, kind, amount, reason) values (sa, stu_a, 'arrears', 10000, 'Balance brought forward');
  insert into public.school_fee_rules (school_id, late_fee_enabled, late_fee_kind, late_fee_value) values (sa, true, 'percent', 10);
  update public.terms set deadline = current_date - 5 where school_id = sa and name = 'Term 1';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.apply_late_fees(sa);
  ok := public.apply_late_fees(sa) = 0;
  reset role;
  r := r || chr(10) || (case when n = 1 and ok then 'PASS late fee charged once' else 'FAIL late fee n='||n||' second_zero='||ok end);

  -- history: publishing writes a version
  insert into public.fee_structure_published (school_id, data, term_names) values (sa, '{"Grade 4":{}}'::jsonb, array['Term 1','Term 2','Term 3']);
  r := r || chr(10) || (case when (select count(*) from public.fee_structure_history where school_id = sa) = 1 then 'PASS fee history version 1 written' else 'FAIL history' end);

  raise exception E'REPORT\n%', r;
end $t$;
