# Ethixo cloud-sync migration — status (updated 2026-11-10)

| Item | State |
|---|---|
| Phase 3 (attempts sync, flags off) | Code + 831 automated checks. Live: Case 1 insert proven on dev; Cases 2–9 covered by automated tests. |
| Phase 4a: minimal data (D3), compare-and-swap (D1), one-time backfill | Done, pushed: branch `phase4a-minimal-sync-backfill` (`3733330`). Flags off; `DB_BACKFILL=false`. |
| Schema hardening v1.1 | **Applied and verified on `ethixo-sg-dev`** (`proposals/schema-hardening-v1.1/LIVE-VERIFICATION.md`). Branch `schema-hardening-v1.1`. |
| D4 `delete_my_data()` / `erase_student_data()` | Proposal + local tests only. NOT applied anywhere. |
| Pilot gate (consent, disclosure, scope 1 teacher / ≤10 students / 1–2 weeks) | Checklist only (`proposals/PILOT-GATE-CHECKLIST.md`). Real student data NOT permitted yet. |
| `main` / Production | Untouched (`d0ebdf0`). No sync enabled in any deployed build. |
| Open cleanup | `p3-live-test` branch, its Vercel deployments, dev test data, dev publishable key in a public repo. |
