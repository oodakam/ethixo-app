// Phase 3 end-to-end test: REAL Chromium + the REAL vendored supabase-js, against a LOCAL MOCK Supabase.
// There is no real Supabase here: every request to the mock host is answered by this file (including a small PostgREST
// stand-in for public.attempts that applies the same ownership rules as the real grants/RLS), and every other non-local
// request is aborted. The committed index.html keeps its placeholders, DB_SYNC_MODE "off" and DB_ATTEMPTS_SYNC false; the
// flag-on builds used below exist only in a temp dir for the duration of this test.
// Run: node tests/attempts-sync-mock-supabase.test.js   (needs playwright-core + Chromium, like the other browser tests)
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");

const repo = path.join(__dirname, "..");
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let passed = 0, failed = 0;
function assert(c, m){ if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }
const MOCK_HOST = "mock-project.supabase.test", MOCK = "https://" + MOCK_HOST;
const MOCK_KEY = "sb_publishable_MOCKKEY0123456789";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const committed = fs.readFileSync(path.join(repo, "index.html"), "utf8");

function build(opts){
  opts = opts || {};
  const rep = [
    ['const DB_SYNC_MODE = "off";', 'const DB_SYNC_MODE = "shadow";'],
    ['const SUPABASE_URL = "__SET_ME__";', 'const SUPABASE_URL = "' + MOCK + '";'],
    ['const SUPABASE_PUBLISHABLE_KEY = "__SET_ME__";', 'const SUPABASE_PUBLISHABLE_KEY = "' + MOCK_KEY + '";'],
    ['const DB_SYNC_ALLOWED_HOSTS = [];\n', 'const DB_SYNC_ALLOWED_HOSTS = ' + JSON.stringify(opts.hosts || ["127.0.0.1"]) + ';\n'],
  ];
  if(opts.attempts) rep.push(["const DB_ATTEMPTS_SYNC = false;", "const DB_ATTEMPTS_SYNC = true;"]);
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

// ---------- the mock Supabase (auth + profiles + a PostgREST stand-in for attempts) ----------
function b64u(o){ return Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function makeMock(){
  const m = { mode:"ok", log:[], users:0, profiles:{}, tokens:{}, attempts:[], seq:0, studentIdSeen:false, otherTables:[] };
  m.reset = () => { m.mode = "ok"; m.log = []; m.studentIdSeen = false; m.otherTables = []; };
  m.handler = async function(route){
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": req.headers()["access-control-request-headers"] || "*", "access-control-expose-headers": "*" };
    if(method === "OPTIONS") return route.fulfill({ status:204, headers:cors });
    let body = null; try{ body = req.postData() ? JSON.parse(req.postData()) : null; }catch(e){ body = req.postData(); }
    const h = req.headers();
    const entry = { method, path: url.pathname, query: url.search, body, authz: h["authorization"] || "", prefer: h["prefer"] || "" };
    m.log.push(entry);
    if(m.mode === "offline") return route.abort("internetdisconnected");
    const json = (status, obj, extra) => route.fulfill({ status, headers:Object.assign({ "content-type":"application/json" }, cors, extra || {}), body: obj === undefined ? "" : JSON.stringify(obj) });
    if(m.mode === "e500") return json(500, { message:"boom" });
    if(url.pathname === "/auth/v1/signup" && method === "POST"){
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
      const want = (url.searchParams.get("id") || "").replace(/^eq\./, ""); const row = m.profiles[want] || null;
      const single = /vnd\.pgrst\.object/.test(h["accept"] || "");
      if(single) return row ? json(200, { id:row.id, role:row.role, level:row.level }) : json(406, { code:"PGRST116", message:"The result contains 0 rows" });
      return json(200, row ? [{ id:row.id, role:row.role, level:row.level }] : []);
    }
    if(url.pathname === "/rest/v1/rpc/create_my_profile" && method === "POST"){
      m.profiles[uid] = { id:uid, role:body.p_role, level:body.p_level, display_name:body.p_display_name };
      return route.fulfill({ status:204, headers:cors });
    }
    if(url.pathname === "/rest/v1/profiles" && method === "PATCH"){ return route.fulfill({ status:204, headers:cors }); }
    if(url.pathname === "/rest/v1/attempts"){
      const q = (k) => (url.searchParams.get(k) || "").replace(/^eq\./, "");
      const mine = m.attempts.filter(r => r.student_id === uid);
      if(method === "GET"){
        const rows = mine.filter(r => (!url.searchParams.get("level") || r.level === q("level")) && (!url.searchParams.get("subject_key") || r.subject_key === q("subject_key"))
          && (!url.searchParams.get("lesson_id") || r.lesson_id === q("lesson_id")) && (!url.searchParams.get("q_idx") || String(r.q_idx) === q("q_idx")));
        const single = /vnd\.pgrst\.object/.test(h["accept"] || "");
        const shape = (r) => ({ id:r.id, data:r.data });
        if(single) return rows.length ? json(200, shape(rows[0])) : json(406, { code:"PGRST116", message:"The result contains 0 rows" });
        return json(200, rows.map(shape));
      }
      if(method === "POST"){
        if(body && "student_id" in body){ m.studentIdSeen = true; if(body.student_id !== uid) return json(403, { code:"42501", message:"new row violates row-level security policy" }); }
        if(mine.some(r => r.level === body.level && r.subject_key === body.subject_key && r.lesson_id === body.lesson_id && r.q_idx === body.q_idx)) return json(409, { code:"23505", message:"duplicate key" });
        m.attempts.push({ id:"att-" + (++m.seq), student_id:uid, level:body.level, subject_key:body.subject_key, lesson_id:body.lesson_id, q_idx:body.q_idx, data:body.data });   // owner = token, never the client
        return route.fulfill({ status:201, headers:cors });
      }
      if(method === "PATCH"){
        if(body && "student_id" in body){ m.studentIdSeen = true; return json(403, { code:"42501", message:"permission denied for table attempts" }); }
        const r = mine.find(r => r.id === q("id"));
        if(r && body && "data" in body) r.data = body.data;
        return /return=representation/.test(entry.prefer) ? json(200, r ? [{ id:r.id }] : []) : route.fulfill({ status:204, headers:cors });
      }
    }
    if(/\/rest\/v1\/(vault_entries|student_state|class_members|classes|assignments)/.test(url.pathname)){ m.otherTables.push(url.pathname); return json(200, []); }
    return json(404, { code:"404", message:"mock: unexpected " + method + " " + url.pathname });
  };
  return m;
}

// ---------- harness ----------
async function newCtx(browser, mock, port, seed){
  const ctx = await browser.newContext({ viewport:{ width:1200, height:900 } });
  const other = [], local = [];
  await ctx.addInitScript((seedJson) => {
    const seed = JSON.parse(seedJson);
    if(seed && !sessionStorage.getItem("__seeded")){ sessionStorage.setItem("__seeded", "1"); Object.keys(seed).forEach(function(k){ localStorage.setItem(k, JSON.stringify(seed[k])); }); }
  }, JSON.stringify(seed || null));
  await ctx.route("**/*", function(route){
    const u = route.request().url();
    if(u.startsWith("http://127.0.0.1:" + port)){ local.push(u); return route.continue(); }
    if(u.startsWith(MOCK + "/")) return mock.handler(route);
    other.push(u); return route.abort();
  });
  return { ctx, other, local };
}
async function open(ctx, port){
  const page = await ctx.newPage(); const errors = [], consoles = [];
  page.on("pageerror", e => errors.push(String(e))); page.on("console", c => consoles.push(c.type() + ": " + c.text()));
  await page.goto("http://127.0.0.1:" + port + "/index.html", { waitUntil:"load" }); await page.waitForTimeout(500);
  return { page, errors, consoles };
}
const status = (page) => page.evaluate(() => ETHIXO_AUTH.status());
async function waitFor(fn, ms){ const t0 = Date.now(); while(Date.now() - t0 < (ms || 8000)){ if(await fn()) return true; await sleep(100); } return false; }
const screen = (page) => page.evaluate(() => document.getElementById("app").innerText.replace(/\s+/g, " ").trim());
const dumpLS = (page) => page.evaluate(() => { const o = {}; const P = Object.getPrototypeOf(localStorage); for(let i = 0; i < localStorage.length; i++){ const k = P.key.call(localStorage, i); o[k] = P.getItem.call(localStorage, k); } return o; });
const reqs = (mock) => mock.log.filter(e => e.method !== "OPTIONS");
const attReqs = (mock) => reqs(mock).filter(e => /\/rest\/v1\/attempts/.test(e.path));
const A = (at, score) => ({ answer:"fake practice answer " + at, score:score == null ? 1 : score, strengths:[], nextSteps:[], usedThinking:false, at:at });
const K0 = "attempts:P6:SS:2.1:0", K1 = "attempts:P6:SS:2.1:1";

(async function(){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ethixo-att-"));
  const mkSite = (name, html) => { const d = path.join(tmp, name); fs.mkdirSync(path.join(d, "assets", "vendor"), { recursive:true }); fs.writeFileSync(path.join(d, "index.html"), html);
    fs.copyFileSync(path.join(repo, "assets", "vendor", "supabase-js-2.117.2.umd.js"), path.join(d, "assets", "vendor", "supabase-js-2.117.2.umd.js")); return d; };
  const ON = await serve(mkSite("on", build({ attempts:true })));
  const AUTHONLY = await serve(mkSite("authonly", build({ attempts:false })));
  const WRONG = await serve(mkSite("wrong", build({ attempts:true, hosts:["ethixo-preview.example.test"] })));
  const ORIG = await serve(mkSite("orig", execFileSync("git", ["-C", repo, "show", "d0ebdf0:index.html"], { maxBuffer: 1 << 26 }).toString()));
  const OFF = await serve(mkSite("off", committed));
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const mock = makeMock();
  const goStudent = async (page) => { await page.evaluate(() => { enterAsStudent(); state.level = "P6"; chooseLevel(); }); };

  console.log("\nTest 0: the committed build is off on both switches; the test builds differ from it only in the intended lines");
  assert(/const DB_SYNC_MODE = "off";/.test(committed) && /const DB_ATTEMPTS_SYNC = false;/.test(committed), "committed index.html: DB_SYNC_MODE off, DB_ATTEMPTS_SYNC false");
  assert(build({ attempts:true }).split("\n").filter((l, i) => l !== committed.split("\n")[i]).length === 5, "the attempts-on test build differs in exactly 5 lines (4 config + 1 attempts switch)");

  console.log("\nTest 1: committed (off) build in a real browser - learning writes cause ZERO requests and create no sync keys");
  {
    mock.reset();
    const { ctx, other } = await newCtx(browser, mock, OFF.port, null);
    const { page, errors } = await open(ctx, OFF.port);
    await goStudent(page); await page.waitForTimeout(600);
    await page.evaluate(([k, v]) => sSet(k, v), [K0, [A(1)]]); await page.waitForTimeout(2500);
    const onlyFonts = other.every(u => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));   // the original app already loads its web font
    assert(reqs(mock).length === 0 && onlyFonts, "no request to Supabase; the only external requests are the original app's own web-font loads (mock " + reqs(mock).length + ", other " + other.length + ")");
    const ls = await dumpLS(page);
    assert(!Object.keys(ls).some(k => /^ethixo(Outbox|Auth|SyncKill)|^sb-/.test(k)), "no ethixoOutbox / ethixoAuth* / sb-* keys");
    assert(JSON.parse(ls[K0]).length === 1 && errors.length === 0, "the local attempt is stored normally and there are no JavaScript errors");
    await ctx.close();
  }

  console.log("\nTest 2: shadow auth ON but the attempts switch FALSE (the Phase 2 scope) - attempts are NOT uploaded");
  {
    mock.reset(); mock.attempts = [];
    const { ctx } = await newCtx(browser, mock, AUTHONLY.port, null);
    const { page } = await open(ctx, AUTHONLY.port);
    await goStudent(page); await waitFor(async () => await status(page) === "profile-ok");
    await page.evaluate(([k, v]) => sSet(k, v), [K0, [A(1)]]); await page.waitForTimeout(3500);
    assert(await status(page) === "profile-ok" && reqs(mock).some(e => /signup/.test(e.path)), "auth itself works (signed in, profile ok)");
    assert(attReqs(mock).length === 0 && mock.attempts.length === 0, "ZERO requests to /rest/v1/attempts and no remote row");
    assert(!("ethixoOutbox" in await dumpLS(page)) && await page.evaluate(() => ETHIXO_ATTEMPTS.status()) === "off", "no ethixoOutbox key; ETHIXO_ATTEMPTS.status() is off");
    await ctx.close();
  }

  console.log("\nTest 3: attempts ON on a non-allow-listed host - fully inert");
  {
    mock.reset(); mock.attempts = [];
    const { ctx } = await newCtx(browser, mock, WRONG.port, null);
    const { page } = await open(ctx, WRONG.port);
    await goStudent(page); await page.waitForTimeout(500);
    await page.evaluate(([k, v]) => sSet(k, v), [K0, [A(1)]]); await page.waitForTimeout(3000);
    assert(reqs(mock).length === 0 && !("ethixoOutbox" in await dumpLS(page)), "wrong host: zero requests, no outbox key");
    await ctx.close();
  }

  console.log("\nTest 4: attempts ON, allow-listed host - the first attempt is mirrored; ownership comes from the token");
  let ctx4, page4;
  {
    mock.reset(); mock.attempts = []; mock.users = 0; mock.profiles = {}; mock.tokens = {};
    const c = await newCtx(browser, mock, ON.port, null); ctx4 = c.ctx;
    const o = await open(ctx4, ON.port); page4 = o.page;
    await goStudent(page4); await waitFor(async () => await status(page4) === "profile-ok");
    mock.log = [];
    await page4.evaluate(([k, v]) => sSet(k, v), [K0, [A(1)]]);
    const ok = await waitFor(async () => mock.attempts.length === 1, 9000);
    assert(ok, "one remote attempts row appeared within the debounce window");
    const seq = reqs(mock).map(e => e.method + " " + e.path).join(" | ");
    assert(seq === "GET /rest/v1/attempts | POST /rest/v1/attempts", "request sequence: GET (look up) then POST (insert), no PATCH, no upsert (" + seq + ")");
    const post = reqs(mock).find(e => e.method === "POST");
    assert(Object.keys(post.body).sort().join() === "data,lesson_id,level,q_idx,subject_key", "POST body has exactly level, subject_key, lesson_id, q_idx, data");
    assert(mock.studentIdSeen === false, "student_id was never sent by the browser (in a body)");
    assert(!reqs(mock).some(e => /student_id/.test(e.query)), "student_id is not in any query string either");
    const row = mock.attempts[0];
    assert(row.student_id === "00000000-0000-4000-8000-000000000001" && row.level === "P6" && row.subject_key === "SS" && row.lesson_id === "2.1" && row.q_idx === 0, "the owner on the row is the signed-in user (assigned from the token by the server side)");
    assert(JSON.stringify(row.data) === JSON.stringify([A(1)]), "the remote data equals the local array exactly");
    assert(mock.otherTables.length === 0, "no request to vault_entries / student_state / class_members / classes / assignments");
    const ls = await dumpLS(page4);
    assert(JSON.parse(ls[K0]).length === 1 && JSON.stringify(JSON.parse(ls.ethixoOutbox || "[]")) === "[]", "local value intact; the outbox is empty again after the send");
  }

  console.log("\nTest 5: a later attempt on the same question - GET then PATCH { data } by row id; history is appended");
  {
    mock.log = [];
    await page4.evaluate(([k, v]) => sSet(k, v), [K0, [A(1), A(2, 0.5)]]);
    const ok = await waitFor(async () => mock.attempts[0].data.length === 2, 9000);
    assert(ok, "the remote array grew to 2 attempts");
    const seq = reqs(mock).map(e => e.method + " " + e.path).join(" | ");
    assert(seq === "GET /rest/v1/attempts | PATCH /rest/v1/attempts", "request sequence: GET then PATCH (" + seq + ")");
    const patch = reqs(mock).find(e => e.method === "PATCH");
    assert(Object.keys(patch.body).join() === "data" && /id=eq\.att-1/.test(patch.query) && /return=representation/.test(patch.prefer), "PATCH body is exactly { data }, addressed by row id, asking for the id back");
    assert(mock.studentIdSeen === false && mock.attempts.length === 1, "student_id never sent; still exactly one row");
    // an identical re-write (double click) sends only the look-up
    mock.log = [];
    await page4.evaluate(([k, v]) => sSet(k, v), [K0, [A(1), A(2, 0.5)]]);
    await waitFor(async () => attReqs(mock).length >= 1, 9000); await page4.waitForTimeout(800);
    assert(reqs(mock).map(e => e.method).join() === "GET", "an identical re-write: GET only, no POST/PATCH (idempotent)");
  }

  console.log("\nTest 6: other learning data stays local (vault, timelog, lastLesson) and nothing else leaves the browser");
  {
    mock.log = [];
    await page4.evaluate(() => { sSet("vault", [{ qid:"attempts:P6:SS:2.1:0", level:"P6", subjectKey:"SS", answer:"fake", score:1, savedAt:2 }]); sSet("timelog", { a:5 }); sSet("lastLesson", { level:"P6", subjectKey:"SS", lessonId:"2.1" }); sSet("attempts:P6:SS:2.1:custom-1", [{ answer:"c", score:1, at:3 }]); });
    await page4.waitForTimeout(4000);
    assert(reqs(mock).length === 0, "vault / timelog / lastLesson / custom-question writes cause ZERO requests");
    assert(mock.otherTables.length === 0 && mock.attempts.length === 1, "no other table touched; no row for the custom question");
  }

  console.log("\nTest 7: a second question gets its own row");
  {
    mock.log = [];
    await page4.evaluate(([k, v]) => sSet(k, v), [K1, [A(10)]]);
    await waitFor(async () => mock.attempts.length === 2, 9000);
    assert(mock.attempts.length === 2 && mock.attempts[1].q_idx === 1 && mock.attempts[1].student_id === mock.attempts[0].student_id, "two rows, same owner, q_idx 0 and 1");
  }

  console.log("\nTest 8: offline / server error - the student sees nothing, local data is untouched, and it catches up");
  {
    const before = await screen(page4);
    const localBefore = (await dumpLS(page4))[K0];
    mock.mode = "offline"; mock.log = [];
    await page4.evaluate(([k, v]) => sSet(k, v), [K0, [A(1), A(2, 0.5), A(3, 1)]]);
    // supabase-js itself retries a failed GET a few times (1 s, 2 s, 4 s) before reporting the error, so the first failure is only
    // recorded after ~9 s; wait for it rather than assume a timing.
    await waitFor(async () => { const ob = JSON.parse((await dumpLS(page4)).ethixoOutbox || "[]"); return ob.length === 1 && ob[0].tries >= 1; }, 20000);
    const outbox = JSON.parse((await dumpLS(page4)).ethixoOutbox || "[]");
    assert(outbox.length === 1 && outbox[0].key === K0 && outbox[0].tries >= 1 && outbox[0].value === null, "the attempt waits in the outbox (key only), tries >= 1 " + JSON.stringify(outbox));
    assert(JSON.parse((await dumpLS(page4))[K0]).length === 3, "the local attempts array has all 3 attempts");
    assert(await screen(page4) === before, "the screen is unchanged: no error, toast or banner");
    assert(mock.attempts[0].data.length === 2, "remote still has the old 2 attempts");
    mock.mode = "ok"; await page4.evaluate(() => window.dispatchEvent(new Event("online")));
    const ok = await waitFor(async () => mock.attempts[0].data.length === 3, 16000);
    assert(ok, "after the connection returns it catches up on its own (remote now has 3 attempts)");
    assert(JSON.parse((await dumpLS(page4)).ethixoOutbox || "[]").length === 0, "the outbox drains to empty");
    mock.mode = "e500"; mock.log = [];
    await page4.evaluate(([k, v]) => sSet(k, v), [K1, [A(10), A(11)]]); await page4.waitForTimeout(3500);
    assert(JSON.parse((await dumpLS(page4))[K1]).length === 2 && await screen(page4) === before, "HTTP 500: local intact, screen unchanged");
    mock.mode = "ok";
  }

  console.log("\nTest 9: no extra hosts, no secrets, no errors");
  {
    assert(!reqs(mock).some(e => /sb_secret|service_role/.test(JSON.stringify(e))), "no secret key anywhere in the traffic");
    assert(reqs(mock).every(e => /^(GET|POST|PATCH)$/.test(e.method)), "only GET / POST / PATCH are ever used (no DELETE, no PUT)");
    await ctx4.close();
  }

  console.log("\nTest 10: the learning screens are identical to the original app with attempts sync active");
  {
    const seed = { [K0]: [A(1, 0), A(2, 1)], [K1]: [A(5, 0.5)], chosenLevel:"P6" };
    const run = async (port, label) => {
      mock.reset(); mock.attempts = []; mock.users = 0; mock.profiles = {}; mock.tokens = {};
      const c = await newCtx(browser, mock, port, seed); const o = await open(c.ctx, port);
      const shots = {}; const snap = async (n) => { shots[n] = await screen(o.page); };
      await snap("landing");
      await o.page.evaluate(() => enterAsStudent()); await o.page.waitForTimeout(300); await snap("afterEnterStudent");
      await o.page.evaluate(() => { state.level = "P6"; chooseLevel(); }); await o.page.waitForTimeout(400); await snap("afterChooseLevel");
      if(port !== ORIG.port) await waitFor(async () => await status(o.page) === "profile-ok");
      await o.page.evaluate(() => goto("dashboard")); await o.page.waitForTimeout(400); await snap("dashboard");
      await o.page.evaluate(() => { if(typeof goto === "function") goto("vault"); }); await o.page.waitForTimeout(300); await snap("vault");
      const ls = await dumpLS(o.page);
      await o.page.waitForTimeout(500);
      const res = { shots, ls, errors:o.errors.slice() }; await c.ctx.close(); return res;
    };
    const o = await run(ORIG.port, "orig"), n = await run(ON.port, "on");
    Object.keys(o.shots).forEach(k => { if(o.shots[k] !== n.shots[k]) console.log("      DIFF at " + k + "\n        old: " + o.shots[k].slice(0, 150) + "\n        new: " + n.shots[k].slice(0, 150)); });
    assert(Object.keys(o.shots).every(k => o.shots[k] === n.shots[k]), "every rendered screen is identical to the ORIGINAL app (" + Object.keys(o.shots).length + " screens, with seeded attempts)");
    assert(JSON.stringify(JSON.parse(n.ls[K0])) === JSON.stringify(seed[K0]) && JSON.stringify(JSON.parse(n.ls[K1])) === JSON.stringify(seed[K1]), "seeded attempts are byte-identical afterwards (existing local history is never modified)");
    assert(o.errors.length === 0 && n.errors.length === 0, "no JavaScript errors in either");
    assert(attReqs(mock).length === 0, "existing local history is NOT backfilled (that is Phase 4's opt-in step): no attempts request without a new write");
  }

  await browser.close();
  [ON, AUTHONLY, WRONG, ORIG, OFF].forEach(s => s.srv.close());
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
  console.log("\n==================================================\nRESULTS: " + passed + " passed, " + failed + " failed\n==================================================");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("TEST CRASHED:", e); process.exit(2); });
