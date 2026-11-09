-- Local-only (throw-away Postgres). Loads AFTER shim + schema v1 + migration.sql. Fake data only.
\set ON_ERROR_STOP off
create schema t; create table t.res(n serial, name text, expected text, got text, ok boolean);
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
grant usage on schema t to anon, authenticated; 
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','t@x.sg'),('00000000-0000-0000-0000-0000000000b1',null),('00000000-0000-0000-0000-0000000000b2',null);
\set T1 '''00000000-0000-0000-0000-0000000000a1'''
\set S1 '''00000000-0000-0000-0000-0000000000b1'''
\set S2 '''00000000-0000-0000-0000-0000000000b2'''
select t.run(:T1,false,$$select public.create_my_profile('teacher','Mr Tan')$$) \gset
select t.run(:S1,true,$$select public.create_my_profile('student','Student','P6')$$) \gset
select t.run(:S2,true,$$select public.create_my_profile('student','Student','P6')$$) \gset
select t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','SS','1',0,'[{"at":1,"score":2,"usedThinking":false}]'),('P6','SS','1',1,'[{"at":2,"score":1,"usedThinking":false}]')$$) \gset
select t.run(:S2,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','SS','1',0,'[{"at":1,"score":3,"usedThinking":true}]')$$) \gset
insert into public.vault_entries(student_id,qid,subject_key,lesson_id,data) values (:S1,'q1','SS','1','{}');
insert into public.student_state(student_id) values (:S1) on conflict do nothing;
insert into public.classes(id,teacher_id,name) values ('00000000-0000-0000-0000-00000000c001',:T1,'Class A');
insert into public.class_members(class_id,student_id) values ('00000000-0000-0000-0000-00000000c001',:S1),('00000000-0000-0000-0000-00000000c001',:S2);
create function t.cnt(tbl text, sid uuid) returns bigint language plpgsql as $$ declare n bigint; begin execute format('select count(*) from public.%I where student_id=%L',tbl,sid) into n; return n; end $$;

select t.check('D1 anon role cannot call delete_my_data','ERR:42501%', t.run(:S1,true,$$select public.delete_my_data('DELETE MY DATA')$$,'anon'));
select t.check('D2 no sign-in (empty claims) refused','ERR:28000%', t.run(null,false,$$select public.delete_my_data('DELETE MY DATA')$$));
select t.check('D3 wrong confirmation refused','ERR:22023%', t.run(:S1,true,$$select public.delete_my_data('yes')$$));
select t.check('D3b null confirmation refused','ERR:22023%', t.run(:S1,true,$$select public.delete_my_data(null)$$));
select t.check('D4 nothing deleted by the refused calls (S1 attempts still 2)','2', t.cnt('attempts',:S1)::text);
select t.check('D5 a signed-in user cannot call the internal function','ERR:42501%', t.run(:S1,true,$$select private.erase_student_data('00000000-0000-0000-0000-0000000000b2')$$));
select t.check('D6 a teacher cannot erase themselves (student-only)','ERR:P0002%', t.run(:T1,false,$$select public.delete_my_data('DELETE MY DATA')$$));
select t.check('D7 teacher profile and class intact after refusal','1', (select count(*) from public.profiles where id=:T1)::text);
select t.check('D8 S1 erases own data: returns counts','rows:1', t.run(:S1,true,$$select public.delete_my_data('DELETE MY DATA')$$));
select t.check('D9 S1 attempts gone','0', t.cnt('attempts',:S1)::text);
select t.check('D9b S1 vault_entries gone','0', t.cnt('vault_entries',:S1)::text);
select t.check('D10 S1 student_state gone','0', t.cnt('student_state',:S1)::text);
select t.check('D11 S1 class_members gone','0', t.cnt('class_members',:S1)::text);
select t.check('D12 S1 profile gone','0', (select count(*) from public.profiles where id=:S1)::text);
select t.check('D13 S1 auth user gone','0', (select count(*) from auth.users where id=:S1)::text);
select t.check('D14 S2 untouched (attempts 1, member 1, profile 1)','1/1/1', t.cnt('attempts',:S2)||'/'||t.cnt('class_members',:S2)||'/'||(select count(*) from public.profiles where id=:S2));
select t.check('D15 teacher and class untouched','1/1', (select count(*) from public.profiles where id=:T1)||'/'||(select count(*) from public.classes where id='00000000-0000-0000-0000-00000000c001'));
select t.check('D16 a second call by the erased user is refused','ERR:%', t.run(:S1,true,$$select public.delete_my_data('DELETE MY DATA')$$));
select t.check('D17 operator erase of S2 works and returns counts (postgres role)','1', (select (private.erase_student_data(:S2)->>'attempts')));
select t.check('D18 operator erase of unknown id refused','ERR:P0002%', t.run(null,false,$$select 1$$) ) ; -- placeholder replaced below
delete from t.res where name like 'D18%';
do $$ begin begin perform private.erase_student_data('00000000-0000-0000-0000-0000000000ff'); insert into t.res(name,expected,got,ok) values ('D18 operator erase of unknown id refused','ERR','no error',false); exception when sqlstate 'P0002' then insert into t.res(name,expected,got,ok) values ('D18 operator erase of unknown id refused','ERR','ERR',true); end; end $$;
do $$ begin begin perform private.erase_student_data('00000000-0000-0000-0000-0000000000a1'::uuid); insert into t.res(name,expected,got,ok) values ('D19 operator erase of a teacher id refused','ERR','no error',false); exception when sqlstate 'P0002' then insert into t.res(name,expected,got,ok) values ('D19 operator erase of a teacher id refused','ERR','ERR',true); end; end $$;
select t.check('D20 no teacher/class loss after all erases','1/1', (select count(*) from public.profiles where role='teacher')||'/'||(select count(*) from public.classes));
select n, name, got, case when ok then 'PASS' else 'FAIL expected '||expected end as res from t.res order by n;
