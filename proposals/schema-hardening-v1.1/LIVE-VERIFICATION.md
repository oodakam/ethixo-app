# Schema hardening v1.1 — live deployment record (`ethixo-sg-dev` only)

**Result: COMPLETE and verified on 2026-11-10.** Applied by the project owner in the Supabase SQL Editor; results below are as reported by the owner. No other project, no Production, no `main`.

| Step | Outcome |
|---|---|
| Diagnostic BEFORE | `teacher_attempt_summary`: `has_fix=false` (migration was initially not applied; a first step-5 run failed with `22P02 invalid input syntax for type numeric: "abc"`, the bug being fixed) |
| `2-MIGRATION.sql` | "Success. No rows returned." |
| Diagnostic AFTER | `teacher_attempt_summary`: `has_fix=true`, SECURITY DEFINER; private helper functions: `anon=false`, `public_grants=0` |
| Query A | 36 rows, no FAIL. Row 86 stays INFO ("unchecked cast present"): it only looks for the cast text, which is still in the function body but is now guarded by the `jsonb_typeof` filter. Informational by design, not a failure. |
| Fake-teacher runtime test (step 5) | Row with `attempt_count=2`, `latest_at=3000`, `latest_score=3`, `best_score=3`, `used_thinking=true`. The malformed `"abc"` score, the element with no `score`, the string and the null element are skipped. Ends with ROLLBACK: no test data retained. |

Not separately reported / not claimed: the V3 fingerprint comparison (policies, table/column grants, triggers identical before and after) from `1-CHECK-run-before-and-after.sql`. The migration itself changes none of those objects, and the local rehearsal showed the five V3 rows identical.

Unchanged: tables, RLS policies, function signature and return columns, application code, UI, flags (`DB_BACKFILL=false`, `DB_ATTEMPTS_SYNC=false`, `DB_SYNC_MODE="off"`).
Rollback (not needed): `rollback.sql`.
