# Ethixo pilot gate checklist (D2 / D3 / D4 / D5)
A working checklist, not legal advice. Real student data is NOT used until every box is ticked.

**Pilot scope (D5):** 1 Singapore teacher · at most 10 students · about 1–2 weeks · no account recovery.

## A. Before anyone participates
- [ ] Parent/guardian consent obtained in writing or electronically for each participating student (D2). Kept by Elelet Digital / the teacher, not in the app.
- [ ] Consent text says, in plain words: what is uploaded (scores, times, whether thinking help was used) and that written answers are NOT uploaded (D3).
- [ ] Consent text says clearly: **if the browser data is cleared or the device is lost, earlier progress may be lost. There is no account recovery in this pilot** (D5).
- [ ] Consent text says who to contact to stop participating and have the child's cloud data deleted (D4), and how fast.
- [ ] Teacher has agreed to the same terms and knows which 10 students are in.
- [ ] Reviewed with your own privacy/legal adviser for PDPA fit (Elelet Digital's responsibility; this sheet does not replace it).

## B. Technical gates (each needs your explicit approval before it happens)
- [ ] Schema v1.1 hardening proposal reviewed, then applied to the dev project (proposal only today).
- [ ] D4 `delete_my_data()` / `private.erase_student_data()` reviewed and applied (proposal only today; tested only in local Postgres).
- [ ] Phase 4a merged to a pilot branch and deployed to ONE allow-listed pilot host only. `DB_BACKFILL` stays false until the teacher/students have consent; it is set true only when you decide old local progress should be uploaded.
- [ ] Production/`main` stays off (sync flags off, allow-list empty).
- [ ] Dev publishable key / `p3-live-test` activation branch and test data cleaned up before real data is used.

## C. During the pilot
- [ ] Only the pilot host has sync enabled. Kill switch known: `localStorage["ethixoSyncKill"]="1"` on a device stops sync.
- [ ] Deletion requests are handled by the operator with `private.erase_student_data('<student uuid>')` in the SQL editor (no in-app button), after you approve each one.

## D. After the pilot
- [ ] Decide: erase all pilot student data, or keep it with consent. Erase = run the operator function per student; teachers and classes are not touched.
