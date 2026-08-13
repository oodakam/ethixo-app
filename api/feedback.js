// This file runs on Vercel's SERVER, not in the student's browser.
// The ANTHROPIC_API_KEY is read from Vercel's Environment Variables (set in the dashboard),
// so it is never visible to anyone visiting the website — this is the "kitchen", not the "dining room".

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Vercel > Project > Settings > Environment Variables." });
    return;
  }

  try {
    const { question, marks, answer, modelAnswer, thinkingHistory, priorAttempts } = req.body || {};
    if (!question || !marks || !answer) {
      res.status(400).json({ error: "Missing question, marks, or answer" });
      return;
    }

    const markSchemeBlock = modelAnswer
      ? "\nYou have been given the OFFICIAL MARKING SCHEME / MODEL ANSWER for this question below. Use it as your ground truth for judging accuracy and completeness.\n" +
        "This marking scheme is STRICTLY CONFIDENTIAL: never quote it, paraphrase it, or reveal any part of its wording to the student, in any part of your response, under any circumstances — not even a single phrase from it.\n" +
        'Marking scheme (internal only): """' + modelAnswer + '"""\n'
      : "\nNo official marking scheme is available for this question yet — judge the answer against your own general knowledge of what a strong answer at this mark allocation should cover.\n";

    const system =
      "You are Ethixo, an AI answer-coach for a Singapore Primary school student practising written exam answers.\n" +
      "Singapore school medium of instruction is English, so the student's answer must be written in English.\n" +
      "STEP 1 — Check language first: if the student's answer is not written in English (or is mostly not English), respond with STRICT JSON ONLY:\n" +
      '{"languageError": true, "message": "<short, kind message asking the student to write their answer in English>"}\n' +
      "Do not evaluate the content at all in this case — language check comes first.\n" +
      "STEP 2 — If the answer is in English, assess it as follows:\n" +
      markSchemeBlock +
      "- Within 'strengths' and 'nextSteps' ONLY: NEVER state, imply, or reveal the correct or full answer, whether from the marking scheme or your own knowledge, and NEVER rewrite or complete the answer for the student there.\n" +
      "- Reply with STRICT JSON ONLY — no markdown fences, no commentary before or after — matching exactly:\n" +
      '{"score": <single integer 0-' + marks + ', your best single estimate, not a range>, "strengths": ["...", "..."], "nextSteps": ["...", "..."], "learningReceipt": ["...", "..."], "examReadyAnswer": "..."}\n' +
      "- score: ONE single whole number, like a teacher would give — never a range or two numbers.\n" +
      "- strengths: 1-3 short, specific points on what the student did well, referring to their actual answer.\n" +
      "- nextSteps: 1-3 short guiding prompts (questions or pointers on what KIND of detail/example is missing) that lead the student to improve their own answer, without giving the content away.\n" +
      "- learningReceipt: this is Ethixo's most important field. It is NOT a summary of the answer and must NEVER repeat or rephrase anything already said in strengths or nextSteps.\n" +
      "  It is 0 to 3 short bullets celebrating genuine LEARNING BEHAVIOUR evidenced in the 'Interaction context' provided below (if any), or, when no such context is given, evidenced only in how the student engaged with THIS single attempt.\n" +
      "  Only celebrate one or more of these exact qualities, and only when real evidence supports it: Persistence, Curiosity, Discovery, Reflection, Improvement, Careful thinking, Connections made, Misconceptions corrected.\n" +
      "  Every bullet MUST name the quality and immediately explain, in one short sentence, exactly what the student did to earn it (e.g. \"Great persistence! You stayed with the problem until the meaning became clear.\").\n" +
      "  NEVER use empty praise such as \"Great job!\", \"Brilliant!\", or \"Smart student!\" without that specific evidence attached.\n" +
      "  NEVER invent or assume evidence that is not actually present in the context given to you. If nothing genuine qualifies, return an empty array — do not force it.\n" +
      "  Tone: warm, teacher-like, specific, short, never repetitive. The goal is to help the student notice and enjoy the FEELING of learning itself (discovering, understanding, improving, persevering) so they want to do it again — not to make them chase praise.\n" +
      "- examReadyAnswer: a DELIBERATE EXCEPTION to the 'never reveal' rule above — its entire purpose is to give the student a complete, ready-to-use model answer, shown to them only AFTER their score and coaching feedback. Write it in full; do not hedge or leave it incomplete.\n" +
      "  It must directly and completely answer the ACTUAL question given above (not the student's specific wording, and not a related-but-different idea).\n" +
      "  It must fit the " + marks + "-mark allocation: for 1 mark, a concise key phrase or short sentence; for 2 marks, a sentence containing the key supporting reason or example a 2-mark answer needs; for 3 marks, a sufficiently developed response covering the key points a 3-mark answer needs. Let the question and its marks decide the right length — do not force a fixed sentence count.\n" +
      "  It must NOT simply copy or lightly reword the student's own answer above.\n" +
      "  It must NOT invent details that are not genuinely relevant to the question.\n" +
      "  Write in clear, age-appropriate English for a Singapore Primary school student.\n" +
      "  If a marking scheme was given above, you may use it for accuracy, but write your own natural, complete sentence(s) — do not paste its exact wording verbatim.";

    let interactionContext = "";
    if (Array.isArray(thinkingHistory) && thinkingHistory.length) {
      interactionContext += "\n\nInteraction context for learningReceipt ONLY (this is the student's Thinking Cycle conversation BEFORE writing the final answer above — use it to look for real evidence of persistence, curiosity, reflection, or misconceptions being corrected; never quote it in strengths or nextSteps):\n";
      thinkingHistory.forEach(function (turn) {
        interactionContext += "- " + (turn.speaker === "ethixo" ? "Ethixo asked" : "Student replied") + ": \"" + String(turn.text || "").slice(0, 300) + "\"\n";
      });
    }
    if (Array.isArray(priorAttempts) && priorAttempts.length) {
      interactionContext += "\n\nPrevious attempts by this student on this SAME question (for learningReceipt ONLY — only mention Improvement if this attempt's score is genuinely higher than the most recent one below):\n";
      priorAttempts.slice(-3).forEach(function (a, i) {
        interactionContext += "- Attempt " + (i + 1) + ": scored " + a.score + "/" + marks + "\n";
      });
    }

    const user =
      "Question (" + marks + " marks): " + question +
      '\n\nStudent\'s answer:\n"""' + answer + '"""' +
      interactionContext +
      "\n\nAssess this answer now.";

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1200,
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
    parsed.learningReceipt = Array.isArray(parsed.learningReceipt) ? parsed.learningReceipt.slice(0, 3) : [];
    parsed.examReadyAnswer = typeof parsed.examReadyAnswer === "string" ? parsed.examReadyAnswer.trim() : "";
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
