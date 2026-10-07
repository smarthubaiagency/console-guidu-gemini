-- SMA-94 contender probe. pgmq is an extension-level shared dependency, unlike
-- the application-owned pg-boss schema. The queue name remains spike-prefixed.
create extension if not exists pgmq;

select pgmq.create('sma94_probe');

revoke all on schema pgmq from public, anon, authenticated;
grant usage on schema pgmq to app_runtime;
grant execute on all functions in schema pgmq to app_runtime;
