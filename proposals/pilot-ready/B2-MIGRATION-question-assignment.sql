-- ======================================================================================
-- B2: question-level assignment — add public.assignments.question_indexes      *** PROPOSAL — NOT APPLIED ***
-- Purpose : lets a teacher assign specific curriculum questions of a lesson to a CLASS (class scope only).
-- Change  : ONE new nullable column  question_indexes smallint[]  = zero-based question indexes within
--           (level, subject_key, lesson_id) — exactly the index the student app already uses (attempts q_idx, selectBankQuestion(idx)).
--           NULL  = whole-lesson assignment (every existing row, and every insert that omits the column) => behaviour unchanged.
--           CHECK : NULL, or 1..20 entries, one dimension, every value 0..99, no NULL elements, no duplicates.
--           GRANT : INSERT (question_indexes) to authenticated   (SELECT is already table-wide, so the column is readable by
--                   exactly the same policies as today: own-class teacher, in-class student).
-- Helper  : private.valid_question_indexes(smallint[])  — IMMUTABLE, SECURITY INVOKER, search_path pinned, no table access.
--           Needed only because a CHECK expression cannot contain a sub-select, and "no duplicates" needs one.
--           EXECUTE: authenticated + service_role only (not PUBLIC / anon).
-- NOT changed: RLS policies, table grants, existing column grants, UPDATE/DELETE (still none => append-only), the composite FK,
--           teacher_attempt_summary(), any other table, any existing row. No question text / answer / feedback / vault data is stored.
-- Idempotent: safe to run twice.   Rollback: B2-ROLLBACK-question-assignment.sql.   One transaction.
-- ======================================================================================
begin;

create or replace function private.valid_question_indexes(a smallint[])
returns boolean language sql immutable set search_path = '' as $$
  select a is not null
     and array_ndims(a) = 1
     and cardinality(a) between 1 and 20
     and not exists (select 1 from unnest(a) as u(x) where u.x is null or u.x < 0 or u.x > 99)
     and (select count(distinct u.x) from unnest(a) as u(x)) = cardinality(a) $$;

revoke execute on function private.valid_question_indexes(smallint[]) from public, anon;
grant  execute on function private.valid_question_indexes(smallint[]) to authenticated;
do $$ begin   -- service_role exists on Supabase (it holds table-level INSERT on assignments, so its inserts must evaluate the CHECK too)
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function private.valid_question_indexes(smallint[]) to service_role;
  end if;
end $$;

alter table public.assignments add column if not exists question_indexes smallint[];

alter table public.assignments drop constraint if exists assignments_question_indexes_check;
alter table public.assignments add  constraint assignments_question_indexes_check
  check (question_indexes is null or private.valid_question_indexes(question_indexes));

grant insert (question_indexes) on public.assignments to authenticated;

commit;
