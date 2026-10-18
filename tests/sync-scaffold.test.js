// Unit tests for the ETHIXO-SYNC scaffold block in index.html (Integration Plan v1.1, Phase 0+1).
// Pure node: no jsdom, no network. The block is extracted by its markers and evaluated in isolation.
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

let passed = 0, failed = 0;
function assert(cond, msg){ if(cond){ passed++; console.log("  PASS:", msg); } else { failed++; console.log("  FAIL:", msg); } }

const b = html.indexOf("/* ETHIXO-SYNC-BEGIN"), e = html.indexOf("/* ETHIXO-SYNC-END */");
if(b < 0 || e < 0 || e < b){ console.log("FAIL: markers not found"); process.exit(1); }
const blockSrc = html.slice(b, e);
const mod = new Function(blockSrc + "; return { createEthixoSync, ETHIXO_SYNC, DB_SYNC_MODE };")();
const { createEthixoSync } = mod;

// A storage double that records every access.
function fakeStorage(seed){
  const data = Object.assign({}, seed || {}); const log = [];
  return { data, log,
    getItem(k){ log.push(["get",k]); return k in data ? data[k] : null; },
    setItem(k,v){ log.push(["set",k]); data[k] = String(v); },
    removeItem(k){ log.push(["remove",k]); delete data[k]; } };
}
const mk = (o, st) => createEthixoSync(Object.assign({ getStorage: () => st }, o));

console.log("\nTest 1: shipped defaults are OFF");
assert(mod.DB_SYNC_MODE === "off", "DB_SYNC_MODE constant is \"off\"");
assert(mod.ETHIXO_SYNC.mode() === "off", "the instance the app uses reports mode off");
assert(/const DB_SYNC_MODE = "off";/.test(html), "the literal source line is const DB_SYNC_MODE = \"off\";");
["", undefined, null, "OFF", "banana", "true", 1, "On"].forEach(function(v){
  assert(createEthixoSync({ mode: v }).mode() === "off", "unrecognised mode " + JSON.stringify(v) + " falls back to off");
});

console.log("\nTest 2: OFF performs zero storage access and queues nothing");
{
  const st = fakeStorage({ vault: "[]" });
  const s = mk({ mode: "off" }, st);
  s.setSender(function(){ throw new Error("must never be called"); });
  s.onWrite("vault", [{ qid:"attempts:P6:SS:2.1:0" }]);
  s.onWrite("attempts:P6:SS:2.1:0", [{ answer:"x" }]);
  s.onWrite("timelog", { a:1 });
  assert(s.mode() === "off", "mode() is off");
  assert(st.log.length === 0, "storage was never touched (reads, writes, kill-switch lookups): " + st.log.length + " accesses");
  assert(s.outbox().length === 0, "outbox() is empty and does not read storage");
  assert(st.log.length === 0, "still zero accesses after outbox()");
}
(async function(){
{
  const st = fakeStorage();
  const s = mk({ mode: "off" }, st);
  const r = await s.flush();
  assert(r.sent === 0 && st.log.length === 0, "flush() is a no-op when off, zero storage access");
}

console.log("\nTest 3: build code contains no Supabase loader, URL or key");
assert(!/supabase\.co/i.test(blockSrc), "no supabase.co URL in the sync block");
assert(!/createClient|supabase-js|jsdelivr|importScripts|XMLHttpRequest|\bfetch\s*\(|WebSocket|sendBeacon|createElement\(["']script/.test(blockSrc), "no client creation / fetch / XHR / WebSocket / beacon / script injection in the sync block");
assert(!/service_role|sb_secret|eyJ[A-Za-z0-9_-]{20,}/.test(blockSrc), "no secret or JWT-like string in the sync block");
assert(!/\bdelete\b|\.delete\(|method:\s*["']DELETE/i.test(blockSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no delete operation expressible in the code (comments excluded)");

console.log("\nTest 4: key router");
const R = createEthixoSync({ mode: "off" }).route;
assert(R("vault").kind === "vault", "vault → vault");
["timelog","lastLesson","lastActive","chosenLevel","dashboardSeenNoticedIds"].forEach(k => assert(R(k).kind === "state" && R(k).field === k, k + " → student_state"));
assert(R("activePersona").kind === "local", "activePersona stays local (UI only)");
assert(R("teacherAssignments").kind === "local", "teacherAssignments not routed in this phase");
{ const r = R("attempts:P6:SS:2.1:7"); assert(r.kind === "attempts" && r.level === "P6" && r.subject_key === "SS" && r.lesson_id === "2.1" && r.q_idx === 7, "numeric bank attempt key maps to level/subject/lesson/q_idx"); }
assert(R("attempts:P6:SS:2.1:custom-1760000000000").kind === "local", "custom question attempts stay local (decision D4a)");
assert(R("attempts:P6:SS:2.1").kind === "local" && R("attempts:a:b:c:d:e").kind === "local", "malformed attempt keys stay local");
assert(R("attempts:P6:SS:2.1:1000").kind === "local", "4-digit index stays local");
assert(R("attempts:" + "L".repeat(11) + ":SS:1:0").kind === "local", "over-long level stays local (schema limit 10)");
assert(R("attempts:P6:" + "S".repeat(41) + ":1:0").kind === "local", "over-long subject stays local (schema limit 40)");
assert(R("attempts:P6:SS:" + "x".repeat(41) + ":0").kind === "local", "over-long lesson stays local (schema limit 40)");
assert(R("somethingElse").kind === "local" && R(42).kind === "local" && R(null).kind === "local", "unknown / non-string keys stay local");
assert(R("ethixoOutbox").kind === "local" && R("ethixoSyncKill").kind === "local", "the sync's own keys are never routed");

console.log("\nTest 5: Vault planner is upsert-only and refuses incomplete state");
const S = createEthixoSync({ mode: "off" });
const e1 = { qid:"attempts:P6:SS:2.1:0", subjectKey:"SS", answer:"a", savedAt:100 };
const e2 = { qid:"attempts:P6:SCI:1.1:3", subjectKey:"SCI", answer:"b", savedAt:200 };
{
  const p = S.planVaultUpserts({ local:[e1,e2], loaded:true });
  assert(p.upserts.length === 2 && p.upserts[0].qid === e1.qid && p.upserts[0].lesson_id === "2.1" && p.upserts[1].subject_key === "SCI", "valid loaded array → upserts for each entry with lesson_id/subject_key");
  assert(Object.keys(p).sort().join() === "upserts,warnings", "plan has ONLY upserts + warnings (no delete channel exists)");
}
{ const p = S.planVaultUpserts({ local:[e1,e2], loaded:false }); assert(p.upserts.length === 0 && p.warnings.indexOf("vault-not-loaded") >= 0, "NOT-LOADED local array → nothing planned"); }
{ const p = S.planVaultUpserts({ local:[e1,e2] }); assert(p.upserts.length === 0, "missing loaded flag → nothing planned"); }
[null, undefined, "x", {}, 5].forEach(v => { const p = S.planVaultUpserts({ local:v, loaded:true }); assert(p.upserts.length === 0 && Object.keys(p).join() === "upserts,warnings", "non-array local " + JSON.stringify(v) + " → nothing planned, no deletes possible"); });
{ const p = S.planVaultUpserts({ local:[], loaded:true, lastMirroredCount:5 }); assert(p.upserts.length === 0 && !("deletes" in p), "EMPTY array after 5 mirrored → zero upserts and no delete output"); }
{ const p = S.planVaultUpserts({ local:[e1], loaded:true, lastMirroredCount:2 }); assert(p.warnings.indexOf("local-shrunk") >= 0 && p.upserts.length === 1, "SHRUNK array → warning, still only upserts what it contains"); }
{ const p = S.planVaultUpserts({ local:[e1,e2], loaded:true, remoteSavedAt:{ [e1.qid]:999 } }); assert(p.upserts.length === 1 && p.upserts[0].qid === e2.qid && p.warnings.some(w => w.indexOf("skipped-remote-newer") === 0), "newer remote copy is not overwritten by an older local entry"); }
{ const p = S.planVaultUpserts({ local:[e1, null, {}, {qid:5}, {qid:"x".repeat(201)}, [], "s"], loaded:true }); assert(p.upserts.length === 1 && p.warnings.filter(w => w === "skipped-invalid-entry").length === 6, "invalid entries skipped individually, valid ones kept"); }
{ const big = { qid:"attempts:P6:SS:2.1:1", answer:"x".repeat(100001) }; const p = S.planVaultUpserts({ local:[big], loaded:true }); assert(p.upserts.length === 0, "entry over the 100,000-char database limit is skipped, not sent"); }
{ const cyc = { qid:"attempts:P6:SS:2.1:2" }; cyc.self = cyc; const p = S.planVaultUpserts({ local:[cyc,e1], loaded:true }); assert(p.upserts.length === 1, "unserialisable entry is skipped without throwing"); }
{ const input = { local:[e1,e2], loaded:true }; const before = JSON.stringify(input); S.planVaultUpserts(input); assert(JSON.stringify(input) === before, "planner does not mutate its input"); }

console.log("\nTest 6: shadow mode with NO sender queues nothing (Phase 1 reality)");
{
  const st = fakeStorage({ vault: "[]", chosenLevel: "\"P6\"" });
  const s = mk({ mode: "shadow" }, st);
  s.onWrite("vault", [e1]); s.onWrite("chosenLevel", "P6");
  assert(!("ethixoOutbox" in st.data), "no outbox created without a sender");
  assert(st.data.vault === "[]" && st.data.chosenLevel === "\"P6\"", "existing keys untouched");
}

console.log("\nTest 7: outbox behaviour when a sender is registered (test-only configuration)");
{
  const st = fakeStorage({ vault:"[\"keep\"]" });
  let t = 1000; const s = mk({ mode:"shadow", now: () => t }, st);
  const sent = []; let failNext = false;
  s.setSender(async it => { if(failNext) throw new Error("net"); sent.push(it.key); });
  s.onWrite("attempts:P6:SS:2.1:0", [{ at:1 }]); s.onWrite("attempts:P6:SS:2.1:0", [{ at:1 },{ at:2 }]); s.onWrite("activePersona","student"); s.onWrite("custom", 1); s.onWrite("attempts:P6:SS:2.1:custom-9", []);
  assert(s.outbox().length === 1, "only routable keys queue; duplicate key coalesces to newest value (got " + s.outbox().length + ")");
  assert(s.outbox()[0].value.length === 2, "newest value kept");
  const r1 = await s.flush(); assert(r1.sent === 1 && s.outbox().length === 0, "successful flush empties outbox");
  failNext = true; s.onWrite("timelog", {d:1});
  const r2 = await s.flush(); assert(r2.failed === 1 && s.outbox().length === 1 && s.outbox()[0].tries === 1, "failed send stays queued with tries=1");
  const r3 = await s.flush(); assert(r3.skipped === 1, "item is not retried before its backoff time");
  t += 5001; failNext = false; const r4 = await s.flush(); assert(r4.sent === 1 && s.outbox().length === 0, "retry after backoff succeeds and drains");
  failNext = true; s.onWrite("timelog", {d:2});
  for(let i = 0; i < 12; i++){ t += 400000; await s.flush(); }
  const box = s.outbox(); assert(box.length === 1 && box[0].parked === true && box[0].tries === 6, "after 6 failures item is parked, not dropped");
  assert(st.data.vault === "[\"keep\"]", "learning data key untouched by outbox activity");
  assert(Object.keys(st.data).sort().join() === "ethixoOutbox,vault", "the only key the scaffold ever creates is ethixoOutbox");
}
{
  const st = fakeStorage(); const s = mk({ mode:"shadow" }, st); s.setSender(async () => {});
  for(let i = 0; i < 520; i++) s.onWrite("attempts:P6:SS:2.1:" + (i % 1000) + "", [i]);
  assert(s.outbox().length <= 500, "outbox is capped at 500 items");
}

console.log("\nTest 8: kill switch forces OFF");
{
  const st = fakeStorage({ ethixoSyncKill: "1" }); const s = mk({ mode:"on" }, st); let called = 0; s.setSender(async () => { called++; });
  s.onWrite("timelog", {}); const r = await s.flush();
  assert(s.mode() === "off" && !("ethixoOutbox" in st.data) && called === 0 && r.sent === 0, "kill switch set → mode off, nothing queued, nothing sent");
}

console.log("\nTest 9: failures inside sync never reach the app");
{
  const exploding = { getItem(){ throw new Error("boom"); }, setItem(){ throw new Error("boom"); } };
  const s = createEthixoSync({ mode:"shadow", getStorage: () => exploding }); s.setSender(async () => {});
  let threw = false; try{ s.onWrite("timelog", {}); }catch(_e){ threw = true; }
  assert(!threw, "unreadable/unwritable storage inside the scaffold does not throw");
}

console.log("\nTest 10: sSet integration is minimal and guarded");
{
  const m = html.match(/function sSet\(key,val\)\{[^\n]*\n/);
  assert(m && /localStorage\.setItem\(key, JSON\.stringify\(val\)\)/.test(m[0]), "sSet still writes localStorage first, unchanged");
  assert(m && /try\{ ETHIXO_SYNC\.onWrite\(key,val\); \}catch\(_e\)/.test(m[0]), "sync call is wrapped in its own try/catch");
  assert(/function sGet\(key\)\{ try\{ const v = localStorage\.getItem\(key\); return v \? JSON\.parse\(v\) : null; \}catch\(e\)\{ return null; \} \}/.test(html), "sGet is byte-identical to before");
  assert((html.match(/ETHIXO_SYNC\./g) || []).length === 1, "ETHIXO_SYNC is referenced from exactly one place outside its own block");
}

console.log("\n" + "=".repeat(50));
console.log("RESULTS: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
})();
