-- Rollback for the v1.1 hardening proposal (restores the previous function body and the previous PUBLIC grants).
create or replace function public.teacher_attempt_summary(p_class_id uuid default null)
returns table (student_id uuid, display_name text, class_id uuid, level text, subject_key text, lesson_id text,
               q_idx int, attempt_count int, latest_at numeric, latest_score numeric, best_score numeric, used_thinking boolean)
language sql stable security definer set search_path = '' as $$
  select a.student_id, p.display_name, c.id, a.level, a.subject_key, a.lesson_id, a.q_idx,
         s.cnt, s.latest_at, s.latest_score, s.best_score, s.used
  from public.attempts a
  join public.class_members m on m.student_id = a.student_id
  join public.classes c       on c.id = m.class_id and c.teacher_id = (select auth.uid())
  join public.profiles p      on p.id = a.student_id
  cross join lateral (
    select count(*)::int                                  as cnt,
           max((e ->> 'at')::numeric)                     as latest_at,
           max((e ->> 'score')::numeric)                  as best_score,
           bool_or(coalesce((e ->> 'usedThinking')::boolean, false)) as used,
           (array_agg((e ->> 'score')::numeric order by (e ->> 'at')::numeric desc nulls last))[1] as latest_score
    from jsonb_array_elements(a.data) e) s
  where private.is_approved_teacher()
    and (p_class_id is null or c.id = p_class_id) $$;
-- Optional: only to return the four helpers to their pre-hardening state (each re-opens EXECUTE to PUBLIC/anon):
-- grant execute on function private.teaches_class(uuid), private.in_class(uuid), private.teaches_student(uuid), private.touch_updated_at() to public;
