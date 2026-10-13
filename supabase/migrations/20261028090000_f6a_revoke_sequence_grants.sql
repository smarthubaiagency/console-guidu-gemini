-- ============================================================================
-- F6a — Sequences out of reach of anon and authenticated
--
-- Supabase grants every new sequence in `public` to anon and authenticated
-- (default privileges of the postgres role). The identity column of
-- `public.queue_metrics` (F3d) inherited USAGE, SELECT and UPDATE that way:
-- the table itself was revoked, its sequence was not. Nobody reached it
-- (the Data API exposes no table to these roles and setval lives in
-- pg_catalog), but it breaks the rule that anon and authenticated hold
-- nothing in the app schemas. tests/core/security-catalog.sql now fails on
-- any sequence granted to them, so a new one is caught at the PR.
-- ============================================================================

revoke all on sequence public.queue_metrics_id_seq from public, anon, authenticated;
