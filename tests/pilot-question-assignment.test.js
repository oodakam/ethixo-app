// B2 question-level assignment (pilot only): teacher picker + payload, status over assigned questions only, student "Assigned by Your Teacher" question rows.
//  1. Pure rules (assets/pilot-teacher-insights.js).  2. Teacher browser (mocked Supabase network).  3. Student browser (stub Supabase client, pilot host).
// Disposable fixture names only (Angelina, Alan, Austin + a 10-student class). Nothing leaves the machine; RLS itself is covered by tests/question-assignment-postgres.test.js.
// Run: node tests/pilot-question-assignment.test.js
const fs = require("fs"), path = require("path"), http = require("http");
let chromium; try { ({ chromium } = require("playwright")); } catch (_e) { ({ chromium } = require("playwright-core")); }
const root = path.join(__dirname, "..");
let passed = 0, failed = 0; const assert = (c, m) => { if (c) { passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } };
const P = require("../assets/pilot-teacher-insights.js");
const meta = JSON.parse(fs.readFileSync(path.join(root, "assets", "pilot-lesson-meta.json"), "utf8"));
const NOW = 1e12, DAY = 86400000;
const R = (cls, sid, name, lesson, q, first, best, cnt, think, at) => ({ class_id: cls, student_id: sid, display_name: name, level: "P6", subject_key: "SS", lesson_id: lesson, q_idx: q, attempt_count: cnt, latest_at: at, latest_score: best, best_score: best, used_thinking: think, first_score: first });
// SS 1.1 marks [3,1,5]
const rowsFx = [
  R("c", "a", "Angelina", "1.1", 0, 3, 3, 1, false, NOW), R("c", "a", "Angelina", "1.1", 1, 0, 1, 2, false, NOW), R("c", "a", "Angelina", "1.1", 2, 1, 5, 3, false, NOW),
  R("c", "b", "Alan", "1.1", 0, 0, 0, 2, false, NOW), R("c", "b", "Alan", "1.1", 1, 1, 1, 1, false, NOW), R("c", "b", "Alan", "1.1", 2, 0, 1, 3, false, NOW),
  R("c", "c", "Austin", "1.1", 0, 3, 3, 1, true, NOW), R("c", "c", "Austin", "1.1", 2, 2, 2, 1, true, NOW),
  R("c", "e", "Bella", "1.1", 1, 1, 1, 1, false, NOW)];                                   // Bella only did Q2 (not assigned below)
const members = ["a", "b", "c", "e", "f", "g", "h", "i", "j", "k"].map((id, i) => ({ student_id: id, class_id: "c", display_name: ["Angelina", "Alan", "Austin", "Bella", "Chen", "Dev", "Elle", "Farid", "Gina", "Hui"][i] }));
const asg = (qi, extra) => Object.assign({ id: "x", class_id: "c", level: "P6", subject_key: "SS", lesson_id: "1.1", due_date: "2026-12-05", question_indexes: qi }, extra || {});
const run = list => P.compute(rowsFx, members, meta, NOW, { classId: "c", assignments: list }).assignments;
const st = (a, n) => a.rows.find(r => r.name === n);

console.log("1. Rules over the assigned questions only");
let [q02] = run([asg([0, 2])]);
assert(q02.questionIndexes.join() === "0,2" && q02.rows.length === 10, "assignment carries its question indexes; roster has all 10 students");
assert(st(q02, "Angelina").status === "Completed" && st(q02, "Angelina").done === 2 && st(q02, "Angelina").total === 2, "Angelina: both assigned questions at full marks => Completed 2/2");
assert(st(q02, "Alan").status === "Needs Practice" && st(q02, "Alan").done === 0 && st(q02, "Alan").attempted === 2, "Alan: 2 attempted, average under 40% => Needs Practice 0/2");
assert(st(q02, "Austin").status === "In Progress" && st(q02, "Austin").done === 1, "Austin: Q1 full, Q3 not => In Progress 1/2");
assert(st(q02, "Bella").status === "Not Started" && st(q02, "Bella").total === 2, "Bella only practised an UNASSIGNED question => Not Started (progress counts assigned questions only)");
assert(st(q02, "Hui").status === "Not Started", "10-student class: a student with no activity is Not Started");
const [whole] = run([asg(null)]);
assert(whole.questionIndexes === null && st(whole, "Angelina").total === 3 && st(whole, "Angelina").status === "Completed" && st(whole, "Alan").status === "Needs Practice" && st(whole, "Bella").status === "In Progress", "NULL = whole lesson: original behaviour unchanged (3 questions; any attempt on any question counts)");
const [legacy] = run([(() => { const a = asg(); delete a.question_indexes; return a; })()]);
assert(legacy.questionIndexes === null && st(legacy, "Angelina").total === 3, "an old row without the column behaves as whole lesson");
const [messy] = run([asg([2, 0, 0, 99, -1, 1.5, "x"])]);
assert(messy.questionIndexes.join() === "0,2" && st(messy, "Angelina").total === 2, "invalid / duplicate indexes are ignored, never widened to the whole lesson");
const [none] = run([asg([99])]);
assert(none.questionIndexes.length === 0 && st(none, "Angelina").total === 0 && st(none, "Angelina").status === "Not Started", "no valid index => nothing assigned (not the whole lesson)");

const FAKE = "https://fakeref.supabase.co", KEY = "sb_publishable_TESTONLY";
(async () => {
  const mod = await import(path.join(root, "api", "pilot-app.js")); const handler = mod.default;
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  let studentAssign = [], studentMode = "ok";
  const CODE = "0123456789";
  const stub = () => `window.__tables=window.__tables||[];window.supabase={createClient:function(){var tbl=null,cols="";var chain={select:function(c){cols=c||"";return chain},eq:function(){return chain},maybeSingle:function(){return Promise.resolve({data:null,error:null})},update:function(){return chain},insert:function(){return chain},order:function(){return chain},limit:function(){return chain},
then:function(f){ if(tbl==="assignments"){ if("${studentMode}"==="nocol" && /question_indexes/.test(cols)) return Promise.resolve({data:null,error:{code:"42703"}}).then(f); return Promise.resolve({data:${JSON.stringify(studentAssign)},error:null}).then(f);} return Promise.resolve({data:[],error:null}).then(f)}};
return{auth:{getSession:function(){return Promise.resolve({data:{session:null},error:null})},signInAnonymously:function(){return Promise.resolve({data:{session:{user:{id:"u1"}}},error:null})},getUser:function(){return Promise.resolve({data:{user:{id:"u1"}}})},signOut:function(){return Promise.resolve({})}},
from:function(t){tbl=t;window.__tables.push(t);return chain},rpc:function(n,a){ if(n==="join_class"){ return Promise.resolve(a.p_code==="${CODE}"?{data:[{class_name:"Pilot Class"}],error:null}:{data:null,error:{code:"P0002"}}) } return Promise.resolve({data:null,error:null}) }}}};`;
  const { applyConfig } = require("../api/pilot-app.js");
  const pilotHtml = applyConfig(html, "app", { url: "https://fakefakefake.supabase.co", key: "sb_publishable_FAKEFAKEFAKEFAKE", host: "localhost", attempts: true, backfill: true, mode: "shadow" });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.indexOf("supabase-js") !== -1 && /^localhost/.test(req.headers.host || "")) {   // the stub is for the student page (host "localhost"); the teacher page (127.0.0.1) keeps the real library
      res.setHeader("content-type", "application/javascript"); return res.end(stub()); }
    if (u.pathname === "/pilot") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(pilotHtml); }
    if (u.pathname === "/pilot-teacher") {
      const old = process.env; process.env = Object.assign({}, old, { VERCEL_ENV: "preview", ETHIXO_PILOT_HOSTS: "127.0.0.1", ETHIXO_PILOT_SUPABASE_URL: FAKE, ETHIXO_PILOT_SUPABASE_PUBLISHABLE_KEY: KEY });
      const out = { setHeader() {}, status(c) { res.statusCode = c; return out; }, send(b) { res.setHeader("content-type", "text/html"); res.end(b); }, json() { res.end("{}"); } };
      try { handler({ headers: { host: req.headers.host }, query: { page: "teacher" } }, out); } finally { process.env = old; } return;
    }
    const f = path.join(root, u.pathname);
    if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) { const e = path.extname(f); res.setHeader("content-type", e === ".js" ? "application/javascript" : e === ".json" ? "application/json" : e === ".html" ? "text/html" : e === ".webp" ? "image/webp" : "text/plain"); return res.end(fs.readFileSync(f)); }
    res.statusCode = 404; res.end("nf");
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); const port = server.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {});

  console.log("2. Teacher: question picker and payload");
  const C1 = "c1"; const posts = [], reqs = [], errors = [];
  const assignments = [];
  const roster = members.map(m => [m.student_id, m.display_name, C1]);
  const rows2 = rowsFx.map(r => Object.assign({}, r, { class_id: C1, latest_at: Date.now() }));
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } }); const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  await ctx.addInitScript(s => localStorage.setItem("ethixoTeacherAuth", JSON.stringify(s)), { access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: "u1", email: "t@x.sg", is_anonymous: false, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "x" } });
  await page.route(FAKE + "/**", route => {
    const rq = route.request(), u = new URL(rq.url()); reqs.push({ method: rq.method(), path: u.pathname });
    const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: JSON.stringify(b) });
    if (rq.method() === "OPTIONS") return j({});
    const s = decodeURIComponent(u.search);
    if (u.pathname === "/rest/v1/assignments" && rq.method() === "POST") { const body = JSON.parse(rq.postData() || "{}"); posts.push(body); assignments.push(Object.assign({ id: "n" + posts.length, created_at: "2026-12-01T00:00:0" + posts.length + "Z" }, body)); return route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, body: "" }); }
    if (u.pathname === "/rest/v1/assignments") return j(assignments);
    if (u.pathname === "/rest/v1/profiles" && /id=in\./.test(s)) return j(roster.map(x => ({ id: x[0], display_name: x[1] })));
    if (u.pathname === "/rest/v1/profiles") return j([{ id: "u1", role: "teacher", display_name: "Vijay", is_approved: true }]);
    if (u.pathname === "/rest/v1/class_members") return j(roster.map(x => ({ student_id: x[0], class_id: x[2] })));
    if (u.pathname === "/rest/v1/classes") return j([{ id: C1, name: "Pilot Class", join_code: "0123456789", created_at: "x" }]);
    if (u.pathname === "/rest/v1/rpc/teacher_attempt_summary") return j(rows2);
    route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto("http://127.0.0.1:" + port + "/pilot-teacher"); await page.waitForTimeout(1200);
  const text = () => page.evaluate(() => document.getElementById("app").innerText);
  await page.getByText("Assign Learning").first().click(); await page.waitForTimeout(300);
  let tx = await text();
  assert(/Whole lesson/.test(tx) && /Choose specific questions/.test(tx) && await page.locator("#assignQList").count() === 0, "Assign screen: 'Whole lesson' is the default scope; no question list until the teacher asks for it");
  await page.selectOption("#assignSubject", "SS"); await page.waitForTimeout(200); await page.selectOption("#assignLesson", "1.1"); await page.waitForTimeout(200);
  await page.fill("#assignDueDate", "2026-12-10");
  await page.locator("input[name=assignScope][value=questions]").check(); await page.waitForTimeout(300);
  tx = await text();
  const prompts = meta.P6.SS.lessons["1.1"].prompts, marks = meta.P6.SS.lessons["1.1"].marks;
  assert(await page.locator("#assignQList input[type=checkbox]").count() === marks.length && prompts.every(p => tx.indexOf(p) !== -1), "picker lists every curriculum question of the lesson, with its text (from the curriculum, not from student data)");
  assert(await page.inputValue("#assignDueDate") === "2026-12-10" && await page.inputValue("#assignLesson") === "1.1", "choosing 'specific questions' keeps the lesson and due date");
  await page.getByRole("button", { name: "Assign Learning" }).click(); await page.waitForTimeout(250);
  assert(/Choose at least one question/.test(await text()) && posts.length === 0, "scope 'specific questions' with nothing ticked: blocked, nothing written");
  await page.locator("#assignQList input[value='2']").check(); await page.locator("#assignQList input[value='0']").check(); await page.waitForTimeout(150);
  assert(/2 selected/.test(await text()), "live count of selected questions");
  await page.evaluate(() => { assignLearning(); assignLearning(); }); await page.waitForTimeout(900);   // double submit must create ONE row (the table is append-only)
  assert(posts.length === 1, "double submit creates exactly one assignment row");
  const p0 = posts[0];
  assert(Object.keys(p0).sort().join() === "class_id,due_date,lesson_id,level,question_indexes,subject_key" && JSON.stringify(p0.question_indexes) === "[0,2]" && p0.lesson_id === "1.1" && p0.level === "P6", "payload = class_id, level, subject_key, lesson_id, due_date, question_indexes [0,2] (sorted) — identifiers only");
  assert(!prompts.some(pr => JSON.stringify(p0).indexOf(pr.slice(0, 20)) !== -1), "payload contains no question text");
  tx = await text();
  assert(/Assignment assigned successfully/.test(tx) && /Questions 1, 3/.test(tx) && /Pilot Class will see/.test(tx), "confirmation names the class, lesson and questions (Questions 1, 3)");
  await page.getByRole("button", { name: "Go to Teacher Dashboard" }).click(); await page.waitForTimeout(400);
  tx = await text();
  assert(/Assigned Learning/.test(tx) && /Questions 1, 3/.test(tx) && /Due date: 10\/12\/2026/.test(tx), "Assigned Learning shows 'Questions 1, 3' and the due date");
  const stat = n => (tx.match(new RegExp(n + "\\s+(Not Started|In Progress|Needs Practice|Completed)(?:\\s+(\\d+/\\d+))?")) || []).slice(1).filter(Boolean).join(" ");
  assert(stat("Angelina") === "Completed 2/2" && stat("Alan") === "Needs Practice 0/2" && stat("Austin") === "In Progress 1/2" && stat("Bella") === "Not Started" && stat("Hui") === "Not Started", "teacher sees per-student progress over the assigned questions: " + ["Angelina", "Alan", "Austin", "Bella", "Hui"].map(stat).join(" | "));
  // second assignment: whole lesson keeps the ORIGINAL payload (no question_indexes key)
  await page.getByText("Assign Learning").first().click(); await page.waitForTimeout(300);
  assert(await page.locator("input[name=assignScope][value=lesson]").isChecked() && await page.locator("#assignQList").count() === 0, "'Assign Another' starts clean: whole lesson, no stale selection");
  await page.selectOption("#assignSubject", "SS"); await page.waitForTimeout(150); await page.selectOption("#assignLesson", "1.2"); await page.fill("#assignDueDate", "2026-12-11");
  await page.getByRole("button", { name: "Assign Learning" }).click(); await page.waitForTimeout(800);
  assert(posts.length === 2 && Object.keys(posts[1]).sort().join() === "class_id,due_date,lesson_id,level,subject_key" && posts[1].lesson_id === "1.2", "whole-lesson assignment still sends the original 5-field payload (question_indexes omitted => NULL)");
  await page.getByRole("button", { name: "Go to Teacher Dashboard" }).click(); await page.waitForTimeout(300);
  // switching lesson clears a previous selection
  await page.getByText("Assign Learning").first().click(); await page.waitForTimeout(300);
  await page.selectOption("#assignSubject", "SS"); await page.waitForTimeout(150); await page.selectOption("#assignLesson", "1.1"); await page.waitForTimeout(150);
  await page.locator("input[name=assignScope][value=questions]").check(); await page.waitForTimeout(250); await page.locator("#assignQList input[value='1']").check();
  await page.selectOption("#assignLesson", "1.2"); await page.waitForTimeout(250);
  assert(await page.locator("#assignQList input:checked").count() === 0, "changing the lesson clears the ticked questions (indexes belong to one lesson)");
  await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(300);
  const ov = await page.evaluate(() => { const w = window.innerWidth; return { sw: document.documentElement.scrollWidth, w, bad: Array.from(document.querySelectorAll("#app *")).filter(e => e.getBoundingClientRect().right > w + 1).slice(0, 4).map(e => e.tagName + "." + e.className) }; });
  assert(ov.sw <= ov.w + 1, "375px width: picker screen has no horizontal overflow " + JSON.stringify(ov));
  const tables = Array.from(new Set(reqs.filter(r => r.path.indexOf("/rest/v1/") === 0 && r.method !== "OPTIONS").map(r => r.path.replace("/rest/v1/", "")))).sort().join(",");
  assert(tables === "assignments,class_members,classes,profiles,rpc/teacher_attempt_summary", "only allowed backend resources requested (never attempts / vault_entries / student_state): " + tables);
  assert(errors.length === 0, "no JavaScript errors (teacher)");
  await ctx.close();

  console.log("3. Student: assigned questions on the pilot host");
  const ss = JSON.parse(fs.readFileSync(path.join(root, "assets", "pilot-lesson-meta.json"), "utf8"));
  studentAssign = [
    { id: "q1", class_id: "c1", level: "P6", subject_key: "SS", lesson_id: "1.1", due_date: "2026-12-05", created_at: "2026-11-30T00:00:00Z", question_indexes: [2, 0, 0, 99] },
    { id: "w1", class_id: "c1", level: "P6", subject_key: "SS", lesson_id: "1.2", due_date: "2026-12-06", created_at: "2026-11-30T00:00:01Z", question_indexes: null },
    { id: "bad", class_id: "c1", level: "P6", subject_key: "SS", lesson_id: "1.1", due_date: "2026-12-07", created_at: "2026-11-30T00:00:02Z", question_indexes: [99] }];
  async function openStudent(mode) {
    studentMode = mode || "ok";
    const c = await browser.newContext({ viewport: { width: 1000, height: 900 } }); const p = await c.newPage(); const errs = []; p.on("pageerror", e => errs.push(String(e)));
    await p.route(/supabase\.co/, r => r.abort());
    await p.goto("http://localhost:" + port + "/pilot", { waitUntil: "load" }); await p.evaluate(() => localStorage.clear()); await p.goto("http://localhost:" + port + "/pilot", { waitUntil: "load" });
    await p.fill("#classNameInput", "Test Pupil"); await p.fill("#classCodeInput", CODE); await p.getByRole("button", { name: "Join" }).click(); await p.waitForTimeout(600);
    await p.evaluate(() => goto("dashboard")); await p.waitForTimeout(900);
    return { c, p, errs };
  }
  let { c, p, errs } = await openStudent("ok");
  let body = await p.locator("body").innerText();
  const lessonQs = await p.evaluate(() => { let L = null; LEVELS.P6.SS.chapters.forEach(ch => ch.lessons.forEach(l => { if (l.id === "1.1") L = l; })); return L.questions.map(q => ({ t: q.t, m: q.m })); });
  assert(await p.locator(".t-acard").count() === 2, "2 cards: the question-level one and the whole-lesson one; an assignment whose indexes are all invalid is hidden (not widened)");
  assert(/2 questions assigned/.test(body) && await p.locator(".t-aq-row").count() === 2, "question-level card lists exactly the 2 valid assigned questions (duplicates / out-of-range ignored)");
  assert(/Q1/.test(body) && /Q3/.test(body) && !/Q2/.test(body), "rows are Q1 and Q3 (the assigned ones), not Q2");
  const t0 = lessonQs[0].t.replace(/<[^>]*>/g, ""), t2 = lessonQs[2].t.replace(/<[^>]*>/g, ""), t1 = lessonQs[1].t.replace(/<[^>]*>/g, "");
  assert(body.indexOf(t0.slice(0, 30)) !== -1 && body.indexOf(t2.slice(0, 30)) !== -1 && body.indexOf(t1.slice(0, 30)) === -1, "row text comes from the curriculum question bank; the unassigned question's text is not shown");
  assert(await p.locator(".t-acard", { hasText: "1.2" }).locator(".t-aq-row").count() === 0 && await p.locator(".t-acard", { hasText: "1.2" }).getByRole("button", { name: /Start Practising/ }).count() === 1, "whole-lesson card unchanged: single 'Start Practising' button, no question rows");
  await p.locator(".t-aq-row", { hasText: "Q3" }).getByRole("button").click(); await p.waitForTimeout(500);
  const cur = await p.evaluate(() => ({ view: state.view, id: state.currentQuestion && state.currentQuestion.id, lesson: state.currentQuestion && state.currentQuestion.lessonId, subj: state.currentQuestion && state.currentQuestion.subjectKey, level: state.currentQuestion && state.currentQuestion.level, t: state.currentQuestion && state.currentQuestion.t, m: state.currentQuestion && state.currentQuestion.m }));
  assert(cur.view === "answer" && cur.id === "2" && cur.lesson === "1.1" && cur.subj === "SS" && cur.level === "P6" && cur.t === lessonQs[2].t && cur.m === lessonQs[2].m, "opening Q3 starts the normal learning flow on the correct curriculum item (P6 · SS · 1.1 · question index 2)");
  assert(/Back to Questions|Question/i.test(await p.locator("body").innerText()), "the normal answer screen is shown");
  // progress: attempts live in localStorage (source of truth). Q1 full marks => In Progress 1/2 ; then Q3 full => Completed.
  await p.evaluate(m => { localStorage.setItem("attempts:P6:SS:1.1:0", JSON.stringify([{ score: m, at: Date.now() }])); goto("dashboard"); }, lessonQs[0].m); await p.waitForTimeout(500);
  let card = p.locator(".t-acard", { hasText: "2 questions assigned" });
  assert(/In Progress/.test(await card.innerText()) && /Full marks/.test(await card.locator(".t-aq-row", { hasText: "Q1" }).innerText()) && /Not started/.test(await card.locator(".t-aq-row", { hasText: "Q3" }).innerText()), "after full marks on Q1: card In Progress, Q1 'Full marks', Q3 'Not started'");
  await p.evaluate(m => { localStorage.setItem("attempts:P6:SS:1.1:1", JSON.stringify([{ score: 0, at: Date.now() }])); localStorage.setItem("attempts:P6:SS:1.1:2", JSON.stringify([{ score: m, at: Date.now() }])); goto("dashboard"); }, lessonQs[2].m); await p.waitForTimeout(500);
  card = p.locator(".t-acard", { hasText: "2 questions assigned" });
  assert(/Completed/.test(await card.innerText()), "every ASSIGNED question at full marks => Completed (an unassigned question scored 0 does not block it)");
  await p.setViewportSize({ width: 375, height: 800 }); await p.evaluate(() => goto("dashboard")); await p.waitForTimeout(400);
  const sov = await p.evaluate(() => { const w = window.innerWidth; return { sw: document.documentElement.scrollWidth, w, bad: Array.from(document.querySelectorAll(".t-acard *")).filter(e => e.getBoundingClientRect().right > w + 1).slice(0, 4).map(e => e.tagName + "." + e.className) }; });
  assert(sov.sw <= sov.w + 1 && sov.bad.length === 0, "375px width: student assigned-question rows have no horizontal overflow " + JSON.stringify(sov));
  assert(errs.length === 0, "no JavaScript errors (student)"); await c.close();

  console.log("3b. Student: fail-open if the column is unavailable");
  ({ c, p, errs } = await openStudent("nocol"));
  assert(await p.locator(".t-acard").count() >= 1 && await p.evaluate(() => state.view) === "dashboard", "without question_indexes the app falls back to lesson-level cards and keeps working");
  await c.close();

  console.log("3c. Demo host untouched");
  const plain = await browser.newContext(); const pp = await plain.newPage();
  await pp.route(/supabase\.co/, r => r.abort());
  await pp.goto("http://localhost:" + port + "/index.html", { waitUntil: "load" }); await pp.evaluate(() => localStorage.clear()); await pp.goto("http://localhost:" + port + "/index.html", { waitUntil: "load" });
  await pp.waitForTimeout(600);
  assert(await pp.evaluate(() => typeof isPilotHost === "function" && !isPilotHost() && getTeacherAssignments().length === 0), "demo/normal host: not a pilot host, no pilot assignments");
  await plain.close();

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
