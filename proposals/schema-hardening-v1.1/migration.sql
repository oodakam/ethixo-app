-- ======================================================================================
-- Ethixo schema v1.1 hardening  --  PROPOSAL ONLY. Not applied to any Supabase project.
-- (a) teacher_attempt_summary ignores malformed elements instead of failing for the whole class
-- (b) the remaining private helper / trigger functions stop granting EXECUTE to PUBLIC (and so to anon)
-- Idempotent: safe to run twice. Same function signature and return columns; no table, policy or data change.
-- ======================================================================================

-- (a) -------------------------------------------------------------------------------
-- Only elements that are JSON objects with a JSON-NUMBER "at" and a JSON-NUMBER "score" are counted/aggregated.
-- Anything else (a string score, a missing "at", a number/array/null element, ...) is skipped, never cast, so no 22P02.
-- usedThinking counts only when it is the JSON value true. CREATE OR REPLACE keeps the function's existing grants.
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
    select count(*)::int                                                  as cnt,
           max((e ->> 'at')::numeric)                                     as latest_at,
           max((e ->> 'score')::numeric)                                  as best_score,
           coalesce(bool_or((e -> 'usedThinking') = 'true'::jsonb), false) as used,
           (array_agg((e ->> 'score')::numeric order by (e ->> 'at')::numeric desc nulls last))[1] as latest_score
    from jsonb_array_elements(a.data) e
    where jsonb_typeof(e) = 'object'
      and jsonb_typeof(e -> 'at')    = 'number'
      and jsonb_typeof(e -> 'score') = 'number') s
  where private.is_approved_teacher()
    and (p_class_id is null or c.id = p_class_id) $$;

-- (b) -------------------------------------------------------------------------------
-- Postgres gives every new function EXECUTE to PUBLIC; "alter default privileges ... in schema private revoke" cannot undo that.
-- The two helpers already corrected live are repeated here so a fresh project ends in the same state (no-ops on dev).
revoke execute on function private.is_student(), private.is_approved_teacher(), private.teaches_class(uuid),
                           private.in_class(uuid), private.teaches_student(uuid), private.touch_updated_at()
  from public, anon;
-- RLS policies and RPCs run as the signed-in role and need EXECUTE on the helpers (re-asserted; already granted):
grant execute on function private.is_student(), private.is_approved_teacher(), private.teaches_class(uuid),
                          private.in_class(uuid), private.teaches_student(uuid) to authenticated;
-- touch_updated_at() is a trigger function: Postgres checks EXECUTE only when the trigger is CREATED, never when it fires,
-- so it needs no grant at all.
