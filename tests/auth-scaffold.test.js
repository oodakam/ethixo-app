// Unit tests for the ETHIXO-AUTH block in index.html (Phase 2: student anonymous sign-in + profile).
// Pure node: no browser, no network, no real Supabase. The CONFIG + SYNC + AUTH blocks are extracted by marker
// and evaluated in isolation with injected fakes. Run: node tests/auth-scaffold.test.js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

let passed = 0, failed = 0;
function assert(cond, msg){ if(cond){ passed++; console.log("  PASS:", msg); } else { failed++; console.log("  FAIL:", msg); } }
const tick = async (n) => { for(let i = 0; i < (n || 12); i++) await new Promise(r => setImmediate(r)); };

const bCfg = html.indexOf("/* ETHIXO-CONFIG-BEGIN"), bAuth = html.indexOf("/* ETHIXO-AUTH-BEGIN"), eAuth = html.indexOf("/* ETHIXO-AUTH-END */");
if(bCfg < 0 || bAuth < 0 || eAuth < bAuth){ console.log("FAIL: markers not found"); process.exit(1); }
const fullSrc = html.slice(bCfg, eAuth);                       // config + sync + auth (contiguous in the file)
const authSrc = html.slice(bAuth, eAuth);
const authCode = authSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/ \/\/ .*$/gm, ""); // comments removed
const factory = new Function(fullSrc + "; return { createEthixoSync, createEthixoAuth, ETHIXO_AUTH, ETHIXO_SYNC, DB_SYNC_MODE, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DB_SYNC_ALLOWED_HOSTS, SUPABASE_LIB_PATH };");
const mod = factory();
const { createEthixoSync, createEthixoAuth } = mod;

// ---------- doubles ----------
function fakeStorage(seed){
  const data = Object.assign({}, seed || {}); const log = [];
  return { data, log,
    getItem(k){ log.push(["get", k]); return k in data ? data[k] : null; },
    setItem(k, v){ log.push(["set", k]); data[k] = String(v); },
    removeItem(k){ log.push(["remove", k]); delete data[k]; } };
}
function fakeClient(script){
  script = script || {};
  const calls = [];
  const c = { calls, script,
    auth: {
      getSession: async function(){ calls.push(["getSession"]); if(script.getSessionError) return { data:{ session:null }, error:script.getSessionError }; return { data:{ session: script.session || null }, error:null }; },
      signInAnonymously: async function(){
        calls.push(["signInAnonymously"]);
        if(script.signInErrors && script.signInErrors.length){ const e = script.signInErrors.shift(); if(e === "throw") throw new TypeError("Failed to fetch"); return { data:{ session:null }, error:e }; }
        script.session = { user:{ id: script.nextUid || "uid-1" }, access_token:"SECRET-TOKEN-xyz" };
        return { data:{ session: script.session }, error:null };
      },
      signOut: async function(o){ calls.push(["signOut", o]); script.session = null; return { error:null }; },
    },
    from: function(t){
      calls.push(["from", t]);
      const q = {
        select: function(cols){ calls.push(["select", cols]); return q; },
        eq: function(col, v){ calls.push(["eq", col, v]); return q; },
        maybeSingle: async function(){ const r = (script.selectQueue && script.selectQueue.length) ? script.selectQueue.shift() : { data:null, error:null }; return r; },
        update: function(p){ calls.push(["update", p]); return { eq: function(col, v){ calls.push(["eq", col, v]); return Promise.resolve(script.updateResult || { error:null }); } }; },
      };
      return q;
    },
    rpc: async function(name, args){
      calls.push(["rpc", name, args]);
      if(script.rpcResults && script.rpcResults.length) return script.rpcResults.shift();
      return { data:null, error:null };
    },
  };
  return c;
}
function make(over, scriptOver){
  over = over || {};
  const storage = over.storage || fakeStorage();
  const spies = { timers:[], cleared:[], listeners:[], warns:[], lockCalls:0, libraryLoads:0, now: 1000000 };
  const client = fakeClient(scriptOver);
  const created = [];
  const syncMode = over.syncMode || "shadow";
  const sync = over.sync || createEthixoSync({ mode: syncMode, getStorage: () => storage, allowedHosts: over.allowedHosts, getHost: over.getHost });
  const cfg = over.config || { url:"https://mock-project.supabase.test", key:"sb_publishable_TESTKEY", libPath:"x.js" };
  const auth = createEthixoAuth({
    mode: over.mode === undefined ? "shadow" : over.mode, sync: sync, config: cfg, getStorage: () => storage,
    now: () => spies.now,
    setTimer: (fn, ms) => { const t = { fn, ms, id: spies.timers.length + 1 }; spies.timers.push(t); return t.id; },
    clearTimer: (id) => { spies.cleared.push(id); },
    getLocks: over.getLocks || (() => ({ request: (name, fn) => { spies.lockCalls++; return fn(); } })),
    addListener: (type, fn) => { spies.listeners.push({ type, fn }); },
    isVisible: () => true,
    warn: (m) => { spies.warns.push(m); },
    loadLibrary: over.loadLibrary || (async () => { spies.libraryLoads++; return { createClient: (u, k, o) => { created.push({ u, k, o }); return client; } }; }),
  });
  return { auth, client, storage, spies, created, sync };
}
const OK_PROFILE = { data:{ id:"uid-1", role:"student", level:"P6" }, error:null };

(async function(){

console.log("\nTest 1: shipped defaults are OFF and placeholders only");
assert(mod.DB_SYNC_MODE === "off", "DB_SYNC_MODE is \"off\"");
assert(/const DB_SYNC_MODE = "off";/.test(html), "source line is const DB_SYNC_MODE = \"off\";");
assert(mod.SUPABASE_URL === "__SET_ME__" && mod.SUPABASE_PUBLISHABLE_KEY === "__SET_ME__", "URL and key are placeholders (no real endpoint or key in the branch)");
assert(Array.isArray(mod.DB_SYNC_ALLOWED_HOSTS) && mod.DB_SYNC_ALLOWED_HOSTS.length === 0, "allow-list ships empty");
assert(!/[a-z0-9]{20}\.supabase\.co/i.test(html), "no project-ref supabase.co URL anywhere in index.html");
assert(!/sb_publishable_[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,}\./.test(html), "no key-looking string in index.html");
assert(mod.ETHIXO_AUTH.status() === "off", "shipped ETHIXO_AUTH reports status off");

console.log("\nTest 2: OFF guarantee - the SHIPPED instance touches no global at all, even when called");
{
  const boom = (name) => new Proxy({}, { get(){ throw new Error("ACCESSED " + name); }, set(){ throw new Error("ACCESSED " + name); }, has(){ throw new Error("ACCESSED " + name); } });
  const names = ["localStorage", "sessionStorage", "window", "document", "navigator", "location", "setTimeout", "setInterval", "clearTimeout", "fetch", "XMLHttpRequest", "WebSocket", "console"];
  const f = new Function(...names, fullSrc + "; return ETHIXO_AUTH;");
  let inst, threw = null;
  try{
    inst = f(...names.map(boom));
    const r = [inst.studentActive("P6"), inst.studentActive("P5"), inst.studentActive("P4"), inst.studentActive(null), inst.studentActive()];
    assert(r.every(v => v === undefined), "studentActive returns immediately (undefined) for valid and invalid levels");
    assert(inst.status() === "off" && inst.identityChanged() === false, "status stays off, identityChanged false");
  }catch(e){ threw = e; }
  assert(threw === null, "no access to localStorage/window/document/navigator/location/timers/fetch/console (" + (threw && threw.message) + ")");
}
{
  const m = make({ mode: "off" });
  const r = m.auth.studentActive("P6"); await tick();
  assert(r === undefined, "mode off: returns undefined");
  assert(m.storage.log.length === 0, "mode off: zero storage accesses (reads/writes/kill-switch)");
  assert(m.spies.libraryLoads === 0 && m.created.length === 0, "mode off: library not loaded, no client created");
  assert(m.client.calls.length === 0, "mode off: no auth/db call of any kind");
  assert(m.spies.timers.length === 0 && m.spies.listeners.length === 0 && m.spies.lockCalls === 0, "mode off: no timers, no listeners, no locks");
  assert(m.auth.status() === "off", "mode off: status off");
}

console.log("\nTest 3: other gates (kill switch, host allow-list, bad level) keep it inert even with the flag on");
{
  const st = fakeStorage({ ethixoSyncKill: "1" });
  const m = make({ storage: st });
  m.auth.studentActive("P6"); await tick();
  assert(m.client.calls.length === 0 && m.spies.libraryLoads === 0 && m.spies.timers.length === 0, "kill switch set: nothing happens");
  assert(!st.log.some(a => /ethixoAuth|sb-/.test(a[1])), "kill switch set: no auth keys touched");
}
{
  const m = make({ allowedHosts: ["preview-branch.example.test"], getHost: () => "ethixo.ai" });
  m.auth.studentActive("P6"); await tick();
  assert(m.sync.mode() === "off", "host ethixo.ai not on the allow-list => sync.mode() is off");
  assert(m.client.calls.length === 0 && m.spies.libraryLoads === 0, "host not allow-listed: nothing happens");
  const m2 = make({ allowedHosts: ["preview-branch.example.test"], getHost: () => "test.ethixo.ai" });
  m2.auth.studentActive("P6"); await tick();
  assert(m2.client.calls.length === 0, "test.ethixo.ai not on the allow-list: nothing happens");
  const m3 = make({ allowedHosts: ["preview-branch.example.test"], getHost: () => "preview-branch.example.test" }, { selectQueue:[{ data:null, error:null }] });
  m3.auth.studentActive("P6"); await tick();
  assert(m3.auth.status() === "profile-ok", "allow-listed host + flag on: runs (positive control)");
  const m4 = make({ allowedHosts: ["x.test"], getHost: () => { throw new Error("no location"); } });
  m4.auth.studentActive("P6"); await tick();
  assert(m4.sync.mode() === "off" && m4.client.calls.length === 0, "host lookup failure => off");
}
for(const bad of ["P4", "p6", "", null, undefined, "P6 ", 6, {}, "__proto__", "constructor"]){
  const m = make(); m.auth.studentActive(bad); await tick();
  assert(m.client.calls.length === 0 && m.spies.libraryLoads === 0, "invalid level " + JSON.stringify(bad) + ": no sign-in, library not loaded");
}

console.log("\nTest 4: fresh visitor - one anonymous sign-in, one profile RPC with exactly the approved payload");
{
  const m = make({}, { selectQueue:[{ data:null, error:null }] });
  const r = m.auth.studentActive("P6");
  assert(r && typeof r.then === "function", "returns a promise when active (callers ignore it)");
  await r;
  const names = m.client.calls.map(c => c[0]);
  assert(m.client.calls.filter(c => c[0] === "signInAnonymously").length === 1, "exactly one signInAnonymously");
  assert(m.client.calls.filter(c => c[0] === "rpc").length === 1, "exactly one rpc call");
  const rpc = m.client.calls.find(c => c[0] === "rpc");
  assert(rpc[1] === "create_my_profile", "rpc is create_my_profile");
  assert(JSON.stringify(Object.keys(rpc[2]).sort()) === JSON.stringify(["p_display_name", "p_level", "p_role"]), "payload keys are exactly p_role, p_display_name, p_level (no extras)");
  assert(rpc[2].p_role === "student" && rpc[2].p_display_name === "Student" && rpc[2].p_level === "P6", "payload values: student / Student / P6");
  assert(m.client.calls.filter(c => c[0] === "from").every(c => c[1] === "profiles"), "only the profiles table is ever addressed");
  assert(names.indexOf("getSession") < names.indexOf("signInAnonymously") && names.indexOf("signInAnonymously") < names.indexOf("rpc"), "order: getSession -> signInAnonymously -> rpc");
  assert(m.auth.status() === "profile-ok", "status profile-ok");
  assert(m.created.length === 1, "client created once");
  const o = m.created[0].o.auth;
  assert(o.persistSession === true && o.autoRefreshToken === true && o.detectSessionInUrl === false && o.flowType === "pkce" && o.storageKey === "ethixoAuth", "client options: persist, refresh, no URL detection, pkce, key ethixoAuth");
  assert(m.spies.lockCalls === 1, "cross-tab lock requested once");
  const meta = JSON.parse(m.storage.data.ethixoAuthMeta || "null");
  assert(meta && meta.uid === "uid-1" && typeof meta.at === "number" && Object.keys(meta).length === 2, "ethixoAuthMeta = {uid, at} only");
  const touched = Array.from(new Set(m.storage.log.map(a => a[1]))).sort();
  assert(JSON.stringify(touched) === JSON.stringify(["ethixoAuthMeta", "ethixoSyncKill"]), "only ethixoAuthMeta (+ the existing kill-switch read) touched in storage: " + touched.join(","));
  assert(!m.storage.log.some(a => a[0] !== "get" && a[1] !== "ethixoAuthMeta"), "the only storage WRITE is ethixoAuthMeta");
  assert(m.sync.outbox().length === 0 && !("ethixoOutbox" in m.storage.data), "outbox untouched, no ethixoOutbox key (no sender registered)");
}

console.log("\nTest 5: returning student - no new sign-in, no new profile");
{
  const m = make({}, { session:{ user:{ id:"uid-1" } }, selectQueue:[OK_PROFILE] });
  await m.auth.studentActive("P6");
  const names = m.client.calls.map(c => c[0]);
  assert(!names.includes("signInAnonymously") && !names.includes("rpc") && !names.includes("update"), "no signIn / rpc / update");
  assert(m.auth.status() === "profile-ok", "status profile-ok");
}
{
  const m = make({}, { session:{ user:{ id:"uid-1" } }, selectQueue:[{ data:{ id:"uid-1", role:"student", level:"P5" }, error:null }] });
  await m.auth.studentActive("P6");
  const up = m.client.calls.filter(c => c[0] === "update");
  assert(up.length === 1 && JSON.stringify(up[0][1]) === JSON.stringify({ level:"P6" }), "level mismatch: exactly one update, of level only");
  assert(!m.client.calls.some(c => c[0] === "rpc"), "level mismatch: no second profile created");
}

console.log("\nTest 6: duplicate profile (23505) is success");
{
  const m = make({}, { selectQueue:[{ data:null, error:null }, OK_PROFILE], rpcResults:[{ data:null, error:{ code:"23505", message:"profile already exists" } }] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "profile-ok", "23505 => profile-ok");
  assert(m.spies.timers.length === 0 && m.spies.warns.length === 0, "no retry, no warning");
  assert(m.client.calls.filter(c => c[0] === "rpc").length === 1, "rpc not repeated");
}
{
  const m = make({}, { selectQueue:[{ data:null, error:null }, { data:null, error:null }], rpcResults:[{ data:null, error:{ code:"23505", message:"x" } }] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "profile-ok", "23505 then re-select empty still does not crash");
}

console.log("\nTest 7: coalescing - simultaneous calls make one sign-in and one profile");
{
  const m = make({}, { selectQueue:[{ data:null, error:null }] });
  const a = m.auth.studentActive("P6"), b = m.auth.studentActive("P6"), c = m.auth.studentActive("P6");
  await Promise.all([a, b, c]);
  assert(m.client.calls.filter(x => x[0] === "signInAnonymously").length === 1, "one signInAnonymously");
  assert(m.client.calls.filter(x => x[0] === "rpc").length === 1, "one rpc");
  assert(m.created.length === 1, "one client");
}

console.log("\nTest 8: network failure - silent, backoff 5s/30s/5min, parked after 6, never throws");
{
  const errs = []; for(let i = 0; i < 8; i++) errs.push("throw");
  const m = make({}, { signInErrors: errs, selectQueue:[{ data:null, error:null }] });
  let threw = false;
  try{ await m.auth.studentActive("P6"); }catch(e){ threw = true; }
  assert(!threw, "studentActive never rejects");
  assert(m.auth.status() === "degraded", "status degraded");
  assert(m.spies.timers.length === 1 && m.spies.timers[0].ms === 5000, "first retry scheduled at 5 s");
  assert(m.spies.listeners.map(l => l.type).sort().join() === "online,visibilitychange", "online + visibilitychange listeners attached only now");
  const seq = [m.spies.timers[0].ms];
  for(let i = 0; i < 5; i++){ const t = m.spies.timers[m.spies.timers.length - 1]; t.fn(); await tick(); if(m.spies.timers.length > seq.length) seq.push(m.spies.timers[m.spies.timers.length - 1].ms); }
  assert(JSON.stringify(seq) === JSON.stringify([5000, 30000, 300000, 300000, 300000, 300000]), "backoff sequence 5s,30s,5min,5min,5min,5min: " + seq.join(","));
  const before = m.spies.timers.length;
  m.spies.timers[m.spies.timers.length - 1].fn(); await tick();
  assert(m.spies.timers.length === before, "after 6 retries no further timer is scheduled (parked)");
  assert(m.client.calls.filter(c => c[0] === "signInAnonymously").length === 7, "total attempts = 1 + 6 retries");
  assert(m.spies.warns.length === 1 && /gave-up/.test(m.spies.warns[0]), "a single warning, code only");
}
{
  const m = make({}, { signInErrors:["throw"], selectQueue:[{ data:null, error:null }] });
  await m.auth.studentActive("P6");
  m.spies.timers[0].fn(); await tick();
  assert(m.auth.status() === "profile-ok", "retry after a transient failure completes the profile");
  assert(m.client.calls.filter(c => c[0] === "rpc").length === 1, "still exactly one profile created");
}
{
  const m = make({}, { signInErrors:["throw", "throw"], selectQueue:[{ data:null, error:null }] });
  await m.auth.studentActive("P6");
  m.spies.now += 60000;
  m.spies.listeners.find(l => l.type === "online").fn(); await tick();
  assert(m.client.calls.filter(c => c[0] === "signInAnonymously").length === 2, "online event after cooldown triggers one retry");
  const n = m.client.calls.length; m.spies.listeners.find(l => l.type === "online").fn(); await tick();
  assert(m.client.calls.length === n, "an immediate second online event is ignored (30 s cooldown)");
}
{
  const m = make({}, { signInErrors:[{ status:503, message:"x" }], selectQueue:[{ data:null, error:null }] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "degraded" && m.spies.timers.length === 1, "HTTP 5xx retries with backoff");
}

console.log("\nTest 9: library fetch failure is retried (offline), not fatal");
{
  let n = 0;
  const m = make({ loadLibrary: async () => { n++; if(n === 1) throw new Error("library load failed"); return { createClient: () => m.client }; } }, { selectQueue:[{ data:null, error:null }] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "degraded" && m.spies.timers.length === 1, "first library failure => degraded + retry");
  m.spies.timers[0].fn(); await tick();
  assert(m.auth.status() === "profile-ok", "second try loads the library and completes");
}

console.log("\nTest 10: rate limit and configuration errors");
{
  const m = make({}, { signInErrors:[{ status:429, code:"over_request_rate_limit", message:"x", retryAfter:120 }] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "degraded" && m.spies.timers[0].ms === 120000, "429 honours Retry-After (120 s) and does not loop tightly");
}
for(const err of [{ status:422, code:"anonymous_provider_disabled", message:"x" }, { status:400, code:"captcha_failed", message:"x" }, { status:403, code:"signup_disabled", message:"x" }, { status:401, message:"Invalid API key" }]){
  const m = make({}, { signInErrors:[err] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "disabled" && m.spies.timers.length === 0 && m.spies.listeners.length === 0, "config error " + (err.code || err.status) + " => disabled, no retry timer/listener");
  const n = m.client.calls.length; await m.auth.studentActive("P6");
  assert(m.client.calls.length === n, "disabled stays disabled for later calls in this page life");
  assert(m.spies.warns.length === 1, "one warning only");
}
{
  const m = make({}, { selectQueue:[{ data:null, error:null }], rpcResults:[{ data:null, error:{ code:"42501", message:"anonymous teacher" } }] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "disabled", "42501 from the RPC => disabled");
}

console.log("\nTest 11: key + URL guards - nothing is loaded or sent with bad configuration");
{
  const secret = "sb_secret_" + "A".repeat(20);
  const jwt = (role) => "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role })).toString("base64").replace(/=/g, "") + ".sig";
  const a = createEthixoAuth({ mode:"shadow", sync:{ mode:() => "shadow" } });
  assert(a.keyProblem(secret) === "secret-key", "sb_secret_ key rejected");
  assert(a.keyProblem(jwt("service_role")) === "service-role-key", "service_role JWT rejected");
  assert(a.keyProblem(jwt("anon")) === null, "anon JWT accepted");
  assert(a.keyProblem("sb_publishable_abc") === null, "sb_publishable_ key accepted");
  assert(a.keyProblem("__SET_ME__") === "placeholder" && a.keyProblem("") === "placeholder" && a.keyProblem(null) === "placeholder", "placeholder / empty / null rejected");
  assert(a.keyProblem("random") === "unrecognised-key", "unrecognised key rejected");
  assert(a.urlProblem("__SET_ME__") === "placeholder" && a.urlProblem("http://x.supabase.co") === "bad-url" && a.urlProblem("https://abc.supabase.co") === null, "URL guard: placeholder / http rejected, https accepted");
  for(const cfg of [{ url:"__SET_ME__", key:"__SET_ME__" }, { url:"https://abc.supabase.co", key:secret }, { url:"https://abc.supabase.co", key:jwt("service_role") }, { url:"http://abc.supabase.co", key:"sb_publishable_x" }]){
    const m = make({ config: Object.assign({ libPath:"x.js" }, cfg) });
    await m.auth.studentActive("P6");
    assert(m.auth.status() === "disabled" && m.spies.libraryLoads === 0 && m.client.calls.length === 0 && m.spies.timers.length === 0, "bad config (" + cfg.key.slice(0, 12) + ") => disabled, library never loaded, no request");
  }
}

console.log("\nTest 12: session lost mid-flight (28000) - one fresh identity, never a loop");
{
  const m = make({}, { session:{ user:{ id:"old" } }, nextUid:"uid-new", selectQueue:[{ data:null, error:null }, { data:null, error:null }],
    rpcResults:[{ data:null, error:{ code:"28000", message:"not authenticated" } }, { data:null, error:null }] });
  await m.auth.studentActive("P6");
  assert(m.client.calls.some(c => c[0] === "signOut" && c[1] && c[1].scope === "local"), "local (not server) sign-out");
  assert(m.client.calls.filter(c => c[0] === "signInAnonymously").length === 1, "one new anonymous identity");
  assert(m.auth.status() === "profile-ok", "ends profile-ok");
}
{
  const m = make({}, { session:{ user:{ id:"old" } }, selectQueue:[{ data:null, error:null }, { data:null, error:null }, { data:null, error:null }],
    rpcResults:[{ data:null, error:{ code:"28000", message:"x" } }, { data:null, error:{ code:"28000", message:"x" } }, { data:null, error:{ code:"28000", message:"x" } }] });
  await m.auth.studentActive("P6");
  assert(m.client.calls.filter(c => c[0] === "signOut").length === 1, "repeated 28000 does not loop (one local sign-out)");
  assert(m.auth.status() === "degraded", "falls back to ordinary backoff");
}

console.log("\nTest 13: profile owned by a non-student is never modified");
{
  const m = make({}, { session:{ user:{ id:"uid-1" } }, selectQueue:[{ data:{ id:"uid-1", role:"teacher", level:null }, error:null }] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "disabled", "teacher profile => disabled");
  assert(!m.client.calls.some(c => c[0] === "update" || c[0] === "rpc"), "no update / rpc");
}

console.log("\nTest 14: identity change marker");
{
  const st = fakeStorage({ ethixoAuthMeta: JSON.stringify({ uid:"older-uid", at: 1 }) });
  const m = make({ storage: st }, { session:{ user:{ id:"uid-1" } }, selectQueue:[OK_PROFILE] });
  await m.auth.studentActive("P6");
  assert(m.auth.identityChanged() === true, "different uid => identityChanged true (in memory only)");
  assert(JSON.parse(st.data.ethixoAuthMeta).uid === "uid-1", "marker updated");
  const st2 = fakeStorage({ ethixoAuthMeta: JSON.stringify({ uid:"uid-1", at: 1 }) });
  const m2 = make({ storage: st2 }, { session:{ user:{ id:"uid-1" } }, selectQueue:[OK_PROFILE] });
  await m2.auth.studentActive("P6");
  assert(m2.auth.identityChanged() === false && !st2.log.some(a => a[0] === "set"), "same uid => no change, no rewrite");
}

console.log("\nTest 15: privacy - warnings carry codes only; nothing sensitive is logged or sent");
{
  const m = make({}, { signInErrors:[{ status:422, code:"anonymous_provider_disabled", message:"uid-1 SECRET-TOKEN-xyz leaked?" }] });
  await m.auth.studentActive("P6");
  assert(m.spies.warns.length === 1 && !/uid-|SECRET|TOKEN|@/.test(m.spies.warns[0]), "warning has no uid, token, or message text: " + JSON.stringify(m.spies.warns));
  const m2 = make({}, { selectQueue:[{ data:null, error:null }] });
  await m2.auth.studentActive("P6");
  const sent = JSON.stringify(m2.client.calls);
  assert(!/student_id|email|password|phone|answer|attempt|vault|feedback/i.test(sent), "nothing but the approved fields appears in any call");
}

console.log("\nTest 16: source assertions on the AUTH block");
{
  assert(!/\.delete\s*\(|\.insert\s*\(|\.upsert\s*\(/.test(authSrc), "no delete / insert / upsert calls");
  assert((authSrc.match(/\.from\(\s*"([a-z_]+)"/g) || []).every(s => /"profiles"/.test(s)) && (authSrc.match(/\.from\(/g) || []).length >= 1, "every .from() targets profiles");
  assert((authSrc.match(/\.rpc\(\s*"([a-z_]+)"/g) || []).length === 1 && /\.rpc\(\s*"create_my_profile"/.test(authSrc), "the only rpc is create_my_profile");
  assert(!/attempts|vault_entries|student_state|setSender|sSet\(|sGet\(|innerHTML|render\(|toast|alert\(|console\.(log|error)/.test(authCode), "no learning tables, no sender registration, no sSet/sGet, no UI calls, no console.log/error");
  assert(!/setInterval|requestAnimationFrame|new WebSocket|XMLHttpRequest|\bfetch\s*\(|sendBeacon/.test(authSrc), "no polling, WebSocket, XHR, fetch or beacon of its own");
}

console.log("\nTest 17: existing functions are untouched; exactly three guarded call sites");
{
  const orig = execFileSync("git", ["show", "7b7cfd0:index.html"], { cwd: path.join(__dirname, ".."), maxBuffer: 50e6 }).toString();
  const line = (src, re) => (src.match(re) || [null])[0];
  assert(line(orig, /function sGet\(key\)\{[^\n]*\}/) === line(html, /function sGet\(key\)\{[^\n]*\}/), "sGet is byte-identical to Phase 0+1");
  assert(line(orig, /function sSet\(key,val\)\{[^\n]*\}/) === line(html, /function sSet\(key,val\)\{[^\n]*\}/), "sSet is byte-identical to Phase 0+1");
  const hooks = html.match(/ETHIXO_AUTH\.studentActive\(/g) || [];
  assert(hooks.length === 3, "exactly three call sites: " + hooks.length);
  const guarded = html.match(/try\{ ETHIXO_AUTH\.studentActive\([^)]*\); \}catch\(_e\)\{[^}]*\}/g) || [];
  assert(guarded.length === 3, "all three wrapped in try/catch");
  // everything outside the approved regions is unchanged
  const strip = (s) => s.replace(/\/\* ETHIXO-CONFIG-BEGIN[\s\S]*?ETHIXO-CONFIG-END \*\/\n\n/, "").replace(/\n\/\* ETHIXO-AUTH-BEGIN[\s\S]*?ETHIXO-AUTH-END \*\/\n/, "")
    .replace(/\n\s*try\{ ETHIXO_AUTH\.studentActive\([^)]*\); \}catch\(_e\)\{[^}]*\}/g, "").replace(/ try\{ ETHIXO_AUTH\.studentActive\([^)]*\); \}catch\(_e\)\{[^}]*\}/g, "")
    .replace(/\n    if\(allowedHosts\.length\)\{[^\n]*\n/, "\n").replace(/\n  const allowedHosts = [^\n]*\n  const getHost = [^\n]*\n/, "\n")
    .replace(', allowedHosts: (typeof DB_SYNC_ALLOWED_HOSTS !== "undefined" ? DB_SYNC_ALLOWED_HOSTS : [])', "");
  assert(strip(html) === orig, "removing the approved Phase 2 additions restores the Phase 0+1 index.html exactly (nothing else changed)");
}

console.log("\n" + "=".repeat(50));
console.log("RESULTS: " + passed + " passed, " + failed + " failed");
console.log("=".repeat(50));
process.exit(failed ? 1 : 0);
})();
