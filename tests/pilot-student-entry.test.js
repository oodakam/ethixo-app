// Focused real-Chromium check: pilot student entry = Name + Class Code -> join_class -> Subject (pilot host only).
// Stub Supabase library served locally; nothing leaves the machine. Fake class code only.
// Run: node tests/pilot-student-entry.test.js
const fs = require("fs"), path = require("path"), http = require("http");
let chromium; try { ({ chromium } = require("playwright")); } catch (_e) { ({ chromium } = require("playwright-core")); }
const { applyConfig } = require("../api/pilot-app.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pilotHtml = applyConfig(html, "app", { url: "https://fakefakefake.supabase.co", key: "sb_publishable_FAKEFAKEFAKEFAKE", host: "localhost", attempts: true, backfill: true, mode: "shadow" });
let passed = 0, failed = 0, libMode = "ok"; const calls = [];
function assert(c, m) { if (c) { passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }
const CODE = "0123456789";
const stub = () => `window.supabase={createClient:function(){var T=null;var chain={select:function(){return chain},eq:function(){return chain},maybeSingle:function(){return Promise.resolve({data:null,error:null})},update:function(v){window.__calls.push("update:"+JSON.stringify(v));return chain},insert:function(){return chain},order:function(){return chain},limit:function(){return chain},then:function(f){return Promise.resolve({data:[],error:null}).then(f)}};
window.__calls=window.__calls||[];
return{auth:{getSession:function(){return Promise.resolve({data:{session:null},error:null})},
signInAnonymously:function(){ if("${libMode}"==="fail") return Promise.resolve({data:null,error:{status:0,message:"Failed to fetch",name:"AuthRetryableFetchError"}}); return Promise.resolve({data:{session:{user:{id:"u1"}}},error:null})},
getUser:function(){return Promise.resolve({data:{user:{id:"u1"}}})},signOut:function(){return Promise.resolve({})}},
from:function(){return chain},rpc:function(n,a){ window.__calls.push("rpc:"+n+(a&&a.p_level?":"+a.p_level:"")); if(n==="join_class"){ return Promise.resolve(a.p_code==="${CODE}"?{data:[{class_name:"Pilot Class"}],error:null}:{data:null,error:{code:"P0002"}}) } return Promise.resolve({data:null,error:null}) }}}};`;
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
  const view = p => p.evaluate(() => state.view), txt = p => p.locator("body").innerText();
  async function join(page, name, code) {
    await page.fill("#classNameInput", name); await page.fill("#classCodeInput", code);
    await page.getByRole("button", { name: "Join" }).click(); await page.waitForTimeout(600);
  }

  console.log("A. Fresh pilot entry:");
  libMode = "ok";
  let { ctx, page } = await open("/pilot");
  let body = await txt(page);
  assert(await page.locator("#classNameInput").count() === 1 && await page.locator("#classCodeInput").count() === 1, "Name + Class Code inputs shown");
  assert(!/Primary 5|Primary 6|Select your level|Continue/.test(body), "no P5/P6 selection");
  assert(!/Wenbo|Sharon|Social Science|later phase|Explore Ethixo as/.test(body), "no demo personas / role-chooser text");
  assert(await page.locator(".choice").count() === 0, "no Student/Teacher role cards");

  console.log("C. Invalid class code:");
  await join(page, "Test Pupil", "ffffffffff");
  assert(await view(page) === "entry" && /not found/i.test(await txt(page)), "error shown, stays on entry");
  assert(await page.evaluate(() => localStorage.getItem("ethixoClassJoined")) === null, "no join recorded");
  await page.evaluate(() => goto("subject")); await page.waitForTimeout(300);
  assert(await view(page) === "entry", "no Subject access (goto redirected to entry)");
  await page.fill("#classCodeInput", "abc"); await page.getByRole("button", { name: "Join" }).click(); await page.waitForTimeout(200);
  assert(await view(page) === "entry" && /10 letters and numbers/.test(await txt(page)), "malformed code rejected locally");

  console.log("B/D. Valid class code:");
  await join(page, "Test Pupil", CODE);
  assert(await view(page) === "subject", "lands directly on Subject");
  const c = await page.evaluate(() => window.__calls);
  assert(c.indexOf("rpc:create_my_profile:P6") !== -1, "profile created as P6 (never asked)");
  assert(c.some(x => x.indexOf('update:{"display_name":"Test Pupil"}') === 0), "display_name set from the typed name");
  assert(c.indexOf("rpc:join_class") !== -1, "join_class RPC called");
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem("chosenLevel"))) === "P6", "chosenLevel = P6");
  assert(/Pilot Class/.test(await page.evaluate(() => localStorage.getItem("ethixoClassJoined"))), "join recorded only after RPC success");

  console.log("G. Learning flow after join:");
  const subj = await page.evaluate(() => Object.keys(SUBJECT_META)[0]);
  await page.evaluate(k => goto("lessons", { subjectKey: k }), subj); await page.waitForTimeout(400);
  assert(await view(page) === "lessons", "Lessons opens");
  const lesson = await page.evaluate(() => { const b = document.querySelector("[onclick*=qbank]"); return b ? b.getAttribute("onclick") : null; });
  if (lesson) { await page.evaluate(l => { new Function(l)(); }, lesson); await page.waitForTimeout(600); }
  assert(!lesson || ["qbank","customQ"].indexOf(await view(page)) !== -1, "Practice opens" + (lesson ? "" : " (no lesson button; Lessons verified)"));
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(500);
  assert(await view(page) === "dashboard", "returning joined student opens the Dashboard as before");
  await ctx.close();

  console.log("Auth unavailable at entry (never marks joined):");
  libMode = "fail";
  ({ ctx, page } = await open("/pilot"));
  await join(page, "Test Pupil", CODE);
  assert(await view(page) === "entry" && /connect/i.test(await txt(page)), "stays on entry with a retry message");
  assert(await page.evaluate(() => localStorage.getItem("ethixoClassJoined")) === null, "no join recorded");
  await ctx.close(); libMode = "ok";

  console.log("E. Teacher link:");
  ({ ctx, page } = await open("/pilot"));
  await page.locator("a", { hasText: "Teacher sign in" }).click(); await page.waitForTimeout(400);
  assert(new URL(page.url()).pathname === "/pilot-teacher", "Teacher sign in -> /pilot-teacher");
  await ctx.close();

  console.log("F. Normal/demo host:");
  ({ ctx, page } = await open("/plain"));
  body = await txt(page);
  assert(/Wenbo Lee · Primary 6/.test(body) && /Sharon Lim · Social Science/.test(body) && /later phase/.test(body) && await page.locator("#classNameInput").count() === 0, "entry view unchanged");
  await page.locator(".choice", { hasText: "Student" }).first().click(); await page.waitForTimeout(200);
  await page.locator(".choice", { hasText: "Primary 6" }).first().click();
  await page.getByRole("button", { name: "Continue" }).click(); await page.waitForTimeout(300);
  assert(await view(page) === "subject", "Student → P6 → Continue → Subject unchanged");
  assert(/Switch to Teacher View/.test(await txt(page)), "demo teacher-switch link unchanged");
  await ctx.close();
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
