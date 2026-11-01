# FeeFlow

School fee management for Kenyan schools: a **Parent** portal, a **School Admin** dashboard, a **Fee Structure Manager**, a **Fee Adjustments** page (discounts, waivers, late fees, transport, meals) and a **Super Admin** dashboard.

Static front end (HTML / CSS / vanilla JavaScript, no build step) on **Supabase** (Postgres + Auth + Row Level Security + Edge Functions).

> **Status:** schools register themselves and log in (active at once on a Trial plan). Fee structures follow the school level (Primary / Secondary / CBC grades). M-Pesa STK Push runs through the `fee-api` and `fee-callback` Edge Functions and needs each school's Daraja credentials. See `docs/STATUS.md` for what is done and what is not.

## Run it locally

```bash
python3 -m http.server 8000      # then open http://localhost:8000/portal.html
```
In Supabase → Authentication → URL Configuration, add every address you use (local and deployed) to **Redirect URLs**.

## Pages

| Page | Who | What |
|---|---|---|
| `portal.html` | everyone | Sign in, parent registration, password reset; routes by role |
| `parent.html` | parents | Children, fee reports, payments & receipts, notifications, profile |
| `schooladmin.html` | school admins | Students, payments, ledger, outstanding fees, reminders, receipts, parents (approve child links), terms, settings |
| `fee-structure-manager.html` | school admins | Build the fee structure, save drafts, **publish** (the database recalculates every student's total) |
| `fee-adjustments.html` | school admins | Discount rules (sibling / staff / scholarship), waivers, arrears, late fees, bus routes, meal plans, fee-structure history |
| `superadmin.html` | platform admin | Create schools + their admin login, edit / suspend, reset admin password, platform totals |

## How it is secured

- Everyone signs in with email + password (Supabase Auth). The **role comes from the database** (`profiles`), never from the browser.
- Every table has **Row Level Security**: a school sees only its own data, a parent only their linked children, and the Super Admin sees platform *totals* (not students or payments).
- Browsers **cannot** create M-Pesa payments or edit totals. Totals are computed in the database from the published fee structure; balances are fees minus *confirmed* payments.
- A parent's request to link a child stays **pending until the school approves it** (phone numbers are not verified yet).
- Secrets (Daraja keys, service-role key, SMS keys) live only in Supabase secrets / Edge Functions, **never** in this repo. `js/config.js` holds only the project URL and the *publishable* key, which is public by design.

## Repository layout

```
portal.html  parent.html  schooladmin.html  fee-structure-manager.html  fee-adjustments.html  superadmin.html  index.html
css/ff.css     shared look for every page
js/            config.js, ff-client.js, ff-ui.js, fee-manager.js, fee-adjustments.js, vendor/ (pinned supabase-js)
js/business.js your registered business details (shown on the legal pages)
legal/         privacy, terms, data protection (add your real business details)
sw.js, manifest.webmanifest   installable app + offline shell
supabase/
  migrations/  the exact SQL applied to the live database, in order (0001 ... 0014)
  functions/   Edge Functions: admin-create-school, admin-reset-password, fee-api, fee-callback
  tests/       SQL security tests (roll back; run in the Supabase SQL editor)
tests/         front-end tests (simulated browser + mock Supabase)
```

## Tests

```bash
npm install      # jsdom, for the front-end tests only
npm test         # front-end checks
```
SQL tests are in `supabase/tests/` (`rls_smoke.sql`, `access_matrix.sql`, `migration_0006.sql`, `fee_adjustments.sql`); each ends with a deliberate error that rolls everything back, and a successful run is a message listing only `PASS` lines. Re-run them after any schema or policy change.

## Still to do

See `docs/STATUS.md`.
