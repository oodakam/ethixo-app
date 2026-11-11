-- ONLY AFTER VIJAY APPROVES. ethixo-sg-dev ONLY. Removes the leftover fake test users/data from the Phase 3 live test via the D4 operator function.
-- It ends in ROLLBACK (dry run): the last SELECT shows what the counts WOULD be. To really apply it, a separate approved file with COMMIT is issued.
-- Safety stops: refuses to run if there is any class, more than 10 profiles, or any real-looking email.
begin;
do $$
begin
  if (select count(*) from public.classes) > 0 then raise exception 'STOP: classes exist'; end if;
  if (select count(*) from public.profiles) > 10 then raise exception 'STOP: more than 10 profiles'; end if;
  if exists (select 1 from auth.users where email is not null and email not like '%@example.invalid' and email not like '%@x.sg' and email not like '%@example.com' and email not like '%test%') then
    raise exception 'STOP: an auth user with a real-looking email exists - review manually';
  end if;
end $$;
select private.erase_student_data(id) from public.profiles where role = 'student';
delete from auth.users where id in (select id from public.profiles where role = 'teacher');
delete from auth.users where is_anonymous and id not in (select id from public.profiles);   -- orphan anonymous sessions
select 'after (dry run)' as note, (select count(*) from public.attempts) as attempts, (select count(*) from public.profiles) as profiles, (select count(*) from auth.users) as auth_users;
rollback;   -- dry run
