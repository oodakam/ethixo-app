-- Seed + BEFORE snapshot for the B2 question-assignment test (local throw-away Postgres only). Run on base + hardening v1.1 + B1.
-- Disposable names only: Angelina, Alan, Austin + a 10-student class fixture. Nothing here touches Supabase.
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
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','t1@x.sg'),('00000000-0000-0000-0000-0000000000a2','t2@x.sg'),
 ('00000000-0000-0000-0000-0000000000b1',null),('00000000-0000-0000-0000-0000000000b2',null),('00000000-0000-0000-0000-0000000000b3',null);
\set T1 '''00000000-0000-0000-0000-0000000000a1'''
\set T2 '''00000000-0000-0000-0000-0000000000a2'''
\set S1 '''00000000-0000-0000-0000-0000000000b1'''
\set S2 '''00000000-0000-0000-0000-0000000000b2'''
\set S3 '''00000000-0000-0000-0000-0000000000b3'''
select t.run(:T1,false,$$select public.create_my_profile('teacher','Teacher One')$$); select t.run(:T2,false,$$select public.create_my_profile('teacher','Teacher Two')$$);
select t.run(:S1,true,$$select public.create_my_profile('student','Angelina','P6')$$); select t.run(:S2,true,$$select public.create_my_profile('student','Alan','P6')$$); select t.run(:S3,true,$$select public.create_my_profile('student','Austin','P6')$$);
update public.profiles set is_approved = true where id in (:T1,:T2);
select t.run(:T1,false,$$insert into public.classes(name) values ('Class One')$$); select t.run(:T2,false,$$insert into public.classes(name) values ('Class Two')$$);
select join_code as code1 from public.classes where name='Class One' \gset
select join_code as code2 from public.classes where name='Class Two' \gset
select id as cls1 from public.classes where name='Class One' \gset
select id as cls2 from public.classes where name='Class Two' \gset
select t.run(:S1,true,format($$select * from public.join_class(%L)$$, :'code1')); select t.run(:S2,true,format($$select * from public.join_class(%L)$$, :'code1')); select t.run(:S3,true,format($$select * from public.join_class(%L)$$, :'code2'));
-- realistic 10-student class fixture in Class One (disposable)
insert into auth.users(id,email) select ('00000000-0000-0000-0000-0000000010'||lpad(i::text,2,'0'))::uuid, null from generate_series(1,10) i;
select t.run(('00000000-0000-0000-0000-0000000010'||lpad(i::text,2,'0'))::uuid,true,$$select public.create_my_profile('student','Pilot Student','P6')$$) from generate_series(1,10) i;
select t.run(('00000000-0000-0000-0000-0000000010'||lpad(i::text,2,'0'))::uuid,true,format($$select * from public.join_class(%L)$$, :'code1')) from generate_series(1,10) i;
-- PRE-EXISTING whole-lesson assignments (created the way the live pilot code does today: no question column)
select t.run(:T1,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,due_date) values (%L,'P6','EN','1.4','2026-12-01')$$, :'cls1'));
select t.run(:T2,false,format($$insert into public.assignments(class_id,level,subject_key,lesson_id,due_date) values (%L,'P6','SCI','2.1','2026-12-02')$$, :'cls2'));
create table t.asg_before as select id,class_id,teacher_id,level,subject_key,lesson_id,due_date,created_at from public.assignments;
create table t.cols_before as select string_agg(column_name,',' order by ordinal_position) c from information_schema.columns where table_schema='public' and table_name='assignments';
create table t.fp_before as select
  (select count(*) from pg_policy) policies,
  (select md5(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), ',' order by tablename,policyname)) from pg_policies where schemaname='public') polhash,
  (select md5(string_agg(table_name||column_name||grantee||privilege_type, ',' order by table_name,column_name,grantee,privilege_type)) from information_schema.column_privileges where table_schema='public') colgrants,
  (select md5(string_agg(table_name||grantee||privilege_type, ',' order by table_name,grantee,privilege_type)) from information_schema.role_table_grants where table_schema='public') tblgrants,
  (select count(*) from public.attempts) attempts_rows, (select count(*) from public.assignments) asg_rows;
