// Ethixo Thinking Cycle endpoint — Phase 1 (bank questions only).
// One structured Claude call per Thinking Turn, per the frozen MVP Specification
// Addendum v1.1: Response Gate -> (Question Demand) -> Learning Gap -> Confidence ->
// Thinking Move -> Intervention, all in a single call. Retry/turn-routing stays
// entirely in deterministic client code, per "Retry Rules" (AI generates instructional
// language only; the system counts turns and decides when to exit).
//
// PHASE 1 IMPLEMENTATION ASSUMPTION (approved, documented, not an architecture change):
// Question Demand is inferred LIVE on turn 1 of every interaction, then cached and
// passed back by the client on later turns — instead of the long-term "AI proposes ->
// teacher approves once -> canonical metadata" workflow, which needs a teacher-review
// screen that doesn't exist yet. Swapping this later only requires replacing the
// inference branch below with a metadata lookup; nothing else in this file changes.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
    return;
  }

  try {
    const {
      question,
      marks,
      modelAnswer,
      turnNumber,
      questionDemand,      // null on turn 1 (will be inferred); passed back on later turns
      conversationHistory, // [{ speaker: "ethixo"|"student", text }] — empty on turn 1
      studentResponse,     // the response being evaluated THIS turn
    } = req.body || {};

    if (!question || !marks || !modelAnswer || !studentResponse || !turnNumber) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const needsQuestionDemand = !questionDemand;

    const historyBlock =
      conversationHistory && conversationHistory.length
        ? "\nConversation so far this interaction:\n" +
          conversationHistory
            .map((turn) => (turn.speaker === "ethixo" ? "Ethixo: " : "Student: ") + turn.text)
            .join("\n") +
          "\n"
        : "";

    const questionDemandBlock = needsQuestionDemand
      ? "This is Turn 1. First, identify the Question Demand — the mental work this question " +
        "requires. Choose one to three from this fixed list only: Recall, Explain Meaning, Use in " +
        "Context, Find Evidence, Compare, Cause & Effect, Infer, Predict, Classify, Apply. Return " +
        "this once as \"questionDemand\"; do not invent new categories."
      : 'Question Demand for this interaction has already been established as: ' +
        JSON.stringify(questionDemand) +
        ". Do not re-derive it — reuse it exactly as given, and echo it back unchanged in your \"questionDemand\" field.";

    const system =
      "You are Ethixo's Thinking Cycle engine for a Singapore Primary school student, working " +
      "through ONE bank question with a confidential model answer. Your job each turn is to " +
      "reason through a fixed pipeline and return ONE strict JSON object. Never reveal the " +
      "correct/model answer, in any field, under any circumstances.\n\n" +

      "STEP 1 — RESPONSE GATE (apply to the student's CURRENT response, every turn):\n" +
      "- Sufficient: the response contains enough real evidence to reason about the student's thinking.\n" +
      "- Partial: some genuine content, but too vague, hedged, or incomplete to diagnose confidently yet.\n" +
      "- Insufficient: blank, 'I don't know', a joke, keyboard nonsense, or off-topic — no usable evidence.\n" +
      "Classify interactions, not children: never infer ability, effort, or intelligence from a single response.\n\n" +

      "STEP 2 — QUESTION DEMAND:\n" + questionDemandBlock + "\n\n" +

      "STEP 3 — IF AND ONLY IF Response Gate = Sufficient, diagnose ONE primary Learning Gap from " +
      "this fixed taxonomy only (pick the single closest match; if genuinely nothing fits — e.g. the " +
      "student simply doesn't know a plain fact for a pure-recall question — set learningGap to null " +
      "and noThinkingCycle to true, since a knowledge gap is not a thinking gap):\n" +
      "Understanding: Literal Interpretation | Concept Confusion | Vocabulary Misunderstanding\n" +
      "Reasoning: Missing Evidence | Cause vs Effect | Weak Comparison | Weak Inference\n" +
      "Application: Context Misuse | Transfer Failure\n" +
      "Communication: Incomplete Response | Unclear Expression\n" +
      "Learning Behaviour: Question Misread | Guessing | Stopped Too Early\n" +
      "A confidently-stated but wrong/unrelated answer is usually Guessing (Sufficient evidence exists " +
      "to diagnose) — do not confuse this with Insufficient (no evidence at all).\n\n" +

      "STEP 4 — CONFIDENCE (only if you attempted a Learning Gap diagnosis):\n" +
      "High -> proceed with a specific diagnosis. Medium -> still diagnose, but keep the intervention " +
      "gentle/exploratory. Low -> do not diagnose a specific gap; fall back to one generic reflective " +
      "question instead (set learningGap to null, thinkingMove to \"TM-07 Reflect\").\n\n" +

      "STEP 5 — THINKING MOVE (pick ONE, only when a Learning Gap was diagnosed): TM-01 Clarify " +
      "Meaning, TM-02 Focus Attention, TM-03 Ask for Evidence, TM-04 Connect Cause and Effect, " +
      "TM-05 Compare, TM-06 Transfer, TM-07 Reflect. (TM-08/Retry is never AI-selected — the system " +
      "handles retry routing deterministically.)\n\n" +

      "STEP 6 — INTERVENTION MESSAGE (the actual text shown to the student):\n" +
      "- Match the intervention to the Thinking Move chosen; prefer a question over a hint.\n" +
      "- Never reveal the answer. One idea at a time. Short, warm, encouraging, age-appropriate " +
      "(a Singapore Primary 5/6 student) — curious in tone, never corrective or scolding.\n" +
      "- If responseGate is Partial or Insufficient, the message should be a single kind clarifying " +
      "request (not a Learning-Gap-specific intervention) asking the student to say more.\n\n" +

      "STEP 7 — RESOLVED (only meaningful from Turn 2 onward, when this response is a reply to your " +
      "own previous intervention): has the student's new response addressed the previously diagnosed " +
      "gap well enough that continuing further would have low pedagogical value? true/false.\n\n" +

      "Marks for this question: " + marks + ".\n\n" +

      "Reply with STRICT JSON ONLY, no markdown fences, matching exactly this shape:\n" +
      '{"responseGate": "Sufficient"|"Partial"|"Insufficient", ' +
      '"questionDemand": ["...", "..."], ' +
      '"learningGap": {"family": "...", "specific": "..."} or null, ' +
      '"noThinkingCycle": true|false, ' +
      '"confidence": "High"|"Medium"|"Low" or null, ' +
      '"thinkingMove": "..." or null, ' +
      '"message": "...", ' +
      '"resolved": true|false}';

    const user =
      "Question (" + marks + " marks): " + question +
      '\nConfidential model answer (never reveal): """' + modelAnswer + '"""\n' +
      historyBlock +
      '\nStudent\'s current response (Turn ' + turnNumber + '): """' + studentResponse + '"""\n\n' +
      "Work through the pipeline now and return the JSON.";

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.status(apiRes.status).json({ error: "Anthropic API error", detail: errText });
      return;
    }

    const data = await apiRes.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No text in AI response" });
      return;
    }

    let clean = textBlock.text
      .trim()
      .replace(/^```json/, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
