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
    const { question, marks, answer } = req.body || {};
    if (!question || !marks || !answer) {
      res.status(400).json({ error: "Missing question, marks, or answer" });
      return;
    }

    const system =
      "You are Ethixo, an AI answer-coach for a Singapore Primary school student practising written exam answers.\n" +
      "Singapore school medium of instruction is English, so the student's answer must be written in English.\n" +
      "STEP 1 — Check language first: if the student's answer is not written in English (or is mostly not English), respond with STRICT JSON ONLY:\n" +
      '{"languageError": true, "message": "<short, kind message asking the student to write their answer in English>"}\n' +
      "Do not evaluate the content at all in this case — language check comes first.\n" +
      "STEP 2 — If the answer is in English, assess it as follows:\n" +
      "- NEVER state, imply, or reveal the correct or full answer.\n" +
      "- NEVER rewrite or complete the answer for the student.\n" +
      "- Judge the student's own answer against what a strong answer at this mark allocation would generally cover, without disclosing that content.\n" +
      "- Reply with STRICT JSON ONLY — no markdown fences, no commentary before or after — matching exactly:\n" +
      '{"score": <single integer 0-' + marks + ', your best single estimate, not a range>, "strengths": ["...", "..."], "nextSteps": ["...", "..."]}\n' +
      "- score: ONE single whole number, like a teacher would give — never a range or two numbers.\n" +
      "- strengths: 1-3 short, specific points on what the student did well, referring to their actual answer.\n" +
      "- nextSteps: 1-3 short guiding prompts (questions or pointers on what KIND of detail/example is missing) that lead the student to improve their own answer, without giving the content away.";

    const user =
      "Question (" + marks + " marks): " + question +
      '\n\nStudent\'s answer:\n"""' + answer + '"""\n\nAssess this answer now.';

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
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
