# Ethixo pilot database — run-sheet

Target: NEW Supabase project `ethixo-sg-pilot`, org Elelet, region `ap-southeast-1` (Singapore). Never `ethixo-sg-dev`, never Production.
No keys, URLs or passwords are stored in this repo.

## Files
| File | What | Writes? |
|---|---|---|
| `01-DEPLOY-pilot-schema.sql` | schema v1 + private-helper grant fix + v1.1 hardening + D4, byte-for-byte from the validated files, one transaction | Yes (DDL only, no data) |
| `02-VERIFY-fingerprint-readonly.sql` | Security fingerprint (tables/RLS, columns, constraints, indexes, policies, functions, function/table/column grants, triggers, schema ACL) + D4 presence + data counts | No |

## Steps
1. **[Approval]** Create project `ethixo-sg-pilot` (Free plan, expected $0).
2. **[Approval]** Apply `01-DEPLOY-pilot-schema.sql` once.
3. Run `02-VERIFY` on the pilot. Pass = every row equal to the reference below, `d4_present = 2`, data `0/0/0/0/0/0/0`.
4. Auth settings (dashboard, Vijay): enable anonymous sign-ins; CAPTCHA/rate limits per pilot gate.
5. Pilot app config (publishable key + URL) goes into the pilot host's environment only — never into committed source.

## Reference fingerprint — `ethixo-sg-dev`, 2026-11-17 (validated: schema v1 + fix + v1.1 + D4)
| section | n | md5 |
|---|---|---|
| tables_rls | 7 | efe8f3557f846dd3f2f8ae635b99e207 |
| columns | 41 | dceb42fb79b7a56393b3270fe33850ed |
| constraints | 37 | ec7e7afc6d2da650ba3ae41fc6118160 |
| indexes | 13 | e713fbceecf83a20ec79ce560e07ef5b |
| policies | 23 | 40e08d25c2b9c68b6259a43c15bec454 |
| functions | 11 | d64b41e425b77b91fc5caad0bb1e4ace |
| function_grants | 11 | 28cd51ce4d9449acf824d37df06fcda4 |
| table_grants | 8 | 6cf367576bb44377e70a5faf555f4412 |
| column_grants | 74 | 83e7cf20405c6412b6fbe4c6e1fed391 |
| triggers | 3 | 62f35e1d653a70790da90114444700e2 |
| schema_acl | 2 | 49b43e86f5acc817d9ce99e158b40928 |
| d4_present | 2 | — |

## Free-plan caveats (decide before real students)
- Free projects **pause after ~7 days without activity**; a paused project rejects sync until resumed.
- No daily backups / point-in-time recovery on Free. For a 1–2 week pilot with ≤10 students this is acceptable only if the data-loss disclosure (D5) covers it; otherwise upgrade the org to Pro first.
