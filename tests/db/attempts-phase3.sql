-- Phase 3 Attempts Sync: database-side checks in REAL Postgres (RLS, grants, constraints, trigger, teacher summary).
-- Uses the exact statement SHAPES the browser sender produces (see index.html ETHIXO-ATTEMPTS block):
--   SELECT id,data ... WHERE level/subject_key/lesson_id/q_idx ; INSERT without student_id ; UPDATE data WHERE id RETURNING id.
-- Fake data only. Runs in a throw-away local database, never against Supabase.
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

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','t1@x.sg'),('00000000-0000-0000-0000-0000000000a2','t2@x.sg'),('00000000-0000-0000-0000-0000000000a3','t3@x.sg'),
 ('00000000-0000-0000-0000-0000000000b1',null),('00000000-0000-0000-0000-0000000000b2',null),('00000000-0000-0000-0000-0000000000b3',null),
 ('00000000-0000-0000-0000-0000000000b4',null),('00000000-0000-0000-0000-0000000000b9',null);   -- b9 never gets a profile
\set T1 '''00000000-0000-0000-0000-0000000000a1'''
\set T2 '''00000000-0000-0000-0000-0000000000a2'''
\set T3 '''00000000-0000-0000-0000-0000000000a3'''
\set S1 '''00000000-0000-0000-0000-0000000000b1'''
\set S2 '''00000000-0000-0000-0000-0000000000b2'''
\set S3 '''00000000-0000-0000-0000-0000000000b3'''
\set S4 '''00000000-0000-0000-0000-0000000000b4'''
\set S9 '''00000000-0000-0000-0000-0000000000b9'''

-- ===== G. private helper grants: root cause of live Preflight check 84, then the approved correction =====
select t.check('G1 BEFORE fix: anon can EXECUTE private.is_student() (via PUBLIC) - reproduces the live finding','true', has_function_privilege('anon','private.is_student()','execute')::text);
select t.check('G2 BEFORE fix: the grant comes from PUBLIC, not from anon directly','1', (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) x where p.oid='private.is_student()'::regprocedure and x.grantee=0 and x.privilege_type='EXECUTE'));
\i schema-fix-private-helper-grants.sql
select t.check('G3 AFTER fix: anon cannot EXECUTE is_student / is_approved_teacher','false', (has_function_privilege('anon','private.is_student()','execute') or has_function_privilege('anon','private.is_approved_teacher()','execute'))::text);
select t.check('G4 AFTER fix: authenticated still can EXECUTE both (RLS depends on it)','true', (has_function_privilege('authenticated','private.is_student()','execute') and has_function_privilege('authenticated','private.is_approved_teacher()','execute'))::text);
select t.check('G5 AFTER fix: function bodies unchanged and still SECURITY DEFINER','2', (select count(*)::text from pg_proc where oid in ('private.is_student()'::regprocedure,'private.is_approved_teacher()'::regprocedure) and prosecdef));

-- ===== setup: profiles, one class =====
select t.check('P1 teacher T1','rows:1', t.run(:T1,false,$$select public.create_my_profile('teacher','Mr Tan')$$));
select t.check('P2 teacher T2','rows:1', t.run(:T2,false,$$select public.create_my_profile('teacher','Ms Lim')$$));
select t.check('P3 teacher T3 (stays unapproved)','rows:1', t.run(:T3,false,$$select public.create_my_profile('teacher','Mr Fake')$$));
select t.check('P4 students S1..S4','rows:4', (select 'rows:'||count(*) from (
  select t.run(:S1,true,$$select public.create_my_profile('student','Student','P6')$$) r union all
  select t.run(:S2,true,$$select public.create_my_profile('student','Student','P6')$$) union all
  select t.run(:S3,true,$$select public.create_my_profile('student','Student','P6')$$) union all
  select t.run(:S4,true,$$select public.create_my_profile('student','Student','P6')$$)) z where r='rows:1'));
update public.profiles set is_approved = true where id in (:T1,:T2);
select t.check('C1 T1 creates a class','rows:1', t.run(:T1,false,$$insert into public.classes(name) values ('P6A')$$));
select join_code as code1, id as cls1 from public.classes where name='P6A' \gset
select t.check('C2 S1 joins','rows:1', t.run(:S1,true,format($$select * from public.join_class(%L)$$, :'code1')));
select t.check('C3 S4 joins','rows:1', t.run(:S4,true,format($$select * from public.join_class(%L)$$, :'code1')));

-- ===== Case 1/2: the exact sender shapes (insert, then update by id) =====
select t.check('I1 select-before-insert (4 filters) finds nothing','rows:0', t.run(:S1,true,$$select id,data from public.attempts where level='P6' and subject_key='EN' and lesson_id='1.1' and q_idx=0$$));
select t.check('I2 INSERT WITHOUT student_id succeeds (default auth.uid())','rows:1', t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[{"score":1,"at":1000,"usedThinking":false}]')$$));
select t.check('I3 the row is owned by S1 (taken from the token, not the client)','true', (select (student_id = :S1)::text from public.attempts where lesson_id='1.1' and subject_key='EN'));
select id as aid, updated_at as ts0 from public.attempts where lesson_id='1.1' and subject_key='EN' \gset
select t.check('I4 select-before-update now finds exactly the one row','rows:1', t.run(:S1,true,$$select id,data from public.attempts where level='P6' and subject_key='EN' and lesson_id='1.1' and q_idx=0$$));
select t.check('I5 UPDATE { data } by id (RETURNING id) -> exactly 1 row','rows:1', t.run(:S1,true,format($$update public.attempts set data='[{"score":1,"at":1000,"usedThinking":false},{"score":3,"at":2000,"usedThinking":true},{"score":2,"at":3000}]'::jsonb where id=%L returning id$$, :'aid')));
select t.check('I6 trigger attempts_touch moved updated_at forward (server time)','true', (select (updated_at > :'ts0'::timestamptz)::text from public.attempts where id = :'aid'));
select t.check('I7 id unchanged, still one row for the key, history has 3 attempts','1|3', (select count(*)||'|'||max(jsonb_array_length(data)) from public.attempts where lesson_id='1.1' and subject_key='EN'));
select t.check('I8 duplicate INSERT of the same key -> 23505 (the sender then re-reads and updates)','ERR:23505%', t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[{"score":9,"at":9}]')$$));
select t.check('I9 UPDATE matching no row returns 0 rows (the sender counts that as a failure)','rows:0', t.run(:S1,true,$$update public.attempts set data='[]' where id='00000000-0000-0000-0000-00000000dead' returning id$$));
select t.check('I10 a second question gets its own row','rows:1', t.run(:S1,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',1,'[{"score":2,"at":4000}]')$$));

-- ===== Case 3: identity ownership =====
select t.check('O1 S2 cannot SEE S1''s row with the same 4 filters','rows:0', t.run(:S2,true,$$select id,data from public.attempts where level='P6' and subject_key='EN' and lesson_id='1.1' and q_idx=0$$));
select t.check('O2 S2 UPDATE of S1''s row id -> 0 rows (RLS hides it)','rows:0', t.run(:S2,true,format($$update public.attempts set data='[]' where id=%L returning id$$, :'aid')));
select t.check('O3 S2 INSERT claiming student_id = S1 -> denied','ERR:42501%', t.run(:S2,true,format($$insert into public.attempts(student_id,level,subject_key,lesson_id,q_idx,data) values (%L,'P6','EN','1.1',5,'[]')$$, '00000000-0000-0000-0000-0000000000b1')));
select t.check('O4 S2 can insert the SAME key for itself (uniqueness is per student)','rows:1', t.run(:S2,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[{"score":1,"at":1500}]')$$));
select t.check('O5 that row is owned by S2','true', (select (student_id = :S2)::text from public.attempts where student_id = :S2 and lesson_id='1.1'));
select t.check('O6 S1 sees only its 2 rows, S2 only its 1','rows:2|rows:1', t.run(:S1,true,'select * from public.attempts')||'|'||t.run(:S2,true,'select * from public.attempts'));
select t.check('O7 S1 cannot re-assign student_id (column grant)','ERR:42501%', t.run(:S1,true,format($$update public.attempts set student_id=%L where id=%L$$, '00000000-0000-0000-0000-0000000000b2', :'aid')));
select t.check('O7b column grants: authenticated can UPDATE data but NOT student_id / id / updated_at (independent of RLS)','true|false|false|false', has_column_privilege('authenticated','public.attempts','data','UPDATE')::text||'|'||has_column_privilege('authenticated','public.attempts','student_id','UPDATE')::text||'|'||has_column_privilege('authenticated','public.attempts','id','UPDATE')::text||'|'||has_column_privilege('authenticated','public.attempts','updated_at','UPDATE')::text);
select t.check('O8 S1 cannot update id / updated_at directly','ERR:42501%', t.run(:S1,true,format($$update public.attempts set updated_at=now() where id=%L$$, :'aid')));
select t.check('O9 S1 cannot DELETE','ERR:42501%', t.run(:S1,true,'delete from public.attempts'));
select t.check('O10 logged-out (anon) role: select denied','ERR:42501%', t.run(null,false,'select * from public.attempts','anon'));
select t.check('O11 logged-out (anon) role: insert denied','ERR:42501%', t.run(null,false,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[]')$$,'anon'));
select t.check('O12 teacher cannot read raw attempts','rows:0', t.run(:T1,false,'select * from public.attempts'));
select t.check('O13 teacher cannot write attempts','ERR:42501%', t.run(:T1,false,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[]')$$));
select t.check('O14 authenticated user with NO profile cannot insert','ERR:42501%', t.run(:S9,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[]')$$));
select t.check('O15 token without a subject cannot insert','ERR:%', t.run(null,false,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[]')$$));

-- ===== Case 7: malformed data is rejected by the database as well (defence in depth behind the client validator) =====
select t.check('M1 data = object','ERR:23514%', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','m',0,'{}')$$));
select t.check('M2 data = string','ERR:23514%', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','m',0,'"x"')$$));
select t.check('M3 data = null','ERR:23502%', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','m',0,null)$$));
select t.check('M4 oversize data','ERR:23514%', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','m',0,to_jsonb(array_fill('x'::text, array[40000])))$$));
select t.check('M5 q_idx = 1000','ERR:23514%', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','m',1000,'[]')$$));
select t.check('M6 q_idx = -1','ERR:23514%', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','m',-1,'[]')$$));
select t.check('M7 empty level','ERR:23514%', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('','EN','m',0,'[]')$$));
select t.check('M8 level 11 chars','ERR:23514%', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('12345678901','EN','m',0,'[]')$$));
select t.check('M9 subject_key 41 chars','ERR:23514%', t.run(:S3,true,format($$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6',%L,'m',0,'[]')$$, repeat('x',41))));
select t.check('M10 lesson_id 41 chars','ERR:23514%', t.run(:S3,true,format($$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN',%L,0,'[]')$$, repeat('x',41))));
select t.check('M11 UPDATE of data to an object','ERR:23514%', t.run(:S1,true,format($$update public.attempts set data='{}' where id=%L$$, :'aid')));
select t.check('M12 boundary values are accepted (q_idx 999, level 10 chars, empty array)','rows:1', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('1234567890','EN','m',999,'[]')$$));
select t.check('M13 NOTE: the database does NOT check element shape (the client validator is the only gate)','rows:1', t.run(:S3,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','m',1,'[1,"a",null]')$$));
select t.check('M14 a rejected write left nothing behind (S3 has exactly the 2 boundary rows)','2', (select count(*)::text from public.attempts where student_id = :S3));

-- ===== Case 9: teacher summary =====
select t.check('S1 T1 summary is exactly the class members that have attempts (S1: 2 questions, S4: 0 -> only S1 rows now)','rows:2', t.run(:T1,false,'select * from public.teacher_attempt_summary()'));
select t.check('S2 S1 question 0: count 3, latest_at 3000, latest_score 2, best_score 3, used_thinking true','rows:1', t.run(:T1,false,$$select * from public.teacher_attempt_summary() where student_id='00000000-0000-0000-0000-0000000000b1' and q_idx=0 and attempt_count=3 and latest_at=3000 and latest_score=2 and best_score=3 and used_thinking$$));
select t.check('S3 S1 question 1: count 1, latest 2, thinking false','rows:1', t.run(:T1,false,$$select * from public.teacher_attempt_summary() where student_id='00000000-0000-0000-0000-0000000000b1' and q_idx=1 and attempt_count=1 and latest_score=2 and not used_thinking$$));
select t.check('S4 a student outside the class (S2, has a row) is invisible','rows:0', t.run(:T1,false,'select * from public.teacher_attempt_summary() where student_id=''00000000-0000-0000-0000-0000000000b2'''));
select t.check('S5 approved teacher with no class sees nothing','rows:0', t.run(:T2,false,'select * from public.teacher_attempt_summary()'));
select t.check('S6 unapproved teacher sees nothing','rows:0', t.run(:T3,false,'select * from public.teacher_attempt_summary()'));
select t.check('S7 a student calling it sees nothing','rows:0', t.run(:S1,true,'select * from public.teacher_attempt_summary()'));
select t.check('S8 logged-out role cannot call it','ERR:42501%', t.run(null,false,'select * from public.teacher_attempt_summary()','anon'));
select t.check('S9 class filter: own class works, random class returns nothing','rows:2|rows:0', t.run(:T1,false,format($$select * from public.teacher_attempt_summary(%L)$$, :'cls1'))||'|'||t.run(:T1,false,$$select * from public.teacher_attempt_summary('00000000-0000-0000-0000-00000000cafe')$$));
select t.check('S10 summary exposes counts/scores only, no answer text column','rows:0', t.run(:T1,false,$$select 1 from information_schema.columns where table_name='teacher_attempt_summary' and column_name ilike '%answer%'$$));
-- a healthy second student, then the documented hardening gap
select t.check('S11 S4 (in class) writes a normal row','rows:1', t.run(:S4,true,$$insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','1.1',0,'[{"score":2,"at":500}]')$$));
select t.check('S12 T1 summary now shows both class students','rows:3', t.run(:T1,false,'select * from public.teacher_attempt_summary()'));
select t.check('K1 KNOWN RISK: S4 can store an element with a non-numeric score (the DB allows it)','rows:1', t.run(:S4,true,$$update public.attempts set data='[{"score":"abc","at":1}]' where student_id='00000000-0000-0000-0000-0000000000b4'$$));
select t.check('K2 KNOWN RISK: that one row makes the WHOLE class summary fail for the teacher (22P02). Flips to PASS-as-fixed only after the schema is hardened','ERR:22P02%', t.run(:T1,false,'select * from public.teacher_attempt_summary()'));
update public.attempts set data='[{"score":2,"at":500}]' where student_id = :S4;
select t.check('K3 after the row is repaired the summary works again','rows:3', t.run(:T1,false,'select * from public.teacher_attempt_summary()'));
select t.check('K4 an element with NO "at"/"score" does not break the summary (nulls)','rows:1', t.run(:S4,true,$$update public.attempts set data='[{"x":1}]' where student_id='00000000-0000-0000-0000-0000000000b4'$$));
select t.check('K5 ... and the summary still returns all rows','rows:3', t.run(:T1,false,'select * from public.teacher_attempt_summary()'));

\echo
select n, case when ok then 'PASS' else 'FAIL' end r, name, expected, got from t.res order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t.res;
