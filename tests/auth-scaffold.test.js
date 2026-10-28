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
  const hosts = over.allowedHosts === undefined ? ["app.test"] : over.allowedHosts;
  const getHostFn = over.getHost || (() => "app.test");
  const sync = over.sync || createEthixoSync({ mode: syncMode, getStorage: () => storage, allowedHosts: hosts, getHost: getHostFn, requireAllowList: true });
  const cfg = over.config || { url:"https://mock-project.supabase.test", key:"sb_publishable_TESTKEY", libPath:"x.js" };
  const auth = createEthixoAuth({
    mode: over.mode === undefined ? "shadow" : over.mode, sync: sync, config: cfg, getStorage: () => storage,
    allowedHosts: hosts, getHost: getHostFn,
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

console.log("\nTest 6: duplicate profile (23505) is success ONLY if a student profile can be read back");
const DUP = { data:null, error:{ code:"23505", message:"profile already exists" } };
{
  const m = make({}, { selectQueue:[{ data:null, error:null }, OK_PROFILE], rpcResults:[DUP] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "profile-ok", "23505 followed by an existing student profile => profile-ok");
  assert(m.spies.timers.length === 0 && m.spies.warns.length === 0, "  ...no retry, no warning");
  assert(m.client.calls.filter(c => c[0] === "rpc").length === 1, "  ...rpc not repeated");
  assert(JSON.parse(m.storage.data.ethixoAuthMeta).uid === "uid-1", "  ...identity marker written only now");
}
{
  const m = make({}, { selectQueue:[{ data:null, error:null }, { data:{ id:"uid-1", role:"student", level:"P5" }, error:null }], rpcResults:[DUP] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "profile-ok" && m.client.calls.filter(c => c[0] === "update").length === 1, "23505 + existing student profile with another level => profile-ok after a level-only update");
}
{
  // 23505 but the profile cannot be found: NOT profile-ok, bounded retry
  const rp = []; for(let i = 0; i < 30; i++) rp.push(DUP);
  const m = make({}, { selectQueue:[], rpcResults: rp });                 // every select returns "no row"
  await m.auth.studentActive("P6");
  assert(m.auth.status() !== "profile-ok", "23505 followed by NO profile => not profile-ok (status " + m.auth.status() + ")");
  assert(m.auth.status() === "degraded" && m.spies.timers.length === 1, "  ...safe failure state: degraded + a single scheduled retry");
  assert(!("ethixoAuthMeta" in m.storage.data), "  ...identity marker NOT written");
  let guard = 0;
  while(m.spies.timers.length && guard < 50){ const t = m.spies.timers.splice(0)[0]; guard++; t.fn(); await tick(); if(m.spies.timers.length === 0) break; }
  const rpcs = m.client.calls.filter(c => c[0] === "rpc").length;
  assert(rpcs === 1 + m.auth.constants.MAX_TRIES, "  ...NO infinite retries: exactly 1 + MAX_TRIES (" + (1 + m.auth.constants.MAX_TRIES) + ") rpc attempts, got " + rpcs);
  assert(m.spies.timers.length === 0 && m.auth.status() === "degraded", "  ...after the cap no timer remains (parked), still not profile-ok");
  await m.auth.studentActive("P6"); await tick();
  assert(m.client.calls.filter(c => c[0] === "rpc").length === rpcs + 1 && m.spies.timers.length === 0, "  ...a later explicit student action makes one more attempt only, no new timer chain");
}
{
  const m = make({}, { selectQueue:[{ data:null, error:null }, { data:null, error:null }, OK_PROFILE], rpcResults:[DUP, DUP] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "degraded", "duplicate but row not yet visible => degraded");
  if(m.spies.timers[0]){ m.spies.timers[0].fn(); await tick(); }
  assert(m.auth.status() === "profile-ok", "  ...and once the student profile is readable the retry reaches profile-ok");
}
for(const [label, row] of [["teacher", { id:"uid-1", role:"teacher", level:null }], ["unknown role 'admin'", { id:"uid-1", role:"admin", level:"P6" }], ["missing role", { id:"uid-1", level:"P6" }], ["null role", { id:"uid-1", role:null, level:"P6" }]]){
  const m = make({}, { selectQueue:[{ data:null, error:null }, { data: row, error:null }], rpcResults:[DUP] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "disabled", "23505 followed by a " + label + " profile => disabled (never profile-ok)");
  assert(!m.client.calls.some(c => c[0] === "update") && m.spies.timers.length === 0 && !("ethixoAuthMeta" in m.storage.data), "  ...no update, no retry, no identity marker");
  assert(m.client.calls.filter(c => c[0] === "rpc").length === 1, "  ...rpc not repeated");
}
for(const [label, err, expect] of [["network error", { message:"TypeError: Failed to fetch", code:"" }, "degraded"], ["HTTP 500", { status:500, message:"x", code:"" }, "degraded"], ["HTTP 403 (permission)", { status:403, message:"denied", code:"42501" }, "disabled"], ["expired JWT", { status:401, code:"PGRST301", message:"JWT expired" }, "degraded"]]){
  const m = make({}, { selectQueue:[{ data:null, error:null }, { data:null, error: err }, { data:null, error:null }, { data:null, error:null }], rpcResults:[DUP, DUP, DUP] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === expect, "23505 followed by a FAILED profile query (" + label + ") => " + expect + " (got " + m.auth.status() + ")");
  assert(m.auth.status() !== "profile-ok" && !("ethixoAuthMeta" in m.storage.data), "  ...not profile-ok, no identity marker");
}
{
  const sq = []; for(let i = 0; i < 20; i++){ sq.push({ data:null, error:null }); sq.push({ data:null, error:{ status:500, message:"x", code:"" } }); }
  const rp = []; for(let i = 0; i < 20; i++) rp.push(DUP);
  const m = make({}, { selectQueue: sq, rpcResults: rp });
  await m.auth.studentActive("P6");
  let guard = 0; while(m.spies.timers.length && guard < 50){ const t = m.spies.timers.splice(0)[0]; guard++; t.fn(); await tick(); }
  assert(m.auth.status() === "degraded" && m.client.calls.filter(c => c[0] === "rpc").length <= 1 + m.auth.constants.MAX_TRIES, "23505 + repeatedly failing read-back: bounded, ends degraded (rpc attempts " + m.client.calls.filter(c => c[0] === "rpc").length + ")");
}
{
  const m = make({}, { selectQueue:[{ data:null, error:null }, { data:null, error:null }], rpcResults:[DUP] });
  await m.auth.studentActive("P6");
  assert(m.auth.status() === "degraded", "(replaces the old 'does not crash' check) 23505 then empty re-select no longer reports success");
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
  // Phase 3 (Attempts Sync) additions are reversed first, each one an exact, named edit; what is left must be Phase 2's strip.
  const stripPhase3 = (s) => s
    .replace(/\n\/\* ETHIXO-ATTEMPTS-BEGIN[\s\S]*?ETHIXO-ATTEMPTS-END \*\/\n/, "")
    .replace(/  \/\/ Phase 3 options[\s\S]*?  let sender = null, seqCounter = 0;\n/, "  let sender = null;\n")
    .replace("    if(kinds && kinds.indexOf(r.kind) === -1) return;\n", "")
    .replace("value:(omitValues ? null : val), queuedAt:now(), seq:++seqCounter,", "value:val, queuedAt:now(),")
    .replace("    if(onQueued){ try{ onQueued(r); }catch(e){ /* a notifier can never affect the app */ } }\n", "")
    .replace("    if(!list.length) return summary;          // nothing queued: write nothing (no empty ethixoOutbox key is ever created)\n", "")
    .replace(/    \/\/ Items queued \(or re-queued\) while the senders above[\s\S]*?writeBox\(merged\.length > MAX_OUTBOX \? merged\.slice\(merged\.length - MAX_OUTBOX\) : merged\);\n/, "    writeBox(keep);\n")
    .replace(/,\n  kinds: \(\(typeof DB_ATTEMPTS_SYNC[\s\S]*?\} \}\);/, " });");
  const strip = (s) => stripPhase3(s).replace(/\/\* ETHIXO-CONFIG-BEGIN[\s\S]*?ETHIXO-CONFIG-END \*\/\n\n/, "").replace(/\n\/\* ETHIXO-AUTH-BEGIN[\s\S]*?ETHIXO-AUTH-END \*\/\n/, "")
    .replace(/\n\s*try\{ ETHIXO_AUTH\.studentActive\([^)]*\); \}catch\(_e\)\{[^}]*\}/g, "").replace(/ try\{ ETHIXO_AUTH\.studentActive\([^)]*\); \}catch\(_e\)\{[^}]*\}/g, "")
    .replace(/  \/\/ Host allow-list\.[\s\S]*?  const getHost = [^\n]*\n/, "")
    .replace(/    if\(requireAllowList \|\| listProvided\)\{[^\n]*\n/, "")
    .replace(", requireAllowList: true, allowedHosts: (typeof DB_SYNC_ALLOWED_HOSTS !== \"undefined\" ? DB_SYNC_ALLOWED_HOSTS : [])", "");
  assert(strip(html) === orig, "removing the approved Phase 2 and Phase 3 additions restores the Phase 0+1 index.html exactly (nothing else changed)");
}

console.log("\nTest 18: host allow-list FAILS CLOSED (empty / missing / malformed list => off; only an explicitly listed host works)");
{
  const st = () => fakeStorage();
  const mk2 = (o) => createEthixoSync(Object.assign({ mode:"shadow", getStorage: st, requireAllowList:true, getHost: () => "preview.example.test" }, o));
  assert(mk2({ allowedHosts: [] }).mode() === "off", "empty allow-list => off (app configuration)");
  assert(mk2({}).mode() === "off", "missing allow-list => off");
  assert(mk2({ allowedHosts: undefined }).mode() === "off" && mk2({ allowedHosts: null }).mode() === "off", "undefined / null allow-list => off");
  for(const bad of ["preview.example.test", {}, 5, true]) assert(mk2({ allowedHosts: bad }).mode() === "off", "non-array allow-list " + JSON.stringify(bad) + " => off");
  for(const list of [["*"], ["*.example.test"], [""], [" "], ["preview.example.test/"], ["https://preview.example.test"], ["preview.example.test:443"], [null], [123], [["preview.example.test"]]])
    assert(mk2({ allowedHosts: list }).mode() === "off", "unusable entries " + JSON.stringify(list) + " => off (no wildcard, no scheme, no port, no empty)");
  assert(mk2({ allowedHosts: ["ethixo.ai", "test.ethixo.ai"] }).mode() === "off", "a non-allow-listed host (even ethixo.ai / test.ethixo.ai listed for others) => off");
  assert(mk2({ allowedHosts: ["other.example.test"] }).mode() === "off", "host not in a non-empty list => off");
  assert(mk2({ allowedHosts: ["preview.example.test"] }).mode() === "shadow", "explicitly allow-listed host => shadow (positive control)");
  assert(mk2({ allowedHosts: ["PREVIEW.example.test"] }).mode() === "shadow", "match is case-insensitive");
  assert(mk2({ allowedHosts: ["preview.example.test"], getHost: () => { throw new Error("x"); } }).mode() === "off", "host lookup error => off");
  assert(mk2({ allowedHosts: ["preview.example.test"], getHost: () => "" }).mode() === "off" && mk2({ allowedHosts: [""], getHost: () => "" }).mode() === "off", "empty hostname (file://) never matches");
  assert(createEthixoSync({ mode:"off", allowedHosts:["preview.example.test"], requireAllowList:true, getHost: () => "preview.example.test", getStorage: st }).mode() === "off", "flag off stays off even when the host is allow-listed");
  const kill = createEthixoSync({ mode:"shadow", allowedHosts:["preview.example.test"], requireAllowList:true, getHost: () => "preview.example.test", getStorage: () => fakeStorage({ ethixoSyncKill:"1" }) });
  assert(kill.mode() === "off", "kill switch still wins on an allow-listed host");
  assert(createEthixoSync({ mode:"shadow", getStorage: st }).mode() === "shadow", "Phase 0+1 factory default (no requireAllowList, no list) is unchanged - only the APP opts in to fail-closed");
  assert(/createEthixoSync\(\{ mode: DB_SYNC_MODE, requireAllowList: true,/.test(html), "the app's ETHIXO_SYNC instance is built with requireAllowList: true");
}
console.log("\nTest 19: the real app wiring with DB_SYNC_MODE patched to shadow in a throw-away copy of the source");
{
  const run = (src, host) => new Function("location", src + "; return { sync: ETHIXO_SYNC.mode(), auth: ETHIXO_AUTH, kill: 0 };")({ hostname: host });
  const flip = (src) => src.replace('const DB_SYNC_MODE = "off";', 'const DB_SYNC_MODE = "shadow";');
  const noCfg = (src) => src.replace(/const DB_SYNC_ALLOWED_HOSTS = \[\];\n/, "");
  const withList = (src, arr) => src.replace("const DB_SYNC_ALLOWED_HOSTS = [];", "const DB_SYNC_ALLOWED_HOSTS = " + JSON.stringify(arr) + ";");
  const cfgOk = (src) => src.replace('const SUPABASE_URL = "__SET_ME__";', 'const SUPABASE_URL = "https://mock-project.supabase.test";').replace('const SUPABASE_PUBLISHABLE_KEY = "__SET_ME__";', 'const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MOCK1234";');
  assert(flip(fullSrc) !== fullSrc && noCfg(fullSrc) !== fullSrc && withList(fullSrc, ["a.test"]) !== fullSrc, "patch helpers actually change the source");
  const probe = async (src, host) => {   // returns {sync, requests} - the auth factory is driven with a library spy
    const f = new Function("location", src + "; return { ETHIXO_SYNC, createEthixoAuth, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_LIB_PATH, DB_SYNC_MODE, hosts: (typeof DB_SYNC_ALLOWED_HOSTS !== 'undefined' ? DB_SYNC_ALLOWED_HOSTS : undefined) };")({ hostname: host });
    const calls = []; const client = fakeClient({ selectQueue:[{ data:null, error:null }] });
    // rebuild an auth instance exactly the way the app does (same sync instance, same config, same allow-list)
    const a = f.createEthixoAuth({ mode: f.DB_SYNC_MODE, sync: f.ETHIXO_SYNC, allowedHosts: f.hosts, getHost: () => host,
      config: { url: f.SUPABASE_URL, key: f.SUPABASE_PUBLISHABLE_KEY, libPath: f.SUPABASE_LIB_PATH },
      loadLibrary: async () => { calls.push("library"); return { createClient: () => client }; }, getStorage: () => fakeStorage(), setTimer: () => 1, clearTimer: () => {}, addListener: () => {}, getLocks: () => null, warn: () => {} });
    await a.studentActive("P6"); await tick();
    return { sync: f.ETHIXO_SYNC.mode(), library: calls.length, client: client.calls.length, status: a.status() };
  };
  const shadowOk = (src) => cfgOk(flip(src));
  let r;
  r = await probe(shadowOk(fullSrc), "a.test");
  assert(r.sync === "off" && r.library === 0 && r.client === 0, "flag on + allow-list EMPTY ([]) => sync off, library not loaded, no client call");
  r = await probe(noCfg(shadowOk(fullSrc)), "a.test");
  assert(r.sync === "off" && r.library === 0 && r.client === 0, "flag on + allow-list constant MISSING => sync off, library not loaded, no client call");
  r = await probe(withList(shadowOk(fullSrc), ["other.test"]), "a.test");
  assert(r.sync === "off" && r.library === 0 && r.client === 0, "flag on + host not allow-listed => off, inert");
  r = await probe(withList(shadowOk(fullSrc), ["ethixo.ai", "test.ethixo.ai"]), "ethixo.ai");
  assert(r.sync === "shadow", "(sanity of the helper) listing ethixo.ai WOULD enable it - which is why the committed list must stay empty");
  r = await probe(withList(shadowOk(fullSrc), ["a.test"]), "a.test");
  assert(r.sync === "shadow" && r.library === 1 && r.status === "profile-ok", "flag on + explicitly allow-listed host => runs against the fake client (positive control)");
  r = await probe(withList(fullSrc, ["a.test"]), "a.test");
  assert(r.sync === "off" && r.library === 0 && r.client === 0, "allow-listed host but DB_SYNC_MODE \"off\" => off");
  // the auth module is independently fail-closed even if handed a permissive sync stub
  for(const hosts of [undefined, [], ["other.test"], ["*"]]){
    const m = make({ allowedHosts: hosts, getHost: () => "a.test", sync: { mode: () => "shadow" } });
    await m.auth.studentActive("P6"); await tick();
    assert(m.spies.libraryLoads === 0 && m.client.calls.length === 0 && m.spies.timers.length === 0 && m.storage.log.length === 0, "auth alone, permissive sync stub, allow-list " + JSON.stringify(hosts) + " => library never loaded, no call");
  }
  assert(/DB_SYNC_ALLOWED_HOSTS = \[\];/.test(html) && /const DB_SYNC_MODE = "off";/.test(html), "committed code: empty allow-list and DB_SYNC_MODE \"off\"");
}

console.log("\n" + "=".repeat(50));
console.log("RESULTS: " + passed + " passed, " + failed + " failed");
console.log("=".repeat(50));
process.exit(failed ? 1 : 0);
})();
