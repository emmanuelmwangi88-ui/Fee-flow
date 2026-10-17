# FeeFlow database (Supabase)

Project: `feeflow` (ref `kwuhuvkxvylgzohkrcqt`, region eu-west-2).

## Layout
- `migrations/` — the exact SQL applied to the live project, in order. Re-run them on an empty
  Supabase project to rebuild the database (e.g. a staging copy).
- `tests/rls_smoke.sql` — attack-style security tests (58 checks). It runs in a transaction that
  **always rolls back**, so it is safe to run any time; success shows as a `RLS TEST RESULTS`
  message with every line `PASS`. Re-run it after every schema or policy change.

## Security model in one minute
- Every table has Row Level Security. Anonymous visitors can only list active schools
  (`id, name, location, level`).
- Roles live in `public.profiles` and can **only** be set server-side (service role / SQL), never from the browser.
- Browsers can never create or edit payments for M-Pesa. Only the server (Edge Functions, Phase 4)
  inserts/completes them. School admins may record cash / bank / cheque payments.
- Balances come from the `student_balances` view = fees minus **completed** payments.
- `students.total_fee` is computed by the database from the school's published fee structure.
- Parent → child links start `pending` and need school approval until phone verification exists.

## Making someone Super Admin (run in the SQL editor, after they exist in Authentication → Users)
```sql
insert into public.profiles (id, role, full_name)
select id, 'super_admin', 'Platform Super Admin'
from auth.users
where email = 'feeflowadmin@gmail.com' and email_confirmed_at is not null
on conflict (id) do update set role = 'super_admin';
```
Never put passwords, keys or secrets in this repo.
