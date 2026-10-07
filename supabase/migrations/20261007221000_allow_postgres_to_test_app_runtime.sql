-- Lets the hosted migration administrator assume the restricted runtime role
-- for SQL-level RLS verification. This grants nothing to app_runtime.
grant app_runtime to postgres;

