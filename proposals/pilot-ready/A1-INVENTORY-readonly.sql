-- READ-ONLY. One statement. Lists everything that exists in ethixo-sg-dev so cleanup can be judged. Expect (per the last D4 check): attempts=2, profiles=3, classes=0.
select item, detail from (
  select 1 o, 'counts' item, 'attempts=' || (select count(*) from public.attempts) || ' profiles=' || (select count(*) from public.profiles) || ' classes=' || (select count(*) from public.classes)
         || ' class_members=' || (select count(*) from public.class_members) || ' vault=' || (select count(*) from public.vault_entries) || ' student_state=' || (select count(*) from public.student_state)
         || ' auth_users=' || (select count(*) from auth.users) || ' anonymous_auth_users=' || (select count(*) from auth.users where is_anonymous) as detail
  union all select 2, 'profile ' || left(id::text, 8), role || ' name=' || coalesce(display_name, '-') || ' level=' || coalesce(level, '-') || ' created=' || created_at::date from public.profiles
  union all select 3, 'auth_user ' || left(id::text, 8), 'anonymous=' || is_anonymous || ' email=' || coalesce(email, '-') from auth.users
) q order by o, item;
