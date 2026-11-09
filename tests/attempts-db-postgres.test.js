/* Phase 3 database-side tests in a REAL, throw-away, local PostgreSQL (never Supabase, never the network).
   - tests/db/ethixo-schema-v1.sql        the schema (same file that was applied to ethixo-sg-dev)
   - tests/db/local-test-shim.sql         stands in for Supabase's auth schema/roles (auth.users, auth.uid(), anon, authenticated)
   - tests/db/security-tests-v1.sql       the existing 92-check schema security suite (RLS, grants, teacher isolation)
   - tests/db/attempts-phase3.sql         Phase 3: sender statement shapes, ownership, malformed data, teacher summary, helper-grant fix
   - tests/db/preflight-query-a.sql       the live Preflight "Query A" must show no FAIL after the fix
   - a true two-connection insert race (this file)
   If PostgreSQL is not installed the suite says NOT RUN (it does not pretend to pass). Fake data only. */
const fs = require("fs"), path = require("path"), os = require("os");
const { spawnSync, spawn } = require("child_process");
const repo = path.join(__dirname, ".."), dbdir = path.join(__dirname, "db");
let passed = 0, failed = 0;
function assert(c, m){ if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } }

function findBin(){
  const cands = [];
  try{ for(const v of fs.readdirSync("/usr/lib/postgresql")) cands.push("/usr/lib/postgresql/" + v + "/bin"); }catch(e){}
  cands.push("/usr/local/pgsql/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
  for(const d of cands.reverse()) if(fs.existsSync(path.join(d, "initdb")) && fs.existsSync(path.join(d, "pg_ctl"))) return d;
  return null;
}
const BIN = findBin();
if(!BIN || spawnSync("which", ["psql"]).status !== 0){
  console.log("NOT RUN: PostgreSQL (initdb, pg_ctl, psql) is not installed here. The database-side Phase 3 checks were NOT executed.");
  process.exit(0);
}
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const tmp = fs.mkdtempSync(path.join("/tmp", "ethixo-pg-"));
const port = String(54000 + Math.floor(Math.random() * 900));
function wrap(cmd, args){
  if(!isRoot) return { cmd, args };
  const q = (a) => "'" + String(a).replace(/'/g, "'\\''") + "'";
  return { cmd: "su", args: ["postgres", "-s", "/bin/bash", "-c", [cmd].concat(args).map(q).join(" ")] };
}
function run(cmd, args, opts){
  const w = wrap(cmd, args); opts = opts || {};
  const r = spawnSync(w.cmd, w.args, { encoding:"utf8", cwd: opts.cwd || "/", input: opts.input, env: Object.assign({}, process.env, { PGHOST: tmp, PGPORT: port, PGUSER:"postgres" }), timeout: 120000, maxBuffer: 1 << 26 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "" };
}
const psql = (db, args, opts) => run(path.join(BIN, "psql"), ["-d", db].concat(args), opts);
function stopAndClean(){
  try{ run(path.join(BIN, "pg_ctl"), ["-D", path.join(tmp, "data"), "-m", "immediate", "stop"]); }catch(e){}
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
}
process.on("exit", stopAndClean);

(async function(){
try{
  if(isRoot){ spawnSync("chown", ["postgres:postgres", tmp]); fs.chmodSync(dbdir, 0o755); }
  let r = run(path.join(BIN, "initdb"), ["-D", path.join(tmp, "data"), "-A", "trust", "-U", "postgres"]);
  if(r.code !== 0) throw new Error("initdb failed: " + r.out.slice(0, 300));
  r = run(path.join(BIN, "pg_ctl"), ["-D", path.join(tmp, "data"), "-o", "-c listen_addresses='' -k " + tmp + " -p " + port, "-l", path.join(tmp, "log"), "-w", "start"]);
  if(r.code !== 0) throw new Error("pg_ctl start failed: " + r.out.slice(0, 300));
  const load = (db, files) => psql(db, ["-q", "-v", "ON_ERROR_STOP=1"].concat([].concat.apply([], files.map(f => ["-f", f]))), { cwd: dbdir });
  psql("postgres", ["-q", "-c", "create database base"]);
  r = load("base", ["local-test-shim.sql", "ethixo-schema-v1.sql"]);
  if(r.code !== 0) throw new Error("loading schema failed: " + r.out.slice(0, 400));

  const summarize = (db, label, expectMin) => {
    const t = psql(db, ["-At", "-F", "|", "-c", "select count(*) filter (where ok), count(*) filter (where not ok) from t.res"]).stdout.trim().split("|").map(Number);
    const bad = psql(db, ["-At", "-F", " => ", "-c", "select name, got from t.res where not ok order by n"]).stdout.trim();
    console.log("  " + label + ": " + t[0] + " passed, " + t[1] + " failed");
    if(bad) console.log(bad.split("\n").map(x => "    FAIL: " + x.slice(0, 220)).join("\n"));
    passed += t[0]; failed += t[1];
    assert(t[0] + t[1] >= expectMin, label + " ran its full set of checks (>= " + expectMin + ")");
  };

  console.log("\nSuite 1: existing schema security suite (RLS, grants, teacher isolation) in real Postgres");
  psql("postgres", ["-q", "-c", "create database sec template base"]);
  psql("sec", ["-q", "-o", "/dev/null", "-f", "security-tests-v1.sql"], { cwd: dbdir });
  summarize("sec", "security-tests-v1", 90);

  console.log("\nSuite 2: Phase 3 attempts (sender shapes, ownership, malformed data, teacher summary, helper-grant fix)");
  psql("postgres", ["-q", "-c", "create database p3 template base"]);
  psql("p3", ["-q", "-o", "/dev/null", "-f", "attempts-phase3.sql"], { cwd: dbdir });
  summarize("p3", "attempts-phase3", 69);

  console.log("\nSuite 3: the live Preflight 'Query A' against the real engine (after the approved helper-grant fix)");
  const qa = psql("p3", ["-At", "-F", "|", "-f", "preflight-query-a.sql"], { cwd: dbdir });
  const rows = qa.stdout.trim().split("\n").filter(Boolean);
  const res = rows.map(l => l.split("|").pop());
  assert(qa.code === 0 && rows.length === 36, "Query A runs as ONE statement and returns all 36 check rows (" + rows.length + ")");
  assert(res.filter(x => x === "FAIL").length === 0, "Query A: no FAIL rows (" + res.filter(x => x === "PASS").length + " PASS, " + res.filter(x => x === "INFO").length + " INFO)");
  const pre = psql("base", ["-At", "-F", "|", "-f", "preflight-query-a.sql"], { cwd: dbdir }).stdout.trim().split("\n").filter(l => /\|FAIL$/.test(l));
  assert(pre.length === 1 && /^84\|/.test(pre[0]), "BEFORE the fix, Query A fails exactly check 84 and nothing else - the same finding seen live");

  console.log("\nSuite 4: a true two-connection race on one new key (real unique index, real locking)");
  const claims = (uid) => "select set_config('request.jwt.claims', '{\"sub\":\"" + uid + "\",\"is_anonymous\":true}', true);\nset local role authenticated;\n";
  const S3 = "00000000-0000-0000-0000-0000000000b3";
  const ins = "insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','race',0,'[{\"score\":1,\"at\":10}]');\n";
  const scriptA = "begin;\n" + claims(S3) + ins + "select pg_sleep(1.5);\ncommit;\n";
  const scriptB = "begin;\n" + claims(S3) + "insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','race',0,'[{\"score\":2,\"at\":20}]');\ncommit;\n";
  const spawnPsql = (script) => new Promise((resolve) => {
    const w = wrap(path.join(BIN, "psql"), ["-d", "p3", "-At", "-v", "ON_ERROR_STOP=0", "-q"]);
    const t0 = Date.now(); let out = "";
    const p = spawn(w.cmd, w.args, { env: Object.assign({}, process.env, { PGHOST: tmp, PGPORT: port, PGUSER:"postgres" }) });
    p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
    p.on("close", () => resolve({ out, ms: Date.now() - t0 })); p.stdin.write(script); p.stdin.end();
  });
  const pa = spawnPsql(scriptA);
  const pb = new Promise(res => setTimeout(() => res(spawnPsql(scriptB)), 400));
  const [ra, rb] = await Promise.all([pa, pb]);
  assert(!/ERROR/.test(ra.out), "connection A (first writer) inserted and committed without error");
  assert(/23505|duplicate key/.test(rb.out) && rb.ms > 900, "connection B (racing writer) was BLOCKED until A committed, then got the duplicate-key error 23505 (" + rb.ms + " ms)");
  const id = psql("p3", ["-At", "-c", "select id from public.attempts where lesson_id='race'"]).stdout.trim();
  assert(/^[0-9a-f-]{36}$/.test(id), "exactly one row exists for the key");
  const fix = "begin;\n" + claims(S3) + "update public.attempts set data = '[{\"score\":1,\"at\":10},{\"score\":2,\"at\":20}]' where id = '" + id + "' returning id;\ncommit;\n";
  const rf = psql("p3", ["-At", "-q"], { input: fix });
  assert(rf.stdout.indexOf(id) !== -1, "the loser's recovery (re-read, then UPDATE by id) matches exactly one row");
  const fin = psql("p3", ["-At", "-F", "|", "-c", "select count(*), max(jsonb_array_length(data)) from public.attempts where lesson_id='race'"]).stdout.trim();
  assert(fin === "1|2", "final state: one row holding both writers' attempts (" + fin + ")");

  console.log("\nSuite 5 (Phase 4a): compare-and-swap UPDATE (update ... where id and updated_at, returning id) with two independent connections");
  const CAS = "cas";
  const one = (script) => psql("p3", ["-At", "-F", "|", "-q"], { input: script });                    // each call = its own connection and its own transaction
  const asS3 = (sql) => "begin;\n" + claims(S3) + sql + "\ncommit;\n";
  const e1 = '[{"score":1,"usedThinking":false,"at":10}]';
  one(asS3("insert into public.attempts(level,subject_key,lesson_id,q_idx,data) values ('P6','EN','" + CAS + "',0,'" + e1 + "');"));
  const readRow = () => one(asS3("select id, updated_at, data::text from public.attempts where lesson_id='" + CAS + "' and q_idx=0 and level='P6' and subject_key='EN';")).stdout.split("\n").filter(l => /^[0-9a-f-]{36}\|/.test(l))[0].split("|");
  const readA = readRow(), readB = readRow();     // two readers obtain the same version
  assert(readA[1] === readB[1] && readA[1].length > 10, "two independent readers obtain the same updated_at (" + readA[1] + ")");
  const rid = readA[0], oldV = readA[1];
  const cas = (v, data) => asS3("update public.attempts set data = '" + data + "' where id = '" + rid + "' and updated_at = '" + v + "' returning id;");
  const dataA = '[{"score":1,"usedThinking":false,"at":10},{"score":2,"usedThinking":true,"at":20}]';
  const casA = one(cas(oldV, dataA));
  assert(casA.stdout.indexOf(rid) !== -1, "writer A's conditional update on the version it read affects exactly 1 row");
  const afterA = readRow();
  assert(afterA[1] !== oldV, "the database bumped updated_at after A's write (the version really changed)");
  const dataB = '[{"score":1,"usedThinking":false,"at":10},{"score":3,"usedThinking":false,"at":30}]';
  const casB = one(cas(oldV, dataB));
  assert(casB.stdout.indexOf(rid) === -1 && /UPDATE 0|^$/m.test(casB.stdout + "\n") && readRow()[2] === afterA[2], "writer B's stale update (old updated_at) affects 0 rows and changes nothing");
  const cur = JSON.parse(readRow()[2]); const merged = cur.concat([{ score:3, usedThinking:false, at:30 }]);
  const casB2 = one(cas(readRow()[1], JSON.stringify(merged)));
  assert(casB2.stdout.indexOf(rid) !== -1, "writer B re-reads, merges and its update on the NEW updated_at affects 1 row");
  const fin5 = readRow(); const fd = JSON.parse(fin5[2]);
  assert(JSON.stringify(fd.map(x => x.at)) === "[10,20,30]" && fd[1].usedThinking === true, "final row holds both writers' attempts (at 10, 20, 30)");
  assert(fd.every(x => Object.keys(x).sort().join() === "at,score,usedThinking") && !/answer|strengths|nextSteps/.test(fin5[2]), "final row has only at / score / usedThinking: no answer, strengths or nextSteps");
  const ghost = one(asS3("update public.attempts set data = '[]' where id = '" + rid + "' and updated_at = '2000-01-01T00:00:00+00' returning id;"));
  assert(ghost.stdout.indexOf(rid) === -1 && JSON.parse(readRow()[2]).length === 3, "an update with a wrong version never matches (data still 3 attempts)");
}catch(e){
  failed++; console.log("  FAIL: harness error: " + e.message);
}
console.log("\n==================================================\nRESULTS: " + passed + " passed, " + failed + " failed\n==================================================");
process.exit(failed ? 1 : 0);
})();
