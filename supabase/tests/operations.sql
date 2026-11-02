-- Behaviour + security tests for migration 0014 (staff roles, import, promotion, reversals, instalments,
-- clearance, invoices, support, health). Runs in one transaction that is rolled back by the final RAISE.
-- Expected: every line starts with PASS.
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create function pg_temp.chk(label text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || label || E'\n' $$;
create function pg_temp.fails(label text, stmt text, code text default null) returns text language plpgsql as $$
begin
  execute stmt;
  return 'FAIL ' || label || E' (no error)\n';
exception when others then
  if code is null or sqlstate = code then return 'PASS ' || label || E'\n'; end if;
  return 'FAIL ' || label || ' (got ' || sqlstate || ': ' || sqlerrm || E')\n';
end $$;

do $t$
declare
  r text := '';
  uo uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); ubur uuid := gen_random_uuid(); usup uuid := gen_random_uuid();
  sa uuid; sb uuid; a text; res jsonb; n int; v numeric; v2 numeric;
  s1 uuid; s2 uuid; s3 uuid; pay1 uuid; pay2 uuid; rev uuid; rev2 uuid; plan uuid; inv uuid; tk uuid; cnt int;
begin
  insert into auth.users (id, email, instance_id, aud, role, email_confirmed_at) values
    (uo,   'owner-'||uo||'@t.test',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now()),
    (ub,   'ownb-'||ub||'@t.test',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now()),
    (ubur, 'bursar-'||ubur||'@t.test','00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now()),
    (usup, 'super-'||usup||'@t.test','00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now());
  insert into public.profiles (id, role, full_name) values (usup, 'super_admin', 'Test Super');

  perform pg_temp.as_user(uo); sa := public.register_school('Ops School A', 'Owner A'); perform pg_temp.as_admin();
  perform pg_temp.as_user(ub); sb := public.register_school('Ops School B', 'Owner B'); perform pg_temp.as_admin();

  -- ---- staff roles
  perform pg_temp.as_user(uo);
  perform public.invite_staff('bursar-'||ubur||'@t.test', 'bursar');
  select count(*) into n from public.list_staff() where pending;
  r := r || pg_temp.chk('owner can invite staff; invite is listed as pending', n = 1);
  perform pg_temp.as_admin();
  perform pg_temp.as_user(ubur); perform public.accept_staff_invite('Bea Bursar'); perform pg_temp.as_admin();
  r := r || pg_temp.chk('invited person joins with the invited role', (select staff_role from public.profiles where id = ubur) = 'bursar' and (select school_id from public.profiles where id = ubur) = sa);
  perform pg_temp.as_user(ubur);
  r := r || pg_temp.fails('a bursar cannot invite staff', $q$select public.invite_staff('x@y.test','head')$q$, '42501');
  r := r || pg_temp.fails('a bursar cannot promote classes', $q$select public.promote_students('[{"from":"Grade 1","to":"Grade 2"}]')$q$, '42501');
  r := r || pg_temp.fails('a bursar cannot import pupils', $q$select public.import_students('[]')$q$, '42501');
  perform pg_temp.as_admin();
  perform pg_temp.as_user(ub);
  r := r || pg_temp.fails('an unrelated person cannot accept an invite', $q$select public.accept_staff_invite('x')$q$, '23505');
  perform pg_temp.as_admin();
  perform pg_temp.as_user(uo);
  r := r || pg_temp.fails('the last owner cannot be demoted', format($q$select public.set_staff_role(%L, 'head')$q$, uo), '23514');
  r := r || pg_temp.fails('an owner cannot remove themselves', format($q$select public.remove_staff(%L)$q$, uo), '23514');
  perform pg_temp.as_admin();

  -- ---- bulk import
  perform pg_temp.as_user(uo);
  res := public.import_students('[
    {"admission_no":"A1","full_name":"Amani Wanjiru","class_name":"Grade 6","guardian_phone":"0712345678","gender":"F"},
    {"admission_no":"A2","full_name":"Brian Otieno","class_name":"Grade 6A","boarding":"yes"},
    {"admission_no":"A3","full_name":"Cynthia Kamau","class_name":"Grade 9"},
    {"admission_no":"A4","full_name":"Dan Mwangi","class_name":"Grade 12"},
    {"admission_no":"","full_name":"No Adm","class_name":"Grade 1"},
    {"admission_no":"A6","full_name":"Bad Phone","class_name":"Grade 1","guardian_phone":"123"}]');
  perform pg_temp.as_admin();
  r := r || pg_temp.chk('import adds valid rows (4)', (res->>'inserted')::int = 4);
  r := r || pg_temp.chk('import rejects bad rows with a message (2)', jsonb_array_length(res->'errors') = 2);
  perform pg_temp.as_user(uo);
  res := public.import_students('[{"admission_no":"a1","full_name":"Amani W. Wanjiru","class_name":"Grade 6"}]');
  perform pg_temp.as_admin();
  r := r || pg_temp.chk('re-importing an admission number updates it, not duplicates', (res->>'updated')::int = 1 and (select count(*) from public.students where school_id = sa) = 4);
  perform pg_temp.as_user(ub);
  r := r || pg_temp.chk('school B sees none of school A pupils', (select count(*) from public.students where school_id = sa) = 0);
  perform pg_temp.as_admin();

  select id into s1 from public.students where school_id = sa and admission_no = 'A1';
  select id into s2 from public.students where school_id = sa and admission_no = 'A2';
  select id into s3 from public.students where school_id = sa and admission_no = 'A4';

  -- ---- promotion with arrears carried forward (old rows are back-dated so they pre-date the new cycle)
  insert into public.fee_adjustments (school_id, student_id, kind, amount, reason, created_at) values (sa, s1, 'arrears', 5000, 'Old arrears', now() - interval '2 days');
  insert into public.payments (school_id, student_id, amount, method, status, completed_at, note, recorded_by) values (sa, s1, 2000, 'cash', 'completed', now() - interval '1 day', 'old term', uo);
  select balance into v from public.student_balances where id = s1;
  r := r || pg_temp.chk('before promotion balance is 3000', v = 3000);
  perform pg_temp.as_user(uo);
  res := public.promote_students('[{"from":"Grade 6","to":"Grade 7"},{"from":"Grade 12","to":""}]', true);
  perform pg_temp.as_admin();
  r := r || pg_temp.chk('promotion moves 2 and releases 1 leaver', (res->>'moved')::int = 2 and (res->>'left')::int = 1);
  r := r || pg_temp.chk('Grade 6 -> Grade 7 and stream letter kept (6A -> 7A)', (select class_name from public.students where id = s1) = 'Grade 7' and (select class_name from public.students where id = s2) = 'Grade 7A');
  select balance, paid into v, v2 from public.student_balances where id = s1;
  r := r || pg_temp.chk('arrears of 3000 carried, payments restart at 0', v = 3000 and v2 = 0);
  r := r || pg_temp.chk('leaver is deactivated', not (select active from public.students where id = s3));
  perform pg_temp.as_user(uo);
  res := public.promote_students('[{"from":"Grade 7","to":"Grade 8"}]', true);
  perform pg_temp.as_admin();
  select balance into v from public.student_balances where id = s1;
  r := r || pg_temp.chk('a second promotion does not double the carried arrears', v = 3000);

  -- ---- reversals (maker-checker)
  insert into public.payments (school_id, student_id, amount, method, status, note, recorded_by) values (sa, s2, 1000, 'cash', 'completed', 'to reverse', uo) returning id into pay1;
  select paid into v from public.student_balances where id = s2;
  perform pg_temp.as_user(ubur);
  rev := public.request_payment_reversal(pay1, 'Paid to the wrong pupil');
  r := r || pg_temp.fails('a second request on the same payment is refused', format($q$select public.request_payment_reversal(%L, 'again please')$q$, pay1), '23505');
  r := r || pg_temp.fails('a bursar cannot approve a reversal', format($q$select public.decide_payment_reversal(%L, true)$q$, rev), '42501');
  perform pg_temp.as_admin();
  r := r || pg_temp.fails('a completed payment cannot be edited directly', format($q$update public.payments set status = 'cancelled' where id = %L$q$, pay1), '23514');
  perform pg_temp.as_user(uo);
  perform public.decide_payment_reversal(rev, true, 'Confirmed');
  perform pg_temp.as_admin();
  select paid into v2 from public.student_balances where id = s2;
  r := r || pg_temp.chk('approved reversal cancels the payment and removes it from paid', (select status::text from public.payments where id = pay1) = 'cancelled' and v2 = v - 1000);
  insert into public.payments (school_id, student_id, amount, method, status, recorded_by) values (sa, s2, 500, 'cash', 'completed', uo) returning id into pay2;
  perform pg_temp.as_user(uo);
  rev2 := public.request_payment_reversal(pay2, 'Entered twice by mistake');
  r := r || pg_temp.fails('you cannot approve your own reversal when others can', format($q$select public.decide_payment_reversal(%L, true)$q$, rev2), '42501');
  perform public.decide_payment_reversal(rev2, false, 'Not needed');
  perform pg_temp.as_admin();
  r := r || pg_temp.chk('a rejected reversal leaves the payment completed', (select status::text from public.payments where id = pay2) = 'completed');

  -- ---- instalments
  perform pg_temp.as_user(uo);
  plan := public.create_instalment_plan(s1, 3, current_date + 7, 30);
  r := r || pg_temp.fails('a past first due date is refused', format($q$select public.create_instalment_plan(%L, 2, current_date - 1, 30)$q$, s1), '22023');
  perform pg_temp.as_admin();
  select count(*), sum(amount) into n, v from public.instalment_items where plan_id = plan;
  r := r || pg_temp.chk('3 instalments adding to exactly the balance', n = 3 and v = 3000);
  perform pg_temp.as_user(ub);
  r := r || pg_temp.chk('another school cannot see the plan', (select count(*) from public.instalment_plans where id = plan) = 0);
  perform pg_temp.as_admin();

  -- ---- clearance
  perform pg_temp.as_user(uo);
  r := r || pg_temp.fails('clearance refused while a balance is owed', format($q$select public.issue_clearance(%L)$q$, s1), '22023');
  res := public.issue_clearance(s2);
  perform pg_temp.as_admin();
  r := r || pg_temp.chk('clearance issued at nil balance with a serial', (res->>'serial') like 'CLR-%');

  -- ---- invoices
  perform pg_temp.as_user(uo);
  r := r || pg_temp.fails('a school cannot issue invoices', format($q$select public.issue_invoice(%L, 1000, 'Term 1 subscription', current_date + 14)$q$, sa), '42501');
  perform pg_temp.as_admin();
  perform pg_temp.as_user(usup);
  inv := public.issue_invoice(sa, 4500, 'Term 1 subscription', current_date + 14);
  perform pg_temp.as_admin();
  perform pg_temp.as_user(uo);
  r := r || pg_temp.chk('the school sees its invoice', (select count(*) from public.subscription_invoices where school_id = sa) = 1);
  perform pg_temp.as_admin();
  perform pg_temp.as_user(ub);
  r := r || pg_temp.chk('another school cannot see it', (select count(*) from public.subscription_invoices where id = inv) = 0);
  perform pg_temp.as_admin();
  perform pg_temp.as_user(usup); perform public.settle_invoice(inv, true, 'MPESA123'); perform pg_temp.as_admin();
  r := r || pg_temp.chk('super admin settles an invoice', (select status from public.subscription_invoices where id = inv) = 'paid');

  -- ---- support
  perform pg_temp.as_user(uo); tk := public.open_ticket('M-Pesa payments not matching', 'mpesa', 'Several payments are unmatched.'); perform pg_temp.as_admin();
  perform pg_temp.as_user(ub);
  r := r || pg_temp.chk('another school cannot see the ticket', (select count(*) from public.support_tickets where id = tk) = 0);
  r := r || pg_temp.fails('another school cannot reply to it', format($q$select public.reply_ticket(%L, 'hi')$q$, tk), '42501');
  perform pg_temp.as_admin();
  perform pg_temp.as_user(usup); perform public.reply_ticket(tk, 'We are looking into it.'); perform pg_temp.as_admin();
  r := r || pg_temp.chk('platform reply marks the ticket answered', (select status from public.support_tickets where id = tk) = 'answered' and (select count(*) from public.support_messages where ticket_id = tk and from_platform) = 1);

  -- ---- health
  perform pg_temp.as_user(uo);
  r := r || pg_temp.fails('only the super admin can read platform health', $q$select public.platform_health()$q$, '42501');
  perform pg_temp.as_admin();
  perform pg_temp.as_user(usup);
  r := r || pg_temp.chk('super admin gets a health report', (public.platform_health()->>'schools_active')::int >= 2);
  perform pg_temp.as_admin();

  -- ---- school row protection
  perform pg_temp.as_user(uo);
  r := r || pg_temp.fails('a school admin cannot write the super admin note', format($q$update public.schools set admin_note = 'x' where id = %L$q$, sa), '42501');
  r := r || pg_temp.fails('a school admin cannot rewrite the school id', format($q$update public.schools set id = gen_random_uuid() where id = %L$q$, sa), '42501');
  update public.schools set name = 'Ops School A (renamed)' where id = sa;
  r := r || pg_temp.chk('a school admin can still edit their own details', (select name from public.schools where id = sa) like '%renamed%');
  perform pg_temp.as_admin();

  raise exception E'REPORT\n%', r;
end $t$;
