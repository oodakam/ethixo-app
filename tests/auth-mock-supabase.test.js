// Phase 2 end-to-end test: REAL Chromium + the REAL vendored supabase-js, against a LOCAL MOCK Supabase.
// There is no real Supabase here: every request to the mock host is answered by this file, and every other
// non-local request is aborted. The committed index.html keeps its placeholders and "off"; the flag-on build
// used below exists only in memory/temp dir for the duration of this test.
// Run: node tests/auth-mock-supabase.test.js   (needs playwright-core + Chromium, see other browser tests)
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");

const repo = path.join(__dirname, "..");
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let passed = 0, failed = 0;
function assert(c, m){ if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }

const MOCK_HOST = "mock-project.supabase.test", MOCK = "https://" + MOCK_HOST;
const MOCK_KEY = "sb_publishable_MOCKKEY0123456789";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- the flag-on build (in memory + temp dir only) ----------
const committed = fs.readFileSync(path.join(repo, "index.html"), "utf8");
function flagOnHtml(allowedHosts){
  const rep = [
    ['const DB_SYNC_MODE = "off";', 'const DB_SYNC_MODE = "shadow";'],
    ['const SUPABASE_URL = "__SET_ME__";', 'const SUPABASE_URL = "' + MOCK + '";'],
    ['const SUPABASE_PUBLISHABLE_KEY = "__SET_ME__";', 'const SUPABASE_PUBLISHABLE_KEY = "' + MOCK_KEY + '";'],
    ['const DB_SYNC_ALLOWED_HOSTS = [];', 'const DB_SYNC_ALLOWED_HOSTS = ' + JSON.stringify(allowedHosts) + ';'],
  ];
  let h = committed;
  rep.forEach(([a, b]) => { if(h.split(a).length !== 2) throw new Error("test build: marker not found exactly once: " + a); h = h.replace(a, b); });
  return h;
}

function serve(dir){
  return new Promise(function(resolve){
    const srv = http.createServer(function(req, res){
      const p = decodeURIComponent(req.url.split("?")[0]); const f = path.join(dir, p === "/" ? "index.html" : p);
      if(!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end("nf"); }
      const ext = path.extname(f); res.writeHead(200, { "content-type": ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "application/octet-stream" }); res.end(fs.readFileSync(f));
    }).listen(0, "127.0.0.1", function(){ resolve({ srv, port: srv.address().port }); });
  });
}

// ---------- the mock Supabase ----------
function b64u(o){ return Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function makeMock(){
  const m = { mode:"ok", log:[], users:0, profiles:{}, dupOnce:false, tokens:{} };
  m.reset = () => { m.mode = "ok"; m.log = []; m.dupOnce = false; };
  m.handler = async function(route){
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": req.headers()["access-control-request-headers"] || "*", "access-control-expose-headers": "*" };
    if(method === "OPTIONS") return route.fulfill({ status:204, headers:cors });
    let body = null; try{ body = req.postData() ? JSON.parse(req.postData()) : null; }catch(e){ body = req.postData(); }
    const h = req.headers();
    const entry = { method, path: url.pathname, query: url.search, body, apikey: h["apikey"], authz: h["authorization"] || "" };
    m.log.push(entry);
    if(m.mode === "offline") return route.abort("internetdisconnected");
    const json = (status, obj, extra) => route.fulfill({ status, headers:Object.assign({ "content-type":"application/json" }, cors, extra || {}), body: obj === undefined ? "" : JSON.stringify(obj) });
    if(m.mode === "e500") return json(500, { message:"boom" });
    if(url.pathname === "/auth/v1/signup" && method === "POST"){
      if(m.mode === "e429") return json(429, { code:429, error_code:"over_request_rate_limit", msg:"rate limited" });
      if(m.mode === "e422") return json(422, { code:422, error_code:"anonymous_provider_disabled", msg:"Anonymous sign-ins are disabled" });
      const uid = "00000000-0000-4000-8000-" + String(++m.users).padStart(12, "0");
      const now = Math.floor(Date.now() / 1000);
      const jwt = b64u({ alg:"HS256", typ:"JWT" }) + "." + b64u({ sub:uid, aud:"authenticated", role:"authenticated", is_anonymous:true, exp: now + 3600, iat: now }) + ".mocksig";
      m.tokens[jwt] = uid;
      return json(200, { access_token: jwt, token_type:"bearer", expires_in:3600, expires_at: now + 3600, refresh_token:"mock-refresh-" + uid,
        user:{ id:uid, aud:"authenticated", role:"authenticated", is_anonymous:true, app_metadata:{}, user_metadata:{}, created_at:new Date().toISOString() } });
    }
    const tok = (entry.authz.match(/^Bearer (.+)$/) || [])[1], uid = m.tokens[tok];
    if(url.pathname.indexOf("/rest/v1/") === 0 && !uid) return json(401, { code:"PGRST301", message:"JWT invalid" });
    if(url.pathname === "/rest/v1/profiles" && method === "GET"){
      const want = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      const row = m.profiles[want] || null;
      const single = /vnd\.pgrst\.object/.test(h["accept"] || "");
      if(single) return row ? json(200, { id:row.id, role:row.role, level:row.level }) : json(406, { code:"PGRST116", message:"The result contains 0 rows" });
      return json(200, row ? [{ id:row.id, role:row.role, level:row.level }] : []);
    }
    if(url.pathname === "/rest/v1/rpc/create_my_profile" && method === "POST"){
      if(m.profiles[uid] || m.dupOnce){
        if(m.dupOnce && !m.profiles[uid]) m.profiles[uid] = { id:uid, role:body.p_role, level:body.p_level, display_name:body.p_display_name };
        m.dupOnce = false;
        return json(409, { code:"23505", message:"profile already exists", details:null, hint:null });
      }
      m.profiles[uid] = { id:uid, role:body.p_role, level:body.p_level, display_name:body.p_display_name };
      return route.fulfill({ status:204, headers:cors });
    }
    if(url.pathname === "/rest/v1/profiles" && method === "PATCH"){
      const want = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      if(m.profiles[want] && want === uid) Object.assign(m.profiles[want], { level: body.level });
      return route.fulfill({ status:204, headers:cors });
    }
    return json(404, { code:"404", message:"mock: unexpected " + method + " " + url.pathname });
  };
  return m;
}

// ---------- harness ----------
async function newCtx(browser, mock, port, seed){
  const ctx = await browser.newContext({ viewport:{ width:1200, height:900 } });
  const other = [];
  await ctx.addInitScript((seedJson) => {
    window.__log = { storage:[], listeners:[], timers:[] };
    const P = Storage.prototype;
    ["getItem","setItem","removeItem","clear"].forEach(function(n){ const o = P[n]; P[n] = function(){ try{ window.__log.storage.push([n, String(arguments[0])]); }catch(e){} return o.apply(this, arguments); }; });
    const seed = JSON.parse(seedJson);
    if(seed && !sessionStorage.getItem("__seeded")){ sessionStorage.setItem("__seeded","1"); Object.keys(seed).forEach(function(k){ localStorage.setItem(k, JSON.stringify(seed[k])); }); }
  }, JSON.stringify(seed || null));
  await ctx.route("**/*", function(route){
    const u = route.request().url();
    if(u.startsWith("http://127.0.0.1:" + port)) return route.continue();
    if(u.startsWith(MOCK + "/")) return mock.handler(route);
    other.push(u); return route.abort();
  });
  return { ctx, other };
}
async function open(ctx, port){
  const page = await ctx.newPage(); const errors = [], consoles = [];
  page.on("pageerror", e => errors.push(String(e))); page.on("console", c => consoles.push(c.type() + ": " + c.text()));
  await page.goto("http://127.0.0.1:" + port + "/index.html", { waitUntil:"load" }); await page.waitForTimeout(500);
  return { page, errors, consoles };
}
const status = (page) => page.evaluate(() => ETHIXO_AUTH.status());
async function waitStatus(page, want, ms){ const t0 = Date.now(); let s; while(Date.now() - t0 < (ms || 6000)){ s = await status(page); if(want.indexOf(s) !== -1) return s; await sleep(100); } return s; }
const screen = (page) => page.evaluate(() => document.getElementById("app").innerText.replace(/\s+/g, " ").trim());
const dumpLS = (page) => page.evaluate(() => { const o = {}; const P = Object.getPrototypeOf(localStorage); for(let i = 0; i < localStorage.length; i++){ const k = P.key.call(localStorage, i); o[k] = P.getItem.call(localStorage, k); } return o; });
const reqs = (mock) => mock.log.filter(e => e.method !== "OPTIONS");
const summary = (mock) => reqs(mock).map(e => e.method + " " + e.path);
const paths = (mock) => summary(mock).join(" | ");

(async function(){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ethixo-auth-"));
  const mkSite = (name, html) => { const d = path.join(tmp, name); fs.mkdirSync(path.join(d, "assets", "vendor"), { recursive:true }); fs.writeFileSync(path.join(d, "index.html"), html);
    fs.copyFileSync(path.join(repo, "assets", "vendor", "supabase-js-2.117.2.umd.js"), path.join(d, "assets", "vendor", "supabase-js-2.117.2.umd.js")); return d; };
  const onDir = mkSite("on", flagOnHtml(["127.0.0.1"]));
  const wrongHostDir = mkSite("wronghost", flagOnHtml(["ethixo-preview.example.test"]));
  const origDir = mkSite("orig", execFileSync("git", ["-C", repo, "show", "d0ebdf0:index.html"], { maxBuffer: 1 << 26 }).toString());
  const offDir = mkSite("off", committed);
  const ON = await serve(onDir), WRONG = await serve(wrongHostDir), ORIG = await serve(origDir), OFF = await serve(offDir);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const mock = makeMock();

  console.log("\nTest 0: harness sanity - committed build is placeholder + off; test build differs only in the 4 config lines");
  assert(/const DB_SYNC_MODE = "off";/.test(committed) && /const SUPABASE_URL = "__SET_ME__";/.test(committed), "committed index.html: flag off, placeholders");
  assert(flagOnHtml(["127.0.0.1"]).split("\n").filter((l, i) => l !== committed.split("\n")[i]).length === 4, "flag-on test build differs from the committed file in exactly 4 lines");

  console.log("\nTest 1: flag ON, landing page / teacher only - no account is created");
  {
    mock.reset();
    const { ctx } = await newCtx(browser, mock, ON.port, null);
    const { page, errors } = await open(ctx, ON.port);
    await page.evaluate(() => enterAsTeacher()); await page.waitForTimeout(500);
    await page.evaluate(() => switchToStudent()); await page.waitForTimeout(300); // no saved level => level screen, not an entry point
    await page.waitForTimeout(500);
    assert(reqs(mock).length === 0, "landing + teacher + level screen: ZERO requests to the mock (" + reqs(mock).length + ")");
    const ls = await dumpLS(page);
    assert(!Object.keys(ls).some(k => /^ethixoAuth/.test(k)), "no ethixoAuth / ethixoAuthMeta key created");
    assert(errors.length === 0, "no JavaScript errors");
    await ctx.close();
  }

  console.log("\nTest 2: flag ON, wrong host (allow-list does not include this host) - fully inert in a real browser");
  {
    mock.reset();
    const { ctx } = await newCtx(browser, mock, WRONG.port, null);
    const { page, errors } = await open(ctx, WRONG.port);
    await page.evaluate(() => { enterAsStudent(); state.level = "P6"; chooseLevel(); }); await page.waitForTimeout(1200);
    assert(reqs(mock).length === 0, "chooseLevel on a non-allow-listed host: ZERO requests");
    assert(await page.evaluate(() => ETHIXO_SYNC.mode()) === "off", "ETHIXO_SYNC.mode() reports off");
    assert(!Object.keys(await dumpLS(page)).some(k => /^ethixoAuth/.test(k)), "no auth keys");
    assert(errors.length === 0, "no JavaScript errors");
    await ctx.close();
  }

  console.log("\nTest 3: flag ON, fresh visitor - one sign-up, one profile; UI identical to the original app");
  let sharedCtx;
  {
    mock.reset(); mock.users = 0; mock.profiles = {}; mock.tokens = {};
    const script = async (page, withWait) => {
      const shots = {}; const snap = async (n) => { shots[n] = await screen(page); };
      await snap("landing");
      await page.evaluate(() => enterAsStudent()); await page.waitForTimeout(250); await snap("afterEnterStudent");
      const before = reqs(mock).length;
      await page.evaluate(() => { state.level = "P6"; chooseLevel(); }); await page.waitForTimeout(250); await snap("afterChooseLevel");
      if(withWait) await waitStatus(page, ["profile-ok"]);
      await page.evaluate(() => goto("dashboard")); await page.waitForTimeout(250); await snap("dashboard");
      return { shots, before };
    };
    const o = await newCtx(browser, mock, ORIG.port, null); const op = await open(o.ctx, ORIG.port);
    const origRun = await script(op.page, false); const origLS = await dumpLS(op.page); const origOther = o.other.slice(); await o.ctx.close();

    const { ctx, other } = await newCtx(browser, mock, ON.port, null); sharedCtx = ctx;
    const { page, errors, consoles } = await open(ctx, ON.port);
    mock.log = [];
    const run = await script(page, true);
    assert(summary(mock).join(",") === "POST /auth/v1/signup,GET /rest/v1/profiles,POST /rest/v1/rpc/create_my_profile", "exact request sequence: signup -> profiles select -> create_my_profile (" + paths(mock) + ")");
    assert(Object.keys(mock.profiles).length === 1, "exactly one profile row exists in the mock");
    const prof = Object.values(mock.profiles)[0];
    assert(prof.role === "student" && prof.display_name === "Student" && prof.level === "P6", "profile = {student, \"Student\", P6}");
    const rpc = reqs(mock).find(e => /create_my_profile/.test(e.path));
    assert(JSON.stringify(Object.keys(rpc.body).sort()) === JSON.stringify(["p_display_name", "p_level", "p_role"]), "RPC body has exactly p_role, p_display_name, p_level");
    assert(reqs(mock).every(e => e.apikey === MOCK_KEY), "every request carries only the publishable key as apikey");
    assert(!reqs(mock).some(e => /attempts|vault|student_state|feedback/.test(e.path + e.query + JSON.stringify(e.body || ""))), "no request mentions attempts / vault / student_state / feedback");
    assert(await status(page) === "profile-ok", "status profile-ok");
    Object.keys(origRun.shots).forEach(k => { if(origRun.shots[k] !== run.shots[k]) console.log("      DIFF at " + k + "\n        old: " + origRun.shots[k].slice(0, 150) + "\n        new: " + run.shots[k].slice(0, 150)); });
    assert(Object.keys(origRun.shots).every(k => origRun.shots[k] === run.shots[k]), "every rendered screen identical to the ORIGINAL app (" + Object.keys(run.shots).length + " screens)");
    assert(errors.length === 0, "no JavaScript errors");
    assert(JSON.stringify(Array.from(new Set(other.map(u => new URL(u).hostname))).sort()) === JSON.stringify(Array.from(new Set(origOther.map(u => new URL(u).hostname))).sort()), "no host contacted other than the mock + whatever the ORIGINAL app already contacts");
    const ls = await dumpLS(page);
    const extra = Object.keys(ls).filter(k => !(k in origLS));
    assert(extra.length > 0 && extra.every(k => /^ethixoAuth/.test(k)), "the only NEW localStorage keys are ethixoAuth*: " + extra.join(", "));
    const same = Object.keys(origLS).filter(k => !/lastActive|timelog|__seeded/.test(k)).every(k => ls[k] === origLS[k]);
    assert(same, "all pre-existing app keys byte-identical to the ORIGINAL app's");
    const meta = JSON.parse(ls.ethixoAuthMeta); assert(Object.keys(meta).sort().join() === "at,uid", "ethixoAuthMeta = {uid, at}");
    assert(!consoles.some(c => /00000000-0000-4000|mock-refresh|eyJ/.test(c)), "no uid / token written to the console");
    // learning data stays local: write attempts + vault after sign-in and watch the mock
    mock.log = [];
    await page.evaluate(() => { sSet("attempts:P6:SS:2.1:1", [{ answer:"fake", score:1, strengths:[], nextSteps:[], usedThinking:false, at:1 }]); sSet("vault", [{ qid:"attempts:P6:SS:2.1:1", level:"P6", subjectKey:"SS", answer:"fake", score:1, savedAt:2 }]); sSet("timelog", { a: 5 }); sSet("lastLesson", { level:"P6", subjectKey:"SS", lessonId:"2.1" }); });
    await page.waitForTimeout(1500);
    assert(reqs(mock).length === 0, "learning-data writes (attempts, vault, timelog, lastLesson) cause ZERO requests - nothing is uploaded");
    assert(!("ethixoOutbox" in await dumpLS(page)), "no ethixoOutbox key (sender never registered)");
    await page.close();
  }

  console.log("\nTest 4: returning student (reload) - no new account");
  {
    mock.log = [];
    const page = await sharedCtx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
    await page.goto("http://127.0.0.1:" + ON.port + "/index.html"); await page.waitForTimeout(300);
    await waitStatus(page, ["profile-ok"]);
    assert(summary(mock).filter(s => /signup/.test(s)).length === 0 && summary(mock).filter(s => /create_my_profile/.test(s)).length === 0, "reload: no sign-up, no profile creation (" + paths(mock) + ")");
    assert(summary(mock).length <= 1, "reload: at most the single profile SELECT");
    assert(Object.keys(mock.profiles).length === 1 && mock.users === 1, "still one user and one profile in the mock");
    assert(await status(page) === "profile-ok", "status profile-ok");
    assert(/Dashboard|dashboard|Welcome|Wenbo|Subject|Primary 6/i.test(await screen(page)), "the app restored the student dashboard as before");
    assert(errors.length === 0, "no JavaScript errors");
    await page.close(); await sharedCtx.close();
  }

  console.log("\nTest 5: two tabs open a fresh visitor at the same moment - one account only");
  {
    mock.reset(); mock.users = 0; mock.profiles = {}; mock.tokens = {};
    const { ctx } = await newCtx(browser, mock, ON.port, null);
    const a = await open(ctx, ON.port), b = await open(ctx, ON.port);
    mock.log = [];
    await Promise.all([a.page.evaluate(() => { state.level = "P6"; chooseLevel(); }), b.page.evaluate(() => { state.level = "P6"; chooseLevel(); })]);
    await waitStatus(a.page, ["profile-ok"]); await waitStatus(b.page, ["profile-ok"]);
    assert(mock.users === 1, "navigator.locks serialises the tabs: exactly ONE anonymous user created (" + mock.users + ")");
    assert(Object.keys(mock.profiles).length === 1, "exactly one profile row");
    assert(summary(mock).filter(s => /create_my_profile/.test(s)).length <= 2, "profile RPC attempted at most twice, duplicates tolerated");
    assert(await status(a.page) === "profile-ok" && await status(b.page) === "profile-ok", "both tabs end profile-ok, no errors: " + a.errors.concat(b.errors).length + " errors");
    await ctx.close();
  }

  console.log("\nTest 6: duplicate profile creation (server says 23505)");
  {
    mock.reset(); mock.users = 0; mock.profiles = {}; mock.tokens = {}; mock.dupOnce = true;
    const { ctx } = await newCtx(browser, mock, ON.port, null); const { page, errors, consoles } = await open(ctx, ON.port);
    await page.evaluate(() => { state.level = "P6"; chooseLevel(); });
    assert(await waitStatus(page, ["profile-ok"]) === "profile-ok", "23505 handled as success => profile-ok");
    assert(errors.length === 0 && !consoles.some(c => /^warning.*Ethixo auth/.test(c)), "no error, no warning");
    await ctx.close();
  }

  console.log("\nTest 7: network failure - silent, app unaffected, recovers by itself");
  {
    mock.reset(); mock.users = 0; mock.profiles = {}; mock.tokens = {}; mock.mode = "offline";
    const { ctx } = await newCtx(browser, mock, ON.port, null); const { page, errors } = await open(ctx, ON.port);
    const before = await (async () => { await page.evaluate(() => enterAsStudent()); await page.waitForTimeout(200); return screen(page); })();
    await page.evaluate(() => { state.level = "P6"; chooseLevel(); });
    assert(await waitStatus(page, ["degraded"]) === "degraded", "offline: status degraded");
    const shot = await screen(page);
    assert(/Subject|Mathematics|English|Science|Social/i.test(shot), "the student still lands on the normal Subject screen while offline");
    await page.evaluate(() => { sSet("attempts:P6:SS:2.1:1", [{ answer:"fake", score:1 }]); }); // the app keeps working locally
    assert(errors.length === 0, "no JavaScript error while offline");
    assert(!/error|failed|retry|offline|sign/i.test(shot.replace(/Sign out|sign-in wired/gi, "")), "no error / retry / sign-in text appears on screen");
    mock.mode = "ok"; // network returns before the 5 s retry fires
    assert(await waitStatus(page, ["profile-ok"], 9000) === "profile-ok", "after ~5 s the scheduled retry succeeds on its own");
    assert(Object.keys(mock.profiles).length === 1, "exactly one profile created after recovery");
    assert(await page.evaluate(() => JSON.stringify(sGet("attempts:P6:SS:2.1:1"))) === JSON.stringify([{ answer:"fake", score:1 }]), "local learning data written while offline is intact");
    await ctx.close();
  }

  console.log("\nTest 8: server errors - 500 and 429 retry quietly; 422 (anonymous disabled) stops");
  for(const [mode, expect] of [["e500", "degraded"], ["e429", "degraded"], ["e422", "disabled"]]){
    mock.reset(); mock.users = 0; mock.profiles = {}; mock.tokens = {}; mock.mode = mode;
    const { ctx } = await newCtx(browser, mock, ON.port, null); const { page, errors, consoles } = await open(ctx, ON.port);
    await page.evaluate(() => { state.level = "P6"; chooseLevel(); });
    const s = await waitStatus(page, [expect], 4000); await page.waitForTimeout(800);
    assert(s === expect, mode + " => status " + expect + " (got " + s + ")");
    assert(errors.length === 0, mode + ": no JavaScript errors; app still on the Subject screen: " + /Subject|Mathematics|English|Science|Social/i.test(await screen(page)));
    if(mode === "e422"){
      const n = reqs(mock).length; await page.evaluate(() => { goto("dashboard"); goto("subject"); }); await page.waitForTimeout(800);
      assert(reqs(mock).length === n, "422: no further requests (no retry loop)");
      assert(consoles.filter(c => /Ethixo auth/.test(c)).length === 1, "one code-only warning in the console: " + consoles.filter(c => /Ethixo auth/.test(c)).join(" / "));
    } else {
      assert(reqs(mock).length <= 2, mode + ": no tight loop (" + reqs(mock).length + " requests in ~5 s)");
    }
    await ctx.close();
  }

  console.log("\nTest 9: auth storage lost (session gone, local learning data kept) - new identity, local data untouched");
  {
    mock.reset(); mock.users = 0; mock.profiles = {}; mock.tokens = {};
    const seed = { activePersona:"student", chosenLevel:"P6", vault:[{ qid:"attempts:P6:SS:2.1:0", level:"P6", subjectKey:"SS", answer:"mine", score:2, savedAt:1760000000001 }] };
    const { ctx } = await newCtx(browser, mock, ON.port, seed); const { page } = await open(ctx, ON.port);
    await waitStatus(page, ["profile-ok"]);
    const firstUid = JSON.parse((await dumpLS(page)).ethixoAuthMeta).uid;
    const vaultBefore = (await dumpLS(page)).vault;
    await page.evaluate(() => { const P = Storage.prototype; P.removeItem.call(localStorage, "ethixoAuth"); P.removeItem.call(localStorage, "ethixoAuthMeta"); });
    await page.reload(); await page.waitForTimeout(400); await waitStatus(page, ["profile-ok"]);
    const ls = await dumpLS(page);
    assert(mock.users === 2 && Object.keys(mock.profiles).length === 2, "a second anonymous user + profile exists (the first is orphaned, as documented)");
    assert(JSON.parse(ls.ethixoAuthMeta).uid !== firstUid, "the identity marker now points at the new user");
    assert(ls.vault === vaultBefore, "the local Vault is byte-identical");
    await ctx.close();
  }

  console.log("\nTest 10: positive controls - the recorders can see violations");
  {
    mock.reset(); const { ctx } = await newCtx(browser, mock, ON.port, null); const { page } = await open(ctx, ON.port);
    await page.evaluate(() => fetch("https://mock-project.supabase.test/rest/v1/attempts").catch(() => {})); await page.waitForTimeout(400);
    assert(reqs(mock).some(e => /rest\/v1\/attempts/.test(e.path)), "mock recorder DOES see a deliberate attempts request");
    await ctx.close();
  }

  await browser.close(); [ON, WRONG, ORIG, OFF].forEach(x => x.srv.close()); fs.rmSync(tmp, { recursive:true, force:true });
  console.log("\n" + "=".repeat(50)); console.log("RESULTS: " + passed + " passed, " + failed + " failed"); console.log("=".repeat(50));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(2); });
