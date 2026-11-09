// Phase 3 (Attempts Sync) unit tests. Pure node: no network, no browser, no real Supabase.
// The ETHIXO-SYNC and ETHIXO-ATTEMPTS blocks are extracted from index.html by their markers and evaluated in isolation
// with injected fakes (storage, clock, timers, listeners, and an in-memory stand-in for the attempts table that enforces
// the same ownership rules as the real grants/RLS: student_id may not be updated, an inserted student_id must be the caller's).
// Run: node tests/attempts-sync.test.js
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

let passed = 0, failed = 0;
function assert(cond, msg){ if(cond){ passed++; console.log("  PASS:", msg); } else { failed++; console.log("  FAIL:", msg); } }
const has = (s, m) => s.indexOf(m) !== -1;

function block(begin, end){
  const b = html.indexOf(begin), e = html.indexOf(end);
  if(b < 0 || e < 0 || e < b){ console.log("FAIL: markers not found: " + begin); process.exit(1); }
  return html.slice(b, e);
}
const syncSrc = block("/* ETHIXO-SYNC-BEGIN", "/* ETHIXO-SYNC-END */");
const attSrcFull = block("/* ETHIXO-ATTEMPTS-BEGIN", "/* ETHIXO-ATTEMPTS-END */");
const attSrc = attSrcFull.replace(/\nconst ETHIXO_ATTEMPTS = [^\n]*\n/, "\n");
if(attSrc === attSrcFull){ console.log("FAIL: could not remove the shipped instance line"); process.exit(1); }
const mod = new Function(syncSrc + "\n" + attSrc + "\nreturn { createEthixoSync, createEthixoAttempts };")();
const { createEthixoSync, createEthixoAttempts } = mod;

// ---------- fakes ----------
function fakeStorage(seed){
  const data = Object.assign({}, seed || {}); const log = [];
  return { data, log,
    getItem(k){ log.push(["get", k]); return k in data ? data[k] : null; },
    setItem(k, v){ log.push(["set", k]); data[k] = String(v); },
    removeItem(k){ log.push(["remove", k]); delete data[k]; } };
}
const KEY = "attempts:P6:SS:2.1:0", KEY2 = "attempts:P6:SS:2.1:1";
const A = (at, score, extra) => Object.assign({ answer:"private answer text " + at, score:score == null ? 1 : score, strengths:[], nextSteps:[], usedThinking:false, at:at }, extra || {});

// A stand-in for public.attempts + PostgREST + the grants/RLS that matter here. Records every call.
function makeDb(){
  const db = { rows:[], calls:[], script:[], uid:"user-A", n:0, studentIdEverSent:false, ver:0 };
  const stamp = () => "2026-11-09T10:00:" + String(Math.floor(++db.ver / 1000)).padStart(2, "0") + "." + String(db.ver % 1000).padStart(3, "0") + "000+00:00";   // the server sets updated_at (trigger)
  const ALLOWED_INSERT = ["student_id", "level", "subject_key", "lesson_id", "q_idx", "data"];
  const ALLOWED_UPDATE = ["level", "subject_key", "lesson_id", "q_idx", "data"];   // NOT student_id (column grant)
  const take = (op) => { const i = db.script.findIndex(f => f.op === op); return i < 0 ? null : db.script.splice(i, 1)[0]; };
  function from(table){
    const q = { table, op:null, payload:null, f:{}, returning:null };
    async function exec(){
      db.calls.push({ table, op:q.op, payload:q.payload, filters:Object.assign({}, q.f), returning:q.returning });
      const sc = take(q.op);
      if(sc && sc.error) return { data:null, error:sc.error };
      if(sc && sc.run) sc.run(db);
      if(table !== "attempts") return { data:null, error:{ code:"42P01", message:"unexpected table" } };
      if(q.op === "select"){
        const r = db.rows.find(r => r.student_id === db.uid && r.level === q.f.level && r.subject_key === q.f.subject_key && r.lesson_id === q.f.lesson_id && r.q_idx === q.f.q_idx);
        return { data: r ? { id:r.id, data:JSON.parse(JSON.stringify(r.data)), updated_at:r.updated_at } : null, error:null };
      }
      if(q.op === "insert"){
        const keys = Object.keys(q.payload);
        if(keys.some(k => ALLOWED_INSERT.indexOf(k) === -1)) return { data:null, error:{ code:"42501", message:"permission denied (column)" } };
        if("student_id" in q.payload){ db.studentIdEverSent = true; if(q.payload.student_id !== db.uid) return { data:null, error:{ code:"42501", message:"new row violates row-level security policy" } }; }
        if(db.rows.some(r => r.student_id === db.uid && r.level === q.payload.level && r.subject_key === q.payload.subject_key && r.lesson_id === q.payload.lesson_id && r.q_idx === q.payload.q_idx)) return { data:null, error:{ code:"23505", message:"duplicate key" } };
        db.rows.push({ id:"row-" + (++db.n), student_id:db.uid, level:q.payload.level, subject_key:q.payload.subject_key, lesson_id:q.payload.lesson_id, q_idx:q.payload.q_idx, data:JSON.parse(JSON.stringify(q.payload.data)), updated_at:stamp() });
        return { data:null, error:null };
      }
      if(q.op === "update"){
        const keys = Object.keys(q.payload);
        if(keys.some(k => ALLOWED_UPDATE.indexOf(k) === -1)){ if(keys.indexOf("student_id") !== -1) db.studentIdEverSent = true; return { data:null, error:{ code:"42501", message:"permission denied for table attempts" } }; }
        const r = db.rows.find(r => r.id === q.f.id && r.student_id === db.uid);          // RLS: only the owner's rows are visible
        if(!r) return { data:[], error:null };
        if("updated_at" in q.f && q.f.updated_at !== r.updated_at) return { data:[], error:null };   // compare-and-swap: the row moved since it was read
        if("data" in q.payload){ r.data = JSON.parse(JSON.stringify(q.payload.data)); r.updated_at = stamp(); }
        return { data:[{ id:r.id }], error:null };
      }
      return { data:null, error:{ message:"unsupported" } };
    }
    const api = {
      select(cols){ if(q.op === "update"){ q.returning = cols; return api; } q.op = "select"; return api; },
      eq(c, v){ q.f[c] = v; return api; },
      maybeSingle(){ return exec(); },
      insert(p){ q.op = "insert"; q.payload = p; return exec(); },
      update(p){ q.op = "update"; q.payload = p; return api; },
      then(res, rej){ return exec().then(res, rej); },
    };
    return api;
  }
  db.client = { from };
  return db;
}

// A complete little app: real sync block + real attempts block + the fakes above.
function setup(o){
  o = o || {};
  const st = fakeStorage(o.seed), db = makeDb();
  let t = 1000000, ready = o.ready !== false;
  const timers = [], listeners = [], warns = [], cleared = [];
  let timerSeq = 0;
  let att = null;
  const sync = createEthixoSync({ mode:o.mode || "shadow", getStorage:() => st, now:() => t, requireAllowList:true, allowedHosts:["h.test"], getHost:() => "h.test",
    kinds: ("kinds" in o) ? o.kinds : ["attempts"], omitValues: o.omitValues !== false, onQueued:() => { if(att) att.schedule(); } });
  const auth = { readyClient(){ return ready ? db.client : null; } };
  att = createEthixoAttempts({ mode:o.attMode || o.mode || "shadow", sync, auth, getStorage:() => st, now:() => t,
    setTimer:(f, ms) => { const id = ++timerSeq; const rec = { id, ms, f:() => { const i = timers.indexOf(rec); if(i >= 0) timers.splice(i, 1); return f(); } }; timers.push(rec); return id; },
    clearTimer:(id) => { cleared.push(id); const i = timers.findIndex(x => x.id === id); if(i >= 0) timers.splice(i, 1); },
    addListener:(type, fn) => listeners.push([type, fn]), isVisible:() => true, warn:(m) => warns.push(m) });
  // what the app's sSet does: local write first, then the sync hook
  const write = (key, val) => { st.setItem(key, JSON.stringify(val)); sync.onWrite(key, val); };
  return { st, db, sync, att, auth, timers, listeners, warns, cleared, write,
    setReady:(v) => { ready = v; }, tick:(ms) => { t += ms; }, now:() => t };
}
const ops = (db) => db.calls.map(c => c.op).join(",");
const noStudentId = (db) => db.calls.every(c => !c.payload || !("student_id" in c.payload)) && db.calls.every(c => !("student_id" in c.filters));

(async function(){

console.log("\nTest 1: OFF is completely inert (nothing is read, written, scheduled, registered or listened to)");
{
  const boom = new Proxy({}, { get(){ throw new Error("TOUCHED"); }, set(){ throw new Error("TOUCHED"); } });
  [undefined, null, "off", "OFF", "banana", true, 1].forEach(function(m){
    let a;
    try{
      a = createEthixoAttempts({ mode:m, sync:boom, auth:boom, getStorage(){ throw new Error("TOUCHED"); }, now(){ throw new Error("TOUCHED"); },
        setTimer(){ throw new Error("TOUCHED"); }, clearTimer(){ throw new Error("TOUCHED"); }, addListener(){ throw new Error("TOUCHED"); }, isVisible(){ throw new Error("TOUCHED"); }, warn(){ throw new Error("TOUCHED"); } });
      a.schedule(); a.schedule(0); a.status();
    }catch(e){ a = null; }
    assert(!!a, "mode " + JSON.stringify(m) + ": construct + schedule() + status() touch nothing");
  });
  const a = createEthixoAttempts({ mode:"off", sync:boom, auth:boom });
  const r = await a.flush();
  assert(r.sent === 0 && a.status() === "off", "off: flush() resolves immediately with an empty summary; status is \"off\"");
  let called = 0;
  const syncSpy = { setSender(){ called++; }, flush(){ called++; }, outbox(){ called++; return []; }, mode(){ called++; return "shadow"; } };
  createEthixoAttempts({ mode:"off", sync:syncSpy, auth:boom }).schedule();
  assert(called === 0, "off: no sender is registered and the sync layer is never consulted");
  const s = setup({ mode:"off" });
  s.write(KEY, [A(1)]);
  assert(s.timers.length === 0 && s.listeners.length === 0 && s.db.calls.length === 0, "off end-to-end: a learning write creates no timer, no listener, no database call");
  assert(!("ethixoOutbox" in s.st.data), "off end-to-end: no ethixoOutbox key");
}
console.log("\nTest 1b: the second switch - attempts stay inert unless DB_ATTEMPTS_SYNC is true, even when DB_SYNC_MODE is shadow");
{
  assert(/const DB_ATTEMPTS_SYNC = false;/.test(html), "shipped source: const DB_ATTEMPTS_SYNC = false;");
  assert(/const DB_SYNC_MODE = "off";/.test(html), "shipped source: DB_SYNC_MODE is still \"off\"");
  assert(has(html, 'mode: (DB_ATTEMPTS_SYNC === true ? DB_SYNC_MODE : "off")'), "the attempts instance runs in mode off unless DB_ATTEMPTS_SYNC === true");
  assert(has(html, 'kinds: ((typeof DB_ATTEMPTS_SYNC !== "undefined" && DB_ATTEMPTS_SYNC === true) ? ["attempts"] : [])'), "the sync instance queues NOTHING (kinds: []) unless DB_ATTEMPTS_SYNC === true");
  // the app's wiring with the second switch false but the first one on (shadow)
  const s = setup({ mode:"shadow", kinds:[], attMode:"off" });
  s.write(KEY, [A(1)]); s.write("vault", [{ qid:KEY }]); s.write("timelog", { a:1 });
  assert(!("ethixoOutbox" in s.st.data), "shadow + attempts switch false: nothing is queued (no outbox key)");
  assert(s.timers.length === 0 && s.listeners.length === 0 && s.db.calls.length === 0, "shadow + attempts switch false: no timer, listener or request");
  assert(s.att.status() === "off", "shadow + attempts switch false: attempts status is off");
}

console.log("\nTest 2: validateAttempts - only well-formed arrays are ever uploaded");
{
  const v = (x) => createEthixoAttempts({ mode:"off" }).validateAttempts(x);
  assert(v([A(1), A(2)]).ok === true, "well-formed array ok");
  assert(v([{ answer:"x", scoreLow:1, scoreHigh:2 }]).ok === true, "legacy element without score/at is ok");
  assert(v([A(1, null)]).ok === true, "score null is ok (NaN serialises to null)");
  [["not-an-array", {}], ["not-an-array", "str"], ["not-an-array", null], ["empty", []]].forEach(([why, x]) => assert(v(x).reason === why, "rejected as " + why + ": " + JSON.stringify(x)));
  assert(v([A(1), null]).reason === "bad-element" && v([A(1), 5]).reason === "bad-element" && v([[1]]).reason === "bad-element", "non-object elements rejected");
  assert(v([A(1, "7")]).reason === "bad-score" && v([A(1, NaN, { score:Infinity })]).reason === "bad-score", "string / infinite score rejected (the teacher summary casts score to numeric)");
  assert(v([A("2026-01-01")]).reason === "bad-at" && v([Object.assign(A(1), { at:"1" })]).reason === "bad-at", "non-numeric at rejected");
  assert(v([Object.assign(A(1), { usedThinking:"yes" })]).reason === "bad-usedThinking", "non-boolean usedThinking rejected");
  assert(v(new Array(1001).fill(A(1))).reason === "too-many", "more than 1000 attempts rejected");
  assert(v([A(1, 1, { answer:"x".repeat(150001) })]).reason === "too-large", "over 150,000 bytes rejected (database cap is 200,000)");
  const circ = {}; circ.self = circ; assert(v([circ]).reason === "unserialisable", "unserialisable rejected");
}

console.log("\nTest 3: mergeAttempts - union by at, remote never dropped, local never modified");
{
  const m = createEthixoAttempts({ mode:"off" }).mergeAttempts;
  const r = [A(10), A(30)], l = [A(20), A(30, 0)];
  const lCopy = JSON.stringify(l), rCopy = JSON.stringify(r);
  const out = m(r, l);
  assert(out.map(e => e.at).join() === "10,20,30", "union ordered by time: " + out.map(e => e.at).join());
  assert(out.find(e => e.at === 30).score === 0, "identical timestamp: the local copy wins");
  assert(JSON.stringify(l) === lCopy && JSON.stringify(r) === rCopy, "inputs are not mutated");
  assert(m([A(5)], []).length === 1 && m([], [A(5)]).length === 1 && m(null, [A(5)]).length === 1 && m(undefined, undefined).length === 0, "empty / missing sides handled");
  assert(m([A(1), A(2), A(3)], [A(3)]).length === 3, "a SHORTER local array never shrinks the result (remote attempts survive)");
  const legacy = m([{ answer:"a", scoreLow:1, scoreHigh:2 }], [{ answer:"a", scoreLow:1, scoreHigh:2 }, { answer:"b", scoreLow:0, scoreHigh:1 }]);
  assert(legacy.length === 2, "elements without at are deduplicated by content, not dropped");
  assert(m([A(2), A(1)], []).map(e => e.at).join() === "1,2", "output is ordered even if the input was not");
}

console.log("\nTest 4: first write -> one SELECT then one INSERT; student_id is never sent; local value is what is uploaded");
{
  const s = setup();
  s.write(KEY, [A(1)]);
  const box = s.sync.outbox();
  assert(box.length === 1 && box[0].key === KEY && box[0].value === null, "outbox holds the KEY only (value null), so it cannot eat the localStorage quota");
  assert(s.timers.length === 1 && s.timers[0].ms === 2000, "exactly one debounce timer (2 s) was scheduled");
  assert(s.db.calls.length === 0, "nothing is sent synchronously with the write");
  const r = await s.att.flush();
  assert(r.sent === 1 && s.sync.outbox().length === 0, "flush sent 1 and emptied the outbox");
  assert(ops(s.db) === "select,insert", "call sequence is select -> insert (" + ops(s.db) + ")");
  const ins = s.db.calls[1].payload;
  assert(Object.keys(ins).sort().join() === "data,lesson_id,level,q_idx,subject_key", "INSERT body has exactly level, subject_key, lesson_id, q_idx, data");
  assert(ins.level === "P6" && ins.subject_key === "SS" && ins.lesson_id === "2.1" && ins.q_idx === 0 && Array.isArray(ins.data) && ins.data.length === 1, "key columns come from the route; data is the local array");
  assert(noStudentId(s.db) && s.db.studentIdEverSent === false, "student_id is never sent: not in any payload, not in any filter");
  assert(s.db.rows.length === 1 && s.db.rows[0].student_id === "user-A", "the database assigned the owner (DEFAULT auth.uid()) - the client never did");
  assert(s.db.calls.every(c => c.table === "attempts"), "only the attempts table is touched");
}

console.log("\nTest 5: a later attempt -> SELECT then UPDATE of { data } only (by row id), never an upsert");
{
  const s = setup();
  s.write(KEY, [A(1)]); await s.att.flush();
  s.db.calls.length = 0;
  s.write(KEY, [A(1), A(2, 0)]); await s.att.flush();
  assert(ops(s.db) === "select,update", "select -> update (" + ops(s.db) + ")");
  const up = s.db.calls[1];
  assert(Object.keys(up.payload).join() === "data" && up.filters.id === "row-1", "UPDATE sends only { data } and addresses the row by its id");
  assert(up.returning === "id", "UPDATE asks for the affected id back, so a 0-row update can be detected");
  assert(s.db.rows[0].data.length === 2 && s.db.rows[0].data[1].score === 0, "remote now has both attempts");
  assert(noStudentId(s.db) && s.db.studentIdEverSent === false, "student_id never sent on update either");
  assert(!s.db.calls.some(c => c.op === "upsert"), "no upsert is ever issued");
}

console.log("\nTest 6: duplicate submissions / repeated flushes are idempotent");
{
  const s = setup();
  s.write(KEY, [A(1)]); await s.att.flush();
  s.db.calls.length = 0;
  s.write(KEY, [A(1)]);                         // same content queued again (double click / re-render)
  await s.att.flush();
  assert(ops(s.db) === "select", "identical data: one SELECT and no INSERT/UPDATE (" + ops(s.db) + ")");
  s.write(KEY, [A(1)]); s.write(KEY, [A(1)]); s.write(KEY, [A(1)]);
  assert(s.sync.outbox().length === 1, "three writes of one key coalesce to ONE outbox item");
  assert(s.db.rows.length === 1, "still exactly one remote row");
  const r = await s.att.flush(); assert(s.db.rows.length === 1 && r.failed === 0, "flushing again changes nothing");
}

console.log("\nTest 7: insert race (23505 - another tab / lost response) -> re-read, then update; bounded");
{
  const s = setup();
  s.write(KEY, [A(1)]);
  // the table already holds the row (another tab inserted it) but the FIRST select does not see it
  let hide = true;
  const realFrom = s.db.client.from;
  s.db.client.from = function(t){ const b = realFrom(t);
    const mb = b.maybeSingle; b.maybeSingle = function(){ if(hide){ hide = false; s.db.calls.push({ table:t, op:"select", payload:null, filters:{}, returning:null }); return Promise.resolve({ data:null, error:null }); } return mb.apply(b, arguments); };
    return b; };
  s.db.rows.push({ id:"row-x", updated_at:"2026-11-09T09:00:00.000000+00:00", student_id:"user-A", level:"P6", subject_key:"SS", lesson_id:"2.1", q_idx:0, data:[A(0.5)] });
  const r = await s.att.flush();
  assert(ops(s.db) === "select,insert,select,update", "select(miss) -> insert(23505) -> select -> update (" + ops(s.db) + ")");
  assert(r.sent === 1 && s.db.rows.length === 1 && s.db.rows[0].data.map(e => e.at).join() === "0.5,1", "the existing remote attempt is kept and the new one added (union)");
}
{
  const s = setup();
  s.write(KEY, [A(1)]);
  let n = 0; const realFrom = s.db.client.from;
  s.db.client.from = function(t){ const b = realFrom(t); const mb = b.maybeSingle; b.maybeSingle = function(){ n++; return Promise.resolve({ data:null, error:null }); };
    const ins = b.insert; b.insert = function(p){ s.db.calls.push({ table:t, op:"insert", payload:p, filters:{}, returning:null }); return Promise.resolve({ data:null, error:{ code:"23505" } }); }; return b; };
  const r = await s.att.flush();
  assert(n === 3 && r.failed === 1 && s.sync.outbox().length === 1 && s.sync.outbox()[0].tries === 1, "a conflict that never resolves is bounded to 3 rounds, then handled as an ordinary retry (tries=1)");
}

console.log("\nTest 8: offline / server errors -> silent retry with backoff; local data untouched");
{
  const s = setup();
  const before = JSON.stringify([A(1)]);
  s.write(KEY, [A(1)]);
  s.db.script.push({ op:"select", error:{ message:"Failed to fetch" } });
  s.timers.shift().f();                         // the 2 s debounce timer fires, exactly as in the app
  await new Promise(r0 => setTimeout(r0, 10));
  const r = { failed: s.sync.outbox()[0] ? s.sync.outbox()[0].tries : 0 };
  assert(r.failed === 1 && s.sync.outbox().length === 1 && s.sync.outbox()[0].tries === 1 && s.sync.outbox()[0].nextAt === s.now() + 5000, "a network error: item stays queued, tries=1, next try in 5 s");
  assert(s.st.data[KEY] === before, "the local attempts value is byte-identical");
  assert(s.timers.length >= 1 && s.timers[s.timers.length - 1].ms === 5000, "a retry timer was scheduled for the backoff time (5000 ms)");
  const r2 = await s.att.flush();
  assert(r2.skipped === 1 && s.db.calls.length === 1, "before the backoff elapses the item is skipped (no request)");
  s.tick(5001);
  const r3 = await s.att.flush();
  assert(r3.sent === 1 && s.sync.outbox().length === 0 && s.db.rows.length === 1, "after the backoff the retry succeeds and drains");
  // HTTP 500 / 429 behave the same
  [{ status:500, message:"boom" }, { status:429, code:"over_request_rate_limit" }, { code:"PGRST301", message:"JWT expired" }].forEach(function(err, i){
    const q = setup(); q.write(KEY, [A(1)]); q.db.script.push({ op:"select", error:err });
    return q.att.flush().then(function(rr){ assert(rr.failed === 1 && q.sync.outbox()[0].tries === 1 && q.st.data[KEY] === before, "error #" + i + " " + JSON.stringify(err) + " => retry, local untouched"); });
  });
  await new Promise(r => setTimeout(r, 20));
}

console.log("\nTest 9: after 6 failures the item is parked (needs attention), local value kept; the next real write re-queues it");
{
  const s = setup();
  s.write(KEY, [A(1)]);
  for(let i = 0; i < 6; i++){ s.db.script.push({ op:"select", error:{ message:"down" } }); s.tick(400000); await s.att.flush(); }
  const box = s.sync.outbox();
  assert(box.length === 1 && box[0].parked === true && box[0].tries === 6, "parked after 6 tries, not dropped");
  assert(s.warns.some(w => /parked/.test(w)) && s.warns.every(w => !/private answer|user-A/.test(w)), "one warning, tag only (no answer text, no ids): " + JSON.stringify(s.warns));
  s.tick(400000); const callsBefore = s.db.calls.length; await s.att.flush();
  assert(s.db.calls.length === callsBefore, "a parked item is not retried");
  s.write(KEY, [A(1), A(2)]);
  assert(s.sync.outbox().length === 1 && s.sync.outbox()[0].parked === false && s.sync.outbox()[0].tries === 0, "the next real write of that question replaces the parked item with a fresh one");
  await s.att.flush(); assert(s.db.rows.length === 1 && s.db.rows[0].data.length === 2, "and it syncs, with both attempts");
}

console.log("\nTest 10: not signed in yet -> flush waits without burning retry attempts; draining starts when ready");
{
  const s = setup({ ready:false });
  s.write(KEY, [A(1)]); s.write(KEY2, [A(1)]);
  const r = await s.att.flush();
  assert(s.db.calls.length === 0 && s.att.status() === "waiting-for-auth", "no request while the profile is not confirmed (status waiting-for-auth)");
  assert(s.sync.outbox().length === 2 && s.sync.outbox().every(it => it.tries === 0 && it.nextAt === 0), "both items intact, tries still 0");
  s.setReady(true);
  const r2 = await s.att.flush();
  assert(r2.sent === 2 && s.db.rows.length === 2 && s.sync.outbox().length === 0, "once ready, both drain");
}

console.log("\nTest 11: malformed or oversized local data is never uploaded and never retried in a loop");
{
  const s = setup();
  s.write(KEY, [A(1, "oops")]);
  const r = await s.att.flush();
  assert(s.db.calls.length === 0 && s.sync.outbox().length === 0, "bad score: no request, queue item cleared (local value untouched)");
  assert(s.warns.length === 1 && /skipped-bad-score/.test(s.warns[0]), "one warning tag: " + JSON.stringify(s.warns));
  const s2 = setup(); s2.write(KEY, [A(1, 1, { answer:"x".repeat(160000) })]); await s2.att.flush();
  assert(s2.db.calls.length === 0 && s2.warns.some(w => /too-large/.test(w)), "oversize: nothing sent");
  const s3 = setup(); s3.write(KEY, [A(1)]); delete s3.st.data[KEY]; await s3.att.flush();
  assert(s3.db.calls.length === 0 && s3.sync.outbox().length === 0, "local key vanished: nothing invented, nothing sent");
  const s4 = setup(); s4.write(KEY, [A(1)]); s4.st.data[KEY] = "{not json"; await s4.att.flush();
  assert(s4.db.calls.length === 0, "unparseable local value: nothing sent");
  const s5 = setup(); s5.write(KEY, [A(1)]);
  s5.db.rows.push({ id:"r", updated_at:"2026-11-09T09:00:00.000000+00:00", student_id:"user-A", level:"P6", subject_key:"SS", lesson_id:"2.1", q_idx:0, data:[A(1)] });
  s5.db.rows[0].data = "garbage";   // remote not an array (the table forbids it; defence in depth)
  await s5.att.flush();
  assert(!s5.db.calls.some(c => c.op === "update" || c.op === "insert") && s5.warns.some(w => /remote-not-an-array/.test(w)), "remote row that is not an array: never overwritten");
}

console.log("\nTest 12: an UPDATE that matches no row (RLS hides it) is a failure to retry, not a success");
{
  const s = setup();
  s.write(KEY, [A(1)]); await s.att.flush();
  s.write(KEY, [A(1), A(2)]);
  const realFrom = s.db.client.from;
  s.db.client.from = function(t){ const b = realFrom(t); const up = b.update; b.update = function(p){ const a = up.apply(b, arguments); a.then = function(res){ return Promise.resolve({ data:[], error:null }).then(res); }; return a; }; return b; };
  const r = await s.att.flush();
  assert(r.failed === 1 && s.sync.outbox().length === 1 && s.sync.outbox()[0].tries === 1, "0 rows updated => item stays queued for retry (never reported as sent)");
}

console.log("\nTest 13: attempts made elsewhere (same identity, other device/tab) are kept; local is never overwritten");
{
  const s = setup();
  s.db.rows.push({ id:"row-r", updated_at:"2026-11-09T09:00:00.000000+00:00", student_id:"user-A", level:"P6", subject_key:"SS", lesson_id:"2.1", q_idx:0, data:[A(5), A(6)] });
  const local = [A(7)];
  s.write(KEY, local);
  const localBefore = s.st.data[KEY];
  await s.att.flush();
  assert(s.db.rows[0].data.map(e => e.at).join() === "5,6,7", "remote attempts 5,6 + local 7 => 5,6,7 (history is append-only)");
  assert(s.st.data[KEY] === localBefore, "the local value was not modified by the sync");
  assert(!s.st.log.some(a => a[0] === "set" && a[1] === KEY && a !== s.st.log.find(x => x[0] === "set" && x[1] === KEY)), "the sync never wrote the attempts key (only the test's own write above)");
}

console.log("\nTest 14: routing - only real attempts are queued; vault, state, custom questions stay out");
{
  const s = setup();
  s.write("vault", [{ qid:KEY }]); s.write("timelog", { a:1 }); s.write("lastLesson", {}); s.write("chosenLevel", "P6");
  s.write("attempts:P6:SS:2.1:custom-abc", [A(1)]); s.write("activePersona", "student"); s.write("teacherAssignments", []);
  s.write("attempts:" + "L".repeat(11) + ":SS:2.1:0", [A(1)]);
  assert(!("ethixoOutbox" in s.st.data) && s.timers.length === 0, "none of these queues anything or schedules a timer");
  s.write(KEY, [A(1)]); s.write(KEY2, [A(1)]);
  assert(s.sync.outbox().length === 2 && s.sync.outbox().every(it => it.route.kind === "attempts"), "the two real attempts keys queue");
  const q = setup({ kinds:null }); q.write("vault", [{ qid:KEY }]);
  assert(q.sync.outbox().length === 1, "(control) without the kinds filter the Phase 1 behaviour is unchanged: vault is queued");
  const q2 = setup({ omitValues:false }); q2.write(KEY, [A(1)]);
  assert(JSON.stringify(q2.sync.outbox()[0].value) === JSON.stringify([A(1)]), "(control) without omitValues the Phase 1 behaviour is unchanged: the value is stored");
}

console.log("\nTest 15: the Phase 1 flush race - items queued while a send is in flight must survive");
{
  const st = fakeStorage(); let t = 5;
  const s = createEthixoSync({ mode:"shadow", getStorage:() => st, now:() => t, kinds:["attempts"], omitValues:true });
  let first = true;
  s.setSender(async function(item){ if(first){ first = false; await Promise.resolve(); s.onWrite(KEY, [A(2)]); s.onWrite(KEY2, [A(9)]); } });
  s.onWrite(KEY, [A(1)]);
  const r = await s.flush();
  const box = s.outbox();
  assert(r.sent === 1, "the in-flight item was sent");
  assert(box.length === 2 && box.map(i => i.key).sort().join() === KEY + "," + KEY2, "both the NEW key and the RE-queued key survive the flush's final write (" + box.map(i => i.key).join() + ")");
  const r2 = await s.flush();
  assert(r2.sent === 2 && s.outbox().length === 0, "and they drain on the next flush");
  const st2 = fakeStorage();
  const s2 = createEthixoSync({ mode:"shadow", getStorage:() => st2, now:() => 7, kinds:["attempts"], omitValues:true });
  s2.setSender(async function(){ throw new Error("down"); });
  s2.onWrite(KEY, [A(1)]); await s2.flush(); await s2.flush();
  assert(s2.outbox().length === 1 && s2.outbox()[0].tries === 1, "(control) an ordinary failure still keeps one item with tries=1");
  const st3 = fakeStorage(); const s3 = createEthixoSync({ mode:"shadow", getStorage:() => st3 }); s3.setSender(async function(){}); await s3.flush();
  assert(!("ethixoOutbox" in st3.data), "flushing an EMPTY outbox writes nothing (no empty ethixoOutbox key is created)");
}

console.log("\nTest 16: scheduling - one timer, no polling, listeners only after activity");
{
  const s = setup();
  assert(s.timers.length === 0 && s.listeners.length === 0, "constructing the active instance creates no timer and no listener");
  s.write(KEY, [A(1)]);
  assert(s.timers.length === 1 && s.listeners.map(l => l[0]).join() === "online,visibilitychange", "first queued write: one timer, listeners attached once");
  s.write(KEY2, [A(1)]); s.write(KEY, [A(1), A(2)]);
  assert(s.timers.length === 1 && s.listeners.length === 2, "more writes inside the debounce window reuse the timer and add no listeners");
  s.att.schedule(100);
  assert(s.timers.length === 1 && s.timers[0].ms === 100 && s.cleared.length === 1, "an earlier due time replaces the later timer (never two)");
  s.att.schedule(5000);
  assert(s.timers.length === 1 && s.timers[0].ms === 100, "a later due time does not delay an earlier one");
  s.timers[0].f();                                             // the timer fires
  await new Promise(r => setTimeout(r, 10));
  assert(s.db.rows.length === 2 && s.sync.outbox().length === 0, "the timer drained both items");
  assert(s.timers.length === 0, "nothing re-schedules once the outbox is empty (no polling)");
  const online = s.listeners.find(l => l[0] === "online")[1];
  s.write(KEY, [A(1), A(2), A(3)]); s.timers.shift().f(); await new Promise(r => setTimeout(r, 10));   // drained; no timer left
  assert(s.timers.length === 0, "(setup) no timer pending");
  online();
  assert(s.timers.length === 1, "the online event schedules a flush when ready");
  const s2 = setup({ ready:false }); s2.write(KEY, [A(1)]); s2.timers.shift().f(); await new Promise(r => setTimeout(r, 10));
  assert(s2.timers.length === 0, "(setup) not ready: the timer fired and nothing re-armed");
  s2.listeners.find(l => l[0] === "online")[1]();
  assert(s2.timers.length === 0, "the online event does nothing while not signed in");
}
{
  // flush while a flush is running -> exactly one follow-up, no overlap
  const s = setup();
  s.write(KEY, [A(1)]);
  let inFlight = 0, maxInFlight = 0; const realFrom = s.db.client.from;
  s.db.client.from = function(t){ const b = realFrom(t); const mb = b.maybeSingle; b.maybeSingle = async function(){ inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise(r => setTimeout(r, 15)); inFlight--; return mb.apply(b, arguments); }; return b; };
  const p1 = s.att.flush(), p2 = s.att.flush(), p3 = s.att.flush();
  await Promise.all([p1, p2, p3]); await new Promise(r => setTimeout(r, 30));
  assert(maxInFlight === 1, "overlapping flush() calls never run concurrently (max in flight " + maxInFlight + ")");
  assert(s.db.rows.length === 1, "and produce exactly one remote row");
}

console.log("\nTest 17: learning is never blocked or affected");
{
  const s = setup();
  const t0 = s.db.calls.length;
  const before = s.st.log.length;
  s.write(KEY, [A(1)]);
  assert(s.db.calls.length === t0, "a learning write makes no request by itself (the send happens later, off the learning path)");
  // a throwing sync layer / throwing notifier cannot escape sync.onWrite
  const st = fakeStorage();
  const bad = createEthixoSync({ mode:"shadow", getStorage:() => st, kinds:["attempts"], omitValues:true, onQueued(){ throw new Error("notifier exploded"); } });
  bad.setSender(async function(){});
  let threw = false; try{ bad.onWrite(KEY, [A(1)]); }catch(e){ threw = true; }
  assert(!threw && bad.outbox().length === 1, "a throwing onQueued notifier never reaches the caller and the item is still queued");
  const brokenStorage = { getItem(){ throw new Error("quota"); }, setItem(){ throw new Error("quota"); } };
  const q = createEthixoSync({ mode:"shadow", getStorage:() => brokenStorage, kinds:["attempts"], omitValues:true });
  q.setSender(async function(){});
  let threw2 = false; try{ q.onWrite(KEY, [A(1)]); }catch(e){ threw2 = true; }
  assert(!threw2, "unwritable storage: onWrite does not throw");
  const kill = setup(); kill.write(KEY, [A(1)]); kill.st.data.ethixoSyncKill = "1"; const r = await kill.att.flush();
  assert(kill.db.calls.length === 0 && r.sent === 0, "kill switch (ethixoSyncKill=1): flush sends nothing");
}

console.log("\nTest 18: privacy - what goes over the wire, what goes in warnings");
{
  const s = setup(); s.write(KEY, [A(1)]); await s.att.flush();
  const wire = JSON.stringify(s.db.calls);
  assert(!/ethixoAuth|token|password|email|apikey|user-A/i.test(wire), "no identity, token or key appears in any call");
  assert(s.db.calls.every(c => c.table === "attempts" && ["select", "insert", "update"].indexOf(c.op) !== -1), "only select / insert / update on attempts");
  const w = setup(); w.write(KEY, [A(1, "bad", { answer:"my secret answer" })]); await w.att.flush();
  assert(w.warns.length === 1 && !/secret|answer|user|P6|SS/.test(w.warns[0]), "a warning never contains answer text or ids: " + JSON.stringify(w.warns));
}

console.log("\nTest 19: source assertions on the ATTEMPTS block");
{
  const code = attSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    .split("\n").filter(l => !/^  const (getStorage|now|setTimer|clearTimer|addListener|isVisible|warnFn) = opts\./.test(l)).join("\n");   // injected platform defaults
  assert(!/student_id/.test(code), "the code never mentions student_id");
  assert(!/\.upsert\s*\(|\.delete\s*\(|\.rpc\s*\(/.test(code), "no upsert / delete / rpc");
  assert((code.match(/\.from\(\s*"([a-z_]+)"/g) || []).every(x => /"attempts"/.test(x)) && (code.match(/\.from\(/g) || []).length === (code.match(/\.from\(\s*"attempts"/g) || []).length && (code.match(/\.from\(/g) || []).length >= 1, "every .from() targets attempts");
  assert(!/vault_entries|student_state|class_members|"profiles"|"classes"/.test(code), "no other table is named");
  assert(!/setItem|removeItem|\.clear\s*\(|localStorage|sessionStorage|sSet\(|sGet\(/.test(code), "never writes, removes or clears storage; no direct localStorage (reads go through the injected getItem only)");
  assert((code.match(/getItem\(/g) || []).length === 1, "exactly one storage read: the attempts key being sent");
  assert(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|setInterval|createElement|innerHTML|render\(|alert\(|toast|console\./.test(code), "no network of its own, no polling, no UI, no console");
  assert(!/createClient|signIn|signUp|signOut|getSession|\.auth\./.test(code), "no authentication calls of its own (it only asks the auth block for a ready client)");
  assert(/\bsetSender\(sender\)/.test(code) && (code.match(/setSender\(/g) || []).length === 1, "the sender is registered in exactly one place, after the off-gate");
  assert(code.indexOf('baseMode === "off"') < code.indexOf("setSender("), "the off gate returns BEFORE the sender can be registered");
  // the other shipped blocks
  const authCode = block("/* ETHIXO-AUTH-BEGIN", "/* ETHIXO-AUTH-END */").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert(!/attempts|setSender|ETHIXO_SYNC\.flush/.test(authCode.replace(/ETHIXO_ATTEMPTS/g, "")), "the auth block still never names attempts or registers a sender");
  assert(/function readyClient\(\)\{\s*if\(baseMode === "off"\) return null;/.test(authCode), "auth.readyClient() returns null first thing when the flag is off");
  assert(/return status === "profile-ok" \? client : null;/.test(authCode), "auth.readyClient() hands out the client only after the student profile is confirmed");
  assert((html.match(/ETHIXO_ATTEMPTS\.schedule\(\)/g) || []).length === 2, "the only two external triggers are the sync onQueued hook and the auth onProfileOk hook");
  assert(/function sSet\(key,val\)\{ try\{ localStorage\.setItem\(key, JSON\.stringify\(val\)\); try\{ ETHIXO_SYNC\.onWrite\(key,val\); \}catch\(_e\)\{ \/\* sync can never affect the app \*\/ \} \}catch\(e\)\{ console\.error\("storage set failed",e\); \} \}/.test(html), "sSet is byte-identical (the learning write path is untouched)");
}

console.log("\n==================================================\nRESULTS: " + passed + " passed, " + failed + " failed\n==================================================");
process.exit(failed ? 1 : 0);
})();
