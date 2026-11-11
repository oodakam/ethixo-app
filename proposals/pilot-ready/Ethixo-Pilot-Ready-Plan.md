# Ethixo — Pilot-Ready Plan (11 Nov 2026)
Pilot scope: 1 Singapore teacher · max 10 students · 1–2 weeks · no account recovery · scores/timestamps only, no raw answers in the cloud.
Nothing below has been executed. Every live or destructive action needs Vijay's explicit go.

## 0. Current state (inspected 11 Nov, nothing re-tested)
| Item | State |
|---|---|
| `main` / Production | `d0ebdf0`, last Production deployment 22 Aug 2026. Untouched. Contains no Supabase URL, no key, sync fully off. |
| `phase4a-minimal-sync-backfill` | `3733330`, pushed. Flags off, `DB_BACKFILL=false`. |
| `schema-hardening-v1.1` | `f6f0f85`, pushed. v1.1 live-verified on `ethixo-sg-dev`. |
| D4 `delete_my_data` / `erase_student_data` | Live-verified on dev (`0,0,0,0,1,1,1`). Repo files are proposals only. |
| `p3-live-test` | `b65a657`. The ONLY commit in the whole repo containing the dev Supabase URL, the dev publishable key and the allow-listed preview host, with sync ON in shadow mode. 2 preview deployments (`e99a47d`, `b65a657`) are still live. |
| Other branches | 7, all flags-off. 11 Preview deployments exist (flags-off builds, harmless). |
| Repo visibility | **Public.** |
| Dev data left | attempts=2, profiles=3, classes=0 (fake). |

**Gap found while preparing the teacher-view design:** the app has no teacher sign-in, no "join class" screen, and no way to create a class. Only anonymous student sign-in exists. See section 4 — the pilot cannot work without a small, deliberate decision here.

## 1. Test leftovers cleanup (dev data)
1. Run `A1-INVENTORY-readonly.sql` (read-only) → expect `attempts=2 profiles=3 classes=0`, 1 teacher + 2 students, all fake.
2. After approval: `A2-CLEANUP-dev-test-data-DRYRUN.sql` — uses the D4 operator function, stops by itself if any class exists, >10 profiles or a real-looking email, and **ends in ROLLBACK**, so the first run only shows the "after" counts (expect 0/0/0 with the current data).
3. Only if the dry run is as expected, I issue a separate COMMIT version for one more explicit approval. Rehearsed locally: dry run leaves data unchanged; the guard blocks when a class exists.

## 2. `p3-live-test` branch and deployments — exact order
1. **Vercel (Vijay)**: Project → Deployments → filter branch `p3-live-test` → delete the 2 deployments. This switches off the only host that is allow-listed to talk to dev. (I cannot reach Vercel from here.)
2. **GitHub (me, after approval)**: delete branch `p3-live-test`; mark its two GitHub deployment records inactive.
3. Do NOT touch `main`, Production deployments, or the other 7 branches.
4. Leave the 9 flags-off preview deployments (optional later tidy-up).
Note: deleting the branch does not erase commit `b65a657` — GitHub keeps commits reachable by SHA, in forks and in caches. So step 3 of section 3 is required, not optional.

## 3. Dev publishable key in public history — plan
- Fact: the key appears only in `b65a657` (checked all 8 branches; `main` is clean). A Supabase publishable key is designed to be in client code, so this is **low severity**; real protection is RLS, column grants, the helper-grant fixes and the allow-list. The realistic risk is someone creating anonymous users or hitting the dev API with it.
- Plan (in order):
  1. Clean up as in sections 1–2.
  2. **Rotate** (Vijay, Supabase dashboard → Project Settings → API Keys): create a new publishable key, then delete/revoke the old one. Dev only. No code change needed (the key only lives in the deleted branch).
  3. Optional hardening: Auth → turn on CAPTCHA / rate limits for anonymous sign-ins before any pilot.
  4. No history rewrite of `main` (it never contained the key).
- **Recommendation (decision for Vijay):** run the pilot on a **fresh Supabase project** (Singapore region), e.g. `ethixo-sg-pilot`, not on `ethixo-sg-dev`. Dev carries test history and a publicly exposed URL/key. I would prepare one consolidated, pre-verified SQL set (schema v1 + grant fix + v1.1 + D4) with the same run-sheet style, so real student data never touches a project with that history.

## 4. Teacher read-only view — design only
**Data source:** `public.teacher_attempt_summary(p_class_id uuid default null)` (hardened). Returns per student/question: `student_id, display_name, class_id, level, subject_key, lesson_id, q_idx, attempt_count, latest_at, latest_score, best_score, used_thinking`. Only an approved teacher sees only their own classes; no answer text exists in the cloud (D3).
**View (one screen, read-only):** class picker → table: student · lesson · questions attempted · latest score · best score · "used thinking help" flag · last activity. Sort/filter by student or lesson. No edit, no delete, no export in the pilot. Empty state: "No attempts yet".
**What the pilot needs that does not exist yet (decide before building):**
| Need | Options | Recommended for a 1-teacher pilot |
|---|---|---|
| Teacher sign-in | email magic-link via Supabase Auth, new small page `teacher.html` (separate from the student app) | Separate page; keeps the student app unchanged |
| Teacher approval | operator sets `is_approved=true` in SQL | Manual, by you, for the 1 teacher |
| Class creation | one SQL insert by operator | Operator-created; no UI |
| Students joining the class | `join_class(code)` RPC exists but the app has no screen | Smallest option: one "Class code" field on the student profile screen, shown only when sync is on for the pilot host. This is the one student-app UI change the pilot needs. |
Everything stays behind the allow-listed pilot host and flags; production stays untouched.

## 5. Pilot consent, disclosure and deletion — checklist
Full list in `PILOT-GATE-CHECKLIST.md`; concise version:
- **Parent/guardian consent** per student, written or electronic, kept by Elelet/teacher (D2). States: what is uploaded (scores, times, thinking-help flag), what is not (written answers), who sees it (the one teacher + Elelet operator), purpose, pilot length.
- **Data-loss disclosure (D5)**: "If browser data is cleared or the device is lost, earlier progress may be lost. No account recovery during the pilot."
- **Deletion procedure**: parent asks the teacher/Elelet → operator runs `private.erase_student_data('<student uuid>')` in the SQL editor after Vijay's approval, and confirms back within an agreed number of days. Students may also use `delete_my_data` only if a button is ever added (none planned). At pilot end: erase all pilot data or keep it only with consent.
- **Operator access**: only Vijay holds Supabase dashboard access during the pilot; a short access log.
- **Privacy review** of the consent text and PDPA fit by Elelet's own adviser. This is not legal advice.
- **Go/no-go gate**: consent forms collected ✔ · disclosure shown ✔ · D4 live ✔ (done on dev; repeat on pilot project) · cleanup + key rotation ✔ · pilot project verified ✔ · teacher approved ✔.

## 6. Admin panel — notes only (Phase B, after the pilot; do not build now)
Hierarchy: Centre/Organisation → Centre Admin → Teacher → Classes → Students. Architecture considerations to keep open now:
- Add an `organisations` (centre) table and `org_id` on profiles/classes later; avoid assuming "one teacher = one tenant" in new SQL.
- Roles beyond student/teacher (`centre_admin`) need their own `is_approved`-style gate and RLS helpers in `private`; never trust a client-sent role.
- Teacher provisioning by invitation (admin creates → teacher accepts), not self-service.
- Keep deletion/erasure operator-grade and audited; per-org data boundaries enforced in RLS, not in the UI.
- Today's schema (class → teacher_id composite FK) already supports adding an org layer without rewriting attempts.

## Recommended order from here
1. Vercel: delete the 2 `p3-live-test` deployments (Vijay).
2. I delete the branch (approval) → dry-run cleanup of dev data (approval) → rotate dev key (Vijay).
3. Decide: separate pilot Supabase project (recommended) + the small teacher/class/join UI scope.
4. Consent pack, then build the teacher page and class-code field, then a short pilot rehearsal on the pilot host with fake data.
