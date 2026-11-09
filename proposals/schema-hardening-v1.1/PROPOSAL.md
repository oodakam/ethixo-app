# Ethixo schema v1.1 hardening — PROPOSAL ONLY (not applied anywhere)

Status: prepared 9 Nov 2026. Nothing has been run against Supabase. Nothing is merged. The files below are for review.

## What it changes (two things, nothing else)

**(a) `public.teacher_attempt_summary(uuid)` ignores malformed elements.**
Today it casts every element's `at` and `score` to numeric. The database accepts any JSON array in `attempts.data`, so one element such as `{"score":"abc","at":1}` makes the whole class summary fail (SQLSTATE 22P02) for the teacher. The new body only aggregates elements that are JSON objects with a JSON-number `at` and a JSON-number `score`; `usedThinking` counts only when it is the JSON value `true`. Same signature, same return columns, still SECURITY DEFINER with `search_path = ''`. `CREATE OR REPLACE` keeps the existing grants.

**(b) The remaining private helpers stop granting EXECUTE to PUBLIC (and so to anon).**
`private.teaches_class(uuid)`, `private.in_class(uuid)`, `private.teaches_student(uuid)` and the trigger function `private.touch_updated_at()` still have EXECUTE through PUBLIC (the two you already fixed on dev are repeated, as no-ops, so a fresh project ends in the same state). `authenticated` keeps explicit EXECUTE on the five helpers that RLS and the RPCs use. `touch_updated_at()` needs no grant: Postgres checks EXECUTE on a trigger function only when the trigger is created.

No table, column, policy, trigger or data changes. The migration is idempotent.

## Evidence (real PostgreSQL 16, throw-away local database, fake data)

- 19/19 new checks pass (`Ethixo-Schema-v1.1-Hardening-LocalTests.sql`): malformed elements of every kind no longer break the summary; a healthy student's numbers are unchanged; an all-garbage row shows 0 attempts; a mixed row counts only its valid elements; isolation (other teacher, student, anon) unchanged; the `updated_at` trigger still fires; RLS still works through the helpers; all six private functions refuse anon with no PUBLIC grant.
- The existing 92-check schema security suite still passes 92/92 on the hardened schema.
- The 69-check Phase 3 database suite differs in exactly the intended places: K2 (the documented failure) now returns the 3 rows instead of 22P02; G1/G2 only describe the pre-fix state.
- Running the migration twice succeeds. The rollback script applies cleanly.
- `verify.sql` fingerprints (policies, table grants, column grants, other function grants, triggers) are identical before and after.

## How it would be applied (only after your explicit approval)

1. Run `Ethixo-Schema-v1.1-Hardening-Verify-ReadOnly.sql`, queries V1, V2, V3, one at a time, and keep the output.
2. Run `Ethixo-Schema-v1.1-Hardening-Migration.sql` on `ethixo-sg-dev` only.
3. Run the verify queries again. Expected: all six private functions `anon_can_execute = false`; the five helpers `authenticated_can_execute = true`; `touch_updated_at` false for both (correct); V2 `skips_malformed_elements = true`; V3 values identical to step 1.
4. Re-run Preflight Query A: expect no FAIL.

Rollback: `Ethixo-Schema-v1.1-Hardening-Rollback.sql` restores the previous function body; its last statement (commented out) would re-open the four helpers to PUBLIC if ever needed.

## Risks

- Revoking PUBLIC EXECUTE on the helpers could break a policy if `authenticated` lacked its own grant. It has one (schema line 137) and the local suites prove RLS still works.
- The service role may lose a passive EXECUTE it had through PUBLIC. It bypasses RLS and never calls these helpers.
- The summary now silently skips bad elements instead of failing; a student's bad row is therefore invisible to the teacher rather than loud. The client validator already prevents the app from writing such rows. A database-level check on element shape is a possible later step and is deliberately not part of this proposal.
- The schema file `ethixo-schema-v1.sql` is not edited here; a v1.1 file would be a separate, approved change so a rebuilt project gets the same state.
