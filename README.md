# FeeFlow

School fee management for Kenyan schools: a **Parent** portal, a **School Admin** dashboard (students, fee structure, payments, receipts, reminders) and a **Super Admin** dashboard (schools, platform totals).

Static front end (HTML / CSS / vanilla JavaScript, no build step) on **Supabase** (Postgres + Auth + Row Level Security + Edge Functions).

<<<<<<< HEAD
> **Status:** sign-in, registration, password reset and all three dashboards run on the secure online database. Fee payments can be **recorded** by the school (cash, bank, cheque, M-Pesa statement match). **Automatic M-Pesa STK Push is the next step** (Phase 4): until it is connected, parents are shown the school's paybill and their child's admission number to pay from the M-Pesa menu.
=======
> **Status: moving to Supabase (in progress).** Sign-in, registration, password reset and the Super Admin dashboard already run on the secure online database. The School Admin, Parent and Fee Manager screens are being converted next; until then they show a "coming soon" page. Database docs and tests are in `supabase/` and `tests/`.
>>>>>>> ead16596339ae4d2953c797810b8ff47eaefde85

## Run it locally

Any static server works. Examples:

```bash
python3 -m http.server 8000      # then open http://localhost:8000/portal.html
```
or use the VS Code **Live Server** extension (`http://127.0.0.1:5500/portal.html`).

In the Supabase dashboard → Authentication → URL Configuration, add every address you use (local and deployed) to **Redirect URLs**, otherwise confirmation / password-reset links send people to the wrong site.

## Pages

| Page | Who | What |
|---|---|---|
| `portal.html` | everyone | Sign in, parent registration, password reset; routes by role |
| `parent.html` | parents | Children, fee reports, payments & receipts, notifications, profile |
| `schooladmin.html` | school admins | Students, payments, ledger, outstanding fees, reminders, receipts, parents (approve child links), terms, settings |
| `fee-structure-manager.html` | school admins | Build the fee structure, save drafts, **publish** (the database recalculates every student's total) |
| `superadmin.html` | platform admin | Create schools + their admin login, edit / suspend, reset admin password, platform totals |

## How it is secured

- Everyone signs in with email + password (Supabase Auth). The **role comes from the database** (`profiles`), never from the browser.
- Every table has **Row Level Security**: a school sees only its own data, a parent only their linked children, and the Super Admin sees platform *totals* (not students or payments).
- Browsers **cannot** create M-Pesa payments or edit totals. Totals are computed in the database from the published fee structure; balances are fees minus *confirmed* payments.
- A parent's request to link a child stays **pending until the school approves it** (phone numbers are not verified yet).
- Secrets (Daraja keys, service-role key, SMS keys) live only in Supabase secrets / Edge Functions, **never** in this repo. `js/config.js` holds only the project URL and the *publishable* key, which is public by design.

## Repository layout

```
portal.html  parent.html  schooladmin.html  fee-structure-manager.html  superadmin.html  index.html
js/            config.js, ff-client.js (shared sign-in/role helpers), fee-manager.js, vendor/ (pinned supabase-js)
supabase/
  migrations/  the exact SQL applied to the live database, in order (0001 ... 0006)
  functions/   Edge Functions: admin-create-school, admin-reset-password
  tests/       SQL security tests (roll back; run in the Supabase SQL editor)
tests/         front-end tests (simulated browser + mock Supabase)
```

## Tests

```bash
npm install      # jsdom, for the front-end tests only
npm test         # 373 front-end checks
```
SQL tests are in `supabase/tests/` (`rls_smoke.sql`, `access_matrix.sql`, `migration_0006.sql`); each ends with a deliberate error that rolls everything back, and a successful run is a message listing only `PASS` lines. Re-run them after any schema or policy change.

## Still to do

- [ ] **M-Pesa STK Push** (Daraja): `mpesa-stk-push`, `mpesa-callback`, reconciliation job, per-school credentials. Needs your Daraja sandbox keys, set as Supabase secrets (never in the repo).
- [ ] SMS fee reminders (Africa's Talking) and SMS code verification of parents' phone numbers.
- [ ] Custom email sender (Supabase's built-in sender is slow and rate-limited), leaked-password protection, custom domain.
- [ ] Privacy policy / terms; check Kenya Data Protection Act registration.
