-- Assertions AFTER proposals/pilot-ready/B2-MIGRATION-question-assignment.sql (local throw-away Postgres only).
\set ON_ERROR_STOP off
\set T1 '''00000000-0000-0000-0000-0000000000a1'''
\set T2 '''00000000-0000-0000-0000-0000000000a2'''
\set S1 '''00000000-0000-0000-0000-0000000000b1'''
\set S2 '''00000000-0000-0000-0000-0000000000b2'''
\set S3 '''00000000-0000-0000-0000-0000000000b3'''
\set S10 '''00000000-0000-0000-0000-000000001005'''
select id as cls1 from public.classes where name='Class One' \gset
select id as cls2 from public.classes where name='Class Two' \gset
select t.check('Q1 exactly ONE column added: question_indexes smallint[], nullable, no default','smallint[]|YES|none',
  (select data_type_fmt||'|'||is_nullable||'|'||coalesce(column_default,'none') from (select format_type(a.atttypid,a.atttypmod) data_type_fmt, case when a.attnotnull then 'NO' else 'YES' end is_nullable, (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum) column_default from pg_attribute a where a.attrelid='public.assignments'::regclass and a.attname='question_indexes') x));
select t.check('Q1b column list = BEFORE list + question_indexes (nothing else, no text column added)','true',
  ((select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='assignments') = (select c||',question_indexes' from t.cols_before))::text);
select t.check('Q2 existing assignments are byte-identical and are whole-lesson (question_indexes NULL)','0|2',
  (select count(*)::text from ((select * from t.asg_before except select id,class_id,teacher_id,level,subject_key,lesson_id,due_date,created_at from public.assignments)
    union all (select id,class_id,teacher_id,level,subject_key,lesson_id,due_date,created_at from public.assignments where question_indexes is null and id in (select id from t.asg_before) except select * from t.asg_before)) x)
  ||'|'||(select count(*) from public.assignments where question_indexes is null)::text);
select t.check('Q3 teacher insert WITHOUT the column still works (old client code path)','rows:1',
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,due_date) values (%L,'P6','SS','1.1','2026-12-03')$$,:'cls1')));
select t.check('Q3b ...and the stored row is whole-lesson (question_indexes NULL)','null',
  (select coalesce(question_indexes::text,'null') from public.assignments where lesson_id='1.1' and subject_key='SS'));
select t.check('Q4 teacher insert with explicit NULL is whole-lesson','rows:1',
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,due_date,question_indexes) values (%L,'P6','SS','1.2','2026-12-03',null)$$,:'cls1')));
select t.check('Q5 teacher inserts question-level {0,2,5}','rows:1',
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,due_date,question_indexes) values (%L,'P6','SCI','2.1','2026-12-04','{0,2,5}')$$,:'cls1')));
select t.check('Q5b ...stored exactly, as curriculum identifiers only','{0,2,5}',
  (select question_indexes::text from public.assignments where subject_key='SCI' and lesson_id='2.1' and class_id=:'cls1'));
select t.check('Q6 boundaries accepted: {0,99} and a full 20-entry list','rows:1|rows:1',
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,due_date,question_indexes) values (%L,'P6','EN','1.5','2026-12-05','{0,99}')$$,:'cls1'))||'|'||
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,due_date,question_indexes) values (%L,'P6','EN','1.6','2026-12-05','{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19}')$$,:'cls1')));
select t.check('Q7 invalid arrays rejected by the CHECK (23514): empty, 21 entries, -1, 100, duplicate, NULL element, 2-D','ERR:23514%|ERR:23514%|ERR:23514%|ERR:23514%|ERR:23514%|ERR:23514%|ERR:23514%',
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','9.1','{}')$$,:'cls1'))||'|'||
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','9.2','{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20}')$$,:'cls1'))||'|'||
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','9.3','{-1}')$$,:'cls1'))||'|'||
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','9.4','{100}')$$,:'cls1'))||'|'||
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','9.5','{3,3}')$$,:'cls1'))||'|'||
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','9.6','{1,NULL}')$$,:'cls1'))||'|'||
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','9.7','{{1,2},{3,4}}')$$,:'cls1')));
select t.check('Q7b a value outside smallint is rejected too (22003), nothing stored','ERR:22003%|0',
  t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','9.8','{40000}')$$,:'cls1'))||'|'||(select count(*) from public.assignments where lesson_id like '9.%'));
select t.check('Q8 isolation (INSERT): teacher two cannot assign to teacher one''s class, with or without question_indexes','ERR:42501%|ERR:42501%',
  t.run(:T2,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','1.4','{1}')$$,:'cls1'))||'|'||
  t.run(:T2,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id) values (%L,'P6','EN','1.4')$$,:'cls1')));
select t.check('Q8b DB-level FK still binds teacher_id to the class owner even for the table owner','ERR:23503%',
  t.run(null,false,format($$insert into public.assignments(class_id,teacher_id,level,subject_key,lesson_id,question_indexes) values (%L,%L,'P6','EN','1.4','{1}')$$,:'cls1','00000000-0000-0000-0000-0000000000a2'),'postgres'));
select t.check('Q9 teacher read: teacher one sees all own rows incl. question_indexes; teacher two sees only own class rows','rows:6|rows:1',
  t.run(:T1,false,'select * from public.assignments')||'|'||t.run(:T2,false,'select * from public.assignments'));
select t.check('Q10 student visibility via REAL RLS: Angelina, Alan and a fixture student (Class One) see the 6 Class One rows; Austin (Class Two) sees only his own class''s 1','rows:6|rows:6|rows:6|rows:1',
  t.run(:S1,true,'select * from public.assignments')||'|'||t.run(:S2,true,'select * from public.assignments')||'|'||t.run(:S10,true,'select * from public.assignments')||'|'||t.run(:S3,true,'select * from public.assignments'));
select t.check('Q11 another class''s assignment (incl. its question_indexes) is invisible: Austin sees 0 Class One rows; Angelina sees 0 Class Two rows','rows:0|rows:0',
  t.run(:S3,true,format($$select * from public.assignments where class_id=%L$$,:'cls1'))||'|'||t.run(:S1,true,format($$select * from public.assignments where class_id=%L$$,:'cls2')));
select t.check('Q12 students cannot create assignments (with or without question_indexes), cannot update, cannot delete','ERR:42501%|ERR:42501%|ERR:42501%|ERR:42501%',
  t.run(:S1,true,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,question_indexes) values (%L,'P6','EN','1.4','{1}')$$,:'cls1'))||'|'||
  t.run(:S1,true,format($$insert into public.assignments(class_id,level,subject_key,lesson_id) values (%L,'P6','EN','1.4')$$,:'cls1'))||'|'||
  t.run(:S1,true,$$update public.assignments set question_indexes='{1}'$$)||'|'||t.run(:S1,true,'delete from public.assignments'));
select t.check('Q13 append-only unchanged: even the owning teacher cannot UPDATE (incl. question_indexes) or DELETE','ERR:42501%|ERR:42501%|ERR:42501%',
  t.run(:T1,false,$$update public.assignments set question_indexes='{1}'$$)||'|'||t.run(:T1,false,$$update public.assignments set due_date='2027-01-01'$$)||'|'||t.run(:T1,false,'delete from public.assignments'));
select t.check('Q14 anon: cannot read or insert','ERR:42501%|ERR:42501%',
  t.run(null,false,'select * from public.assignments','anon')||'|'||t.run(null,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id) values (%L,'P6','EN','1.4')$$,:'cls1'),'anon'));
select t.check('Q15 privacy boundary intact: a teacher still reads 0 rows of attempts / vault_entries / student_state','rows:0|rows:0|rows:0',
  t.run(:T1,false,'select * from public.attempts')||'|'||t.run(:T1,false,'select * from public.vault_entries')||'|'||t.run(:T1,false,'select * from public.student_state'));
select t.check('G1 authenticated INSERT columns = the original 6 + question_indexes; SELECT includes it; no UPDATE/DELETE/TRUNCATE; anon and PUBLIC hold nothing','class_id,due_date,lesson_id,level,question_indexes,subject_key,teacher_id|true|0|0',
  (select string_agg(column_name,',' order by column_name) from information_schema.column_privileges where table_schema='public' and table_name='assignments' and grantee='authenticated' and privilege_type='INSERT')||'|'||
  exists(select 1 from information_schema.column_privileges where table_schema='public' and table_name='assignments' and grantee='authenticated' and privilege_type='SELECT' and column_name='question_indexes')::text||'|'||
  (select count(*) from information_schema.column_privileges where table_schema='public' and table_name='assignments' and grantee='authenticated' and privilege_type in ('UPDATE','DELETE','TRUNCATE'))||'|'||
  (select count(*) from information_schema.column_privileges where table_schema='public' and table_name='assignments' and grantee in ('anon','PUBLIC')));
select t.check('G2 RLS unchanged: policy count and a hash of every policy definition identical to BEFORE','true|true',
  (select (b.policies=(select count(*) from pg_policy))::text||'|'||(b.polhash=(select md5(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), ',' order by tablename,policyname)) from pg_policies where schemaname='public'))::text from t.fp_before b));
select t.check('G3 grants unchanged except the new column: table-level grants identical; column grants identical when question_indexes is excluded','true|true',
  (select (b.tblgrants=(select md5(string_agg(table_name||grantee||privilege_type, ',' order by table_name,grantee,privilege_type)) from information_schema.role_table_grants where table_schema='public'))::text||'|'||
          (b.colgrants=(select md5(string_agg(table_name||column_name||grantee||privilege_type, ',' order by table_name,column_name,grantee,privilege_type)) from information_schema.column_privileges where table_schema='public' and column_name<>'question_indexes'))::text from t.fp_before b));
select t.check('G4 helper function: authenticated can execute, anon cannot, PUBLIC holds nothing, SECURITY INVOKER, IMMUTABLE, search_path pinned','true|false|0|false|i|true',
  has_function_privilege('authenticated','private.valid_question_indexes(smallint[])','EXECUTE')||'|'||has_function_privilege('anon','private.valid_question_indexes(smallint[])','EXECUTE')||'|'||
  (select count(*) from pg_proc x, aclexplode(coalesce(x.proacl, acldefault('f',x.proowner))) a where x.oid='private.valid_question_indexes(smallint[])'::regprocedure and a.grantee=0)||'|'||
  (select prosecdef from pg_proc where oid='private.valid_question_indexes(smallint[])'::regprocedure)||'|'||
  (select provolatile::text from pg_proc where oid='private.valid_question_indexes(smallint[])'::regprocedure)||'|'||
  (select (proconfig @> array['search_path=""']) from pg_proc where oid='private.valid_question_indexes(smallint[])'::regprocedure));
select t.check('G5 no free-text storage: the only text columns are the curriculum identifiers level, lesson_id, subject_key','lesson_id,level,subject_key',
  (select string_agg(column_name,',' order by column_name) from information_schema.columns where table_schema='public' and table_name='assignments' and data_type='text'));
select t.check('G6 other data untouched: attempts row count identical to BEFORE','true',
  (select (b.attempts_rows=(select count(*) from public.attempts))::text from t.fp_before b));
select n, case when ok then 'PASS' else 'FAIL' end r, name, expected, got from t.res order by n;
