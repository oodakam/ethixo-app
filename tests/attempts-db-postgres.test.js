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
}catch(e){
  failed++; console.log("  FAIL: harness error: " + e.message);
}
console.log("\n==================================================\nRESULTS: " + passed + " passed, " + failed + " failed\n==================================================");
process.exit(failed ? 1 : 0);
})();
