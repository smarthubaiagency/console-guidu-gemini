-- ============================================================================
-- SQL API rate limit fallback (F4a): counters reachable only by the function
-- ============================================================================

begin;
set local role app_runtime;
do $$
declare
  v integer;
begin
  v := private.hit_rate_limit('key:00000000-0000-4000-8000-0000000000f1');
  v := private.hit_rate_limit('key:00000000-0000-4000-8000-0000000000f1');
  if v <> 2 then raise exception 'rate limit: counter did not increment (%)', v; end if;
  begin
    perform private.hit_rate_limit('anything');
    raise exception 'rate limit: arbitrary bucket accepted';
  exception when check_violation then null;
  end;
  begin
    perform count(*) from public.api_rate_counters;
    raise exception 'rate limit: runtime reads the counters';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.api_rate_counters;
    raise exception 'rate limit: runtime resets the counters';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- The worker removes only windows older than a day.
insert into public.api_rate_counters (bucket, window_start, hits)
values ('user:00000000-0000-4000-8000-0000000000f2', now() - interval '2 days', 5);
set local role app_worker;
do $$
begin
  delete from public.api_rate_counters where window_start > now() - interval '1 hour';
  if found then raise exception 'rate limit: worker removed a current window'; end if;
  delete from public.api_rate_counters;
  if not found then raise exception 'rate limit: worker could not remove an old window'; end if;
end
$$;
rollback;
