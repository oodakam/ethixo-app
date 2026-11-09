-- READ-ONLY verification for the v1.1 hardening. Run once BEFORE and once AFTER; run each query on its own.
-- V1: EXECUTE exposure of every function in schema private (+ the summary). After: anon_can_execute = false on all six private functions.
select p.oid::regprocedure::text as function,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE') as public_grants
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' or p.oid = to_regprocedure('public.teacher_attempt_summary(uuid)')
order by 1;
-- Expected AFTER: the 5 helpers: anon false, authenticated true, public_grants 0.  touch_updated_at(): anon false, authenticated false, public_grants 0
--                 (that is correct: it is a trigger function).  teacher_attempt_summary: anon false, authenticated true, public_grants 0 (unchanged).

-- V2: the summary keeps its signature, return columns, SECURITY DEFINER and pinned search_path, and now filters by JSON type.
select pg_get_function_result(p.oid) as returns, p.prosecdef as security_definer, array_to_string(p.proconfig, ',') as config,
       (p.prosrc like '%jsonb_typeof(e -> ''score'') = ''number''%') as skips_malformed_elements
from pg_proc p where p.oid = to_regprocedure('public.teacher_attempt_summary(uuid)');
-- Expected AFTER: same 12 return columns, true, search_path="", true.   BEFORE: skips_malformed_elements = false.

-- V3: nothing else moved. Run before and after; every value must be identical (policies, tables, columns, other functions).
select
  (select md5(coalesce(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by tablename, policyname), '')) from pg_policies where schemaname = 'public') as rls_policies,
  (select md5(coalesce(string_agg(c.oid::regclass::text || ':' || coalesce(c.relacl::text, 'default'), '|' order by c.oid::regclass::text), '')) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r') as table_grants,
  (select md5(coalesce(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':' || a.attacl::text, '|' order by a.attrelid::regclass::text, a.attname), '')) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and a.attacl is not null) as column_grants,
  (select md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, 'default'), '|' order by p.oid::regprocedure::text), '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.oid <> to_regprocedure('public.teacher_attempt_summary(uuid)')) as other_public_function_grants,
  (select md5(coalesce(string_agg(tgname || ':' || pg_get_triggerdef(oid), '|' order by tgname), '')) from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%') as triggers;
-- Expected: identical before and after.
