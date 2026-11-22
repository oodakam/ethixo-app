-- ======================================================================================
-- B1: add first_score to public.teacher_attempt_summary()          *** PROPOSAL — NOT APPLIED ***
-- Purpose : lets the pilot Teacher Dashboard reproduce the student app's own rules that need the FIRST attempt
--           (misconceptions corrected, first-try full marks, improved after retrying).
-- Change  : ONE new trailing output column  first_score numeric  = score of the EARLIEST valid attempt on that question
--           (earliest "at"; ties broken by array position). Same sensitivity as best_score / latest_score: a number.
-- Unchanged: the other 12 columns and their meaning, SECURITY DEFINER, search_path = '', the approved-teacher + own-class
--           filters, the malformed-element filter from hardening v1.1, no table / policy / column-grant change, no data change.
-- Why DROP : PostgreSQL cannot change a function's RETURNS TABLE shape with CREATE OR REPLACE. The drop + create + grants are
--           ONE transaction, so there is no moment without the function. Nothing in the database depends on it (called only via RPC).
-- Rollback : B1-ROLLBACK-first_score.sql.   Idempotent: running it twice is safe.
-- ======================================================================================
begin;

drop function if exists public.teacher_attempt_summary(uuid);

create function public.teacher_attempt_summary(p_class_id uuid default null)
returns table (student_id uuid, display_name text, class_id uuid, level text, subject_key text, lesson_id text,
               q_idx int, attempt_count int, latest_at numeric, latest_score numeric, best_score numeric, used_thinking boolean,
               first_score numeric)
language sql stable security definer set search_path = '' as $$
  select a.student_id, p.display_name, c.id, a.level, a.subject_key, a.lesson_id, a.q_idx,
         s.cnt, s.latest_at, s.latest_score, s.best_score, s.used, s.first_score
  from public.attempts a
  join public.class_members m on m.student_id = a.student_id
  join public.classes c       on c.id = m.class_id and c.teacher_id = (select auth.uid())
  join public.profiles p      on p.id = a.student_id
  cross join lateral (
    select count(*)::int                                                  as cnt,
           max((e.v ->> 'at')::numeric)                                   as latest_at,
           max((e.v ->> 'score')::numeric)                                as best_score,
           coalesce(bool_or((e.v -> 'usedThinking') = 'true'::jsonb), false) as used,
           (array_agg((e.v ->> 'score')::numeric order by (e.v ->> 'at')::numeric desc nulls last))[1] as latest_score,
           (array_agg((e.v ->> 'score')::numeric order by (e.v ->> 'at')::numeric asc nulls last, e.ord asc))[1] as first_score
    from jsonb_array_elements(a.data) with ordinality as e(v, ord)
    where jsonb_typeof(e.v) = 'object'
      and jsonb_typeof(e.v -> 'at')    = 'number'
      and jsonb_typeof(e.v -> 'score') = 'number') s
  where private.is_approved_teacher()
    and (p_class_id is null or c.id = p_class_id) $$;

revoke all on function public.teacher_attempt_summary(uuid) from public, anon;
grant execute on function public.teacher_attempt_summary(uuid) to authenticated;

-- Abort (and roll the whole transaction back) unless the security posture is exactly what it was.
do $$
declare p oid := to_regprocedure('public.teacher_attempt_summary(uuid)');
begin
  if p is null then raise exception 'B1: function missing'; end if;
  if has_function_privilege('anon', p, 'EXECUTE') then raise exception 'B1: anon can EXECUTE'; end if;
  if exists (select 1 from pg_proc x, aclexplode(coalesce(x.proacl, acldefault('f', x.proowner))) a where x.oid = p and a.grantee = 0) then
    raise exception 'B1: PUBLIC can EXECUTE'; end if;
  if not has_function_privilege('authenticated', p, 'EXECUTE') then raise exception 'B1: authenticated cannot EXECUTE'; end if;
  if not (select prosecdef from pg_proc where oid = p) then raise exception 'B1: not SECURITY DEFINER'; end if;
  if not exists (select 1 from pg_proc where oid = p and proconfig @> array['search_path=""']) then raise exception 'B1: search_path not pinned'; end if;
end $$;

commit;
notify pgrst, 'reload schema';   -- PostgREST picks up the new column
