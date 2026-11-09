-- Local-only checks (real Postgres) for the v1.1 hardening proposal. Runs AFTER base schema + the approved two-function fix + migration.sql.
\set ON_ERROR_STOP off
create schema if not exists t;
create table t.res(n serial, name text, expected text, got text, ok boolean);
create function t.run(uid uuid, anon boolean, stmt text, as_role text default 'authenticated') returns text language plpgsql as $$
declare n bigint; out text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '{}' else json_build_object('sub',uid,'is_anonymous',anon)::text end, true);
  execute 'set local role '||as_role;
  begin
    if stmt ~* '^\s*(select|with)' then execute 'select count(*) from ('||stmt||') s' into n;
    else execute stmt; get diagnostics n = row_count; end if;
    out := 'rows:'||n;
  exception when others then out := 'ERR:'||sqlstate||':'||sqlerrm; end;
  execute 'reset role';
  return out;
end $$;
create function t.check(name text, expected text, got text) returns void language sql as $$
  insert into t.res(name,expected,got,ok) values (name,expected,got, got like expected) $$;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','t1@x.sg'),('00000000-0000-0000-0000-0000000000a2','t2@x.sg'),
 ('00000000-0000-0000-0000-0000000000b1',null),('00000000-0000-0000-0000-0000000000b2',null),('00000000-0000-0000-0000-0000000000b3',null),('00000000-0000-0000-0000-0000000000b4',null);
\set T1 '''00000000-0000-0000-0000-0000000000a1'''
\set T2 '''00000000-0000-0000-0000-0000000000a2'''
\set S1 '''00000000-0000-0000-0000-0000000000b1'''
\set S2 '''00000000-0000-0000-0000-0000000000b2'''
\set S3 '''00000000-0000-0000-0000-0000000000b3'''
\set S4 '''00000000-0000-0000-0000-0000000000b4'''
select t.run(:T1,false,$$select public.create_my_profile('teacher','Mr Tan')$$); select t.run(:T2,false,$$select public.create_my_profile('teacher','Ms Lim')$$);
select t.run(:S1,true,$$select public.create_my_profile('student','Student','P6')$$); select t.run(:S2,true,$$select public.create_my_profile('student','Student','P6')$$);
select t.run(:S3,true,$$select public.create_my_profile('student','Student','P6')$$); select t.run(:S4,true,$$select public.create_my_profile('student','Student','P6')$$);
update public.profiles set is_approved = true where id in (:T1,:T2);
select t.run(:T1,false,$$insert into public.classes(name) values ('P6A')$$);
select join_code as code1 from public.classes where name='P6A' \gset
select t.run(:S1,true,format($$select * from public.join_class(%L)$$, :'code1')); select t.run(:S3,true,format($$select * from public.join_class(%L)$$, :'code1')); select t.run(:S4,true,format($$select * from public.join_class(%L)$$, :'code1'));
-- S1: healthy history; S3: nothing but garbage; S4: valid + garbage mixed
select t.check('H1 healthy S1 row','rows:1', t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[{"score":1,"at":1000,"usedThinking":false},{"score":3,"at":2000,"usedThinking":true},{"score":2,"at":3000}]')$$));
select t.check('H2 S3 stores every kind of malformed element (the DB allows it)','rows:1', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[{"score":"abc","at":1},{"score":"3","at":2},{"score":1,"at":"x"},{"score":1},{"at":5},1,"a",null,[1,2],{"score":{"v":1},"at":{"v":1}}]')$$));
select t.check('H3 S4 stores valid + malformed mixed','rows:1', t.run(:S4,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[{"score":1,"at":10,"usedThinking":"maybe"},{"score":"oops","at":20},{"score":4,"at":30,"usedThinking":true},"junk"]')$$));
select t.check('H4 the summary WORKS with malformed data in the class (was 22P02 before): 3 rows','rows:3', t.run(:T1,false,'select * from public.teacher_attempt_summary()'));
select t.check('H5 healthy student unchanged: count 3, latest_at 3000, latest 2, best 3, thinking true','rows:1', t.run(:T1,false,$$select * from public.teacher_attempt_summary() where student_id='00000000-0000-0000-0000-0000000000b1' and attempt_count=3 and latest_at=3000 and latest_score=2 and best_score=3 and used_thinking$$));
select t.check('H6 all-garbage student: row present, 0 valid attempts, no values, thinking false','rows:1', t.run(:T1,false,$$select * from public.teacher_attempt_summary() where student_id='00000000-0000-0000-0000-0000000000b3' and attempt_count=0 and latest_at is null and latest_score is null and best_score is null and not used_thinking$$));
select t.check('H7 mixed student: only the 2 valid elements count (at 10 and 30), latest score 4, best 4, thinking true','rows:1', t.run(:T1,false,$$select * from public.teacher_attempt_summary() where student_id='00000000-0000-0000-0000-0000000000b4' and attempt_count=2 and latest_at=30 and latest_score=4 and best_score=4 and used_thinking$$));
select t.check('H8 usedThinking only counts for the JSON value true ("maybe" ignored)','rows:1', t.run(:T1,false,$$select * from public.teacher_attempt_summary() where student_id='00000000-0000-0000-0000-0000000000b4' and used_thinking$$));
select t.check('H9 empty array row still works (0 attempts)','rows:1', t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',5,'[]')$$));
select t.check('H10 summary with class filter works; unknown class empty','rows:4|rows:0', t.run(:T1,false,format($$select * from public.teacher_attempt_summary(%L)$$, (select id from public.classes where name='P6A')))||'|'||t.run(:T1,false,$$select * from public.teacher_attempt_summary('00000000-0000-0000-0000-00000000cafe')$$));
select t.check('H11 isolation unchanged: other approved teacher sees nothing','rows:0', t.run(:T2,false,'select * from public.teacher_attempt_summary()'));
select t.check('H12 student / anon still cannot use it','rows:0|ERR:42501%', t.run(:S1,true,'select * from public.teacher_attempt_summary()')||'|'||t.run(null,false,'select * from public.teacher_attempt_summary()','anon'));
-- grants after the migration
select t.check('G1 all six private functions: anon cannot EXECUTE','0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('anon',p.oid,'EXECUTE')));
select t.check('G2 no private function keeps a PUBLIC grant','0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) x where n.nspname='private' and x.grantee=0));
select t.check('G3 the five RLS helpers: authenticated can still EXECUTE','5', (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname<>'touch_updated_at' and has_function_privilege('authenticated',p.oid,'EXECUTE')));
select t.check('G4 summary keeps its grants (authenticated yes, anon no, PUBLIC none) and SECURITY DEFINER + search_path','true|false|0|true|true', has_function_privilege('authenticated','public.teacher_attempt_summary(uuid)','EXECUTE')::text||'|'||has_function_privilege('anon','public.teacher_attempt_summary(uuid)','EXECUTE')::text||'|'||(select count(*)::text from pg_proc p, aclexplode(p.proacl) x where p.oid='public.teacher_attempt_summary(uuid)'::regprocedure and x.grantee=0)||'|'||(select prosecdef::text from pg_proc where oid='public.teacher_attempt_summary(uuid)'::regprocedure)||'|'||(select (array_to_string(proconfig,',') like '%search_path=%')::text from pg_proc where oid='public.teacher_attempt_summary(uuid)'::regprocedure));
select id as aid, updated_at as ts0 from public.attempts where student_id=:S1 and q_idx=0 \gset
select t.check('G5a the update goes through as the student','rows:1', t.run(:S1,true,format($$update public.attempts set data=data where id=%L$$, :'aid')));
select t.check('G5b the updated_at trigger still fires after touch_updated_at lost PUBLIC EXECUTE','true', (select (updated_at > :'ts0'::timestamptz)::text from public.attempts where id=:'aid'));
select t.check('G6 RLS still works through the helpers (student sees own rows only, teacher raw read blocked)','rows:2|rows:0', t.run(:S1,true,'select * from public.attempts')||'|'||t.run(:T1,false,'select * from public.attempts'));
\echo
select n, case when ok then 'PASS' else 'FAIL' end r, name, expected, got from t.res order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t.res;
