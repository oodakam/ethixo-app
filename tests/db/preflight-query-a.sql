-- Ethixo Phase 3 Preflight — QUERY A only (identical to Query A in Ethixo-Phase3-Preflight.sql, lines 14-265).
-- Read-only: a single SELECT. Paste ALL of it into an empty SQL Editor tab, click once so nothing is highlighted, run.
select ord, section, check_name, expected, actual,
       case when ok is null then 'INFO' when ok then 'PASS' else 'FAIL' end as result
from (

  -- 1. TABLE + RLS ---------------------------------------------------------------------
  select 10 as ord, '1 table/RLS' as section, 'public.attempts is a plain table' as check_name,
         '1' as expected,
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'attempts' and c.relkind = 'r') as actual,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'attempts' and c.relkind = 'r') = 1 as ok
  union all
  select 11, '1 table/RLS', 'Row Level Security is enabled', 'true',
         (select relrowsecurity::text from pg_class where oid = 'public.attempts'::regclass),
         (select relrowsecurity from pg_class where oid = 'public.attempts'::regclass)
  union all
  select 12, '1 table/RLS', 'anon / authenticated can NOT bypass RLS (rolbypassrls)', '0 roles',
         (select count(*)::text || ' roles' from pg_roles where rolname in ('anon','authenticated') and rolbypassrls),
         (select count(*) from pg_roles where rolname in ('anon','authenticated') and rolbypassrls) = 0

  -- 2. COLUMNS / DEFAULTS --------------------------------------------------------------
  union all
  select 20, '2 columns', 'column names, types, NOT NULL',
         'id:uuid:nn, student_id:uuid:nn, level:text:nn, subject_key:text:nn, lesson_id:text:nn, q_idx:integer:nn, data:jsonb:nn, updated_at:timestamp with time zone:nn',
         (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ':nn' else '' end, ', ' order by a.attnum)
            from pg_attribute a where a.attrelid = 'public.attempts'::regclass and a.attnum > 0 and not a.attisdropped),
         (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ':nn' else '' end, ', ' order by a.attnum)
            from pg_attribute a where a.attrelid = 'public.attempts'::regclass and a.attnum > 0 and not a.attisdropped)
          = 'id:uuid:nn, student_id:uuid:nn, level:text:nn, subject_key:text:nn, lesson_id:text:nn, q_idx:integer:nn, data:jsonb:nn, updated_at:timestamp with time zone:nn'
  union all
  select 21, '2 columns', 'defaults (student_id defaults to the caller: auth.uid())',
         'id=gen_random_uuid(), student_id=auth.uid(), updated_at=now()',
         (select string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ', ' order by a.attnum)
            from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
           where d.adrelid = 'public.attempts'::regclass),
         (select string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ', ' order by a.attnum)
            from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
           where d.adrelid = 'public.attempts'::regclass)
          = 'id=gen_random_uuid(), student_id=auth.uid(), updated_at=now()'

  -- 3. UNIQUE CONSTRAINT + CHECKS -----------------------------------------------------
  union all
  select 30, '3 constraints', 'exactly one UNIQUE constraint, on the five key columns, in this order',
         'UNIQUE (student_id, level, subject_key, lesson_id, q_idx)',
         (select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'u'),
         (select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'u')
          = 'UNIQUE (student_id, level, subject_key, lesson_id, q_idx)'
  union all
  select 31, '3 constraints', 'number of CHECK constraints (level, subject_key, lesson_id, q_idx, data)', '5',
         (select count(*)::text from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'c'),
         (select count(*) from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'c') = 5
  union all
  select 32, '3 constraints', 'data must be a JSON array', 'present',
         case when exists (select 1 from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'c'
                             and pg_get_constraintdef(oid) like '%jsonb_typeof(data) = ''array''%') then 'present' else 'missing' end,
         exists (select 1 from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%jsonb_typeof(data) = ''array''%')
  union all
  select 33, '3 constraints', 'data size limit 200000 bytes', 'present',
         case when exists (select 1 from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'c'
                             and pg_get_constraintdef(oid) like '%pg_column_size(data) <= 200000%') then 'present' else 'missing' end,
         exists (select 1 from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%pg_column_size(data) <= 200000%')
  union all
  select 34, '3 constraints', 'q_idx limited to 0..999', 'present',
         case when exists (select 1 from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'c'
                             and pg_get_constraintdef(oid) like '%q_idx >= 0%' and pg_get_constraintdef(oid) like '%q_idx <= 999%') then 'present' else 'missing' end,
         exists (select 1 from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%q_idx >= 0%' and pg_get_constraintdef(oid) like '%q_idx <= 999%')

  -- 4. FOREIGN KEYS / DELETION CASCADE FROM auth.users --------------------------------
  union all
  select 40, '4 cascade', 'attempts.student_id -> profiles(id) ON DELETE CASCADE', 'present',
         case when exists (select 1 from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'f'
                             and pg_get_constraintdef(oid) like 'FOREIGN KEY (student_id) REFERENCES %profiles(id) ON DELETE CASCADE%') then 'present' else 'missing' end,
         exists (select 1 from pg_constraint where conrelid = 'public.attempts'::regclass and contype = 'f'
                   and pg_get_constraintdef(oid) like 'FOREIGN KEY (student_id) REFERENCES %profiles(id) ON DELETE CASCADE%')
  union all
  select 41, '4 cascade', 'profiles.id -> auth.users(id) ON DELETE CASCADE', 'present',
         case when exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'f'
                             and pg_get_constraintdef(oid) like '%REFERENCES auth.users(id) ON DELETE CASCADE%') then 'present' else 'missing' end,
         exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'f'
                   and pg_get_constraintdef(oid) like '%REFERENCES auth.users(id) ON DELETE CASCADE%')
  union all
  select 42, '4 cascade', 'no table in schema public references auth.users WITHOUT cascade (would block deleting a test user)', '0',
         (select count(*)::text from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass
             and connamespace = 'public'::regnamespace and confdeltype <> 'c'),
         (select count(*) from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass
             and connamespace = 'public'::regnamespace and confdeltype <> 'c') = 0
  union all
  select 43, '4 cascade', 'class_members -> classes and -> profiles both ON DELETE CASCADE', '2',
         (select count(*)::text from pg_constraint where conrelid = 'public.class_members'::regclass and contype = 'f' and confdeltype = 'c'),
         (select count(*) from pg_constraint where conrelid = 'public.class_members'::regclass and contype = 'f' and confdeltype = 'c') = 2
  union all
  select 44, '4 cascade', 'INFO for cleanup order: FKs onto profiles that do NOT cascade (expected: classes.teacher_id -> delete the fake class BEFORE the fake teacher)',
         'classes (teacher_id)',
         coalesce((select string_agg(conrelid::regclass::text || ' ' || pg_get_constraintdef(oid), ' | ' order by conrelid::regclass::text)
                     from pg_constraint where contype = 'f' and confrelid = 'public.profiles'::regclass and confdeltype <> 'c'), '(none)'),
         null::boolean

  -- 5. TABLE / COLUMN GRANTS ----------------------------------------------------------
  union all
  select 50, '5 grants', 'authenticated: TABLE-level privileges (only SELECT)', 'SELECT',
         (select coalesce(string_agg(p, ', ' order by p), '(none)') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
           where has_table_privilege('authenticated', 'public.attempts', p)),
         (select coalesce(string_agg(p, ', ' order by p), '(none)') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
           where has_table_privilege('authenticated', 'public.attempts', p)) = 'SELECT'
  union all
  select 51, '5 grants', 'authenticated: columns it may INSERT (student_id allowed; id, updated_at NOT)',
         'student_id, level, subject_key, lesson_id, q_idx, data',
         (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
           where a.attrelid = 'public.attempts'::regclass and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('authenticated', 'public.attempts', a.attname, 'INSERT')),
         (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
           where a.attrelid = 'public.attempts'::regclass and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('authenticated', 'public.attempts', a.attname, 'INSERT'))
          = 'student_id, level, subject_key, lesson_id, q_idx, data'
  union all
  select 52, '5 grants', 'authenticated: columns it may UPDATE (student_id, id, updated_at must NOT be here)',
         'level, subject_key, lesson_id, q_idx, data',
         (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
           where a.attrelid = 'public.attempts'::regclass and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('authenticated', 'public.attempts', a.attname, 'UPDATE')),
         (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
           where a.attrelid = 'public.attempts'::regclass and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('authenticated', 'public.attempts', a.attname, 'UPDATE'))
          = 'level, subject_key, lesson_id, q_idx, data'
  union all
  select 53, '5 grants', 'anon: no privilege of any kind on the table or any column', 'false',
         (has_table_privilege('anon', 'public.attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege('anon', 'public.attempts', 'SELECT,INSERT,UPDATE,REFERENCES'))::text,
         not (has_table_privilege('anon', 'public.attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              or has_any_column_privilege('anon', 'public.attempts', 'SELECT,INSERT,UPDATE,REFERENCES'))
  union all
  select 54, '5 grants', 'PUBLIC (everyone) holds no table-level or column-level grant', '0',
         ((select count(*) from pg_class c, aclexplode(c.relacl) x where c.oid = 'public.attempts'::regclass and x.grantee = 0)
        + (select count(*) from pg_attribute at, aclexplode(at.attacl) x where at.attrelid = 'public.attempts'::regclass and at.attacl is not null and x.grantee = 0))::text,
         ((select count(*) from pg_class c, aclexplode(c.relacl) x where c.oid = 'public.attempts'::regclass and x.grantee = 0)
        + (select count(*) from pg_attribute at, aclexplode(at.attacl) x where at.attrelid = 'public.attempts'::regclass and at.attacl is not null and x.grantee = 0)) = 0
  union all
  select 55, '5 grants', 'INFO: every role that holds any table-level grant (expect owner/service roles + authenticated; NOT anon)', 'no anon',
         coalesce((select string_agg(distinct coalesce(r.rolname, 'PUBLIC'), ', ') from pg_class c
                     cross join lateral aclexplode(c.relacl) x left join pg_roles r on r.oid = x.grantee
                    where c.oid = 'public.attempts'::regclass), '(none)'),
         null::boolean

  -- 6. RLS POLICIES -------------------------------------------------------------------
  union all
  select 60, '6 policies', 'exactly these 4 policies exist (no DELETE policy, nothing extra)',
         'attempts_insert_own, attempts_owner_only, attempts_select_own, attempts_update_own',
         (select coalesce(string_agg(policyname, ', ' order by policyname), '(none)') from pg_policies where schemaname = 'public' and tablename = 'attempts'),
         (select coalesce(string_agg(policyname, ', ' order by policyname), '(none)') from pg_policies where schemaname = 'public' and tablename = 'attempts')
          = 'attempts_insert_own, attempts_owner_only, attempts_select_own, attempts_update_own'
  union all
  select 61, '6 policies', 'command / permissive-vs-restrictive / roles of each policy',
         'attempts_insert_own:INSERT:PERMISSIVE:{authenticated}; attempts_owner_only:ALL:RESTRICTIVE:{authenticated}; attempts_select_own:SELECT:PERMISSIVE:{authenticated}; attempts_update_own:UPDATE:PERMISSIVE:{authenticated}',
         (select coalesce(string_agg(policyname || ':' || cmd || ':' || permissive || ':' || roles::text, '; ' order by policyname), '(none)')
            from pg_policies where schemaname = 'public' and tablename = 'attempts'),
         (select coalesce(string_agg(policyname || ':' || cmd || ':' || permissive || ':' || roles::text, '; ' order by policyname), '(none)')
            from pg_policies where schemaname = 'public' and tablename = 'attempts')
          = 'attempts_insert_own:INSERT:PERMISSIVE:{authenticated}; attempts_owner_only:ALL:RESTRICTIVE:{authenticated}; attempts_select_own:SELECT:PERMISSIVE:{authenticated}; attempts_update_own:UPDATE:PERMISSIVE:{authenticated}'
  union all
  select 62, '6 policies', 'every policy is tied to auth.uid() (policies with no auth.uid() in USING / WITH CHECK)', '0',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'attempts'
             and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%auth.uid()%'),
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'attempts'
             and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%auth.uid()%') = 0
  union all
  select 63, '6 policies', 'no policy gives teachers direct access (policies mentioning teacher)', '0',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'attempts'
             and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%teacher%'),
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'attempts'
             and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%teacher%') = 0
  union all
  select 64, '6 policies', 'INSERT and UPDATE policies both have a WITH CHECK (student_id cannot be forged or moved)', 'both',
         (select case when count(*) = 2 then 'both' else count(*)::text || ' of 2' end from pg_policies
           where schemaname = 'public' and tablename = 'attempts' and cmd in ('INSERT','UPDATE') and with_check is not null),
         (select count(*) from pg_policies
           where schemaname = 'public' and tablename = 'attempts' and cmd in ('INSERT','UPDATE') and with_check is not null) = 2

  -- 7. TRIGGER ------------------------------------------------------------------------
  union all
  select 70, '7 trigger', 'only one non-internal trigger on attempts', '1',
         (select count(*)::text from pg_trigger where tgrelid = 'public.attempts'::regclass and not tgisinternal),
         (select count(*) from pg_trigger where tgrelid = 'public.attempts'::regclass and not tgisinternal) = 1
  union all
  select 71, '7 trigger', 'attempts_touch = enabled, BEFORE UPDATE, FOR EACH ROW only, runs private.touch_updated_at()', 'present',
         case when exists (select 1 from pg_trigger t where t.tgrelid = 'public.attempts'::regclass and t.tgname = 'attempts_touch'
                              and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16
                              and (t.tgtype & 4) = 0 and (t.tgtype & 8) = 0 and t.tgfoid = 'private.touch_updated_at()'::regprocedure)
              then 'present' else 'missing/different' end,
         exists (select 1 from pg_trigger t where t.tgrelid = 'public.attempts'::regclass and t.tgname = 'attempts_touch'
                    and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16
                    and (t.tgtype & 4) = 0 and (t.tgtype & 8) = 0 and t.tgfoid = 'private.touch_updated_at()'::regprocedure)
  union all
  select 72, '7 trigger', 'trigger function sets updated_at := now() (server time, not client time)', 'present',
         case when (select prosrc from pg_proc where oid = 'private.touch_updated_at()'::regprocedure) like '%updated_at := now()%' then 'present' else 'missing' end,
         (select prosrc from pg_proc where oid = 'private.touch_updated_at()'::regprocedure) like '%updated_at := now()%'

  -- 8. teacher_attempt_summary + RLS helper functions ---------------------------------
  union all
  select 80, '8 functions', 'public.teacher_attempt_summary(uuid) exists, is SECURITY DEFINER, has a pinned search_path', 'present',
         case when exists (select 1 from pg_proc where oid = to_regprocedure('public.teacher_attempt_summary(uuid)')
                              and prosecdef and proretset and array_to_string(proconfig, ',') like '%search_path=%') then 'present' else 'missing/different' end,
         exists (select 1 from pg_proc where oid = to_regprocedure('public.teacher_attempt_summary(uuid)')
                    and prosecdef and proretset and array_to_string(proconfig, ',') like '%search_path=%')
  union all
  select 81, '8 functions', 'teacher_attempt_summary return columns',
         'TABLE(student_id uuid, display_name text, class_id uuid, level text, subject_key text, lesson_id text, q_idx integer, attempt_count integer, latest_at numeric, latest_score numeric, best_score numeric, used_thinking boolean)',
         pg_get_function_result(to_regprocedure('public.teacher_attempt_summary(uuid)')),
         pg_get_function_result(to_regprocedure('public.teacher_attempt_summary(uuid)'))
          = 'TABLE(student_id uuid, display_name text, class_id uuid, level text, subject_key text, lesson_id text, q_idx integer, attempt_count integer, latest_at numeric, latest_score numeric, best_score numeric, used_thinking boolean)'
  union all
  select 82, '8 functions', 'EXECUTE on teacher_attempt_summary: authenticated yes, anon no, PUBLIC no', 'auth=true anon=false public=0',
         'auth=' || has_function_privilege('authenticated', to_regprocedure('public.teacher_attempt_summary(uuid)'), 'EXECUTE')::text
           || ' anon=' || has_function_privilege('anon', to_regprocedure('public.teacher_attempt_summary(uuid)'), 'EXECUTE')::text
           || ' public=' || (select count(*) from pg_proc p, aclexplode(p.proacl) x
                              where p.oid = to_regprocedure('public.teacher_attempt_summary(uuid)') and x.grantee = 0)::text,
         has_function_privilege('authenticated', to_regprocedure('public.teacher_attempt_summary(uuid)'), 'EXECUTE')
           and not has_function_privilege('anon', to_regprocedure('public.teacher_attempt_summary(uuid)'), 'EXECUTE')
           and (select count(*) from pg_proc p, aclexplode(p.proacl) x
                 where p.oid = to_regprocedure('public.teacher_attempt_summary(uuid)') and x.grantee = 0) = 0
  union all
  select 83, '8 functions', 'summary body restricts to approved teachers and to the caller''s own classes', 'both present',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.teacher_attempt_summary(uuid)')) ilike '%private.is_approved_teacher()%'
               and (select prosrc from pg_proc where oid = to_regprocedure('public.teacher_attempt_summary(uuid)')) ilike '%c.teacher_id = (select auth.uid())%'
              then 'both present' else 'missing' end,
         (select prosrc from pg_proc where oid = to_regprocedure('public.teacher_attempt_summary(uuid)')) ilike '%private.is_approved_teacher()%'
           and (select prosrc from pg_proc where oid = to_regprocedure('public.teacher_attempt_summary(uuid)')) ilike '%c.teacher_id = (select auth.uid())%'
  union all
  select 84, '8 functions', 'RLS helpers private.is_student() / private.is_approved_teacher(): exist, SECURITY DEFINER, pinned search_path, authenticated may EXECUTE, anon may not', '2 of 2',
         (select count(*)::text || ' of 2' from pg_proc p
           where p.oid in (to_regprocedure('private.is_student()'), to_regprocedure('private.is_approved_teacher()'))
             and p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%'
             and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')),
         (select count(*) from pg_proc p
           where p.oid in (to_regprocedure('private.is_student()'), to_regprocedure('private.is_approved_teacher()'))
             and p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%'
             and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')) = 2
  union all
  select 85, '8 functions', 'schema private: authenticated has USAGE, anon does not', 'auth=true anon=false',
         'auth=' || has_schema_privilege('authenticated', 'private', 'USAGE')::text || ' anon=' || has_schema_privilege('anon', 'private', 'USAGE')::text,
         has_schema_privilege('authenticated', 'private', 'USAGE') and not has_schema_privilege('anon', 'private', 'USAGE')
  union all
  select 86, '8 functions', 'INFO known risk: the summary casts each element''s "at"/"score" to numeric with no shape check (one malformed element written by a student breaks the summary for the class)',
         'known / not a test failure',
         case when (select prosrc from pg_proc where oid = to_regprocedure('public.teacher_attempt_summary(uuid)')) like '%(e ->> ''at'')::numeric%'
              then 'unchecked cast present' else 'cast not found (re-read the function)' end,
         null::boolean

) checks
order by ord;
