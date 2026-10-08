-- Deliberately not applied. Removes only SMA-94 disposable objects.
select pgmq.drop_queue('sma94_probe');
drop table if exists public.sma94_job_effects;
drop schema if exists sma94_jobs cascade;
