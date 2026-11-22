// Focused real-Chromium check: the entry-page Teacher card.
//  - On a pilot-configured page (allow-listed host), Teacher -> /pilot-teacher (real teacher sign-in), and no demo persona is set.
//  - On an unconfigured page (allow-list empty, e.g. main/Production), Teacher still opens the demo Teacher Dashboard.
//  - Student card is unchanged on the pilot page.
// Uses fake config values only; every request to a Supabase host is blocked and counted (expected: 0).
// Run: node tests/pilot-entry-teacher-route.test.js   (needs playwright or playwright-core + a Chromium)
const fs = require("fs"), path = require("path"), http = require("http");
let chromium; try { ({ chromium } = require("playwright")); } catch (_e) { ({ chromium } = require("playwright-core")); }
const { applyConfig } = require("../api/pilot-app.js");

const repo = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
const pilotHtml = applyConfig(html, "app", { url: "https://fakefakefake.supabase.co", key: "sb_publishable_FAKEFAKEFAKEFAKE", host: "localhost", attempts: true, backfill: true, mode: "shadow" });
let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }

(async () => {
  assert(!!pilotHtml, "pilot config applies to index.html (each placeholder found exactly once)");
  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (p === "/pilot") return res.end(pilotHtml);
    if (p === "/pilot-teacher") return res.end("<!doctype html><title>stub</title><main id=app>TEACHER-SIGNIN-STUB</main>");
    if (p === "/plain") return res.end(html);
    res.statusCode = 404; res.end("nf");
  }).listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = "http://localhost:" + server.address().port;
  const browser = await chromium.launch();
  async function run(pathname, card) {
    const ctx = await browser.newContext(); const page = await ctx.newPage(); let supa = 0;
    await page.route(/supabase\.co/, route => { supa++; route.abort(); });
    await page.goto(base + pathname, { waitUntil: "load" });
    await page.evaluate(() => localStorage.clear());
    await page.goto(base + pathname, { waitUntil: "load" });
    await page.locator(".choice", { hasText: card }).first().click();
    await page.waitForTimeout(500);
    const out = { path: new URL(page.url()).pathname, hash: new URL(page.url()).hash, body: await page.locator("body").innerText(), persona: await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("activePersona")); } catch (_e) { return null; } }), supa };
    await ctx.close(); return out;
  }
  console.log("Pilot page (allow-listed host):");
  const t = await run("/pilot", "Teacher");
  assert(t.path === "/pilot-teacher" && /TEACHER-SIGNIN-STUB/.test(t.body), "Teacher card navigates to /pilot-teacher");
  assert(t.persona !== "teacher", "demo teacher persona is NOT set");
  assert(t.supa === 0, "no Supabase request from the entry page");
  const s = await run("/pilot", "Student");
  assert(s.path === "/pilot" && s.hash === "#level", "Student card unchanged (level screen)");
  console.log("Unconfigured page (main/Production behaviour):");
  const d = await run("/plain", "Teacher");
  assert(d.path === "/plain" && d.hash === "#teacherDashboard" && /Sharon Lim/.test(d.body), "Teacher card still opens the demo Teacher Dashboard");
  assert(d.persona === "teacher", "demo persona set as before");
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
