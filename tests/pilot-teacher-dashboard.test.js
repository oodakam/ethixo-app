// Focused check of the pilot Teacher Dashboard (teacher.html) with realistic pilot-style data.
//  1. Signal rules (pure functions; boundaries).  2. lesson-meta sync + no answers/questions in it.
//  3. Real Chromium + mocked Supabase network: Angelina doing well / Alan needs attention / Austin relies on Thinking Help /
//     a joined-but-idle student, drill-down, mobile width, and that ONLY the allowed backend resources are requested.
// Run: node tests/pilot-teacher-dashboard.test.js
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process");
let chromium; try { ({ chromium } = require("playwright")); } catch (_e) { ({ chromium } = require("playwright-core")); }
const root = path.join(__dirname, "..");
let passed = 0, failed = 0; const assert = (c, m) => { if (c) { passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } };
const P = require("../assets/pilot-teacher-insights.js");
const meta = JSON.parse(fs.readFileSync(path.join(root, "assets", "pilot-lesson-meta.json"), "utf8"));

console.log("1. Signal rules");
const NOW = 1e12;
const row = (sid, name, q, best, cnt, think, sk, lesson, at) => ({ student_id: sid, display_name: name, level: "P6", subject_key: sk || "SS", lesson_id: lesson || "1.1", q_idx: q, attempt_count: cnt, latest_at: at == null ? NOW : at, latest_score: best, best_score: best, used_thinking: think });
// SS 1.1 marks = [3,1,5]
assert(P.performance(0, null) === "No activity yet" && P.performance(2, 1) === "Just getting started", "0 questions = No activity yet; <3 questions = Just getting started");
assert(P.performance(3, 0.7) === "Doing well" && P.performance(3, 0.699) === "Making progress" && P.performance(3, 0.4) === "Making progress" && P.performance(3, 0.399) === "May need attention", "70% / 40% boundaries");
let r = P.compute([row("a", "Angelina", 0, 3, 1, false), row("a", "Angelina", 1, 1, 1, false), row("a", "Angelina", 2, 5, 2, false),
  row("b", "Alan", 0, 0, 2, false), row("b", "Alan", 1, 0, 1, false), row("b", "Alan", 2, 1, 3, false),
  row("c", "Austin", 0, 3, 1, true), row("c", "Austin", 1, 1, 1, true), row("c", "Austin", 2, 2, 1, true)], [{ student_id: "d", display_name: "Dee" }], meta, NOW);
const by = n => r.students.find(s => s.name === n);
assert(by("Angelina").performance === "Doing well" && by("Angelina").fullMarks === 3 && by("Angelina").retriedFull === 1, "Angelina: Doing well, 3 full-marks, reached full marks after retry");
assert(by("Alan").performance === "May need attention" && by("Alan").needsAttention && by("Alan").focusLesson && by("Alan").lessons[0].struggling, "Alan: May need attention, struggling in the lesson");
assert(by("Austin").thinkingHeavy && by("Austin").thinkingQs === 3 && !by("Angelina").thinkingHeavy, "Austin: relies on Thinking Help (3/3); others do not");
assert(by("Dee").performance === "No activity yet" && by("Dee").questions === 0, "Dee: joined, no activity yet");
assert(r.lessonsToLookAt.length === 1 && r.lessonsToLookAt[0].struggling === 1 && r.attention.length === 2, "lesson flagged (1 struggling student); attention list = Alan + Austin");
assert(r.examReady[0].full === 5 && r.examReady[0].scored === 9, "full-marks answers by subject computed from best_score >= marks (5 of 9)");
const unk = P.compute([row("x", "X", 0, 2, 1, false, "SS", "no-such-lesson")], [], meta, NOW);
assert(unk.students[0].questions === 1 && unk.students[0].scored === 0 && unk.students[0].avgRatio === null, "unknown lesson: counted as attempted, never scored (no invented marks)");

console.log("2. lesson-meta");
assert(cp.spawnSync("node", ["scripts/build-pilot-lesson-meta.js", "--check"], { cwd: root }).status === 0, "assets/pilot-lesson-meta.json is in sync with index.html");
const keys = new Set(); (function walk(o) { for (const k of Object.keys(o)) { keys.add(k); if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) walk(o[k]); } })(meta);
assert(!keys.has("t") && !keys.has("a") && !keys.has("questions") && !keys.has("answer"), "meta has no question text or answer keys");

console.log("3. Browser");
const FAKE = "https://fakeref.supabase.co", KEY = "sb_publishable_TESTONLY";
(async () => {
  const mod = await import(path.join(root, "api", "pilot-app.js")); const handler = mod.default;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/pilot-teacher") {
      const old = process.env; process.env = Object.assign({}, old, { VERCEL_ENV: "preview", ETHIXO_PILOT_HOSTS: "127.0.0.1", ETHIXO_PILOT_SUPABASE_URL: FAKE, ETHIXO_PILOT_SUPABASE_PUBLISHABLE_KEY: KEY });
      const out = { setHeader() {}, status(c) { res.statusCode = c; return out; }, send(b) { res.setHeader("content-type", "text/html"); res.end(b); }, json() { res.end("{}"); } };
      try { handler({ headers: { host: req.headers.host }, query: { page: "teacher" } }, out); } finally { process.env = old; } return;
    }
    const f = path.join(root, u.pathname);
    if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) { const e = path.extname(f); res.setHeader("content-type", e === ".js" ? "application/javascript" : e === ".json" ? "application/json" : e === ".webp" ? "image/webp" : "text/plain"); return res.end(fs.readFileSync(f)); }
    res.statusCode = 404; res.end("nf");
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); const port = server.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {});
  const C1 = "c1";
  const day = 86400000, now = Date.now();
  const summary = [
    row("a", "Angelina", 0, 3, 1, false, "SS", "1.1", now - 3600e3), row("a", "Angelina", 1, 1, 1, false, "SS", "1.1", now - 3600e3), row("a", "Angelina", 2, 5, 2, false, "SS", "1.1", now - 3600e3),
    row("b", "Alan", 0, 0, 2, false, "SS", "1.1", now - 2 * day), row("b", "Alan", 1, 0, 1, false, "SS", "1.1", now - 2 * day), row("b", "Alan", 2, 1, 3, false, "SS", "1.1", now - 2 * day),
    row("c", "Austin", 0, 3, 1, true, "SS", "1.1", now - day), row("c", "Austin", 1, 1, 1, true, "SS", "1.1", now - day), row("c", "Austin", 2, 2, 1, true, "SS", "1.1", now - day),
  ];
  const roster = [["a", "Angelina"], ["b", "Alan"], ["c", "Austin"], ["d", "Dee"]];
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } }); const page = await ctx.newPage(); const reqs = []; const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await ctx.addInitScript(s => localStorage.setItem("ethixoTeacherAuth", JSON.stringify(s)), { access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: "u1", email: "t@x.sg", is_anonymous: false, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" } });
  await page.route(FAKE + "/**", route => {
    const rq = route.request(), u = new URL(rq.url()); reqs.push({ method: rq.method(), path: u.pathname });
    const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: JSON.stringify(b) });
    if (rq.method() === "OPTIONS") return j({});
    const s = decodeURIComponent(u.search);
    if (u.pathname === "/rest/v1/profiles" && /id=in\./.test(s)) return j(roster.map(x => ({ id: x[0], display_name: x[1] })));
    if (u.pathname === "/rest/v1/profiles") return j([{ id: "u1", role: "teacher", display_name: "Vijay", is_approved: true }]);
    if (u.pathname === "/rest/v1/class_members") return j(roster.map(x => ({ student_id: x[0] })));
    if (u.pathname === "/rest/v1/classes") return j([{ id: C1, name: "Pilot Class", join_code: "0123456789", created_at: "x" }]);
    if (u.pathname === "/rest/v1/rpc/teacher_attempt_summary") return j(summary.map(x => Object.assign({ class_id: C1 }, x)));
    route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto("http://127.0.0.1:" + port + "/pilot-teacher"); await page.waitForTimeout(1200);
  const text = () => page.evaluate(() => document.getElementById("app").innerText);
  let tx = await text();
  assert(/Hello, Vijay!/.test(tx) && /Pilot Class/.test(tx) && /0123456789/.test(tx), "hero + class name + class code shown");
  assert(/3 of 4 students have practised so far/.test(tx), "Ethixo Noticed: 3 of 4 students practised");
  const attn = await page.locator(".t-encourage-wrap").nth(0).innerText();
  const well = await page.locator(".t-encourage-wrap").nth(1).innerText();
  assert(/Alan/.test(attn) && /Austin/.test(attn) && !/Angelina/.test(attn), "May need attention: Alan and Austin (Thinking Help), not Angelina");
  assert(/Angelina/.test(well) && /Austin/.test(well) && !/Alan/.test(well), "Doing well: Angelina (and Austin by score), not Alan");
  assert(/Austin[\s\S]*Relies on Thinking Help/.test(tx) && /Dee[\s\S]*Joined · no practice yet/.test(tx), "all-students list: Austin relies on Thinking Help; Dee joined, no practice");
  assert(/1\.1 Location of Southeast Asian Countries/.test(tx) && /1 struggling/.test(tx), "lesson list shows the lesson with one student struggling");
  assert(!/Sharon|Wenbo|Aisyah|P6-A|Misconceptions|New ideas understood|Explained independently/i.test(tx), "no demo data and no unsupported analytics");
  assert(!/answer text|vault|thinking cycle/i.test(tx.replace(/Thinking Help conversations/g, "")) , "no private-content wording");
  // drill-down
  await page.locator(".t-student-row", { hasText: "Alan" }).click(); await page.waitForTimeout(300);
  const d = await text();
  assert(/Alan/.test(d) && /May need attention/.test(d) && /Questions attempted\s*3/.test(d) && /Struggling in: 1\.1 Location/.test(d), "student detail: Alan status, counts, struggling lesson");
  assert(!/Angelina/.test(d), "detail shows only the selected student");
  await page.getByRole("button", { name: "Back to dashboard" }).click(); await page.waitForTimeout(300);
  assert(/Class progress/.test(await text()), "back to dashboard works");
  // mobile
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + "-desktop.png", fullPage: true }); await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(300); if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + "-mobile.png", fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "375px width: no horizontal overflow");
  const tables = Array.from(new Set(reqs.filter(r => r.path.indexOf("/rest/v1/") === 0 && r.method !== "OPTIONS").map(r => r.path.replace("/rest/v1/", "")))).sort().join(",");
  assert(tables === "class_members,classes,profiles,rpc/teacher_attempt_summary", "only allowed backend resources requested: " + tables);
  assert(errors.length === 0, "no JavaScript errors");
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
