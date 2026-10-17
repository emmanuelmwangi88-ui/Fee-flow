-- Lets the database call Edge Functions (used for live tests now, scheduled M-Pesa reconciliation in Phase 4)
create extension if not exists pg_net with schema extensions;
