-- ============================================================================
-- F5d — API key scopes of the Portfolio
--
-- `portfolio:read`  the UCP catalog (search_catalog, lookup_catalog,
--                   get_product): active, public items with a price.
-- `portfolio:agent` the view of our service agent: quote items and the AI
--                   governance (`ai_*`), apart from the UCP output.
-- `portfolio:write` item and variant writes through the REST API; the MCP
--                   writes through proposals (F4d).
-- No new table: only the catalog of scopes a key may hold.
-- ============================================================================

alter table public.api_keys drop constraint api_keys_scopes_catalog_check;
alter table public.api_keys
  add constraint api_keys_scopes_catalog_check
  check (
    scopes <@ array[
      'workspace:read',
      'modules:read',
      'usage:read',
      'executions:read',
      'members:read',
      'proposals:write',
      'crm:read',
      'crm:write',
      'portfolio:read',
      'portfolio:agent',
      'portfolio:write'
    ]::text[]
    and cardinality(scopes) > 0
  );
