// Checks a student's self-written practice question BEFORE they write an answer.
// Two checks: (1) is it written in English, (2) does it plausibly relate to the chosen lesson.
// This is a "loose" check using only the lesson title — a stricter, textbook-grounded check
// comes in a later phase once the real syllabus content is fed in.

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
    const { lessonTitle, subjectName, questionText } = req.body || {};
    if (!lessonTitle || !questionText) {
      res.status(400).json({ error: "Missing lessonTitle or questionText" });
      return;
    }

    const system =
      "You are a gatekeeper checking a Singapore Primary school student's self-written PRACTICE QUESTION before they answer it.\n" +
      "The student chose subject '" + (subjectName || "") + "', lesson '" + lessonTitle + "'.\n" +
      "Check two things about the QUESTION TEXT (not any answer):\n" +
      "1. Language: is it written in English? Singapore school medium is English.\n" +
      "2. Topic fit: does it plausibly belong to this lesson's subject area? Be LENIENT — this is a loose, early check (the full textbook hasn't been loaded yet). Only flag CLEAR mismatches such as pop culture trivia, entertainment, sports, or a totally unrelated subject. If there is reasonable doubt, treat it as acceptable.\n" +
      "Reply with STRICT JSON ONLY, no markdown fences:\n" +
      '{"ok": true|false, "issue": "language"|"topic"|null, "message": "<if not ok: a short, kind, encouraging sentence telling the student what to fix>"}';

    const user = "Question: \"\"\"" + questionText + "\"\"\"";

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 400,
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
