# Ethixo Pilot — Consent and Disclosure Pack (DRAFT v0.3, for final approval)

**Status:** Draft. This is not legal advice and makes no claim of legal or PDPA compliance. Elelet's own privacy/PDPA adviser must review it before any real student takes part. **No real student participates until that review is done and the consent form is signed.**

**Pilot facts:** about 1–2 weeks · 1 teacher · maximum 10 students · **Primary 6 only** · run by `[ELELET LEGAL ENTITY — REQUIRED INPUT]`.

**Required inputs (unresolved):**
- `[ELELET LEGAL ENTITY — REQUIRED INPUT]`
- `[ELELET CONTACT EMAIL — REQUIRED INPUT]`
- `[ELELET REGISTERED ADDRESS / UEN — REQUIRED INPUT]` (only if the adviser wants it shown)
- `[PILOT START DATE — REQUIRED INPUT]`
- `[PILOT END DATE — REQUIRED INPUT]`
- `[TEACHER NAME / SCHOOL — REQUIRED INPUT]`
- `[LOG RETENTION — REQUIRED INPUT]` (Supabase and Vercel)
- `[AFTER-PILOT DATA DECISION — REQUIRED INPUT]`
- `[ANTHROPIC AI-FEEDBACK DATA HANDLING — REQUIRED INPUT]`
- `[OPERATOR ACCESS LIST — REQUIRED INPUT]` (optional)
- `[PRIVACY ADVISER REVIEW DATE — REQUIRED INPUT]`

---

## A. Parent/Guardian Consent Form

**Ethixo pilot — parent/guardian consent**

Ethixo is a practice app with English, Science and Social Science lessons for Primary 5–6 students. This pilot is open to **Primary 6 students only**. Lesson content in this pilot build is sample material. `[ELELET LEGAL ENTITY]` is running a small pilot of about 1–2 weeks with one teacher and at most 10 students, from `[PILOT START DATE]` to `[PILOT END DATE]`. Taking part is optional.

**1. What is stored in the pilot cloud database (Supabase, Singapore region)**

| Data | Details |
|---|---|
| Anonymous student identity | A random ID created when your child first opens the pilot app. No email, phone number or password. |
| Student profile | Level (P6) and a display name. The display name is whatever your child or you type, up to 40 characters. It is "Student" until changed. **Please use a first name or nickname, not a full legal name.** |
| Class membership | Which pilot class your child joined with the class code, and when. |
| Practice results | Per question: the score, whether thinking help was used, and the time. Also the lesson and question identifiers the system needs to file each result. |

**2. Earlier practice on the same device**
The pilot app is set to upload earlier practice **scores** that already exist on the device, once, when your child first signs in on that device. Only the "Practice results" fields above are uploaded, and nothing else from earlier practice.

**3. What is not stored in the pilot database**
Your child's written answers, the feedback shown (strengths and next steps), ScholarVault content and the app's other saved progress and settings are **not uploaded to the pilot database.** They stay in your child's browser on their device.

**4. AI feedback: written answers do leave the device**
To produce feedback, the app sends your child's written answer, the thinking-help conversation and earlier attempts at that question from the device, through Elelet's feedback function on Vercel, to the **Anthropic API** (an AI service). This happens each time feedback is requested. In the app's code, this function does not save or log the answer text, and none of it is stored in the pilot Supabase database. How Anthropic and Vercel handle this data is: `[ANTHROPIC AI-FEEDBACK DATA HANDLING — REQUIRED INPUT]`.

**5. Who can see what**
- **The pilot teacher** sees, for their own class only: student display name, level, subject and lesson, number of questions attempted, number of attempts, latest score, best score, whether thinking help was used, and last activity time. Behind the page, the same summary also carries the student's internal anonymous ID and the question number to the teacher's browser, but the page does not display them. The teacher cannot see written answers, feedback or ScholarVault content.
- **The pilot operator at Elelet** has administrative access to the pilot database, so it can technically view every item in section 1. It uses this access only to run and support the pilot and to carry out deletion requests. `[OPERATOR ACCESS LIST — REQUIRED INPUT]`
- **Service providers:** Supabase (database and sign-in, Singapore region), Vercel (delivers the app pages and runs the feedback function), and Anthropic (AI feedback, section 4). Providers keep technical logs under their own settings: `[LOG RETENTION — REQUIRED INPUT]`.
- **Your child's device:** the on-device data in section 3 is visible to anyone using that device.

**6. No account recovery; data may be lost**
- There is **no account recovery** in this pilot. If browser data is cleared, a private window is closed, or the device is lost or replaced, your child's earlier progress may be lost and may not be restorable.
- The cloud database plan used for the pilot has **no backups or point-in-time recovery**, so cloud data could also be lost if a fault occurs.
- The pilot may be unavailable at times. For example, the database project can pause after about 7 days without activity until it is resumed. There is **no guarantee of uninterrupted availability or permanent data preservation.**

**7. Deleting your child's data / withdrawing**
Tell the pilot teacher, who forwards the request to the pilot operator at Elelet, or write to `[ELELET CONTACT EMAIL]`. Elelet will delete your child's pilot database data **within 7 days** of receiving the request, and will confirm through the teacher or by email once done. Deletion removes your child's anonymous account, profile, class membership and stored practice results. It does not remove data on your child's own device. You can clear that by clearing the browser's site data for the pilot address. Please also stop using the pilot link: if your child keeps using it, the app may create a new anonymous identity and begin syncing again. Deletion does not cover provider technical logs or AI-feedback data held by providers (see sections 4 and 5).

**8. How long data is kept**
For the pilot duration. After the pilot: `[AFTER-PILOT DATA DECISION — REQUIRED INPUT]`.

**9. Consent**
- ☐ I am the parent/guardian of the student named below and have read this form.
- ☐ I consent to my child taking part in the pilot and to the data in sections 1–2 being stored, and to the AI-feedback processing in section 4.
- ☐ I understand section 6 (no recovery, possible data loss, no availability guarantee).
- ☐ I understand I can withdraw and request deletion at any time (section 7).

Student first name or nickname (as it will appear in the app): ______________ Level: **P6**
Parent/guardian name: ______________ Signature: ______________ Date: __________

*Kept by `[ELELET LEGAL ENTITY]` / the teacher, not inside the app.*

---

## B. Student-Facing Short Disclosure
*For the teacher to read out or display before students start.*

**About this practice app (pilot, Primary 6)**
- This is a short trial, about 1–2 weeks.
- Use your **first name or a nickname**, not your full name.
- Your teacher can see your **scores, how often you practised, and whether you used thinking help.** They cannot see what you wrote.
- When you ask for feedback, **what you write is sent to an AI service** to give you feedback. It is not saved in the pilot's database.
- What you write, the feedback, and your ScholarVault stay **on your own device.**
- If you clear your browser or lose the device, your **progress can disappear.** We cannot get it back.
- You or your parents can ask your teacher at any time to **stop and delete** your data in the pilot database.
- You can stop whenever you want.

---

## C. Teacher / School Briefing and Acknowledgement

**Your role:** the single pilot teacher for up to 10 Primary 6 students, `[TEACHER NAME / SCHOOL]`.

**What is stored about you:** your email address (used for sign-in), your display name, and whether Elelet has approved your account.

**What you can see:** for your own class only, the class code and the summary fields listed in section A.5. Students who have joined but have no attempts yet do not appear in the summary table. You cannot see written answers, feedback, ScholarVault content or on-device progress.

**What students' written answers do:** they are sent through the Vercel feedback function to the Anthropic API for AI feedback, and are not stored in the pilot database (section A.4). Handling by Anthropic and Vercel: `[ANTHROPIC AI-FEEDBACK DATA HANDLING — REQUIRED INPUT]`.

**Your responsibilities:**
1. Only invite students whose parent/guardian has returned the signed consent form. Keep the forms, or confirm where Elelet keeps them.
2. Tell students to use a first name or nickname. Do not enter a full legal name for them.
3. Read out the student disclosure (section B) before first use.
4. Pass any deletion, withdrawal or privacy request to the pilot operator at Elelet promptly, and tell the family it will be handled within 7 days.
5. Tell families that browser data loss and device loss can erase earlier progress, and that there is no account recovery.
6. Do not share the class code outside the consented group.

**Acknowledgement:**
- ☐ I have read and understood this briefing and the data-loss disclosure (section D).
- ☐ I will only enrol students with signed parent/guardian consent.
- ☐ I understand this pilot has no uptime or data-preservation guarantee.

Name: ______________ Signature: ______________ Date: __________

---

## D. Data-Loss and Service-Availability Disclosure
*A one-page notice for the teacher and parents.*

| Where the data is | What could go wrong | Recoverable? |
|---|---|---|
| **Student's device (browser storage):** written answers, feedback, ScholarVault, app progress, local copy of scores | Clearing browser data, private/incognito windows, changing or reinstalling the browser, a lost or replaced device | **No.** Nothing on the device is backed up. There is no account recovery. |
| **Pilot database (Supabase, Singapore):** anonymous identity, profile, class membership, minimal practice results | Service fault or data loss. The pilot plan has **no backups or point-in-time recovery.** | **No.** There is no backup to restore. |
| **Pilot database, after a deletion request** | Data is deleted within 7 days of the request | Not recoverable after deletion. |
| **AI feedback (Vercel function → Anthropic)** | Written answers are sent for feedback. They are not stored in the pilot database. | Handling: `[ANTHROPIC AI-FEEDBACK DATA HANDLING — REQUIRED INPUT]`. Logs: `[LOG RETENTION — REQUIRED INPUT]`. |
| **Service availability** | The app, sign-in, AI feedback or teacher view may be unavailable, slow or changed without notice. The database project can pause after about 7 days without activity until it is resumed. | The pilot is a trial. There is no uptime guarantee. |

Because the pilot database holds only minimal results, losing it costs scores and timestamps only. A child who loses their device also loses their own written work, which cannot be restored.

The pilot runs for about 1–2 weeks, with 1 teacher and a maximum of 10 Primary 6 students.

---

## E. Operator Deletion Procedure
*Internal. Only the pilot operator at Elelet runs this.*

**Trigger:** a parent, guardian or student request, made through the teacher or to `[ELELET CONTACT EMAIL]`. **Deadline: completed within 7 days of receipt.** Log the received date.

1. **Record the request.** Note the date received, the student's display name and class, and who asked. The teacher confirms the request comes from the parent/guardian.
2. **Identify the student ID (read-only).** In the pilot SQL editor, look up the student by display name within the class (profiles joined to `class_members`). If more than one student matches, the teacher confirms which one. Never guess.
3. **Get explicit approval** from the pilot operator for each deletion, as required for any live-data change.
4. **Preview (read-only).** Count the rows for that ID in `attempts`, `class_members`, `profiles`, `vault_entries` and `student_state`, and confirm the role is `student`.
5. **Erase.** Run `select private.erase_student_data('<student uuid>');` The function refuses teacher IDs and unknown IDs. It deletes the `auth.users` row, which cascades to the profile, class membership and stored attempts. It returns the row counts it removed.
6. **Verify (read-only).** Confirm 0 rows for that ID in `auth.users`, `profiles`, `class_members`, `attempts`, `vault_entries` and `student_state`, and confirm the teacher and class are untouched.
7. **Confirm back** to the teacher/family within the 7-day window. Say what was deleted. Also say that data on the child's own device is unaffected, that provider logs and AI-feedback data are outside this deletion (`[LOG RETENTION — REQUIRED INPUT]`, `[ANTHROPIC AI-FEEDBACK DATA HANDLING — REQUIRED INPUT]`), and that the family should clear the site data and stop using the pilot link so the app does not create a new anonymous identity and begin syncing again.
8. **Log it.** Record the date completed and the counts. Keep the log minimal, with no answer content.

**Do not:** delete teachers or classes, touch `main`/Production, or run bulk deletion without separate approval.
**End of pilot:** `[AFTER-PILOT DATA DECISION — REQUIRED INPUT]`. If the decision is to delete all pilot students, run step 5 per student, with approval.
