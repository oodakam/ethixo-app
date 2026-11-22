// Focused real-Chromium check: mandatory class join on the PILOT HOST only (fail-open).
// Stub Supabase library served locally; nothing leaves the machine. Uses a fake class code.
// Run: node tests/pilot-class-gate.test.js
const fs = require("fs"), path = require("path"), http = require("http");
let chromium; try { ({ chromium } = require("playwright")); } catch (_e) { ({ chromium } = require("playwright-core")); }
const { applyConfig } = require("../api/pilot-app.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pilotHtml = applyConfig(html, "app", { url: "https://fakefakefake.supabase.co", key: "sb_publishable_FAKEFAKEFAKEFAKE", host: "localhost", attempts: true, backfill: true, mode: "shadow" });
let passed = 0, failed = 0, libMode = "ok";
function assert(c, m) { if (c) { passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }
const CODE = "0123456789"; // fake 10-hex code; the stub accepts only this
const stub = () => `window.supabase={createClient:function(){var chain={select:function(){return chain},eq:function(){return chain},maybeSingle:function(){return Promise.resolve({data:{id:"u1",role:"student",level:"P6"},error:null})},update:function(){return chain},insert:function(){return chain},order:function(){return chain},limit:function(){return chain},then:function(f){return Promise.resolve({data:[],error:null}).then(f)}};
return{auth:{getSession:function(){return Promise.resolve({data:{session:null},error:null})},
signInAnonymously:function(){ if("${libMode}"==="fail") return Promise.resolve({data:null,error:{status:0,message:"Failed to fetch",name:"AuthRetryableFetchError"}}); return new Promise(function(r){setTimeout(function(){r({data:{session:{user:{id:"u1"}}},error:null})},200)})},
getUser:function(){return Promise.resolve({data:{user:{id:"u1"}}})},signOut:function(){return Promise.resolve({})}},
from:function(){return chain},rpc:function(n,a){ if(n==="join_class"){ return Promise.resolve(a.p_code==="${CODE}"?{data:[{class_name:"Pilot Class"}],error:null}:{data:null,error:{code:"P0002"}}) } return Promise.resolve({data:null,error:null}) }}}};`;
(async () => {
  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    if (p.indexOf("supabase-js") !== -1) { res.setHeader("content-type", "application/javascript"); return res.end(stub()); }
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (p === "/pilot") return res.end(pilotHtml);
    if (p === "/pilot-teacher") return res.end("<!doctype html><main>TEACHER-STUB</main>");
    if (p === "/plain") return res.end(html);
    res.statusCode = 404; res.end("nf");
  }).listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  async function open(pathname) {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.route(/supabase\.co/, r => r.abort());
    await page.goto(base + pathname, { waitUntil: "load" });
    await page.evaluate(() => localStorage.clear());
    await page.goto(base + pathname, { waitUntil: "load" });
    return { ctx, page };
  }
  const hash = p => new URL(p.url()).hash, txt = p => p.locator("body").innerText();
  async function toContinue(page) {
    await page.locator(".choice", { hasText: "Student" }).first().click(); await page.waitForTimeout(150);
    await page.locator(".choice", { hasText: "Primary 6" }).first().click(); await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Continue" }).click();
  }

  console.log("A/B/C/D/E. Pilot, auth healthy:");
  libMode = "ok";
  let { ctx, page } = await open("/pilot");
  await toContinue(page);
  await page.waitForFunction(() => ETHIXO_AUTH.status() === "profile-ok", null, { timeout: 5000 }); await page.waitForTimeout(400);
  assert(hash(page) === "#dashboard", "A: Continue lands on the Dashboard");
  assert(await page.locator("#classCodeCard").count() === 1 && /Join your class/.test(await txt(page)), "B: existing class-code card is shown");
  await page.evaluate(() => goto("subject")); await page.waitForTimeout(300);
  assert(await page.evaluate(() => state.view) === "dashboard" && await page.locator("#classCodeCard").count() === 1, "C: goto(subject) before joining -> Dashboard");
  await page.evaluate(() => goto("lessons", { subjectKey: "socialScience" })); await page.waitForTimeout(300);
  assert(await page.evaluate(() => state.view) === "dashboard", "C: goto(lessons) before joining -> Dashboard");
  await page.fill("#classNameInput", "Test Pupil"); await page.fill("#classCodeInput", "ffffffffff");
  await page.getByRole("button", { name: "Join" }).click(); await page.waitForTimeout(400);
  assert(await page.evaluate(() => state.view) === "dashboard" && /not found/i.test(await txt(page)), "D: wrong code -> error, still gated");
  await page.fill("#classCodeInput", CODE); await page.getByRole("button", { name: "Join" }).click(); await page.waitForTimeout(500);
  assert(/Class:\s*Pilot Class/.test(await txt(page)), "D: valid code joins (card shows Class ✓)");
  await page.evaluate(() => goto("subject")); await page.waitForTimeout(300);
  assert(await page.evaluate(() => state.view) === "subject", "E: after joining, Subject opens");
  const subj = await page.evaluate(() => Object.keys(SUBJECT_META)[0]);
  await page.evaluate(k => goto("lessons", { subjectKey: k }), subj); await page.waitForTimeout(400);
  assert(await page.evaluate(() => state.view) === "lessons", "E: Lessons opens");
  const lesson = await page.evaluate(() => { const b = document.querySelector("[onclick*=qbank]"); return b ? b.getAttribute("onclick") : null; });
  if (lesson) { await page.evaluate(l => { new Function(l)(); }, lesson); await page.waitForTimeout(600); }
  assert(!lesson || ["qbank","customQ","lessons"].indexOf(await page.evaluate(() => state.view)) !== -1, "E: practice entry not redirected to Dashboard" + (lesson ? "" : " (no lesson button found; Subject+Lessons verified)"));
  await ctx.close();

  console.log("F. Fail-open (sign-in unavailable):");
  libMode = "fail";
  ({ ctx, page } = await open("/pilot"));
  await toContinue(page);
  await page.waitForFunction(() => ETHIXO_AUTH.status() === "degraded", null, { timeout: 5000 });
  await page.evaluate(() => goto("subject")); await page.waitForTimeout(300);
  assert(await page.evaluate(() => state.view) === "subject", "F: auth degraded -> Subject opens without joining");
  await page.evaluate(() => goto("lessons", { subjectKey: Object.keys(SUBJECT_META)[0] })); await page.waitForTimeout(300);
  assert(await page.evaluate(() => state.view) === "lessons", "F: Lessons opens without joining");
  await ctx.close();
  libMode = "ok";

  console.log("G. Unconfigured host (main/demo):");
  ({ ctx, page } = await open("/plain"));
  await toContinue(page); await page.waitForTimeout(300);
  assert(hash(page) === "#subject", "G: Continue still goes to Subject");
  await page.evaluate(() => goto("lessons", { subjectKey: Object.keys(SUBJECT_META)[0] })); await page.waitForTimeout(300);
  assert(await page.evaluate(() => state.view) === "lessons" && await page.locator("#classCodeCard").count() === 0, "G: no gate, no class card");
  await ctx.close();

  console.log("H. Teacher route:");
  ({ ctx, page } = await open("/pilot"));
  await page.locator(".choice", { hasText: "Teacher" }).first().click(); await page.waitForTimeout(400);
  assert(new URL(page.url()).pathname === "/pilot-teacher", "H: Teacher card -> /pilot-teacher");
  await ctx.close();
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
