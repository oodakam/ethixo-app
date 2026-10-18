// Real-Chromium evidence test for Phase 0+1 (flag OFF).
//  1. Records EVERY request the page makes and EVERY localStorage access, and asserts: zero Supabase
//     requests, zero reads/writes of the sync scaffold's keys (ethixoOutbox / ethixoSyncKill) or Supabase
//     auth keys (sb-*).
//  2. Differential check: runs the SAME scripted session against the original index.html (git HEAD) and the
//     new one, then asserts identical rendered screens and identical localStorage contents.
//  3. Positive controls prove the detectors would catch a violation.
// Needs: playwright-core + a Chromium (PLAYWRIGHT_BROWSERS_PATH / CHROMIUM_PATH). Run: node tests/sync-flag-off-browser.test.js
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");

const repo = path.join(__dirname, "..");
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let passed = 0, failed = 0;
function assert(c, m){ if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }

// Same inline-script injection used for both app versions: log storage + network-ish APIs, seed data.
const INSTRUMENT = (seed) => `
(function(){
  window.__log = { storage:[], api:[] };
  const P = Storage.prototype;
  ["getItem","setItem","removeItem","clear","key"].forEach(function(n){
    const o = P[n]; P[n] = function(){ try{ window.__log.storage.push([n, String(arguments[0])]); }catch(e){} return o.apply(this, arguments); };
  });
  const of = window.fetch; window.fetch = function(u){ window.__log.api.push(["fetch", String(u && u.url || u)]); return of.apply(this, arguments); };
  const ox = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m,u){ window.__log.api.push(["xhr", String(u)]); return ox.apply(this, arguments); };
  const OW = window.WebSocket; window.WebSocket = function(u){ window.__log.api.push(["ws", String(u)]); return new OW(...arguments); };
  if(navigator.sendBeacon){ const ob = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function(u){ window.__log.api.push(["beacon", String(u)]); return ob.apply(null, arguments); }; }
  const oc = document.createElement.bind(document); document.createElement = function(t){ const el = oc(t); if(String(t).toLowerCase()==="script"){ Object.defineProperty(el,"src",{ set(v){ window.__log.api.push(["script", String(v)]); el.setAttribute("src", v); }, get(){ return el.getAttribute("src"); } }); } return el; };
  const seed = ${JSON.stringify(seed || null)};
  if(seed && !sessionStorage.getItem("__seeded")){ sessionStorage.setItem("__seeded","1"); Object.keys(seed).forEach(function(k){ localStorage.setItem(k, JSON.stringify(seed[k])); }); }
})();`;

const SEEDS = {
  fresh: null,
  student: {
    activePersona: "student", chosenLevel: "P6", lastActive: 1760000000000, timelog: { "2026-10-17": 900 },
    lastLesson: { level:"P6", subjectKey:"SS", lessonId:"2.1" },
    vault: [
      { qid:"attempts:P6:SS:2.1:0", level:"P6", subjectKey:"SS", lessonTitle:"2.1 The Features of Ancient Civilisations", t:"Q one", m:2, answer:"My answer one", score:2, savedAt:1760000000001 },
      { qid:"attempts:P6:SCI:1.1:3", level:"P6", subjectKey:"SCI", lessonTitle:"x", t:"Q two", m:1, answer:"My answer two", examReadyAnswer:"Exam ready two", score:1, savedAt:1760000000002 },
    ],
    "attempts:P6:SS:2.1:0": [{ answer:"My answer one", score:2, strengths:["a"], nextSteps:["b"], usedThinking:false, at:1760000000001 }],
    "attempts:P6:SS:2.1:custom-1": [{ answer:"mine", score:1, strengths:[], nextSteps:[], usedThinking:true, at:1760000000003 }],
    teacherAssignments: [{ id:"a1", classId:"p6a", level:"P6", subjectKey:"SS", lessonId:"2.1", lessonTitle:"2.1", dueDate:"2026-11-01", assignedAt:1760000000004 }],
    dashboardSeenNoticedIds: ["noticed-persist"],
  },
  teacher: { activePersona: "teacher", chosenLevel: "P6", lastActive: 1760000000000 },
};

function serve(dir){
  return new Promise(function(resolve){
    const srv = http.createServer(function(req, res){
      const p = decodeURIComponent(req.url.split("?")[0]); const f = path.join(dir, p === "/" ? "index.html" : p);
      if(!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end("nf"); }
      const ext = path.extname(f); res.writeHead(200, { "content-type": ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "application/octet-stream" }); res.end(fs.readFileSync(f));
    }).listen(0, "127.0.0.1", function(){ resolve({ srv, port: srv.address().port }); });
  });
}

// The scripted session: identical for both versions. Uses the app's own functions/flows.
async function session(browser, port, seed){
  const ctx = await browser.newContext({ viewport:{ width:1200, height:900 } });
  await ctx.addInitScript(INSTRUMENT(seed));
  const requests = [];
  await ctx.route("**/*", function(route){
    const u = route.request().url(); requests.push(u);
    if(u.startsWith("http://127.0.0.1:" + port)) return route.continue();
    return route.abort(); // sandbox: never let anything leave; the attempt itself is what we record
  });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto("http://127.0.0.1:" + port + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(600);
  const shots = {};
  const snap = async (name) => { shots[name] = await page.evaluate(() => document.getElementById("app").innerText.replace(/\s+/g," ").trim()); };
  await snap("landing");
  // Exercise the same sSet-driven paths a real session uses.
  await page.evaluate(() => { try{ enterAsStudent(); }catch(e){} }); await page.waitForTimeout(200); await snap("afterEnterStudent");
  await page.evaluate(() => { try{ state.level = "P6"; chooseLevel(); }catch(e){} }); await page.waitForTimeout(200); await snap("afterChooseLevel");
  await page.evaluate(() => { try{ goto("dashboard"); }catch(e){} }); await page.waitForTimeout(200); await snap("dashboard");
  await page.evaluate(() => { try{ saveLastLesson("P6","SS","2.1"); }catch(e){} });
  await page.evaluate(() => { try{ sSet("attempts:P6:SS:2.1:1", [{ answer:"z", score:1, strengths:[], nextSteps:[], usedThinking:false, at:1 }]); sSet("vault", (sGet("vault")||[]).concat([{ qid:"attempts:P6:SS:2.1:1", level:"P6", subjectKey:"SS", answer:"z", score:1, savedAt:2 }])); }catch(e){} });
  await page.evaluate(() => { try{ goto("vault"); }catch(e){} }); await page.waitForTimeout(200); await snap("vault");
  await page.evaluate(() => { try{ enterAsTeacher(); }catch(e){} }); await page.waitForTimeout(200); await snap("teacherDashboard");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(300);
  const dump = await page.evaluate(() => { const o = {}; for(let i = 0; i < localStorage.length; i++){ const k = Object.getPrototypeOf(localStorage).key.call(localStorage, i); o[k] = Object.getPrototypeOf(localStorage).getItem.call(localStorage, k); } return o; });
  const log = await page.evaluate(() => window.__log);
  await ctx.close();
  return { shots, dump, log, requests, errors };
}

function normalise(dump){ // keys the app itself stamps with the clock
  const d = Object.assign({}, dump); delete d.lastActive; delete d.__seeded;
  if(d.timelog) d.timelog = "<timelog>";
  return d;
}

(async function(){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ethixo-ab-"));
  const oldDir = path.join(tmp, "old"), newDir = path.join(tmp, "new"); fs.mkdirSync(oldDir); fs.mkdirSync(newDir);
  let oldHtml;
  try{ oldHtml = execFileSync("git", ["-C", repo, "show", "d0ebdf0:index.html"], { maxBuffer: 1 << 26 }).toString(); }
  catch(e){ console.log("FAIL: cannot read original index.html from git (d0ebdf0)"); process.exit(1); }
  fs.writeFileSync(path.join(oldDir, "index.html"), oldHtml);
  fs.writeFileSync(path.join(newDir, "index.html"), fs.readFileSync(path.join(repo, "index.html")));
  const A = await serve(oldDir), B = await serve(newDir);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });

  for(const name of Object.keys(SEEDS)){
    console.log("\nScenario: " + name + " (flag OFF) — original vs new");
    const o = await session(browser, A.port, SEEDS[name]);
    const n = await session(browser, B.port, SEEDS[name]);

    const sup = n.requests.concat(n.log.api.map(a => a[1])).filter(u => /supabase|sb_publishable|\/auth\/v1|\/rest\/v1/i.test(u));
    assert(sup.length === 0, "NEW app: zero Supabase requests (requests seen: " + n.requests.length + ", API-level calls: " + n.log.api.length + ")");
    const hosts = Array.from(new Set(n.requests.map(u => new URL(u).hostname))).sort();
    console.log("    hosts contacted by new app (all aborted except localhost): " + hosts.join(", "));
    const oldHosts = Array.from(new Set(o.requests.map(u => new URL(u).hostname))).sort();
    assert(JSON.stringify(hosts) === JSON.stringify(oldHosts), "NEW app contacts exactly the same hosts as the ORIGINAL app");
    assert(JSON.stringify(n.requests) === JSON.stringify(o.requests.map(u => u.replace(":" + A.port, ":" + B.port))), "NEW app makes exactly the same request sequence as the ORIGINAL (" + n.requests.length + " requests)");

    const touched = n.log.storage.map(x => x[1]).filter(k => /^(ethixoOutbox|ethixoSyncKill|ethixoPreSyncSnapshot)$|^sb-|supabase/i.test(k));
    assert(touched.length === 0, "NEW app never reads/writes ethixoOutbox, ethixoSyncKill or Supabase auth keys (storage ops logged: " + n.log.storage.length + ")");
    const oStorageKeys = JSON.stringify(o.log.storage.map(x => x[0] + ":" + x[1]).filter(s => !/lastActive|timelog|__seeded/.test(s)));
    const nStorageKeys = JSON.stringify(n.log.storage.map(x => x[0] + ":" + x[1]).filter(s => !/lastActive|timelog|__seeded/.test(s)));
    assert(oStorageKeys === nStorageKeys, "NEW app performs the same storage operations (same op + key, same order) as the ORIGINAL");

    assert(JSON.stringify(normalise(n.dump)) === JSON.stringify(normalise(o.dump)), "localStorage contents identical to the ORIGINAL after the same session (" + Object.keys(n.dump).length + " keys)");
    if(SEEDS[name]){
      const sd = SEEDS[name];
      const keep = Object.keys(sd).filter(k => !["lastActive","timelog","activePersona","vault","lastLesson","chosenLevel"].includes(k));
      if(keep.length) assert(keep.every(k => n.dump[k] === JSON.stringify(sd[k])), "seeded learning data (" + keep.join(", ") + ") byte-identical afterwards");
      if(sd.vault){ const v = JSON.parse(n.dump.vault); assert(v.length === sd.vault.length + 1 && sd.vault.every((e, i) => JSON.stringify(v[i]) === JSON.stringify(e)), "seeded Vault entries preserved in order (only the one deliberate test entry added)"); }
    }
    Object.keys(o.shots).forEach(function(k){ if(o.shots[k] !== n.shots[k]) console.log("      DIFF at " + k + "\n        old: " + o.shots[k].slice(0,160) + "\n        new: " + n.shots[k].slice(0,160)); });
    assert(Object.keys(o.shots).every(k => o.shots[k] === n.shots[k]), "every rendered screen identical to the ORIGINAL (" + Object.keys(o.shots).length + " screens compared)");
    assert(n.errors.length === o.errors.length, "no new JavaScript errors (original: " + o.errors.length + ", new: " + n.errors.length + ")");
    assert(Object.values(n.shots).every(s => s.length > 20), "screens actually rendered content (not blank)");
  }

  console.log("\nPositive controls (prove the detectors work)");
  {
    const ctx = await browser.newContext(); await ctx.addInitScript(INSTRUMENT(null));
    const seen = []; await ctx.route("**/*", r => { const u = r.request().url(); seen.push(u); return u.startsWith("http://127.0.0.1:" + B.port) ? r.continue() : r.abort(); });
    const page = await ctx.newPage(); await page.goto("http://127.0.0.1:" + B.port + "/index.html"); await page.waitForTimeout(300);
    await page.evaluate(() => { fetch("https://abcdefgh.supabase.co/rest/v1/attempts").catch(()=>{}); localStorage.getItem("ethixoOutbox"); });
    await page.waitForTimeout(300);
    const log = await page.evaluate(() => window.__log);
    assert(seen.some(u => /supabase\.co/.test(u)), "request recorder DOES see a deliberate supabase.co request");
    assert(log.api.some(a => /supabase\.co/.test(a[1])), "fetch hook DOES see a deliberate supabase.co call");
    assert(log.storage.some(x => x[1] === "ethixoOutbox"), "storage hook DOES see a deliberate ethixoOutbox read");
    await ctx.close();
  }
  {
    // Control: a build with the flag flipped to "shadow" is detected by the unit test, never shipped here.
    const flipped = fs.readFileSync(path.join(repo, "index.html"), "utf8").replace('const DB_SYNC_MODE = "off";', 'const DB_SYNC_MODE = "shadow";');
    assert(flipped !== fs.readFileSync(path.join(repo, "index.html"), "utf8"), "control: flag text is exactly where the tests expect it");
  }

  await browser.close(); A.srv.close(); B.srv.close(); fs.rmSync(tmp, { recursive:true, force:true });
  console.log("\n" + "=".repeat(50)); console.log("RESULTS: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(2); });
