# FeeFlow status

## Done and live (migrations 0001-0014 applied to project `kwuhuvkxvylgzohkrcqt`)
- Self-registration: `register_school` creates an active Trial school, its admin, three terms and a welcome notice.
- Sign-in, roles, RLS, parent child-linking with school approval, OTP, rate limits.
- Fee Structure Manager by school level; published versions are kept in `fee_structure_history`.
- Fee adjustments: sibling / staff / scholarship rules, waivers, arrears, late fees (once per term), bus routes and meal plans (price changes reprice assigned pupils), expiry job, audit log.
- M-Pesa via `fee-api` / `fee-callback`; reconcile cron; SMS reminders (needs keys).
- Installable PWA shell, legal pages, shared UI. 584 front-end checks plus SQL tests (`supabase/tests/`) pass.

## Added in the latest round
- Landing page (`index.html`) explaining FeeFlow, with links into the portal (`portal.html?mode=school|parent`).
- Portal redesign, consent checkboxes on both registration forms, 'What is FeeFlow?' link.
- Sidebars: the menu button hides/shows the whole sidebar on desktop; the chevron in the sidebar header minimises it to an icon rail. Remembered per browser.
- Legal pages corrected to describe only what exists today (no staff sub-roles, no auto-billing, FeeFlow does not hold funds); controller/processor roles, children's data, transfers, cookies and breach notice added.
- `js/business.js`: one place for your registered business name, emails, address and ODPC number. Unset values show as a yellow "[... not set]" marker.
- Migration 0014, the operations suite (live; 41 SQL checks in `supabase/tests/operations.sql`):
  - **Bulk import** from CSV (up to 2000 rows per call, upsert on admission number, row-level errors).
  - **Class promotion / year rollover** following CBC (PP1-PP2, Grade 1-12) and 8-4-4; arrears and credit carried forward; new payment cycle.
  - **Payment reversals** with maker-checker: the requester cannot approve their own request when the school has more than one staff member.
  - **Staff roles** (owner, head teacher, bursar, secretary) with email invites; joining via the Staff tab on the portal.
  - **Instalment plans** (2-6 parts; schedule visible to parents), **fee clearance certificates** (only at nil balance, numbered, printable).
  - **Manual subscription invoices** (issued and settled by you), 30-day trial dates, **support tickets**, `platform_health()` for monitoring.
  - Pages: `school-tools.html` (school Operations) and `platform-tools.html` (Super Admin: health, invoices, trials, support inbox).
- WhatsApp: click-to-chat buttons for reminders and balance sharing (opens WhatsApp with the text ready; nothing is sent automatically).
- Kiswahili interface (`js/i18n.js`, SW/EN toggle): navigation, sign-in, common buttons and the landing page. Legal pages and long explanations stay English.
- FK indexes; school admins cannot edit `id`, `created_at`, `registered_by`, `admin_note` or `trial_ends_at` on their school row.

## You must do
0. Edit `js/business.js` with your real business details. Migration 0014 is already applied to the live project.
1. Dashboard -> Auth -> Password security: enable leaked-password protection.
2. Enter each school's Daraja sandbox key / secret / passkey in School Admin -> Paybill; test one STK payment.
3. Super Admin -> SMS: enter Africa's Talking username and API key.
4. Put real business details in `legal/*.html`; register with Kenya's ODPC.
5. Push this folder to GitHub (the Supabase project already has every migration).

## Not built, or limited (honest list)
- Card gateways (Pesapal / Flutterwave): need your own merchant accounts and keys; not built.
- Automatic subscription charging: invoices are manual; you mark them paid.
- Import accepts CSV only (save Excel as CSV).
- Staff roles gate the new Operations actions (database-enforced). Older pages still let any staff member of the school use the existing direct table writes; tightening those is a follow-up.
- Kiswahili covers the main screens only and should be reviewed by a native speaker.
- WhatsApp is click-to-chat, not the WhatsApp Business API (no automatic sending).
- Legal pages are plain-language drafts and need review by a Kenyan lawyer; ODPC registration is yours to do.

## Decisions
- Schools are active immediately on registration (no approval queue); the Super Admin can still suspend a school.
