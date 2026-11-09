-- PROPOSAL ONLY (D4). Do NOT run against Supabase without separate written approval.
-- Adds two functions; changes no table, policy or existing function. Reversible with rollback.sql.
-- Erasing a student = deleting their auth.users row; every learning table cascades from it
-- (profiles -> attempts, vault_entries, student_state, class_members). Teachers and classes are never touched.
begin;

create or replace function private.erase_student_data(p_student uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_student is null then raise exception 'student id required' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_student and role = 'student') then
    raise exception 'no student profile for this id' using errcode = 'P0002';   -- refuses teachers and unknown ids
  end if;
  r := jsonb_build_object(
    'attempts',      (select count(*) from public.attempts       where student_id = p_student),
    'vault_entries', (select count(*) from public.vault_entries  where student_id = p_student),
    'student_state', (select count(*) from public.student_state  where student_id = p_student),
    'class_members', (select count(*) from public.class_members  where student_id = p_student),
    'profiles', 1, 'auth_users', 1);
  delete from auth.users where id = p_student;       -- cascades to profiles and everything under it
  return r;
end $$;
revoke all on function private.erase_student_data(uuid) from public, anon, authenticated;   -- operator-only (SQL editor / postgres)

create or replace function public.delete_my_data(p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_confirm is distinct from 'DELETE MY DATA' then raise exception 'confirmation text does not match' using errcode = '22023'; end if;
  return private.erase_student_data(uid);            -- only ever the caller's own id
end $$;
revoke all on function public.delete_my_data(text) from public, anon;
grant execute on function public.delete_my_data(text) to authenticated;   -- anonymous students are role "authenticated" in Supabase

commit;
