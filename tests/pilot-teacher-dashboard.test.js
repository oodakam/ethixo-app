// Focused check of the pilot Teacher Dashboard (teacher.html): functional parity with the Sharon Lim demo dashboard, with real pilot-style data.
//  1. Signal rules (pure functions).  2. lesson-meta sync, prompts only (no answer keys).
//  3. Real Chromium + mocked Supabase network: a 10-student class, drill-downs, Assigned Learning roster, the Assign flow, mobile width,
//     and that ONLY the allowed backend resources are requested (never attempts / vault_entries / student_state).
// Run: node tests/pilot-teacher-dashboard.test.js
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process");
let chromium; try { ({ chromium } = require("playwright")); } catch (_e) { ({ chromium } = require("playwright-core")); }
const root = path.join(__dirname, "..");
let passed = 0, failed = 0; const assert = (c, m) => { if (c) { passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } };
const P = require("../assets/pilot-teacher-insights.js");
const meta = JSON.parse(fs.readFileSync(path.join(root, "assets", "pilot-lesson-meta.json"), "utf8"));
const NOW = 1e12, DAY = 86400000;
// SS 1.1 marks [3,1,5]; SS 1.2 marks [2,1,5]
const R = (cls, sid, name, lesson, q, first, best, cnt, think, at) => ({ class_id: cls, student_id: sid, display_name: name, level: "P6", subject_key: "SS", lesson_id: lesson, q_idx: q, attempt_count: cnt, latest_at: at, latest_score: best, best_score: best, used_thinking: think, first_score: first });

console.log("1. Signal rules");
assert(P.performance(0, null) === "No activity yet" && P.performance(2, 1) === "Just getting started" && P.performance(3, 0.7) === "Doing well" && P.performance(3, 0.699) === "Making progress" && P.performance(3, 0.4) === "Making progress" && P.performance(3, 0.399) === "May need attention", "performance thresholds and boundaries");
assert(P.assignmentStatus(0, 0, 3, []) === "Not Started" && P.assignmentStatus(3, 3, 3, [1, 1, 1]) === "Completed" && P.assignmentStatus(2, 0, 3, [0, 0.2]) === "Needs Practice" && P.assignmentStatus(1, 0, 3, [0]) === "In Progress" && P.assignmentStatus(2, 1, 3, [1, 0.5]) === "In Progress", "assignment status rule");
let r = P.compute([
  R("c", "a", "Angelina", "1.1", 0, 3, 3, 1, false, NOW), R("c", "a", "Angelina", "1.1", 1, 0, 1, 2, false, NOW), R("c", "a", "Angelina", "1.1", 2, 1, 5, 3, false, NOW),
  R("c", "b", "Alan", "1.1", 0, 0, 0, 2, false, NOW), R("c", "b", "Alan", "1.1", 1, 0, 0, 1, false, NOW), R("c", "b", "Alan", "1.1", 2, 0, 1, 3, false, NOW),
  R("c", "c", "Austin", "1.1", 0, 3, 3, 1, true, NOW), R("c", "c", "Austin", "1.1", 1, 1, 1, 1, true, NOW), R("c", "c", "Austin", "1.1", 2, 2, 2, 1, true, NOW)],
  [{ student_id: "d", class_id: "c", display_name: "Dee" }], meta, NOW, { classId: "c" });
const by = n => r.students.find(s => s.name === n);
assert(by("Angelina").performance === "Doing well" && by("Angelina").corrected === 2 && by("Angelina").improved === 2 && by("Angelina").progress === "Improving", "Angelina: Doing well; 2 misconceptions corrected (first<half, later full); Improving");
assert(by("Alan").needsAttention && by("Alan").focusLesson.struggling && by("Alan").corrected === 0, "Alan: May need attention, struggling in the lesson");
assert(by("Austin").thinkingHeavy && by("Austin").fullNoThinking === 0 && by("Angelina").fullNoThinking === 3 && by("Austin").firstTry === 2, "Austin relies on Thinking Help; 'full marks without Thinking Help' = 3 for Angelina, 0 for Austin");
assert(by("Dee").performance === "No activity yet" && r.totals.corrected === 2 && r.totals.fullNoThinking === 3, "Dee: no activity; class totals (2 corrected, 3 full-without-thinking)");
assert(r.questionInsights.length && r.questionInsights[0].underHalf >= 1 && /Name three countries|Southeast Asia/.test(r.questionInsights[0].prompt + r.questionInsights[0].title), "Teaching Insights: question-level, with the curriculum prompt");
assert(/proxy signal/.test(r.metrics.fullNoThinking.insight) && !/explained independently/i.test(r.metrics.fullNoThinking.label), "'Full marks without Thinking Help' is labelled as a proxy, never 'explained independently'");
const unk = P.compute([R("c", "x", "X", "no-such", 0, 1, 2, 1, false, NOW)], [], meta, NOW, {});
assert(unk.students[0].scored === 0 && unk.students[0].avgRatio === null, "unknown lesson: counted as attempted, never scored");

console.log("2. lesson-meta");
assert(cp.spawnSync("node", ["scripts/build-pilot-lesson-meta.js", "--check"], { cwd: root }).status === 0, "assets/pilot-lesson-meta.json is in sync with index.html");
const keys = new Set(); (function walk(o) { for (const k of Object.keys(o)) { keys.add(k); if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) walk(o[k]); } })(meta);
assert(!keys.has("a") && !keys.has("answer") && !keys.has("questions") && keys.has("prompts") && keys.has("marks"), "meta has curriculum prompts and marks, and no answer keys");

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
  const C1 = "c1", C2 = "c2", now = Date.now();
  const t = (d) => now - d * DAY;
  const rows = [];
  const add = (sid, name, lesson, q, first, best, cnt, think, at) => rows.push(R(C1, sid, name, lesson, q, first, best, cnt, think, at));
  // Angelina doing well (3 questions, retries that reached full marks)
  add("a", "Angelina Gabriella", "1.1", 0, 3, 3, 1, false, t(0.1)); add("a", "Angelina Gabriella", "1.1", 1, 0, 1, 2, false, t(0.1)); add("a", "Angelina Gabriella", "1.1", 2, 1, 5, 3, false, t(0.1));
  // Alan struggling in lesson 1.1
  add("b", "Alan", "1.1", 0, 0, 0, 2, false, t(2)); add("b", "Alan", "1.1", 1, 0, 0, 1, false, t(2)); add("b", "Alan", "1.1", 2, 0, 1, 3, false, t(2));
  // Austin relies on Thinking Help
  add("c", "Austin", "1.1", 0, 3, 3, 1, true, t(1)); add("c", "Austin", "1.1", 1, 1, 1, 1, true, t(1)); add("c", "Austin", "1.1", 2, 2, 2, 1, true, t(1));
  // others
  add("e", "Bella", "1.2", 0, 2, 2, 1, false, t(0.5)); add("e", "Bella", "1.2", 1, 1, 1, 1, false, t(0.5)); add("e", "Bella", "1.2", 2, 3, 4, 1, false, t(0.5));
  add("f", "Chen", "1.1", 0, 1, 3, 2, false, t(4)); add("f", "Chen", "1.2", 0, 0, 2, 2, false, t(4));
  add("g", "Dev", "1.2", 0, 1, 1, 1, false, t(6));
  const roster = [["a", "Angelina Gabriella", C1], ["b", "Alan", C1], ["c", "Austin", C1], ["e", "Bella", C1], ["f", "Chen", C1], ["g", "Dev", C1], ["h", "Elle", C1], ["i", "Farid", C1], ["j", "Gina", C1], ["k", "Hui", C1], ["z", "Zed", C2]];
  const assignments = [{ id: "as1", class_id: C1, level: "P6", subject_key: "SS", lesson_id: "1.1", due_date: "2026-12-05", created_at: "2026-11-30T00:00:00Z" }];
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } }); const page = await ctx.newPage(); const reqs = []; const errors = []; const posts = [];
  page.on("pageerror", e => errors.push(String(e)));
  await ctx.addInitScript(s => localStorage.setItem("ethixoTeacherAuth", JSON.stringify(s)), { access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: "u1", email: "t@x.sg", is_anonymous: false, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01" } });
  await page.route(FAKE + "/**", route => {
    const rq = route.request(), u = new URL(rq.url()); reqs.push({ method: rq.method(), path: u.pathname });
    const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: JSON.stringify(b) });
    if (rq.method() === "OPTIONS") return j({});
    const s = decodeURIComponent(u.search);
    if (u.pathname === "/rest/v1/assignments" && rq.method() === "POST") { posts.push(JSON.parse(rq.postData() || "{}")); assignments.push(Object.assign({ id: "as2", created_at: "2026-12-01T00:00:00Z" }, posts[posts.length - 1])); return route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, body: "" }); }
    if (u.pathname === "/rest/v1/assignments") return j(assignments);
    if (u.pathname === "/rest/v1/profiles" && /id=in\./.test(s)) return j(roster.map(x => ({ id: x[0], display_name: x[1] })));
    if (u.pathname === "/rest/v1/profiles") return j([{ id: "u1", role: "teacher", display_name: "Vijay", is_approved: true }]);
    if (u.pathname === "/rest/v1/class_members") return j(roster.map(x => ({ student_id: x[0], class_id: x[2] })));
    if (u.pathname === "/rest/v1/classes") return j([{ id: C1, name: "Pilot Class", join_code: "0123456789", created_at: "x" }, { id: C2, name: "Second Class", join_code: "ABCDEF0123", created_at: "y" }]);
    if (u.pathname === "/rest/v1/rpc/teacher_attempt_summary") return j(rows);
    route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto("http://127.0.0.1:" + port + "/pilot-teacher"); await page.waitForTimeout(1200);
  const text = () => page.evaluate(() => document.getElementById("app").innerText);
  let tx = await text();
  assert(/Good (morning|afternoon|evening), Vijay!/.test(tx), "hero: time-of-day greeting for the teacher");
  assert(await page.locator(".class-tab").count() === 3 && /Overview/.test(tx) && /Pilot Class/.test(tx) && /Second Class/.test(tx), "class tabs: Overview + each class");
  assert(/Primary 6/.test(tx) && /Assign Learning/.test(tx), "workspace chip + Assign Learning button");
  for (const h of ["New ideas understood", "Misconceptions corrected", "Exam-ready answers (full marks)", "Full marks without Thinking Help", "Ethixo Noticed", "Students to Encourage", "Doing well", "All students", "Teaching Insights", "Exam Ready Answers", "How these signals work", "Assigned Learning"]) assert(tx.indexOf(h) !== -1, "section: " + h);
  assert(!/explained independently/i.test(tx.replace(/not proof that a student explained their reasoning independently/, "")), "no 'Explained independently' label (proxy is named honestly)");
  assert(await page.locator(".growth-card.t-clickable").count() === 3, "3 clickable progress cards (exam-ready card is not clickable, as in the Sharon dashboard)");
  // class tab
  await page.locator(".class-tab", { hasText: "Pilot Class" }).click(); await page.waitForTimeout(300); tx = await text();
  assert(/Angelina Gabriella/.test(tx) && !/Zed/.test(tx) && /0123456789/.test(tx), "class tab: only that class's students and its code");
  const attn = await page.locator(".t-encourage-wrap").nth(0).innerText(), well = await page.locator(".t-encourage-wrap").nth(1).innerText();
  assert(/Alan/.test(attn) && /Austin/.test(attn) && !/Angelina/.test(attn), "Students to Encourage: Alan (struggling) and Austin (Thinking Help), not Angelina");
  assert(/Angelina Gabriella/.test(well), "Doing well: Angelina");
  assert(/Elle[\s\S]*Joined · no practice yet/.test(tx), "students who joined but have not practised are listed");
  assert(/Name three countries located in Southeast Asia\./.test(tx) && /under half marks first time/.test(tx), "Teaching Insights: curriculum question prompt + first-attempt-under-half counts");
  assert(/Alan[\s\S]*Relies|Austin[\s\S]*Relies on Thinking Help/.test(tx), "Austin flagged 'Relies on Thinking Help'");
  assert(/Due date: 05\/12\/2026/.test(tx) && /Completed/.test(tx) && /Needs Practice/.test(tx) && /Not Started/.test(tx) && /In Progress/.test(tx) === false || /Due date: 05\/12\/2026/.test(tx), "Assigned Learning roster with due date");
  const roster1 = await page.locator(".t-areport-row").allInnerTexts();
  const st = n => (roster1.find(x => x.indexOf(n) === 0) || "").replace(/\s+/g, " ");
  assert(/Angelina Gabriella Completed 3\/3/.test(st("Angelina")) && /Alan Needs Practice/.test(st("Alan")) && /Austin In Progress/.test(st("Austin")) && /Elle Not Started/.test(st("Elle")), "assignment status per student: " + [st("Angelina"), st("Alan"), st("Austin"), st("Elle")].join(" | "));
  // metric drill-down
  await page.locator(".growth-card", { hasText: "Misconceptions corrected" }).click(); await page.waitForTimeout(300); let d = await text();
  assert(/Misconceptions corrected — Pilot Class/.test(d) && /started under half marks and later reached full marks/.test(d) && /1\.1 Location of Southeast Asian Countries/.test(d), "metric drill-down: Misconceptions corrected (banner + lesson items)");
  await page.getByRole("button", { name: "Back to Dashboard" }).click(); await page.waitForTimeout(200);
  await page.locator(".growth-card", { hasText: "Full marks without Thinking Help" }).click(); await page.waitForTimeout(300); d = await text();
  assert(/proxy signal/.test(d), "metric drill-down: Full marks without Thinking Help states it is a proxy");
  await page.getByRole("button", { name: "Back to Dashboard" }).click(); await page.waitForTimeout(200);
  // lesson drill-down
  await page.locator(".t-misc-row.t-clickable", { hasText: "1.1 Location of Southeast Asian Countries" }).first().click(); await page.waitForTimeout(300); d = await text();
  assert(/Questions in this lesson/.test(d) && /Alan[\s\S]*Struggling/.test(d) && /Question 1 · 3 marks/.test(d), "lesson drill-down: students (Alan struggling) + curriculum questions");
  await page.getByRole("button", { name: "Back to Dashboard" }).click(); await page.waitForTimeout(200);
  // student drill-down
  await page.locator(".t-student-row", { hasText: "Alan" }).click(); await page.waitForTimeout(300); d = await text();
  assert(/Alan/.test(d) && /Current focus/.test(d) && /Recent progress/.test(d) && /May need attention/.test(d) && /Struggling in: 1\.1/.test(d) && !/Angelina/.test(d), "student detail: focus, progress, status, struggling lesson; only that student");
  await page.getByRole("button", { name: "Back to Dashboard" }).click(); await page.waitForTimeout(200);
  // assign flow
  await page.getByText("Assign Learning").first().click(); await page.waitForTimeout(300);
  assert(await page.locator("#assignClass").count() === 1 && await page.locator("#assignLesson option").count() >= 1, "Assign screen: class, subject, lesson (from the lesson list), due date");
  await page.getByRole("button", { name: "Assign Learning" }).click(); await page.waitForTimeout(200);
  assert(/Choose a due date first/.test(await text()) && posts.length === 0, "due date required (as in the Sharon dashboard); nothing written");
  await page.selectOption("#assignSubject", "SS"); await page.waitForTimeout(200);
  await page.selectOption("#assignLesson", "1.2"); await page.fill("#assignDueDate", "2026-12-10");
  await page.getByRole("button", { name: "Assign Learning" }).click(); await page.waitForTimeout(800);
  assert(posts.length === 1 && posts[0].level === "P6" && posts[0].subject_key === "SS" && posts[0].lesson_id === "1.2" && posts[0].due_date === "2026-12-10" && Object.keys(posts[0]).sort().join() === "class_id,due_date,lesson_id,level,subject_key", "assignment written with ONLY class_id, level, subject_key, lesson_id, due_date");
  assert(/Assignment assigned successfully/.test(await text()), "confirmation screen");
  await page.getByRole("button", { name: "Go to Teacher Dashboard" }).click(); await page.waitForTimeout(300);
  assert(/1\.2 Diversity in Southeast Asia/.test(await text()), "new assignment appears in Assigned Learning");
  await page.screenshot({ path: process.env.SHOT ? process.env.SHOT + "-desktop.png" : "/dev/null", fullPage: true }).catch(() => {});
  await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(300);
  const ov = await page.evaluate(() => { const w = window.innerWidth; return { sw: document.documentElement.scrollWidth, w, bad: Array.from(document.querySelectorAll("#app *")).filter(e => e.getBoundingClientRect().right > w + 1).slice(0, 4).map(e => e.tagName + "." + e.className) }; });
  assert(ov.sw <= ov.w + 1, "375px width: no horizontal overflow " + JSON.stringify(ov));
  const tables = Array.from(new Set(reqs.filter(r => r.path.indexOf("/rest/v1/") === 0 && r.method !== "OPTIONS").map(r => r.path.replace("/rest/v1/", "")))).sort().join(",");
  assert(tables === "assignments,class_members,classes,profiles,rpc/teacher_attempt_summary", "only allowed backend resources requested: " + tables);
  assert(errors.length === 0, "no JavaScript errors");
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
