# FeeFlow

A school fee management portal with three connected dashboards — **Parent**, **School Admin**, and **Super Admin** — built to fit Kenyan school fee workflows.

**Live demo:** [fee-flow-psi.vercel.app](https://fee-flow-psi.vercel.app)

> **Status:** Front-end prototype. All data (schools, parents, students, payments, receipts, notifications, active session) currently lives in the browser's `localStorage`. A Django backend (`myapp/`, `manage.py`) is scaffolded in this repo but not yet wired to the front end — see [Roadmap](#roadmap).

## Start here

Open `portal.html`. `index.html` redirects to it automatically.

## Connected pages

| Page | Role |
|---|---|
| `portal.html` | Login, school search, parent registration, role routing |
| `parent.html` | Parent Portal — view fees, make payments, download receipts |
| `schooladmin.html` | School Admin dashboard — manage students, fee structures, payments |
| `superadmin.html` | Super Admin dashboard — manage schools across the platform |

## Routing

- Parent login/registration → `parent.html`
- School Admin login → `schooladmin.html`
- Super Admin selection → `superadmin.html`
- Logout from any dashboard → `portal.html`

All pages read/write the same `localStorage` keys, so a school added through Super Admin becomes available in the portal after returning to or refreshing `portal.html`.

## Roles & workflow

FeeFlow follows a top-down setup, then day-to-day use by school staff and parents:

1. **Super Admin** — onboards the platform. Registers new schools, which then become selectable in the portal.
   - Default password: `#SADMIN888`
2. **School Admin** — once a school is registered, its admin manages everything fee-related for that school: fee structures, students, payment records, and receipts.
3. **Parent** — connects to their child's school through the portal, then makes fee payments and handles other parent-facing actions (viewing balances, downloading receipts, etc.).

> ⚠️ `#SADMIN888` is a hardcoded demo credential in the front-end code, not a securely stored password — don't reuse it if/when this moves to the Django backend with real auth.

## Project structure

```
Fee-flow/
├── portal.html          # Entry point — login, registration, role routing
├── parent.html           # Parent Portal
├── schooladmin.html      # School Admin dashboard
├── superadmin.html       # Super Admin dashboard
├── static/JS/            # Front-end logic (localStorage-backed)
├── template/             # HTML templates
├── feeflow/               # Django project settings
├── myapp/                 # Django app (scaffolded, not yet connected to the UI)
├── manage.py
├── db.sqlite3
└── requirements.txt
```

## Running it

### Front-end demo (no setup required)
Just open `portal.html` in a browser. No server, no build step — it runs entirely client-side.

### Django backend (in progress)
```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```
Note: the Django app is not yet connected to the HTML front end above.

## Roadmap

- [ ] Replace `localStorage` persistence with a real Django backend + database
- [ ] Wire `portal.html` / `parent.html` / `schooladmin.html` / `superadmin.html` to Django views or a REST API
- [ ] Add authentication (currently role routing has no real auth check)
- [ ] Payment integration (e.g. M-Pesa)

## Tech stack

- HTML / CSS / vanilla JavaScript (current UI)
- Django (backend, in progress)
- SQLite (`db.sqlite3`)