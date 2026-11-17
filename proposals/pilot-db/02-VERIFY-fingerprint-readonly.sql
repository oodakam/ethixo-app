-- READ-ONLY. One statement. Security fingerprint of the Ethixo database objects (public + private schemas).
-- Run on ethixo-sg-dev (validated reference) and on the pilot project: every section's n and md5 must match.
-- Also reports the data counts (pilot must be all 0 before any real student is enrolled).
with
tbl as (select c.relname || ':rls=' || c.relrowsecurity || ':force=' || c.relforcerowsecurity x
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
col as (select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') x
        from information_schema.columns where table_schema = 'public'),
con as (select conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) x
        from pg_constraint where connamespace = 'public'::regnamespace),
idx as (select indexname || ':' || indexdef x from pg_indexes where schemaname = 'public'),
pol as (select tablename || ':' || policyname || ':' || permissive || ':' || roles::text || ':' || cmd || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') x
        from pg_policies where schemaname = 'public'),
fn as (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):secdef=' || p.prosecdef
              || ':cfg=' || coalesce(array_to_string(p.proconfig, ','), '-') || ':src=' || md5(p.prosrc) x
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')),
fnacl as (select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(array_to_string(array(select unnest(p.proacl)::text order by 1), ','), 'default') x
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')),
tgrant as (select table_name || ':' || grantee || ':' || privilege_type x from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')),
cgrant as (select table_name || '.' || column_name || ':' || grantee || ':' || privilege_type x from information_schema.column_privileges
           where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')),
trg as (select tgrelid::regclass::text || ':' || tgname || ':' || pg_get_triggerdef(oid) x from pg_trigger where not tgisinternal
        and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)),
sch as (select nspname || ':' || coalesce(array_to_string(array(select unnest(nspacl)::text order by 1), ','), 'default') x
        from pg_namespace where nspname in ('public', 'private'))
select section, n, md5 from (
  select 1 o, 'tables_rls' section, count(*) n, md5(string_agg(x, '|' order by x)) md5 from tbl
  union all select 2, 'columns', count(*), md5(string_agg(x, '|' order by x)) from col
  union all select 3, 'constraints', count(*), md5(string_agg(x, '|' order by x)) from con
  union all select 4, 'indexes', count(*), md5(string_agg(x, '|' order by x)) from idx
  union all select 5, 'policies', count(*), md5(string_agg(x, '|' order by x)) from pol
  union all select 6, 'functions', count(*), md5(string_agg(x, '|' order by x)) from fn
  union all select 7, 'function_grants', count(*), md5(string_agg(x, '|' order by x)) from fnacl
  union all select 8, 'table_grants', count(*), md5(string_agg(x, '|' order by x)) from tgrant
  union all select 9, 'column_grants', count(*), md5(string_agg(x, '|' order by x)) from cgrant
  union all select 10, 'triggers', count(*), md5(string_agg(x, '|' order by x)) from trg
  union all select 11, 'schema_acl', count(*), md5(string_agg(x, '|' order by x)) from sch
  union all select 12, 'd4_present', (select count(*) from pg_proc where proname in ('delete_my_data', 'erase_student_data')), null
  union all select 13, 'data: profiles/attempts/classes/members/vault/state/auth_users',
    null, (select count(*) from public.profiles) || '/' || (select count(*) from public.attempts) || '/' || (select count(*) from public.classes) || '/'
       || (select count(*) from public.class_members) || '/' || (select count(*) from public.vault_entries) || '/' || (select count(*) from public.student_state)
       || '/' || (select count(*) from auth.users)
) q order by o;
