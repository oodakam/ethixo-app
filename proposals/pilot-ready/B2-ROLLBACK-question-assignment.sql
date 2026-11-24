-- Rolls B2 back: removes assignments.question_indexes, its CHECK, its INSERT grant and the helper function. One transaction.
-- SAFETY: if any question-level assignment exists, the rollback REFUSES to run. Dropping the column would silently turn those
-- rows into whole-lesson assignments (a wider assignment than the teacher chose). Remove or re-create those rows deliberately first.
-- With no question-level rows the rollback restores the exact pre-B2 shape. Idempotent.
begin;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'assignments' and column_name = 'question_indexes') then
    if exists (select 1 from public.assignments where question_indexes is not null) then
      raise exception 'B2 rollback refused: question-level assignments exist (would silently become whole-lesson). Handle them first.'
        using errcode = 'P0001';
    end if;
    revoke insert (question_indexes) on public.assignments from authenticated;
  end if;
end $$;

alter table public.assignments drop constraint if exists assignments_question_indexes_check;
alter table public.assignments drop column if exists question_indexes;
drop function if exists private.valid_question_indexes(smallint[]);

commit;
