# FeeFlow

A school fee management portal with three connected dashboards — **Parent**, **School Admin**, and **Super Admin** — built to fit Kenyan school fee workflows.

**Live demo:** [fee-flow-psi.vercel.app](https://fee-flow-psi.vercel.app)

> **Status: moving to Supabase (in progress).** Sign-in, registration, password reset and the Super Admin dashboard already run on the secure online database. The School Admin, Parent and Fee Manager screens are being converted next; until then they show a "coming soon" page. Database docs and tests are in `supabase/` and `tests/`.

## Start here

Open `index.html` (it redirects to `portal.html`).

Some browsers isolate `file://` pages from each other, which stops the pages sharing data. If the dashboards don't see what you registered in the portal, serve the folder instead:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

An internet connection is needed for Bootstrap, Font Awesome and Google Fonts, which load from CDNs.

## Pages

| Page | Role |
|---|---|
| `portal.html` | Login, school search, parent registration, role routing |
| `parent.html` | Parent Portal — view fees, make payments, download receipts |
| `schooladmin.html` | School Admin dashboard — manage students, payments, reminders |
| `fee-structure-manager.html` | Fee structure editor, opened from the School Admin dashboard |
| `superadmin.html` | Super Admin dashboard — manage schools across the platform |

## Routing

- Parent login/registration → `parent.html`
- School Admin login → `schooladmin.html` (Fee Structure → `fee-structure-manager.html`)
- Super Admin selection → `superadmin.html`
- Logout from any dashboard → `portal.html`

All pages read/write the same `localStorage` keys, so a school added through Super Admin becomes available in the portal after returning to or refreshing `portal.html`.

## Roles & workflow

1. **Super Admin** — onboards the platform. Registers new schools, which then become selectable in the portal.
   - Default password: `#SADMIN888`
2. **School Admin** — once a school is registered, its admin manages everything fee-related for that school: fee structures, students, payment records, and receipts.
3. **Parent** — connects to their child's school through the portal, then makes fee payments and handles other parent-facing actions (viewing balances, downloading receipts, etc.).

> ⚠️ `#SADMIN888` is a hardcoded demo credential in the front-end code, not a securely stored password. Anything in `localStorage` is readable by anyone using that browser, so don't use real passwords or sensitive data.

## Payments

Payments run in **demo mode** by default: no real M-Pesa charge is made, and the receipt reference starts with `DEMO`.

A real STK Push needs a secure server, because M-Pesa (Daraja) credentials must never be stored in front-end code. If a school sets an **STK Push API Endpoint** in its School Admin settings, `parent.html` POSTs `{ phone, amount, paybill, accountReference, transactionDesc, studentId, schoolId }` to it and expects `{ success: true, checkoutRequestId }` back.

## Project structure

```
Fee-flow/
├── index.html                    # Redirects to portal.html
├── portal.html                   # Login, registration, role routing
├── parent.html                   # Parent Portal
├── schooladmin.html              # School Admin dashboard
├── fee-structure-manager.html    # Fee structure editor
├── superadmin.html               # Super Admin dashboard
└── js/
    └── fee-structure-integration.js
```

## Limitations / roadmap

- [ ] Real persistence (data is per-browser today and isn't shared between devices)
- [ ] Real authentication (role routing currently has no real auth check)
- [ ] Real M-Pesa STK Push via a secure server endpoint
- [ ] Real SMS / email delivery (the messaging endpoint setting is optional)

## Tech stack

HTML, CSS and vanilla JavaScript, with Bootstrap 5, Font Awesome and Google Fonts loaded from CDNs. Deployed as a static site on Vercel.
