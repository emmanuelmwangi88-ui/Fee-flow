-- Fix: the OUT column "school_id" collided with the table column inside the M-Pesa config check.
create or replace function public.create_stk_payment(p_user uuid, p_student uuid, p_amount numeric, p_phone text)
returns table (payment_id uuid, school_id uuid, parent_id uuid, admission_no text, student_name text)
language plpgsql security definer set search_path = '' as $$
declare v_par public.parents; v_st public.students; v_bal numeric; v_phone text := private.normalize_ke_phone(p_phone); v_id uuid;
begin
  if p_amount is null or p_amount < 1 or p_amount > 250000 or p_amount <> trunc(p_amount) then
    raise exception 'Enter a whole amount between KES 1 and KES 250,000' using errcode = '22023';
  end if;
  if v_phone is null then raise exception 'Enter a valid Safaricom number' using errcode = '22023'; end if;
  select p.* into v_par from public.parents p
    join public.parent_students ps on ps.parent_id = p.id
    where p.user_id = p_user and ps.student_id = p_student and ps.status = 'active' limit 1;
  if not found then raise exception 'This child is not linked to your account' using errcode = '42501'; end if;
  select * into v_st from public.students s where s.id = p_student and s.verified and s.active;
  if not found then raise exception 'This student is not active' using errcode = '42501'; end if;
  if not exists (select 1 from public.schools sc where sc.id = v_st.school_id and sc.status = 'active') then
    raise exception 'This school is not accepting payments right now' using errcode = '55000';
  end if;
  if not exists (select 1 from public.school_mpesa_config c where c.school_id = v_st.school_id) then
    raise exception 'M-Pesa is not set up for this school yet' using errcode = '55000';
  end if;
  select b.balance into v_bal from public.student_balances b where b.id = p_student;
  if coalesce(v_bal, 0) <= 0 then raise exception 'There is no balance to pay' using errcode = '22023'; end if;
  if p_amount > v_bal then
    raise exception 'The amount cannot exceed the balance of KES %', to_char(v_bal, 'FM999,999,990') using errcode = '22023';
  end if;
  if exists (select 1 from public.payments py where py.student_id = p_student and py.method = 'mpesa_stk' and py.status = 'pending'
             and py.created_at > now() - interval '90 seconds') then
    raise exception 'A payment request for this child is already in progress. Please wait a minute.' using errcode = '55006';
  end if;
  insert into public.payments (school_id, student_id, parent_id, amount, method, status, phone, account_reference)
  values (v_st.school_id, p_student, v_par.id, p_amount, 'mpesa_stk', 'pending', v_phone, v_st.admission_no)
  returning id into v_id;
  return query select v_id, v_st.school_id, v_par.id, v_st.admission_no, v_st.full_name;
end $$;
revoke all on function public.create_stk_payment(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.create_stk_payment(uuid, uuid, numeric, text) to service_role;
