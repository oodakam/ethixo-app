/* D4 PROPOSAL tests in a throw-away local PostgreSQL (never Supabase). Loads shim + schema v1 + proposals/d4-delete-my-data/migration.sql, runs local-tests.sql,
   then verify.sql (must be all PASS), then rollback.sql (functions must disappear). NOT RUN if PostgreSQL is missing. Fake data only. */
const fs = require("fs"), path = require("path"); const { spawnSync } = require("child_process");
const dbdir = path.join(__dirname, "db"), pdir = path.join(__dirname, "..", "proposals", "d4-delete-my-data");
let passed = 0, failed = 0; const assert = (c, m) => { if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } };
const cands = []; try{ for(const v of fs.readdirSync("/usr/lib/postgresql")) cands.push("/usr/lib/postgresql/" + v + "/bin"); }catch(e){}
const BIN = cands.reverse().find(d => fs.existsSync(path.join(d, "initdb")));
if(!BIN){ console.log("NOT RUN: PostgreSQL is not installed here."); process.exit(0); }
const isRoot = process.getuid && process.getuid() === 0; const tmp = fs.mkdtempSync("/tmp/ethixo-pg-"); const port = String(54000 + Math.floor(Math.random() * 900));
const q = a => "'" + String(a).replace(/'/g, "'\\''") + "'";
function run(cmd, args, input){ const w = isRoot ? { c:"su", a:["postgres", "-s", "/bin/bash", "-c", [cmd].concat(args).map(q).join(" ")] } : { c:cmd, a:args };
  const r = spawnSync(w.c, w.a, { encoding:"utf8", cwd:"/", input, env:Object.assign({}, process.env, { PGHOST:tmp, PGPORT:port, PGUSER:"postgres" }), timeout:120000 }); return { code:r.status, out:(r.stdout || "") + (r.stderr || "") }; }
const psql = (db, args) => run(path.join(BIN, "psql"), ["-d", db, "-X"].concat(args));
process.on("exit", () => { try{ run(path.join(BIN, "pg_ctl"), ["-D", path.join(tmp, "data"), "-m", "immediate", "stop"]); fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){} });
if(isRoot){ spawnSync("chown", ["postgres:postgres", tmp]); fs.chmodSync(dbdir, 0o755); fs.chmodSync(pdir, 0o755); for(const f of fs.readdirSync(pdir)) fs.chmodSync(path.join(pdir, f), 0o644); }
let r = run(path.join(BIN, "initdb"), ["-D", path.join(tmp, "data"), "-A", "trust", "-U", "postgres"]); if(r.code) throw new Error(r.out.slice(0, 300));
r = run(path.join(BIN, "pg_ctl"), ["-D", path.join(tmp, "data"), "-o", "-c listen_addresses='' -k " + tmp + " -p " + port, "-l", path.join(tmp, "log"), "-w", "start"]); if(r.code) throw new Error(r.out.slice(0, 300));
psql("postgres", ["-q", "-c", "create database d4"]);
r = psql("d4", ["-q", "-v", "ON_ERROR_STOP=1", "-f", path.join(dbdir, "local-test-shim.sql"), "-f", path.join(dbdir, "ethixo-schema-v1.sql"), "-f", path.join(dbdir, "schema-fix-private-helper-grants.sql"), "-f", path.join(pdir, "migration.sql")]);
assert(r.code === 0, "shim + schema v1 + helper-grant fix + D4 migration load cleanly"); if(r.code) console.log(r.out.slice(0, 600));
r = psql("d4", ["-At", "-F", "|", "-f", path.join(pdir, "local-tests.sql")]);
const rows = r.out.split("\n").filter(l => /\|(PASS|FAIL)/.test(l));
rows.forEach(l => { const p = l.split("|"); assert(/^PASS/.test(p[3]), p[1] + " (got " + p[2] + ")"); });
assert(rows.length >= 22, "all " + rows.length + " local checks ran");
r = psql("d4", ["-At", "-F", "|", "-f", path.join(pdir, "verify.sql")]); const v = r.out.split("\n").filter(l => /\|(PASS|FAIL)$/.test(l));
assert(v.length === 5 && v.every(l => /\|PASS$/.test(l)), "verify.sql: all 5 rows PASS");
r = psql("d4", ["-q", "-v", "ON_ERROR_STOP=1", "-f", path.join(pdir, "rollback.sql")]);
const left = psql("d4", ["-At", "-c", "select count(*) from pg_proc where proname in ('delete_my_data','erase_student_data')"]).out.trim();
assert(r.code === 0 && left === "0", "rollback.sql removes both functions");
console.log("\nRESULTS: " + passed + " passed, " + failed + " failed"); process.exit(failed ? 1 : 0);
