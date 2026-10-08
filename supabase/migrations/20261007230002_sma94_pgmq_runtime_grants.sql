-- pgmq functions are security invoker, so the technical worker needs DML on
-- the spike queue tables in addition to function execution.
grant select, insert, update, delete on all tables in schema pgmq to app_runtime;
grant usage, select on all sequences in schema pgmq to app_runtime;
