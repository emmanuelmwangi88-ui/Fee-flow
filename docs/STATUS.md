# FeeFlow status

## Done and live (migrations 0001-0013 applied to project `kwuhuvkxvylgzohkrcqt`)
- Self-registration: `register_school` creates an active Trial school, its admin, three terms and a welcome notice.
- Sign-in, roles, RLS, parent child-linking with school approval, OTP, rate limits.
- Fee Structure Manager by school level; published versions are kept in `fee_structure_history`.
- Fee adjustments: sibling / staff / scholarship rules, waivers, arrears, late fees (once per term), bus routes and meal plans (price changes reprice assigned pupils), expiry job, audit log.
- M-Pesa via `fee-api` / `fee-callback`; reconcile cron; SMS reminders (needs keys).
- Installable PWA shell, legal pages, shared UI. 584 front-end checks plus SQL tests (`supabase/tests/`) pass.

## You must do
1. Dashboard -> Auth -> Password security: enable leaked-password protection.
2. Enter each school's Daraja sandbox key / secret / passkey in School Admin -> Paybill; test one STK payment.
3. Super Admin -> SMS: enter Africa's Talking username and API key.
4. Put real business details in `legal/*.html`; register with Kenya's ODPC.
5. Push this folder to GitHub (the Supabase project already has every migration).

## Not built yet (honest list)
- Bulk student import (CSV/Excel) and class promotion / year rollover (CBC steps Grade 6->7, 9->10, 12 leavers).
- Payment reversals with maker-checker approval, staff sub-roles (bursar, head, secretary), fee clearance certificates.
- Instalment plans, bank/card gateways (need Pesapal/Flutterwave accounts), Swahili interface, WhatsApp sharing, subscription billing, support tickets.
These are best added one migration at a time, each with a SQL test like `supabase/tests/fee_adjustments.sql`.

## Decisions
- Schools are active immediately on registration (no approval queue); the Super Admin can still suspend a school.
