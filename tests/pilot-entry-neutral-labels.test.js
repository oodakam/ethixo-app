// Focused real-Chromium check: pilot-host-only neutral labels + Join-your-class card on first dashboard view.
//  A. Pilot host: no "Wenbo"/"Sharon Lim"/later-phase text; Student/Teacher cards and routing unchanged.
//  B. Unconfigured (main/demo) host: demo text unchanged.
//  C. Pilot dashboard: Join your class card present after student initialisation (stub Supabase library; no real network).
// Run: node tests/pilot-entry-neutral-labels.test.js   (needs playwright or playwright-core + a Chromium)
const fs = require("fs"), path = require("path"), http = require("http");
let chromium; try { ({ chromium } = require("playwright")); } catch (_e) { ({ chromium } = require("playwright-core")); }
const { applyConfig } = require("../api/pilot-app.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pilotHtml = applyConfig(html, "app", { url: "https://fakefakefake.supabase.co", key: "sb_publishable_FAKEFAKEFAKEFAKE", host: "localhost", attempts: true, backfill: true, mode: "shadow" });
let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }
// Stub library: instant anonymous sign-in, existing student profile. Nothing leaves the machine.
const STUB = `window.supabase={createClient:function(){var q=function(){return q};
var chain={select:function(){return chain},eq:function(){return chain},maybeSingle:function(){return Promise.resolve({data:{id:"u1",role:"student",level:"P6"},error:null})},update:function(){return chain},then:function(f){return Promise.resolve({data:null,error:null}).then(f)}};
return{auth:{getSession:function(){return Promise.resolve({data:{session:null},error:null})},signInAnonymously:function(){return new Promise(function(r){setTimeout(function(){r({data:{session:{user:{id:"u1"}}},error:null})},300)})},signOut:function(){return Promise.resolve({})}},
from:function(){return chain},rpc:function(){return Promise.resolve({data:null,error:null})}}}};`;
(async () => {
  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    if (p.indexOf("supabase-js") !== -1) { res.setHeader("content-type", "application/javascript"); return res.end(STUB); }
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
  const txt = p => p.locator("body").innerText();

  console.log("A. Pilot host:");
  let { ctx, page } = await open("/pilot");
  let body = await txt(page);
  assert(!/Wenbo|Sharon|Social Science|later phase|School ID/.test(body), "entry view has no demo persona / later-phase sign-in text");
  assert(/Student/.test(body) && /Teacher/.test(body), "Student and Teacher cards still shown");
  await page.locator(".choice", { hasText: "Student" }).first().click(); await page.waitForTimeout(300);
  assert(new URL(page.url()).hash === "#level", "Student card -> level screen");
  assert(!/Wenbo/.test(await txt(page)), "header has no Wenbo Lee");
  assert(/Student/.test(await page.locator(".profile-chip").innerText()), "header chip label is neutral 'Student'");
  await ctx.close();
  ({ ctx, page } = await open("/pilot"));
  await page.locator(".choice", { hasText: "Teacher" }).first().click(); await page.waitForTimeout(400);
  assert(new URL(page.url()).pathname === "/pilot-teacher", "Teacher card -> /pilot-teacher");
  await ctx.close();

  console.log("C. Pilot dashboard (Join your class after initialisation):");
  ({ ctx, page } = await open("/pilot"));
  await page.locator(".choice", { hasText: "Student" }).first().click(); await page.waitForTimeout(200);
  await page.locator(".choice", { hasText: "Primary 6" }).first().click(); await page.waitForTimeout(150);
  await page.getByRole("button", { name: "Continue" }).click(); await page.waitForTimeout(200);
  // go to dashboard right away (before the 300 ms stub sign-in resolves), then wait for init
  await page.evaluate(() => { goto("dashboard"); });
  await page.waitForTimeout(150);
  await page.waitForFunction(() => ETHIXO_AUTH.status() === "profile-ok", null, { timeout: 5000 });
  await page.waitForTimeout(500);
  assert(await page.locator("#classCodeCard").count() === 1, "Join your class card present once profile is ready");
  assert(/Join your class/.test(await txt(page)), "card text visible");
  assert(!/Wenbo/.test(await txt(page)), "dashboard has no 'Wenbo'");
  // returning student (chosenLevel stored): /pilot opens the dashboard directly; card must be there after init
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => ETHIXO_AUTH.status() === "profile-ok", null, { timeout: 5000 });
  await page.waitForTimeout(500);
  assert(new URL(page.url()).hash === "#dashboard" && await page.locator("#classCodeCard").count() === 1, "returning-student dashboard shows the card after init");
  await ctx.close();

  console.log("B. Unconfigured host (main/demo):");
  ({ ctx, page } = await open("/plain"));
  body = await txt(page);
  assert(/Wenbo Lee · Primary 6/.test(body) && /Sharon Lim · Social Science/.test(body) && /wired up in a later phase/.test(body), "entry view unchanged (demo personas + later-phase line)");
  await page.locator(".choice", { hasText: "Student" }).first().click(); await page.waitForTimeout(300);
  assert(/Wenbo Lee/.test(await page.locator(".profile-chip").innerText()), "header still 'Wenbo Lee'");
  await page.locator(".choice", { hasText: "Primary 6" }).first().click();
  await page.getByRole("button", { name: "Continue" }).click(); await page.waitForTimeout(300);
  await page.evaluate(() => { goto("dashboard"); }); await page.waitForTimeout(500);
  assert(/Welcome, Wenbo!/.test(await txt(page)) && await page.locator("#classCodeCard").count() === 0, "dashboard greeting unchanged; no class card (auth off)");
  await ctx.close();
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
