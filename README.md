# FeeFlow connected website

## Start here
Open `portal.html`. `index.html` redirects to it automatically.

## Connected pages
- `portal.html` — login, school search, parent registration, and role routing
- `parent.html` — Parent Portal
- `schooladmin.html` — School Admin dashboard
- `superadmin.html` — Super Admin dashboard

## Routing
- Parent login/registration → `parent.html`
- School Admin login → `schooladmin.html`
- Super Admin selection → `superadmin.html`
- Logout from every dashboard → `portal.html`

All pages share the same browser `localStorage` records for schools, parents, students, payments, receipts, notifications, and the active session. Schools added through Super Admin become available in the portal after returning to or refreshing `portal.html`.
