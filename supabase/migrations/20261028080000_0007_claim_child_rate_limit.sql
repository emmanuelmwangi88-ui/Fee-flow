-- claim_child: count REJECTED requests too (last 24h) so a parent cannot keep creating
-- unverified junk student rows by retrying after each rejection. Same signature and grants as 0002.
create or replace function public.claim_child(p_parent_id uuid, p_admission_no text, p_child_name text, p_class text, p_gender text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_parent public.parents;
  v_student public.students;
  v_adm text := btrim(coalesce(p_admission_no, ''));
  v_status text;
begin
  if v_uid is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;
  select * into v_parent from public.parents where id = p_parent_id and user_id = v_uid;
  if not found then
    raise exception 'Parent account not found' using errcode = '42501';
  end if;
  if v_adm = '' then
    raise exception 'Enter the admission number' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_child_name, ''))) < 2 then
    raise exception 'Enter the child''s name' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_class, ''))) < 1 then
    raise exception 'Select the child''s class' using errcode = '22023';
  end if;
  if (select count(*) from public.parent_students
      where parent_id = v_parent.id
        and (status = 'pending' or (status = 'rejected' and created_at > now() - interval '24 hours'))) >= 10 then
    raise exception 'Too many pending link requests. Please wait for the school to review them.' using errcode = '54000';
  end if;

  select * into v_student from public.students
  where school_id = v_parent.school_id and upper(btrim(admission_no)) = upper(v_adm);

  if found then
    if v_parent.phone_verified and v_student.guardian_phone is not null and v_student.guardian_phone = v_parent.phone then
      v_status := 'active';
    else
      v_status := 'pending';
    end if;
  else
    insert into public.students (school_id, admission_no, full_name, class_name, gender, verified)
    values (v_parent.school_id, v_adm, btrim(p_child_name), btrim(p_class), nullif(btrim(coalesce(p_gender, '')), ''), false)
    returning * into v_student;
    v_status := 'pending';
  end if;

  insert into public.parent_students (parent_id, student_id, status)
  values (v_parent.id, v_student.id, v_status)
  on conflict (parent_id, student_id) do nothing;

  if v_status = 'pending' then
    insert into public.notifications (audience, school_id, parent_id, student_id, type, title, body)
    values ('school', v_parent.school_id, v_parent.id, v_student.id, 'link-request', 'Parent link request',
            v_parent.full_name || ' asked to link a child (adm. ' || v_adm || '). Review it under Students.');
  end if;
  return v_status;
end $$;
