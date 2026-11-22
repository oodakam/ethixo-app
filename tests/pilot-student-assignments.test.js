// Focused real-Chromium check: pilot-host-only "Assigned by Your Teacher" cards on the student dashboard (reads public.assignments via the student's RLS).
// Stub Supabase library served locally; nothing leaves the machine. (Cross-class isolation is enforced by the database RLS policy assignments_select_student,
// covered by the existing security suite; here we check the UI reads only what the server returns and never shows demo/local assignments on the pilot host.)
// Run: node tests/pilot-student-assignments.test.js
const fs = require("fs"), path = require("path"), http = require("http");
let chromium; try { ({ chromium } = require("playwright")); } catch (_e) { ({ chromium } = require("playwright-core")); }
const { applyConfig } = require("../api/pilot-app.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pilotHtml = applyConfig(html, "app", { url: "https://fakefakefake.supabase.co", key: "sb_publishable_FAKEFAKEFAKEFAKE", host: "localhost", attempts: true, backfill: true, mode: "shadow" });
let passed = 0, failed = 0, assignMode = "ok";
function assert(c, m) { if (c) { passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }
const CODE = "0123456789";
const stub = () => `window.__tables=window.__tables||[];window.supabase={createClient:function(){var tbl=null;var chain={select:function(){return chain},eq:function(){return chain},maybeSingle:function(){return Promise.resolve({data:null,error:null})},update:function(){return chain},insert:function(){return chain},order:function(){return chain},limit:function(){return chain},
then:function(f){ if(tbl==="assignments"){ if("${assignMode}"==="error") return Promise.resolve({data:null,error:{code:"42501"}}).then(f); return Promise.resolve({data:[{id:"as1",class_id:"c1",level:"P6",subject_key:"SS",lesson_id:"1.1",due_date:"2026-12-05",created_at:"2026-11-30T00:00:00Z"},{id:"bad",class_id:"c1",level:"P6",subject_key:"SS",lesson_id:"no-such",due_date:null,created_at:"2026-11-30T00:00:00Z"}],error:null}).then(f);} return Promise.resolve({data:[],error:null}).then(f)}};
return{auth:{getSession:function(){return Promise.resolve({data:{session:null},error:null})},signInAnonymously:function(){return Promise.resolve({data:{session:{user:{id:"u1"}}},error:null})},getUser:function(){return Promise.resolve({data:{user:{id:"u1"}}})},signOut:function(){return Promise.resolve({})}},
from:function(t){tbl=t;window.__tables.push(t);return chain},rpc:function(n,a){ if(n==="join_class"){ return Promise.resolve(a.p_code==="${CODE}"?{data:[{class_name:"Pilot Class"}],error:null}:{data:null,error:{code:"P0002"}}) } return Promise.resolve({data:null,error:null}) }}}};`;
(async () => {
  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    if (p.indexOf("supabase-js") !== -1) { res.setHeader("content-type", "application/javascript"); return res.end(stub()); }
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (p === "/pilot") return res.end(pilotHtml);
    if (p === "/plain") return res.end(html);
    res.statusCode = 404; res.end("nf");
  }).listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  async function open(pathname) {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.route(/supabase\.co/, r => r.abort());
    await page.goto(base + pathname, { waitUntil: "load" }); await page.evaluate(() => localStorage.clear());
    await page.goto(base + pathname, { waitUntil: "load" });
    return { ctx, page };
  }
  const txt = p => p.locator("body").innerText();

  console.log("Pilot host, joined student:");
  assignMode = "ok";
  let { ctx, page } = await open("/pilot");
  await page.fill("#classNameInput", "Test Pupil"); await page.fill("#classCodeInput", CODE);
  await page.getByRole("button", { name: "Join" }).click(); await page.waitForTimeout(600);
  await page.evaluate(() => goto("dashboard")); await page.waitForTimeout(900);
  let body = await txt(page);
  assert(/Assigned by Your Teacher/i.test(body) && /Social Science · 1\.1 Location of Southeast Asian Countries/.test(body), "Assigned by Your Teacher card shows the real assigned lesson");
  assert(/Due date: 05\/12\/2026/.test(body) && /Not Started/.test(body), "due date and real (local) status shown");
  assert(await page.locator(".t-acard").count() === 1, "an assignment for an unknown lesson is ignored (1 card, not 2)");
  const tables = await page.evaluate(() => Array.from(new Set(window.__tables)).sort().join(","));
  assert(/(^|,)assignments(,|$)/.test(tables), "assignments read through the student's own client (tables touched: " + tables + ")");
  await page.locator(".t-acard button").click(); await page.waitForTimeout(400);
  assert(await page.evaluate(() => state.view) === "qbank", "card opens the existing lesson/practice flow (not blocked: student has joined)");
  await ctx.close();

  console.log("Pilot host, assignments unavailable (fail-open):");
  assignMode = "error";
  ({ ctx, page } = await open("/pilot"));
  await page.fill("#classNameInput", "Test Pupil"); await page.fill("#classCodeInput", CODE);
  await page.getByRole("button", { name: "Join" }).click(); await page.waitForTimeout(600);
  await page.evaluate(() => goto("dashboard")); await page.waitForTimeout(900);
  assert(!/Assigned by Your Teacher/i.test(await txt(page)) && await page.evaluate(() => state.view) === "dashboard", "no cards, dashboard still works");
  await ctx.close(); assignMode = "ok";

  console.log("Pilot host ignores local/demo assignments:");
  ({ ctx, page } = await open("/pilot"));
  await page.evaluate(() => localStorage.setItem("teacherAssignments", JSON.stringify([{ id: "a1", classId: "p6a", level: "P6", subjectKey: "SS", lessonId: "1.1", lessonTitle: "DEMO-LOCAL", dueDate: "2026-12-01", assignedAt: 1 }])));
  await page.fill("#classNameInput", "Test Pupil"); await page.fill("#classCodeInput", CODE);
  await page.getByRole("button", { name: "Join" }).click(); await page.waitForTimeout(600);
  await page.evaluate(() => goto("dashboard")); await page.waitForTimeout(900);
  assert(!/DEMO-LOCAL/.test(await txt(page)), "demo/local assignment never shown on the pilot host");
  await ctx.close();

  console.log("Normal/demo host unchanged:");
  ({ ctx, page } = await open("/plain"));
  await page.evaluate(() => localStorage.setItem("teacherAssignments", JSON.stringify([{ id: "a1", classId: "p6a", level: "P6", subjectKey: "SS", lessonId: "1.1", lessonTitle: "1.1 Location of Southeast Asian Countries", dueDate: "2026-12-01", assignedAt: 1 }])));
  await page.evaluate(() => { localStorage.setItem("activePersona", JSON.stringify("student")); localStorage.setItem("chosenLevel", JSON.stringify("P6")); });
  await page.goto(base + "/plain", { waitUntil: "load" }); await page.waitForTimeout(500);
  assert(/Assigned by Your Teacher/i.test(await txt(page)) && /Due date: 01\/12\/2026/.test(await txt(page)), "demo host still shows the local demo assignment exactly as before");
  assert(await page.evaluate(() => (window.__tables || []).length) === 0, "demo host: no backend table is ever touched");
  await ctx.close();
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
