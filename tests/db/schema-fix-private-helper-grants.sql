-- The exact correction proposed for ethixo-sg-dev (private helper EXECUTE leaked to PUBLIC -> anon).
-- Postgres grants EXECUTE to PUBLIC on every new function; "alter default privileges ... in schema private revoke ..."
-- cannot remove that built-in default, so anon inherited it through PUBLIC.
revoke execute on function private.is_student(), private.is_approved_teacher() from public, anon;
grant  execute on function private.is_student(), private.is_approved_teacher() to authenticated;
