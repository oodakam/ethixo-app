-- Assertions AFTER proposals/pilot-ready/B1-MIGRATION-first_score.sql (local throw-away Postgres only).
\set ON_ERROR_STOP off
\set T1 '''00000000-0000-0000-0000-0000000000a1'''
\set T2 '''00000000-0000-0000-0000-0000000000a2'''
\set T3 '''00000000-0000-0000-0000-0000000000a3'''
\set S1 '''00000000-0000-0000-0000-0000000000b1'''
select set_config('request.jwt.claims', json_build_object('sub',:T1)::text, false);
create table t.after1 as select * from public.teacher_attempt_summary();
select set_config('request.jwt.claims', json_build_object('sub',:T2)::text, false);
create table t.after2 as select * from public.teacher_attempt_summary();
select set_config('request.jwt.claims', '{}', false);
select t.check('A1 output columns: the original 12 in order, then first_score numeric (13 total, nothing else)',
  'student_id,display_name,class_id,level,subject_key,lesson_id,q_idx,attempt_count,latest_at,latest_score,best_score,used_thinking,first_score',
  (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a where a.attrelid='t.after1'::regclass and a.attnum>0 and not a.attisdropped));
select t.check('A1b first_score is numeric','numeric',(select format_type(atttypid,atttypmod) from pg_attribute where attrelid='t.after1'::regclass and attname='first_score'));
select t.check('A2 the original 12 columns are IDENTICAL before vs after (teacher one)','0',
  (select count(*)::text from ((select * from t.before1 except select student_id,display_name,class_id,level,subject_key,lesson_id,q_idx,attempt_count,latest_at,latest_score,best_score,used_thinking from t.after1)
   union all (select student_id,display_name,class_id,level,subject_key,lesson_id,q_idx,attempt_count,latest_at,latest_score,best_score,used_thinking from t.after1 except select * from t.before1)) x));
select t.check('A2b same for teacher two','0',
  (select count(*)::text from ((select * from t.before2 except select student_id,display_name,class_id,level,subject_key,lesson_id,q_idx,attempt_count,latest_at,latest_score,best_score,used_thinking from t.after2)
   union all (select student_id,display_name,class_id,level,subject_key,lesson_id,q_idx,attempt_count,latest_at,latest_score,best_score,used_thinking from t.after2 except select * from t.before2)) x));
select t.check('A3 out-of-order attempts: first_score = score at the earliest "at" (1), while latest=3 and best=3','1|3|3',
  (select first_score||'|'||latest_score||'|'||best_score from t.after1 where student_id=:S1 and q_idx=0));
select t.check('A4 single attempt: first_score = that score','1', (select first_score::text from t.after1 where student_id=:S1 and q_idx=1));
select t.check('A5 tie on "at": array position decides (first element, score 0)','0', (select first_score::text from t.after1 where student_id=:S1 and q_idx=2));
select t.check('A6 malformed elements ignored: first valid = 2; count counts only valid (2)','2|2',
  (select first_score||'|'||attempt_count from t.after1 where student_id='00000000-0000-0000-0000-0000000000b2' and q_idx=3));
select t.check('A7 empty array: no valid attempt => first_score NULL, count 0','null|0',
  (select coalesce(first_score::text,'null')||'|'||attempt_count from t.after1 where student_id='00000000-0000-0000-0000-0000000000b2' and q_idx=4));
select t.check('A8 no answer / private text can appear anywhere in the output (SECRET-TEXT absent)','0',
  (select count(*)::text from t.after1 x where x::text like '%SECRET%'));
select t.check('A9 isolation: teacher two sees only its own student (1 row); teacher one does not see it','1|0',
  (select count(*)::text from t.after2)||'|'||(select count(*)::text from t.after1 where student_id='00000000-0000-0000-0000-0000000000b3'));
select t.check('A10 unapproved teacher, student and anon get nothing / are refused','rows:0|rows:0|ERR:42501%',
  t.run(:T3,false,'select * from public.teacher_attempt_summary()')||'|'||t.run(:S1,true,'select * from public.teacher_attempt_summary()')||'|'||t.run(null,false,'select * from public.teacher_attempt_summary()','anon'));
select t.check('A11 raw tables still blocked for a teacher (attempts, vault_entries, student_state)','rows:0|rows:0|rows:0',
  t.run(:T1,false,'select * from public.attempts')||'|'||t.run(:T1,false,'select * from public.vault_entries')||'|'||t.run(:T1,false,'select * from public.student_state'));
select t.check('A12 grants: authenticated yes, anon no, PUBLIC none; SECURITY DEFINER; search_path pinned','true|false|0|true|true',
  has_function_privilege('authenticated','public.teacher_attempt_summary(uuid)','EXECUTE')||'|'||has_function_privilege('anon','public.teacher_attempt_summary(uuid)','EXECUTE')||'|'||
  (select count(*) from pg_proc x, aclexplode(coalesce(x.proacl, acldefault('f',x.proowner))) a where x.oid='public.teacher_attempt_summary(uuid)'::regprocedure and a.grantee=0)||'|'||
  (select prosecdef from pg_proc where oid='public.teacher_attempt_summary(uuid)'::regprocedure)||'|'||
  (select (proconfig @> array['search_path=""']) from pg_proc where oid='public.teacher_attempt_summary(uuid)'::regprocedure));
select t.check('A13 nothing else changed: policies, column grants, table grants, row counts identical to BEFORE','true|true|true|true',
  (select (b.policies=(select count(*) from pg_policy))::text||'|'||
          (b.colgrants=(select md5(string_agg(table_name||column_name||grantee||privilege_type, ',' order by table_name,column_name,grantee,privilege_type)) from information_schema.column_privileges where table_schema='public'))::text||'|'||
          (b.tblgrants=(select md5(string_agg(table_name||grantee||privilege_type, ',' order by table_name,grantee,privilege_type)) from information_schema.role_table_grants where table_schema='public'))::text||'|'||
          (b.attempts_rows=(select count(*) from public.attempts))::text from t.fp_before b));
select n, case when ok then 'PASS' else 'FAIL' end r, name, expected, got from t.res order by n;
