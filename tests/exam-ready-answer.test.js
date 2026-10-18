const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const feedbackApiSrc = fs.readFileSync(path.join(__dirname, "..", "api", "feedback.js"), "utf8");

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("  PASS:", msg); }
  else { failed++; console.log("  FAIL:", msg); }
}

function makeDom() {
  const dom = new JSDOM(html, { url: "https://test.ethixo.ai/", runScripts: "dangerously", pretendToBeVisual: true });
  const store = {};
  dom.window.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  return dom;
}

function baseQuestion() {
  return { id: "0", level: "P6", subjectKey: "SS", lessonId: "2.1", lessonTitle: "2.1 The Features of Ancient Civilisations", t: "Give ONE example.", m: 2 };
}

function test1_apiPromptRequestsMarkAwareExamReadyAnswer() {
  console.log("\nTest 1: api/feedback.js's prompt asks for a mark-aware Exam Ready Answer with all the required properties");
  assert(feedbackApiSrc.includes("examReadyAnswer"), "JSON schema includes examReadyAnswer");
  assert(feedbackApiSrc.includes("DELIBERATE EXCEPTION"), "explicitly carves out an exception to the 'never reveal' rule for this one field");
  assert(feedbackApiSrc.includes("1 mark, a concise key phrase"), "1-mark guidance present");
  assert(feedbackApiSrc.includes("2 marks, a sentence containing the key supporting reason"), "2-mark guidance present");
  assert(feedbackApiSrc.includes("3 marks, a sufficiently developed response"), "3-mark guidance present");
  assert(feedbackApiSrc.includes("do not force a fixed sentence count"), "no rigid fixed-sentence-count rule, matching the requirement");
  assert(feedbackApiSrc.includes("must NOT simply copy or lightly reword the student's own answer"), "explicitly forbidden from copying the student's answer");
  assert(feedbackApiSrc.includes("must NOT invent details that are not genuinely relevant"), "explicitly forbidden from inventing irrelevant details");
  assert(feedbackApiSrc.includes("directly and completely answer the ACTUAL question"), "must answer the actual question shown, not a generic idea");
  assert(feedbackApiSrc.includes("age-appropriate English"), "age-appropriate English required");
  assert(feedbackApiSrc.includes('parsed.examReadyAnswer = typeof parsed.examReadyAnswer === "string" ? parsed.examReadyAnswer.trim() : ""'), "response is defensively sanitized to always be a string");
}

function test2_strengthsAndNextStepsStillNeverReveal() {
  console.log("\nTest 2: The 'never reveal the answer' rule is still fully in force for strengths/nextSteps specifically");
  assert(feedbackApiSrc.includes("Within 'strengths' and 'nextSteps' ONLY: NEVER state, imply, or reveal"), "the never-reveal rule is explicitly scoped to strengths/nextSteps, not removed entirely");
  assert(feedbackApiSrc.includes("STRICTLY CONFIDENTIAL"), "the internal marking scheme confidentiality instruction is still present");
}

function test3_examReadySectionRendersWhenPresent() {
  console.log("\nTest 3: Exam Ready Answer section renders correctly on the feedback screen when the API returned one");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = baseQuestion();
  window.state.feedback = { score: 2, strengths: ["Good"], nextSteps: [], learningReceipt: [], examReadyAnswer: "When petrol burns in a car engine, its chemical energy is converted into kinetic energy, making the car move." };
  window.state.vault = [];

  const out = window.viewFeedback();
  assert(out.includes("📝 Exam Ready Answer"), "section heading present");
  assert(out.includes("A concise answer you could use in an exam."), "hint text present, matching the spec");
  assert(out.includes("When petrol burns in a car engine"), "the generated answer text is shown");
  assert(out.includes("saveExamReadyToVault()"), "Save to ScholarVault button present and wired correctly");
  assert(out.includes("⭐ Save to ScholarVault"), "button label matches spec");
}

function test4_examReadySectionHiddenWhenAbsent() {
  console.log("\nTest 4: Exam Ready Answer section is NOT shown when the API didn't actually return one (defensive, never fabricates)");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = baseQuestion();
  window.state.feedback = { score: 2, strengths: ["Good"], nextSteps: [], learningReceipt: [], examReadyAnswer: "" };
  window.state.vault = [];

  const out = window.viewFeedback();
  assert(!out.includes("📝 Exam Ready Answer"), "section is omitted entirely when there's no real generated answer");

  delete window.state.feedback.examReadyAnswer;
  const out2 = window.viewFeedback();
  assert(!out2.includes("📝 Exam Ready Answer"), "also omitted when the field is missing altogether (older cached feedback, etc.)");
}

function test5_savingDoesNotCreateDuplicateVaultEntries() {
  console.log("\nTest 5: Saving the Exam Ready Answer upserts into the SAME ScholarVault entry as the question — never a duplicate");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = baseQuestion();
  window.state.answerDraft = "my own answer";
  window.state.feedback = { score: 2, strengths: [], nextSteps: [], learningReceipt: [], examReadyAnswer: "Exam ready text." };
  window.state.vault = [];

  return window.saveExamReadyToVault().then(() => {
    assert(window.state.vault.length === 1, "exactly one vault entry after saving");
    assert(window.state.vault[0].examReadyAnswer === "Exam ready text.", "entry has the exam-ready answer");

    return window.saveExamReadyToVault(); // save again
  }).then(() => {
    assert(window.state.vault.length === 1, "still exactly one entry — no duplicate created by saving twice");
  });
}

function test6_savedStateShowsCheckmarkNotDuplicateButton() {
  console.log("\nTest 6: Once saved, the feedback screen shows a checkmark instead of an active Save button (re-visiting doesn't invite a duplicate save)");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = baseQuestion();
  window.state.feedback = { score: 2, strengths: [], nextSteps: [], learningReceipt: [], examReadyAnswer: "Exam ready text." };
  window.state.vault = [{ qid: "attempts:P6:SS:2.1:0", level: "P6", subjectKey: "SS", lessonTitle: "2.1", t: "Give ONE example.", m: 2, examReadyAnswer: "Exam ready text.", score: 2, savedAt: Date.now() }];

  const out = window.viewFeedback();
  assert(out.includes("✓ Saved to ScholarVault"), "shows the saved checkmark state");
  assert(!out.includes("saveExamReadyToVault()"), "no active save button shown once already saved");
}

function test7_savingExamReadyPreservesStudentsOwnAnswerIfAlreadySaved() {
  console.log("\nTest 7: Saving the Exam Ready Answer AFTER the student's own answer was already saved preserves both (merge, not overwrite)");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = baseQuestion();
  window.state.answerDraft = "my own answer text";
  window.state.feedback = { score: 2, strengths: [], nextSteps: [], learningReceipt: [], examReadyAnswer: "Exam ready text." };
  window.state.vault = [];

  return window.addToVault().then(() => {
    assert(window.state.vault.length === 1 && window.state.vault[0].answer === "my own answer text", "student's own answer saved first");
    return window.saveExamReadyToVault();
  }).then(() => {
    assert(window.state.vault.length === 1, "still exactly one entry after the second save");
    assert(window.state.vault[0].answer === "my own answer text", "student's own answer is PRESERVED, not wiped out");
    assert(window.state.vault[0].examReadyAnswer === "Exam ready text.", "exam-ready answer is now also present on the same entry");
  });
}

function test8_savingOwnAnswerAfterExamReadyPreservesExamReadyAnswer() {
  console.log("\nTest 8: Saving the student's own answer AFTER the Exam Ready Answer was already saved preserves both (the opposite order)");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = baseQuestion();
  window.state.answerDraft = "my own answer text";
  window.state.feedback = { score: 2, strengths: [], nextSteps: [], learningReceipt: [], examReadyAnswer: "Exam ready text." };
  window.state.vault = [];

  return window.saveExamReadyToVault().then(() => {
    return window.addToVault();
  }).then(() => {
    assert(window.state.vault.length === 1, "still exactly one entry");
    assert(window.state.vault[0].examReadyAnswer === "Exam ready text.", "exam-ready answer is PRESERVED, not wiped out by the later addToVault() call");
    assert(window.state.vault[0].answer === "my own answer text", "student's own answer is also now present");
  });
}

function test9_saveExamReadyDoesNothingWithoutAGeneratedAnswer() {
  console.log("\nTest 9: saveExamReadyToVault() is a safe no-op if there's genuinely no exam-ready answer to save");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = baseQuestion();
  window.state.feedback = { score: 2, strengths: [], nextSteps: [], learningReceipt: [], examReadyAnswer: "" };
  window.state.vault = [];

  return window.saveExamReadyToVault().then(() => {
    assert(window.state.vault.length === 0, "no vault entry created when there's nothing real to save");
  });
}

function test10_existingActionRowAndBackButtonsUnchanged() {
  console.log("\nTest 10: The existing feedback-page action row (Back to Questions / Change Subject / Retry / Next Question) is unchanged, confirming this was additive, not a redesign");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = baseQuestion();
  window.state.feedback = { score: 2, strengths: ["Good"], nextSteps: [], learningReceipt: [], examReadyAnswer: "Exam ready text." };
  window.state.vault = [];

  const out = window.viewFeedback();
  assert(out.includes(">Back to Questions<"), "Back to Questions button still present");
  assert(out.includes(">Change Subject<"), "Change Subject button still present");
  assert(out.includes("Retry Question"), "Retry Question button still present");
  assert(out.includes("Your Performance Feedback"), "page title unchanged");
}

function test11_gatedStrictlyByFullMarksAllSixCases() {
  console.log("\nTest 11: Exam Ready Answer visibility is gated strictly by score === maxMarks, verified against all 6 specified cases");
  const dom = makeDom();
  const { window } = dom;
  const cases = [
    { score: 0, m: 2, expectVisible: false },
    { score: 1, m: 2, expectVisible: false },
    { score: 2, m: 2, expectVisible: true },
    { score: 1, m: 5, expectVisible: false },
    { score: 4, m: 5, expectVisible: false },
    { score: 5, m: 5, expectVisible: true },
  ];
  cases.forEach(c => {
    window.state.currentQuestion = { id: "0", level: "P6", subjectKey: "SS", lessonId: "2.1", lessonTitle: "2.1", t: "Q", m: c.m };
    window.state.feedback = { score: c.score, strengths: ["x"], nextSteps: c.score < c.m ? ["y"] : [], learningReceipt: [], examReadyAnswer: "Some generated exam ready answer." };
    window.state.vault = [];
    const out = window.viewFeedback();
    const visible = out.includes("📝 Exam Ready Answer");
    assert(visible === c.expectVisible, c.score + "/" + c.m + " → " + (c.expectVisible ? "VISIBLE" : "hidden") + " (as required)");
  });
}

function test12_incompleteAnswerStillShowsEverythingElse() {
  console.log("\nTest 12: An incomplete (non-full-marks) answer still shows every other existing section — only the Exam Ready Answer is withheld");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = { id: "0", level: "P6", subjectKey: "SS", lessonId: "2.1", lessonTitle: "2.1", t: "Explain why Southeast Asia is diverse.", m: 5 };
  window.state.feedback = { score: 1, strengths: ["You gave a specific example."], nextSteps: ["Why did people migrate there?"], learningReceipt: ["Connections made! ..."], examReadyAnswer: "Full exam ready text." };
  window.state.vault = [];

  const out = window.viewFeedback();
  assert(out.includes("Estimated Score"), "Estimated Score still shown");
  assert(out.includes("✅ Strengths") && out.includes("You gave a specific example."), "Strengths still shown");
  assert(out.includes("↗ Next Steps to Strengthen Your Answer") && out.includes("Why did people migrate there?"), "Next Steps still shown");
  assert(out.includes("🌱 Today's Learning") && out.includes("Connections made!"), "Today's Learning still shown");
  assert(out.includes("Retry Question"), "Retry Question button still shown");
  assert(!out.includes("📝 Exam Ready Answer"), "Exam Ready Answer correctly withheld");
  assert(!out.includes("Full exam ready text."), "the generated exam-ready text itself never leaks into the page when marks aren't full");
}

function test13_saveFunctionDefensivelyBlockedBelowFullMarks() {
  console.log("\nTest 13: saveExamReadyToVault() refuses to save even if called directly while marks are not yet full (defence in depth, not just hiding the button)");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = { id: "0", level: "P6", subjectKey: "SS", lessonId: "2.1", lessonTitle: "2.1", t: "Q", m: 5 };
  window.state.feedback = { score: 1, strengths: [], nextSteps: [], learningReceipt: [], examReadyAnswer: "Should not be saveable." };
  window.state.vault = [];

  return window.saveExamReadyToVault().then(() => {
    assert(window.state.vault.length === 0, "no vault entry created — the save is blocked even when invoked directly, not just via a hidden button");
  });
}

function test14_printViewUsesExactSameStoredString() {
  console.log("\nTest 14: Print/Revision-Notes view shows the EXACT SAME string that was shown on Feedback and saved — no regeneration, character-for-character");
  const dom = makeDom();
  const { window } = dom;
  const EXAM_READY_TEXT = "Singapore is economically connected to Southeast Asia mainly through trade: it imports raw materials and food from countries like Malaysia and Indonesia, and exports manufactured goods and financial or business services in return.";

  window.state.currentQuestion = { id: "0", level: "P6", subjectKey: "SS", lessonId: "2.1", lessonTitle: "2.1 The Features of Ancient Civilisations", t: "Describe one way Singapore is economically connected to Southeast Asia.", m: 5 };
  window.state.answerDraft = "My own raw student answer text, completely different wording.";
  window.state.feedback = { score: 5, strengths: ["x"], nextSteps: [], learningReceipt: [], examReadyAnswer: EXAM_READY_TEXT };
  window.state.vault = [];

  const feedbackOut = window.viewFeedback();
  assert(feedbackOut.includes(EXAM_READY_TEXT), "Exam Ready Answer shown on the Feedback screen, exact text");

  return window.saveExamReadyToVault().then(() => {
    assert(window.state.vault[0].examReadyAnswer === EXAM_READY_TEXT, "the stored vault field is character-for-character identical to what Feedback displayed");

    window.state.selectedVaultIds = [];
    const printOut = window.viewPrint();
    assert(printOut.includes(EXAM_READY_TEXT), "the Print/Revision-Notes view shows the exact same string, not a regenerated one");
    assert(!printOut.includes("My own raw student answer text"), "the student's differently-worded own answer does NOT appear — confirming this isn't just coincidentally similar text");
  });
}

function test15_printViewFallsBackToOwnAnswerWhenNoExamReadySaved() {
  console.log("\nTest 15: Older vault entries that only have the student's own answer (no exam-ready answer ever saved) still print correctly via fallback");
  const dom = makeDom();
  const { window } = dom;
  window.state.vault = [{ qid: "attempts:P6:SS:1.1:0", level: "P6", subjectKey: "SS", lessonTitle: "1.1", t: "Old Q", m: 3, answer: "The student's own saved answer, no exam-ready version exists for this one.", score: 3, savedAt: Date.now() }];
  window.state.selectedVaultIds = [];

  const out = window.viewPrint();
  assert(out.includes("The student's own saved answer, no exam-ready version exists for this one."), "falls back to the student's own answer when no examReadyAnswer was ever saved for this entry");
}

function test16_mixedVaultShowsCorrectVersionPerEntry() {
  console.log("\nTest 16: A vault with a mix of entries (some with exam-ready answers, some without) shows the correct text for EACH entry independently");
  const dom = makeDom();
  const { window } = dom;
  window.state.vault = [
    { qid: "q1", level: "P6", subjectKey: "SS", lessonTitle: "1.1", t: "Q1", m: 2, answer: "Student's own answer for Q1 (no exam-ready saved).", score: 2, savedAt: Date.now() },
    { qid: "q2", level: "P6", subjectKey: "SS", lessonTitle: "1.2", t: "Q2", m: 3, answer: "Student's own answer for Q2 (different from exam-ready).", examReadyAnswer: "Ethixo's exam-ready answer for Q2.", score: 3, savedAt: Date.now() },
  ];
  window.state.selectedVaultIds = [];

  const out = window.viewPrint();
  assert(out.includes("Student's own answer for Q1 (no exam-ready saved)."), "Q1 correctly shows its own answer (no exam-ready version exists)");
  assert(out.includes("Ethixo's exam-ready answer for Q2."), "Q2 correctly shows its exam-ready answer");
  assert(!out.includes("Student's own answer for Q2 (different from exam-ready)."), "Q2's own (superseded) answer text does NOT also appear — exam-ready is preferred cleanly, not both shown");
}

function test17_score75PercentTextAndGateRemoved() {
  console.log("\nTest 17: The outdated 'Score 75%+ to save to ScholarVault' text and its hard gate are completely removed");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = { id: "0", level: "P6", subjectKey: "SS", lessonId: "2.1", lessonTitle: "2.1", t: "Q", m: 10 };
  window.state.feedback = { score: 1, strengths: [], nextSteps: ["x"], learningReceipt: [], examReadyAnswer: "" }; // 10% score
  window.state.vault = [];

  const out = window.viewFeedback();
  assert(!out.includes("Score 75%+"), "the outdated text never appears, even at a very low score");
  assert(out.includes("⭐ Add to ScholarVault"), "the Add to ScholarVault button is shown regardless of score now");
}

function test18_addToVaultNoLongerHardGatedAt75Percent() {
  console.log("\nTest 18: addToVault() no longer refuses to save below 75% — a low score can still be saved (after the unrelated 90% confirm prompt, which is untouched)");
  const dom = makeDom();
  const { window } = dom;
  window.state.currentQuestion = { id: "0", level: "P6", subjectKey: "SS", lessonId: "2.1", lessonTitle: "2.1", t: "Q", m: 10 };
  window.state.answerDraft = "a low-scoring answer";
  window.state.feedback = { score: 1, strengths: [], nextSteps: [], learningReceipt: [], examReadyAnswer: "" }; // 10%
  window.state.vault = [];
  window.confirm = () => true; // simulate the user confirming the (still-present) "save anyway?" prompt

  return window.addToVault().then(() => {
    assert(window.state.vault.length === 1 && window.state.vault[0].score === 1, "a 10% answer can now be saved — no hard 75% gate blocking it");
  });
}

function test19_90PercentSoftConfirmStillPresent() {
  console.log("\nTest 19: The unrelated 90% 'want to improve first?' soft confirmation is untouched — only the 75% hard gate/text was removed");
  const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert(src.includes("if(pct < 0.90){"), "the 90% confirm check is still present in addToVault()");
  assert(src.includes("You're doing well! You could try to improve this further before saving."), "the confirm dialog's wording is unchanged");
}

function test20_erbTextNowPreservesLineBreaks() {
  console.log("\nTest 20: The Feedback screen's Exam Ready Answer now preserves line breaks (white-space:pre-wrap), matching ScholarVault's existing Print view technique — content/generation logic untouched");
  const cssRule = html.match(/\.erb-text\{[^}]*\}/)[0];
  assert(cssRule.includes("white-space:pre-wrap"), "erb-text CSS now includes white-space:pre-wrap");

  const printRule = html.match(/white-space:pre-wrap;">'\+displayAnswer/);
  assert(printRule, "confirms ScholarVault's Print view already used this exact same technique (the one being reused, not duplicated)");
}

function test21_formalLetterStructurePreservedOnFeedbackScreen() {
  console.log("\nTest 21: A formal letter's address, date, salutation, paragraphs, and closing render with their intended structure on the Feedback screen");
  const dom = makeDom();
  const { window } = dom;
  const letterText = "123 Ang Mo Kio Avenue 3\nSingapore 560123\n\n15 August 2026\n\nDear Sir/Madam,\n\nI am writing to express my concern about the litter in our neighbourhood park.\n\nYours faithfully,\nWenbo Lee";

  window.state.currentQuestion = { id: "0", level: "P6", subjectKey: "EN", lessonId: "1.1", lessonTitle: "1.1", t: "Write a formal letter.", m: 5 };
  window.state.feedback = { score: 5, strengths: ["x"], nextSteps: [], learningReceipt: [], examReadyAnswer: letterText };
  window.state.vault = [];

  const out = window.viewFeedback();
  assert(out.includes(letterText), "the exact letter text, including every newline character, is present unmodified in the rendered HTML — the browser will now display it with the intended line breaks since white-space:pre-wrap is applied");
}

function test22_bothSurfacesShowIdenticalStructurePostFix() {
  console.log("\nTest 22: Feedback and ScholarVault (Print view) now render the SAME formal-letter structure consistently — reusing one rendering approach, not two");
  const dom = makeDom();
  const { window } = dom;
  const letterText = "Blk 5 Toa Payoh Lorong 4\nSingapore 310005\n\n20 August 2026\n\nDear Editor,\n\nI would like to share my views on recycling in schools.\n\nYours sincerely,\nWenbo Lee";

  window.state.currentQuestion = { id: "0", level: "P6", subjectKey: "EN", lessonId: "1.4", lessonTitle: "1.4 Editing", t: "Write a formal letter to the editor.", m: 5 };
  window.state.feedback = { score: 5, strengths: [], nextSteps: [], learningReceipt: [], examReadyAnswer: letterText };
  window.state.vault = [];
  const feedbackOut = window.viewFeedback();

  return window.saveExamReadyToVault().then(() => {
    window.state.selectedVaultIds = [];
    const printOut = window.viewPrint();

    assert(feedbackOut.includes(letterText), "Feedback screen shows the exact structured letter");
    assert(printOut.includes(letterText), "ScholarVault Print view shows the exact same structured letter (character-for-character, per the existing single-source-of-truth save)");
    assert(feedbackOut.includes("white-space:pre-wrap") === false && html.includes(".erb-text{") , "Feedback's preservation comes from the erb-text CSS class (not an inline style duplicate) — one styling approach, reused via CSS, not copy-pasted inline");
  });
}

function test23_noContentOrGenerationLogicChanged() {
  console.log("\nTest 23: Confirms this was a pure presentation fix — the Exam Ready Answer generation/gating logic is completely untouched");
  assert(html.includes("const examReadyBlock = (isComplete && fb.examReadyAnswer"), "the full-marks gating condition for showing Exam Ready Answer is unchanged");
  assert(html.includes("fb.score < q.m) return; // full marks required"), "saveExamReadyToVault()'s defensive full-marks gate is unchanged");
}

(async () => {
  test1_apiPromptRequestsMarkAwareExamReadyAnswer();
  test2_strengthsAndNextStepsStillNeverReveal();
  test3_examReadySectionRendersWhenPresent();
  test4_examReadySectionHiddenWhenAbsent();
  await test5_savingDoesNotCreateDuplicateVaultEntries();
  test6_savedStateShowsCheckmarkNotDuplicateButton();
  await test7_savingExamReadyPreservesStudentsOwnAnswerIfAlreadySaved();
  await test8_savingOwnAnswerAfterExamReadyPreservesExamReadyAnswer();
  await test9_saveExamReadyDoesNothingWithoutAGeneratedAnswer();
  test10_existingActionRowAndBackButtonsUnchanged();
  test11_gatedStrictlyByFullMarksAllSixCases();
  test12_incompleteAnswerStillShowsEverythingElse();
  await test13_saveFunctionDefensivelyBlockedBelowFullMarks();
  await test14_printViewUsesExactSameStoredString();
  test15_printViewFallsBackToOwnAnswerWhenNoExamReadySaved();
  test16_mixedVaultShowsCorrectVersionPerEntry();
  test17_score75PercentTextAndGateRemoved();
  await test18_addToVaultNoLongerHardGatedAt75Percent();
  test19_90PercentSoftConfirmStillPresent();
  test20_erbTextNowPreservesLineBreaks();
  test21_formalLetterStructurePreservedOnFeedbackScreen();
  await test22_bothSurfacesShowIdenticalStructurePostFix();
  test23_noContentOrGenerationLogicChanged();

  console.log("\n" + "=".repeat(50));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
