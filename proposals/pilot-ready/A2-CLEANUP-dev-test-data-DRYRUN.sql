-- ONLY AFTER VIJAY APPROVES. ethixo-sg-dev ONLY. Removes the leftover fake test users/data from the Phase 3 live test via the D4 operator function.
-- It ends in ROLLBACK (dry run): the last SELECT shows what the counts WOULD be. To really apply it, a separate approved file with COMMIT is issued.
-- Safety stops: refuses to run if there is any class, more than 10 profiles, or any email that is not an approved test address.
-- Email check FAILS CLOSED: every non-null email must exactly match an approved test pattern, or the run stops.
--   Approved: <local-part>@example.invalid or <local-part>@example.com (reserved domains, RFC 2606/6761 - can never be a real mailbox).
--   Whole address is anchored, case-insensitive, no subdomains, no substring matching (so 'testa.kumar@gmail.com' STOPS).
--   Empty-string or malformed emails also STOP. To approve another domain, add it here explicitly after review.
begin;
do $$
begin
  if (select count(*) from public.classes) > 0 then raise exception 'STOP: classes exist'; end if;
  if (select count(*) from public.profiles) > 10 then raise exception 'STOP: more than 10 profiles'; end if;
  if exists (
    select 1 from auth.users
    where email is not null
      and lower(email) !~ '^[a-z0-9._+-]+@(example\.invalid|example\.com)$'
  ) then
    raise exception 'STOP: an auth user has an email that is not an approved test address - review manually';
  end if;
end $$;
select private.erase_student_data(id) from public.profiles where role = 'student';
delete from auth.users where id in (select id from public.profiles where role = 'teacher');
delete from auth.users where is_anonymous and id not in (select id from public.profiles);   -- orphan anonymous sessions
select 'after (dry run)' as note, (select count(*) from public.attempts) as attempts, (select count(*) from public.profiles) as profiles, (select count(*) from auth.users) as auth_users;
rollback;   -- dry run
