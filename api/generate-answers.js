// This file runs on Vercel's SERVER, not in the browser — same pattern as api/feedback.js
// and api/thinking.js. The ANTHROPIC_API_KEY is read from Vercel's Environment Variables.
//
// Purpose (Milestone 4 — Validation Tool): given a real bank question + its confidential
// model answer, generate 4 DIVERSE, realistic representative student answers so Vijay never
// has to role-play a Primary 6 student himself. He reviews/edits and adds the ones he wants
// to the validation set. Later, once Ethixo has real usage, these can be swapped for
// anonymised real student responses — this endpoint is a Phase 1 bootstrap, not a permanent
// substitute for real data.

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
    const { question, marks, modelAnswer } = req.body || {};
    if (!question || !marks || !modelAnswer) {
      res.status(400).json({ error: "Missing question, marks, or modelAnswer" });
      return;
    }

    const system =
      "You help a Singapore Primary school founder build a validation set for an AI coaching tool by generating " +
      "REALISTIC representative student answers — so the founder never has to invent them himself.\n" +
      "Given a question (with marks) and its CONFIDENTIAL model answer, write exactly 4 short answers a real " +
      "Primary 5/6 student might genuinely write, one for each of these distinct categories:\n" +
      "- strong: close to full marks — correct, well-reasoned, uses specific relevant detail (but in the student's " +
      "OWN words — never copy the model answer's exact phrasing, even partially).\n" +
      "- partial: some genuine correct content, but missing a key piece of evidence, detail, or precision that " +
      "keeps it from full marks.\n" +
      "- misconception: confidently states something that is conceptually wrong, muddled, or confuses this idea " +
      "with a related one — NOT just vague or lazy, but a genuine wrong belief stated with confidence.\n" +
      "- insufficient: blank-ish, 'I don't know', a very short guess, or off-topic — realistic low-effort/no-evidence " +
      "responses (not a joke, not gibberish — just genuinely thin).\n" +
      "Write in an authentic student voice for this age group — natural, a little informal, occasional small " +
      "grammar slips are fine, but keep every answer clearly readable. Vary sentence structure across the 4 so they " +
      "don't sound like copies of each other with words swapped.\n" +
      "Reply with STRICT JSON ONLY, no markdown fences, no commentary, matching exactly:\n" +
      '{"strong": "...", "partial": "...", "misconception": "...", "insufficient": "..."}';

    const user =
      "Question (" + marks + " marks): " + question +
      '\nConfidential model answer (for your reference only — never reveal or closely paraphrase this to the student, and never quote it in the "strong" answer): """' + modelAnswer + '"""\n\n' +
      "Generate the 4 representative student answers now.";

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 900,
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
    const required = ["strong", "partial", "misconception", "insufficient"];
    const missing = required.filter((k) => typeof parsed[k] !== "string" || !parsed[k].trim());
    if (missing.length) {
      res.status(502).json({ error: "AI response was missing: " + missing.join(", ") });
      return;
    }

    res.status(200).json({
      strong: parsed.strong.trim(),
      partial: parsed.partial.trim(),
      misconception: parsed.misconception.trim(),
      insufficient: parsed.insufficient.trim(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
