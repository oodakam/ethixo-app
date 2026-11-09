// Phase 4a unit tests (pure node, fakes only): D3 minimal data on the wire, D1 compare-and-swap, and the one-time backfill engine.
// The ETHIXO-SYNC, ETHIXO-ATTEMPTS and ETHIXO-BACKFILL blocks are extracted from index.html and run in isolation.
// Run: node tests/phase4a-minimal-backfill.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let passed = 0, failed = 0;
function assert(c, m){ if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }
function block(b, e){ const i = html.indexOf(b), j = html.indexOf(e); if(i < 0 || j < i){ console.log("FAIL: markers not found " + b); process.exit(1); } return html.slice(i, j); }
const syncSrc = block("/* ETHIXO-SYNC-BEGIN", "/* ETHIXO-SYNC-END */");
const attSrc = block("/* ETHIXO-ATTEMPTS-BEGIN", "/* ETHIXO-ATTEMPTS-END */").replace(/\nconst ETHIXO_ATTEMPTS = [^\n]*\n/, "\n");
const bfSrcFull = block("/* ETHIXO-BACKFILL-BEGIN", "/* ETHIXO-BACKFILL-END */");
const bfSrc = bfSrcFull.replace(/\nconst ETHIXO_BACKFILL = createEthixoBackfill\(\{[\s\S]*?\}\);\n/, "\n");
if(bfSrc === bfSrcFull){ console.log("FAIL: could not remove the shipped backfill instance"); process.exit(1); }
const { createEthixoSync, createEthixoAttempts, createEthixoBackfill } =
  new Function(syncSrc + "\n" + attSrc + "\n" + bfSrc + "\nreturn { createEthixoSync, createEthixoAttempts, createEthixoBackfill };")();

function fakeStorage(seed){
  const data = Object.assign({}, seed || {}); const log = []; let failSet = false;
  return { data, log, failSetOn(v){ failSet = v; },
    getItem(k){ log.push(["get", k]); return k in data ? data[k] : null; },
    setItem(k, v){ if(failSet) throw new Error("quota"); log.push(["set", k]); data[k] = String(v); },
    removeItem(k){ log.push(["remove", k]); delete data[k]; },
    key(i){ const ks = Object.keys(data); return i < ks.length ? ks[i] : null; }, get length(){ return Object.keys(data).length; } };
}
const SECRET = "very private answer text";
const A = (at, score, extra) => Object.assign({ answer:SECRET + " " + at, score:score == null ? 1 : score, strengths:["s " + SECRET], nextSteps:["n " + SECRET], usedThinking:false, at:at }, extra || {});
const key = (i) => "attempts:P6:SS:2.1:" + i;
const kk = (lesson, i) => "attempts:P6:SS:" + lesson + ":" + i;

function makeDb(){
  const db = { rows:[], calls:[], script:[], uid:"user-A", n:0, ver:0 };
  const stamp = () => "2026-11-09T10:00:00." + String(++db.ver).padStart(6, "0") + "+00:00";
  const take = (op) => { const i = db.script.findIndex(f => f.op === op); return i < 0 ? null : db.script.splice(i, 1)[0]; };
  function from(table){
    const q = { op:null, payload:null, f:{} };
    async function exec(){
      db.calls.push({ table, op:q.op, payload:q.payload, filters:Object.assign({}, q.f) });
      const sc = take(q.op); if(sc && sc.error) return { data:null, error:sc.error }; if(sc && sc.run) sc.run(db, stamp);
      if(q.op === "select"){
        const r = db.rows.find(r => r.student_id === db.uid && r.level === q.f.level && r.subject_key === q.f.subject_key && r.lesson_id === q.f.lesson_id && r.q_idx === q.f.q_idx);
        return { data: r ? { id:r.id, data:JSON.parse(JSON.stringify(r.data)), updated_at:r.updated_at } : null, error:null };
      }
      if(q.op === "insert"){
        if(db.rows.some(r => r.student_id === db.uid && r.level === q.payload.level && r.subject_key === q.payload.subject_key && r.lesson_id === q.payload.lesson_id && r.q_idx === q.payload.q_idx)) return { data:null, error:{ code:"23505" } };
        db.rows.push({ id:"row-" + (++db.n), student_id:db.uid, level:q.payload.level, subject_key:q.payload.subject_key, lesson_id:q.payload.lesson_id, q_idx:q.payload.q_idx, data:JSON.parse(JSON.stringify(q.payload.data)), updated_at:stamp() });
        return { data:null, error:null };
      }
      if(q.op === "update"){
        const r = db.rows.find(r => r.id === q.f.id && r.student_id === db.uid); if(!r) return { data:[], error:null };
        if("updated_at" in q.f && q.f.updated_at !== r.updated_at) return { data:[], error:null };
        r.data = JSON.parse(JSON.stringify(q.payload.data)); r.updated_at = stamp(); return { data:[{ id:r.id }], error:null };
      }
      return { data:null, error:{ message:"unsupported" } };
    }
    const api = { select(){ if(q.op === "update") return api; q.op = "select"; return api; }, eq(c, v){ q.f[c] = v; return api; }, maybeSingle(){ return exec(); },
      insert(p){ q.op = "insert"; q.payload = p; return exec(); }, update(p){ q.op = "update"; q.payload = p; return api; }, then(a, b){ return exec().then(a, b); } };
    return api;
  }
  db.client = { from }; return db;
}
const rowOf = (db, k) => { const p = k.split(":"); return db.rows.find(r => r.lesson_id === p[3] && r.q_idx === parseInt(p[4], 10)); };

function setup(o){
  o = o || {};
  const st = fakeStorage(o.seed), db = o.db || makeDb(); let t = 1000000, ready = o.ready !== false; const timers = [], warns = []; let seq = 0, att = null, bf = null;
  const setTimer = (f, ms) => { const id = ++seq; const rec = { id, ms, f:() => { const i = timers.indexOf(rec); if(i >= 0) timers.splice(i, 1); return f(); } }; timers.push(rec); return id; };
  const sync = createEthixoSync({ mode:"shadow", getStorage:() => st, now:() => t, requireAllowList:true, allowedHosts:["h.test"], getHost:() => "h.test", kinds:["attempts"], omitValues:true, onQueued:() => { if(att) att.schedule(); } });
  const auth = { readyClient(){ return ready ? db.client : null; } };
  att = createEthixoAttempts({ mode:"shadow", sync, auth, getStorage:() => st, now:() => t, setTimer, clearTimer:(id) => { const i = timers.findIndex(x => x.id === id); if(i >= 0) timers.splice(i, 1); },
    addListener:() => {}, isVisible:() => true, warn:(m) => warns.push(m), onFlushed:() => { if(bf) bf.next(); } });
  bf = createEthixoBackfill({ mode:o.bfMode || "shadow", sync, attempts:att, auth, getStorage:() => st, now:() => t, setTimer, warn:(m) => warns.push(m) });
  return { st, db, sync, att, bf, auth, timers, warns, setReady:(v) => { ready = v; }, tick:(ms) => { t += ms; }, write:(k, v) => { st.setItem(k, JSON.stringify(v)); sync.onWrite(k, v); } };
}
const settle = () => new Promise(r => setImmediate(r));   // timer callbacks are not awaited by the app, so let their microtasks finish
// run every pending timer (and what it triggers) until nothing is left; each timer advances the fake clock past its own delay
async function pump(s, max){ let n = 0; while(s.timers.length && n++ < (max || 5000)){ const r = s.timers.slice().sort((a, b) => a.ms - b.ms)[0]; s.tick(r.ms + 1); await r.f(); await settle(); } return n; }
const wire = (db) => JSON.stringify(db.calls.map(c => c.payload));
const stateOf = (st) => JSON.parse(st.data.ethixoBackfill || "null");

(async function(){
console.log("Test 1 (D3): only { score, usedThinking, at } ever leaves the device");
{
  const s = setup(); s.write(key(0), [A(1, 3, { usedThinking:true }), A(2, 2)]); await s.att.flush();
  const ins = s.db.calls.find(c => c.op === "insert");
  assert(ins && JSON.stringify(ins.payload.data) === JSON.stringify([{ score:3, usedThinking:true, at:1 }, { score:2, usedThinking:false, at:2 }]), "the uploaded array holds exactly score, usedThinking, at");
  assert(!/answer|strengths|nextSteps|private/.test(wire(s.db)) && wire(s.db).indexOf(SECRET) === -1, "no answer, strengths or nextSteps text appears anywhere in any request payload");
  assert(JSON.parse(s.st.data[key(0)]).every(e => e.answer && e.answer.indexOf(SECRET) === 0), "the local copy is untouched: answers still stored on the device");
  assert(s.st.log.filter(l => l[0] === "set" && l[1].indexOf("attempts:") === 0).length === 1, "no extra write to the attempts key (only the app's own write)");
}
{
  const s = setup(); s.write(key(0), [{ answer:SECRET, scoreLow:2, scoreHigh:4, at:5 }, { answer:SECRET, score:1 }, { score:2, at:6, usedThinking:true }, A(7, 1, { usedThinking:false })]);
  await s.att.flush(); const d = s.db.rows[0].data;
  assert(JSON.stringify(d) === JSON.stringify([{ score:3, usedThinking:false, at:5 }, { score:2, usedThinking:true, at:6 }, { score:1, usedThinking:false, at:7 }]), "a legacy scoreLow/scoreHigh element becomes score 3; an element with no time is skipped, not guessed");
  const s2 = setup(); s2.write(key(0), [{ answer:SECRET, at:1 }, { answer:SECRET, score:"x", at:2 }]); const r2 = await s2.att.flush();
  assert(s2.db.calls.length === 0 && r2.failed === 0 && s2.warns.length >= 1, "nothing uploadable (no numeric score or time) => nothing sent, no retry loop, one warning tag");
  const m = s.att.minimizeAttempts([{ at:1, score:1, usedThinking:"yes" }]).out[0];
  assert(m.usedThinking === false, "usedThinking is true only for the boolean true");
}
{
  const s = setup(); s.db.rows.push({ id:"row-1", student_id:"user-A", level:"P6", subject_key:"SS", lesson_id:"2.1", q_idx:0, updated_at:"2026-11-09T09:00:00.000001+00:00", data:[A(1, 1), A(2, 2)] }); s.db.n = 1;
  s.write(key(0), [A(1, 1), A(2, 2), A(3, 3)]); await s.att.flush();
  assert(JSON.stringify(s.db.rows[0].data) === JSON.stringify([{ score:1, usedThinking:false, at:1 }, { score:2, usedThinking:false, at:2 }, { score:3, usedThinking:false, at:3 }]), "a legacy remote row that held answer text is re-written in the minimal form on its next sync");
  s.db.calls.length = 0; s.write(key(0), [A(1, 1), A(2, 2), A(3, 3)]); await s.att.flush();
  assert(s.db.calls.map(c => c.op).join() === "select", "once minimal and identical, a repeat flush only reads: no update, no updated_at churn");
  const s2 = setup(); s2.db.rows.push({ id:"row-1", student_id:"user-A", level:"P6", subject_key:"SS", lesson_id:"2.1", q_idx:0, updated_at:"v1", data:[{ at:1, score:1, usedThinking:false }] }); s2.db.n = 1;   // jsonb returns keys in its own order
  s2.write(key(0), [A(1, 1)]); await s2.att.flush();
  assert(s2.db.calls.map(c => c.op).join() === "select", "key order from the database (at, score, usedThinking) does not cause a needless update");
}

console.log("\nTest 2 (D1): compare-and-swap");
{
  const s = setup(); s.write(key(0), [A(1)]); await s.att.flush(); s.db.calls.length = 0;
  s.write(key(0), [A(1), A(2)]); await s.att.flush();
  const up = s.db.calls.find(c => c.op === "update");
  assert(up && up.filters.id === "row-1" && typeof up.filters.updated_at === "string" && up.filters.updated_at.length > 10, "the update is conditional on the id AND the updated_at that was read");
  assert(Object.keys(up.payload).join() === "data", "the update still sends only { data } (never updated_at, never student_id)");
}
{
  // another writer slips in between our read and our update
  const s = setup(); s.write(key(0), [A(1)]); await s.att.flush(); s.db.calls.length = 0;
  s.db.script.push({ op:"update", run:(db, stamp) => { const r = db.rows[0]; r.data = r.data.concat([{ score:9, usedThinking:true, at:50 }]); r.updated_at = stamp(); } });
  s.write(key(0), [A(1), A(2)]); const r = await s.att.flush();
  assert(s.db.calls.map(c => c.op).join() === "select,update,select,update" && r.sent === 1, "the lost race is detected (0 rows), re-read, merged again and written (select,update,select,update)");
  assert(JSON.stringify(s.db.rows[0].data.map(e => e.at)) === "[1,2,50]", "the other writer's attempt (at 50) is kept and ours is added: nothing overwritten");
}
{
  const s = setup(); s.write(key(0), [A(1)]); await s.att.flush(); s.db.calls.length = 0;
  for(let i = 0; i < 5; i++) s.db.script.push({ op:"update", run:(db, stamp) => { const r = db.rows[0]; r.data = r.data.concat([{ score:1, usedThinking:false, at:100 + r.data.length }]); r.updated_at = stamp(); } });
  s.write(key(0), [A(1), A(2)]); const r = await s.att.flush();
  assert(r.failed === 1 && s.db.calls.filter(c => c.op === "update").length === 3 && s.sync.outbox().length === 1 && s.sync.outbox()[0].tries === 1, "a writer that always wins is bounded to 3 rounds, then handled as an ordinary retry");
  assert(s.db.rows[0].data.every((e, i, a) => i === 0 || a[i - 1].at <= e.at) && s.db.rows[0].data.length >= 4, "the other writer's attempts are all still there");
  await pump(s); assert(s.db.rows[0].data.some(e => e.at === 2) && s.sync.outbox().length === 0, "the retry later succeeds and our attempt lands");
}
{
  const s = setup(); s.db.rows.push({ id:"row-1", student_id:"user-A", level:"P6", subject_key:"SS", lesson_id:"2.1", q_idx:0, data:[A(1)] }); s.db.n = 1;   // no updated_at at all
  s.write(key(0), [A(1), A(2)]); const r = await s.att.flush();
  assert(r.failed === 1 && !s.db.calls.some(c => c.op === "update"), "a row with no version is never updated blind (fails closed, retried later)");
}

console.log("\nTest 3: backfill is completely inert when off");
{
  const st = fakeStorage({ [key(0)]: JSON.stringify([A(1)]) }); const bf = createEthixoBackfill({ mode:"off", getStorage:() => st, setTimer:() => { throw new Error("timer"); } });
  bf.start(); bf.next();
  assert(bf.status() === "off" && st.log.length === 0, "mode off: start() and next() do nothing at all - no storage read or write, no timer");
  const s = setup({ bfMode:"off" }); s.write(key(0), [A(1)]); s.bf.start(); assert(s.st.data.ethixoBackfill === undefined && s.timers.every(t => t.ms === 2000), "wired into the app but off: no state key, no backfill timer");
}

console.log("\nTest 4: scan, state, chunking");
{
  const seed = {}; for(let i = 0; i < 45; i++) seed[kk("L" + String(i).padStart(2, "0"), 0)] = JSON.stringify([A(10 + i)]);
  seed["attempts:P6:SS:L99:x1"] = JSON.stringify([A(1)]);               // custom question: not synced
  seed[kk("BAD", 0)] = JSON.stringify([{ answer:"x", score:"abc", at:1 }]);   // malformed
  seed[kk("NOSC", 0)] = JSON.stringify([{ answer:"x", at:1 }]);          // nothing uploadable
  seed.vault = JSON.stringify([{ qid:"q" }]); seed.timelog = "{}"; seed.ethixoOutbox = "[]";
  const s = setup({ seed }); s.bf.start();
  const stt = stateOf(s.st);
  assert(stt && stt.v === 1 && stt.state === "running" && stt.total === 45 && stt.pending.length === 45 && stt.done === 0, "start() saves the plan first: 45 uploadable keys (custom, malformed, empty, vault, other keys excluded)");
  assert(s.timers.length === 1 && s.timers[0].ms === 1500, "one timer, 1.5 s away");
  await s.timers[0].f(); await settle();
  assert(s.sync.outbox().length === 20 && stateOf(s.st).pending.length === 25 && stateOf(s.st).done === 20, "the first step hands over exactly 20 keys");
  assert(s.timers.length === 1 && s.timers[0].ms === 2000, "only the normal 2 s upload timer is pending; the backfill waits for the outbox to drain");
  await pump(s);
  assert(s.db.rows.length === 45 && s.sync.outbox().length === 0, "all 45 questions reached the table through the normal sender");
  assert(stateOf(s.st).state === "done" && stateOf(s.st).pending.length === 0 && stateOf(s.st).done === 45, "state is done, nothing pending");
  assert(!wire(s.db).includes(SECRET), "nothing but minimal fields was sent during the backfill");
  const logBefore = s.st.log.length; s.bf.start(); assert(s.st.log.length === logBefore && s.timers.length === 0, "a finished device never scans or uploads again");
}
{
  const seed = {}; for(let i = 0; i < 600; i++) seed[kk("L" + String(i).padStart(3, "0"), 0)] = JSON.stringify([A(10 + i)]);
  const s = setup({ seed }); s.bf.start(); let maxBox = 0; let guard = 0;
  while(s.timers.length && guard++ < 5000){ const r = s.timers.slice().sort((a, b) => a.ms - b.ms)[0]; s.tick(r.ms + 1); await r.f(); await settle(); maxBox = Math.max(maxBox, s.sync.outbox().length); }
  assert(maxBox <= 20 && s.db.rows.length === 600, "600 keys: the outbox never holds more than 20 at a time (cap is 500) and every key arrives");
}

console.log("\nTest 5: resume, kill switch, auth, parked items, failures");
{
  const seed = {}; for(let i = 0; i < 30; i++) seed[kk("L" + String(i).padStart(2, "0"), 0)] = JSON.stringify([A(10 + i)]);
  const s = setup({ seed }); s.bf.start(); await s.timers[0].f(); await settle(); await pump(s, 3);
  const mid = stateOf(s.st);
  const s2 = setup({ seed: Object.assign({}, s.st.data), db: s.db }); s2.bf.start();     // "reload": new instances, same storage and table
  await pump(s2);
  assert(mid.state === "running" && s2.db.rows.length === 30 && stateOf(s2.st).state === "done", "after a reload it resumes from the saved plan and finishes");
  assert(s2.db.rows.length === 30, "no duplicate rows from the keys that were handed over twice");
}
{
  const seed = { [kk("A", 0)]: JSON.stringify([A(1)]), [kk("B", 0)]: JSON.stringify([A(2)]) };
  const s = setup({ seed }); s.bf.start(); s.st.data.ethixoSyncKill = "1"; await pump(s, 5);
  assert(s.sync.outbox().length === 0 && stateOf(s.st).pending.length === 2 && s.db.calls.length === 0, "kill switch set: nothing is handed over, nothing sent, the plan is kept");
  delete s.st.data.ethixoSyncKill; s.bf.next(); await pump(s);
  assert(s.db.rows.length === 2 && stateOf(s.st).state === "done", "kill switch removed: it carries on and finishes");
}
{
  const seed = { [kk("A", 0)]: JSON.stringify([A(1)]) };
  const s = setup({ seed, ready:false }); s.bf.start(); await pump(s, 3);
  assert(s.db.calls.length === 0 && stateOf(s.st).pending.length === 1 && s.bf.status() === "waiting", "not signed in: waits, hands nothing over");
  s.setReady(true); s.bf.next(); await pump(s); assert(s.db.rows.length === 1, "once ready it uploads");
}
{
  const seed = { [kk("A", 0)]: JSON.stringify([A(1)]), [kk("B", 0)]: JSON.stringify([A(2)]) };
  const s = setup({ seed }); s.bf.start();
  s.st.data.ethixoOutbox = JSON.stringify([{ key:kk("Z", 0), route:{ kind:"attempts", level:"P6", subject_key:"SS", lesson_id:"Z", q_idx:0 }, value:null, queuedAt:1, seq:1, tries:6, nextAt:0, parked:true }]);
  await pump(s); assert(s.db.rows.length === 2 && stateOf(s.st).state === "done", "a parked (failed) item does not block the backfill");
}
{
  const seed = { [kk("A", 0)]: JSON.stringify([A(1)]), [kk("B", 0)]: JSON.stringify([A(2)]) };
  const s = setup({ seed }); s.bf.start(); s.db.script.push({ op:"select", error:{ message:"Failed to fetch" } });
  await pump(s); assert(s.db.rows.length === 2 && stateOf(s.st).state === "done", "a failed send is retried by the normal outbox back-off and the backfill still completes");
}
{
  const s = setup({ seed:{ [kk("A", 0)]: JSON.stringify([A(1)]) } }); s.st.failSetOn(true); s.bf.start();
  assert(s.timers.length === 0 && s.warns.some(w => /state-not-saved/.test(w)), "if progress cannot be saved it does not start at all");
}
{
  const seed = { [kk("A", 0)]: JSON.stringify([A(1)]) }; const s = setup({ seed }); const before = s.st.data[kk("A", 0)];
  s.bf.start(); await pump(s);
  assert(s.st.data[kk("A", 0)] === before && s.st.log.filter(l => l[0] === "set" && l[1].indexOf("attempts:") === 0).length === 0 && s.st.log.filter(l => l[0] === "remove").length === 0, "the backfill never writes or removes a local attempts key");
  assert(s.st.log.filter(l => l[0] === "set").every(l => l[1] === "ethixoBackfill" || l[1] === "ethixoOutbox"), "it only ever writes its own state and the shared outbox");
}
{
  // state wiped (e.g. user cleared one key) -> a second full pass is a no-op on the table
  const seed = { [kk("A", 0)]: JSON.stringify([A(1)]), [kk("B", 0)]: JSON.stringify([A(2)]) };
  const s = setup({ seed }); s.bf.start(); await pump(s); s.db.calls.length = 0; delete s.st.data.ethixoBackfill;
  const s2 = setup({ seed: Object.assign({}, s.st.data), db: s.db }); s2.bf.start(); await pump(s2);
  assert(!s.db.calls.some(c => c.op === "insert" || c.op === "update") && s.db.rows.length === 2, "re-running the whole backfill changes nothing in the table (idempotent)");
}

{
  const seed = { [kk("A", 0)]: JSON.stringify([A(1)]), [kk("B", 0)]: JSON.stringify([A(2)]) };
  const s = setup({ seed }); s.bf.start();
  s.st.data.ethixoOutbox = JSON.stringify([{ key:kk("Z", 0), route:{ kind:"attempts", level:"P6", subject_key:"SS", lesson_id:"Z", q_idx:0 }, value:null, queuedAt:1, seq:1, tries:1, nextAt:9e12, parked:false }]);   // a live item waiting out its back-off
  await s.timers.find(t => t.ms === 1500).f(); await settle();
  assert(stateOf(s.st).pending.length === 2 && s.sync.outbox().length === 1, "while a normal (non-parked) upload is waiting in the outbox, the backfill hands over nothing");
}

console.log("\nTest 6: source assertions");
{
  const code = bfSrcFull.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert(!/\bfetch\s*\(|XMLHttpRequest|setInterval|createElement|innerHTML|\.from\(|createClient|\.auth\.|localStorage\.removeItem|removeItem|\.setItem\(k/.test(code), "the backfill block has no network calls, no polling, no UI, no deletes, and never writes an attempts key");
  assert(code.indexOf('baseMode === "off"') < code.indexOf("getStorage()"), "the off gate returns before any storage access");
  assert(/DB_BACKFILL = false;/.test(html) && /DB_ATTEMPTS_SYNC = false;/.test(html) && /DB_SYNC_MODE = "off";/.test(html) && /DB_SYNC_ALLOWED_HOSTS = \[\];/.test(html), "committed constants: DB_BACKFILL false, DB_ATTEMPTS_SYNC false, DB_SYNC_MODE off, allow-list empty");
  assert(/SUPABASE_URL = "__SET_ME__"/.test(html) && /SUPABASE_PUBLISHABLE_KEY = "__SET_ME__"/.test(html), "URL and key are still placeholders");
  assert(/mode: \(\(typeof DB_BACKFILL !== "undefined" && DB_BACKFILL === true && DB_ATTEMPTS_SYNC === true\)/.test(html), "the instance needs DB_BACKFILL AND DB_ATTEMPTS_SYNC (and a non-off DB_SYNC_MODE)");
}

console.log("\n==================================================\nRESULTS: " + passed + " passed, " + failed + " failed\n==================================================");
process.exit(failed ? 1 : 0);
})();
