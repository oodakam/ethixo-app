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
  const requestStart = Date.now();
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

    // NOTE: the system prompt below is now 100% static/identical on every call (same text
    // regardless of turn number, question, or student) — this is required for Anthropic's
    // prompt caching to actually hit. Anything that varies per-call (Question Demand
    // instructions, marks) has been moved into the per-call `user` message instead.
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

      "STEP 2 — QUESTION DEMAND: the user message will tell you either to infer this fresh (Turn 1 " +
      "only — choose one to three from this fixed list: Recall, Explain Meaning, Use in Context, Find " +
      "Evidence, Compare, Cause & Effect, Infer, Predict, Classify, Apply — never invent new categories) " +
      "or to reuse a value already established earlier in this interaction (echo it back unchanged).\n\n" +

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

      "Reply with STRICT JSON ONLY, no markdown fences, matching exactly this shape:\n" +
      '{"responseGate": "Sufficient"|"Partial"|"Insufficient", ' +
      '"questionDemand": ["...", "..."], ' +
      '"learningGap": {"family": "...", "specific": "..."} or null, ' +
      '"noThinkingCycle": true|false, ' +
      '"confidence": "High"|"Medium"|"Low" or null, ' +
      '"thinkingMove": "..." or null, ' +
      '"message": "...", ' +
      '"resolved": true|false}';

    const questionDemandInstruction = needsQuestionDemand
      ? "Question Demand: not yet established — infer it now (Turn 1)."
      : "Question Demand already established as " + JSON.stringify(questionDemand) + " — reuse it exactly, do not re-derive.";

    const user =
      "Question (" + marks + " marks): " + question +
      '\nConfidential model answer (never reveal): """' + modelAnswer + '"""\n' +
      questionDemandInstruction + "\n" +
      historyBlock +
      '\nStudent\'s current response (Turn ' + turnNumber + '): """' + studentResponse + '"""\n\n' +
      "Work through the pipeline now and return the JSON.";


    const callStart = Date.now();
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1536, // raised again (700 -> 1024 -> 1536) — the fallback still fired after the
                           // first increase, per the latest screenshots. The new usage/stop_reason
                           // logging below will confirm from real data whether truncation is still
                           // happening, rather than guessing further.
        cache_control: { type: "ephemeral" }, // system is now fully static across turns/requests —
                           // this caches it so Turn 2/3 (and other students' calls) skip reprocessing
                           // the whole taxonomy every time, which should meaningfully cut latency.
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const callMs = Date.now() - callStart;

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("Ethixo thinking.js — Anthropic API error:", apiRes.status, errText, "| call took", callMs, "ms");
      res.status(apiRes.status).json({ error: "Anthropic API error", detail: errText });
      return;
    }

    const data = await apiRes.json();
    // Log timing + cache stats server-side (Vercel Runtime Logs) on every call — this is the
    // "measure, don't guess" data point: cache_read_input_tokens > 0 means caching hit.
    // totalMs = full function time (includes any Vercel cold start + JSON parsing overhead);
    // callMs = just the Anthropic fetch. Comparing the two tells us where time is actually going.
    const totalMs = Date.now() - requestStart;
    console.log(
      "Ethixo thinking.js — turn", turnNumber, "| anthropic call:", callMs, "ms | total function time:", totalMs, "ms | usage:",
      JSON.stringify(data.usage), "| stop_reason:", data.stop_reason
    );
    if (data.stop_reason === "max_tokens") {
      console.warn("Ethixo thinking.js — response was TRUNCATED (stop_reason: max_tokens). Consider raising max_tokens further if this recurs.");
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    const safeFallback = {
      responseGate: "Sufficient",
      questionDemand: (req.body && req.body.questionDemand) || [],
      learningGap: null,
      noThinkingCycle: false,
      confidence: "Low",
      thinkingMove: "TM-07 Reflect",
      message: "That's an interesting thought! Can you tell me a bit more about how you got to that answer?",
      resolved: false,
    };

    if (!textBlock || !textBlock.text) {
      console.error("Ethixo thinking.js — no usable text block in response; stop_reason:", data.stop_reason);
      res.status(200).json(safeFallback); // endpoint always returns a valid, usable JSON object
      return;
    }

    let clean = textBlock.text
      .trim()
      .replace(/^```json/, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    try {
      const parsed = JSON.parse(clean);
      res.status(200).json(parsed);
    } catch (parseErr) {
      console.error("Ethixo thinking.js — JSON parse failed:", parseErr.message, "| stop_reason:", data.stop_reason, "| raw text:", textBlock.text);
      // Never surface a raw parsing error to a student mid-conversation — fall back to a
      // safe, generic, warm continuation instead, and rely on the server logs above to debug.
      res.status(200).json(safeFallback);
    }
  } catch (e) {
    console.error("Ethixo thinking.js — unexpected error:", e);
    res.status(500).json({ error: e.message });
  }
}
