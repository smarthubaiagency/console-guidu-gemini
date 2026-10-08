-- SMA-116: migration intentionally invalid to prove the CI `db` job fails on
-- `supabase db reset` ("Rebuild database from every migration").
-- This file is reverted immediately after the failing run is recorded.
create table sma116_negative_probe (;
