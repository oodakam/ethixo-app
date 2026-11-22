-- Seed + BEFORE snapshot for the first_score migration test (local throw-away Postgres only). Run on base + hardening v1.1.
\set ON_ERROR_STOP on
create schema t;
create table t.res(n serial, name text, expected text, got text, ok boolean);
create function t.run(uid uuid, anon boolean, stmt text, as_role text default 'authenticated') returns text language plpgsql as $$
declare n bigint; out text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '{}' else json_build_object('sub',uid,'is_anonymous',anon)::text end, true);
  execute 'set local role '||as_role;
  begin
    if stmt ~* '^\s*(select|with)' then execute 'select count(*) from ('||stmt||') s' into n; else execute stmt; get diagnostics n = row_count; end if;
    out := 'rows:'||n;
  exception when others then out := 'ERR:'||sqlstate||':'||sqlerrm; end;
  execute 'reset role'; return out;
end $$;
create function t.check(name text, expected text, got text) returns void language sql as $$ insert into t.res(name,expected,got,ok) values (name,expected,got, got like expected) $$;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','t1@x.sg'),('00000000-0000-0000-0000-0000000000a2','t2@x.sg'),('00000000-0000-0000-0000-0000000000a3','t3@x.sg'),
 ('00000000-0000-0000-0000-0000000000b1',null),('00000000-0000-0000-0000-0000000000b2',null),('00000000-0000-0000-0000-0000000000b3',null);
\set T1 '''00000000-0000-0000-0000-0000000000a1'''
\set T2 '''00000000-0000-0000-0000-0000000000a2'''
\set T3 '''00000000-0000-0000-0000-0000000000a3'''
\set S1 '''00000000-0000-0000-0000-0000000000b1'''
\set S2 '''00000000-0000-0000-0000-0000000000b2'''
\set S3 '''00000000-0000-0000-0000-0000000000b3'''
select t.run(:T1,false,$$select public.create_my_profile('teacher','Teacher One')$$); select t.run(:T2,false,$$select public.create_my_profile('teacher','Teacher Two')$$); select t.run(:T3,false,$$select public.create_my_profile('teacher','Teacher Unapproved')$$);
select t.run(:S1,true,$$select public.create_my_profile('student','Student','P6')$$); select t.run(:S2,true,$$select public.create_my_profile('student','Student','P6')$$); select t.run(:S3,true,$$select public.create_my_profile('student','Student','P6')$$);
update public.profiles set is_approved = true where id in (:T1,:T2);
select t.run(:T1,false,$$insert into public.classes(name) values ('Class One')$$); select t.run(:T2,false,$$insert into public.classes(name) values ('Class Two')$$);
select join_code as code1 from public.classes where name='Class One' \gset
select join_code as code2 from public.classes where name='Class Two' \gset
select t.run(:S1,true,format($$select * from public.join_class(%L)$$, :'code1')); select t.run(:S2,true,format($$select * from public.join_class(%L)$$, :'code1')); select t.run(:S3,true,format($$select * from public.join_class(%L)$$, :'code2'));
-- S1 q0: stored OUT OF ORDER; earliest by "at" is score 1 (at 1000). Contains a private-looking extra key that must never surface.
select t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','SS','1.1',0,'[{"score":3,"at":3000,"usedThinking":false},{"score":1,"at":1000,"usedThinking":true,"answer":"SECRET-TEXT"},{"score":2,"at":2000}]')$$);
-- q1 single attempt
select t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','SS','1.1',1,'[{"score":1,"at":5000,"usedThinking":false}]')$$);
-- q2 tie on "at": array position decides -> first is score 0
select t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','SS','1.1',2,'[{"score":0,"at":500},{"score":4,"at":500}]')$$);
-- q3 malformed elements around valid ones: only valid count; earliest valid = score 2 (at 10)
select t.run(:S2,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','SS','1.1',3,'[{"score":"x","at":1},{"score":2,"at":10},"junk",null,{"at":5},{"score":5,"at":20,"usedThinking":true}]')$$);
-- q4 empty array
select t.run(:S2,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','SS','1.1',4,'[]')$$);
-- other teacher's student
select t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','SS','1.1',0,'[{"score":4,"at":9}]')$$);
-- BEFORE snapshot (old 12 columns) as teacher one / teacher two (function is SECURITY DEFINER; claims drive auth.uid())
select set_config('request.jwt.claims', json_build_object('sub',:T1)::text, false);
create table t.before1 as select * from public.teacher_attempt_summary();
select set_config('request.jwt.claims', json_build_object('sub',:T2)::text, false);
create table t.before2 as select * from public.teacher_attempt_summary();
select set_config('request.jwt.claims', '{}', false);
create table t.fp_before as select
  (select count(*) from pg_policy) policies,
  (select md5(string_agg(table_name||column_name||grantee||privilege_type, ',' order by table_name,column_name,grantee,privilege_type)) from information_schema.column_privileges where table_schema='public') colgrants,
  (select md5(string_agg(table_name||grantee||privilege_type, ',' order by table_name,grantee,privilege_type)) from information_schema.role_table_grants where table_schema='public') tblgrants,
  (select count(*) from public.attempts) attempts_rows;
