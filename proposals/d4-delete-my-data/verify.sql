-- PROPOSAL ONLY. READ-ONLY. Run after the migration. Every row should say PASS.
select 'delete_my_data exists, SECURITY DEFINER, search_path pinned' as check,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='delete_my_data' and p.prosecdef and p.proconfig::text like '%search_path=%') then 'PASS' else 'FAIL' end as result
union all select 'anon cannot execute delete_my_data', case when not has_function_privilege('anon','public.delete_my_data(text)','execute') then 'PASS' else 'FAIL' end
union all select 'authenticated can execute delete_my_data', case when has_function_privilege('authenticated','public.delete_my_data(text)','execute') then 'PASS' else 'FAIL' end
union all select 'erase_student_data not executable by anon/authenticated', case when not has_function_privilege('anon','private.erase_student_data(uuid)','execute') and not has_function_privilege('authenticated','private.erase_student_data(uuid)','execute') then 'PASS' else 'FAIL' end
union all select 'erase_student_data is SECURITY DEFINER with pinned search_path', case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='erase_student_data' and p.prosecdef and p.proconfig::text like '%search_path=%') then 'PASS' else 'FAIL' end;
