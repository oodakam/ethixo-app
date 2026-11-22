/* first_score migration (proposals/pilot-ready/B1-MIGRATION-first_score.sql), tested ONLY in a throw-away local PostgreSQL (never Supabase).
   base = shim + schema v1 + grant fix + hardening v1.1 (this is what the live pilot DB looks like today)
   1. seed + BEFORE snapshot  2. B1 migration  3. assertions  4. existing security suite on the migrated schema  5. migration twice (idempotent)  6. rollback restores the 12-column shape.
   NOT RUN if PostgreSQL is missing. */
const fs = require("fs"), path = require("path"); const { spawnSync } = require("child_process");
const dbdir = path.join(__dirname, "db"), root = path.join(__dirname, ".."), hdir = path.join(root, "proposals", "schema-hardening-v1.1"), pdir = path.join(root, "proposals", "pilot-ready");
let passed = 0, failed = 0; const assert = (c, m) => { if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } };
const cands = []; try{ for(const v of fs.readdirSync("/usr/lib/postgresql")) cands.push("/usr/lib/postgresql/" + v + "/bin"); }catch(e){}
const BIN = cands.reverse().find(d => fs.existsSync(path.join(d, "initdb")));
if(!BIN){ console.log("NOT RUN: PostgreSQL is not installed here."); process.exit(0); }
const isRoot = process.getuid && process.getuid() === 0; const tmp = fs.mkdtempSync("/tmp/ethixo-pg-"); const port = String(54000 + Math.floor(Math.random() * 900));
const q = a => "'" + String(a).replace(/'/g, "'\\''") + "'";
function run(cmd, args){ const w = isRoot ? { c:"su", a:["postgres", "-s", "/bin/bash", "-c", [cmd].concat(args).map(q).join(" ")] } : { c:cmd, a:args };
  const r = spawnSync(w.c, w.a, { encoding:"utf8", cwd:dbdir, env:Object.assign({}, process.env, { PGHOST:tmp, PGPORT:port, PGUSER:"postgres" }), timeout:180000 }); return { code:r.status, out:(r.stdout || "") + (r.stderr || "") }; }
const psql = (db, args) => run(path.join(BIN, "psql"), ["-d", db, "-X"].concat(args));
const f = (d, n) => path.join(d, n);
process.on("exit", () => { try{ run(path.join(BIN, "pg_ctl"), ["-D", path.join(tmp, "data"), "-m", "immediate", "stop"]); fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){} });
if(isRoot){ spawnSync("chown", ["postgres:postgres", tmp]); [dbdir, hdir, pdir].forEach(d => { fs.chmodSync(d, 0o755); for(const x of fs.readdirSync(d)) try{ fs.chmodSync(path.join(d, x), 0o644); }catch(e){} }); }
let r = run(path.join(BIN, "initdb"), ["-D", path.join(tmp, "data"), "-A", "trust", "-U", "postgres"]); if(r.code) throw new Error(r.out.slice(0, 300));
r = run(path.join(BIN, "pg_ctl"), ["-D", path.join(tmp, "data"), "-o", "-c listen_addresses='' -k " + tmp + " -p " + port, "-l", path.join(tmp, "log"), "-w", "start"]); if(r.code) throw new Error(r.out.slice(0, 300));
const quiet = ["-q", "-v", "ON_ERROR_STOP=1"];
psql("postgres", ["-q", "-c", "create database base"]);
r = psql("base", quiet.concat(["-f", f(dbdir, "local-test-shim.sql"), "-f", f(dbdir, "ethixo-schema-v1.sql"), "-f", f(dbdir, "schema-fix-private-helper-grants.sql"), "-f", f(hdir, "migration.sql")]));
assert(r.code === 0, "base loads: shim + schema v1 + grant fix + hardening v1.1 (= live pilot shape)"); if(r.code) console.log(r.out.slice(0, 500));
const rowsOf = out => out.split("\n").filter(l => /^\d+\|(PASS|FAIL)\|/.test(l));

psql("postgres", ["-q", "-c", "create database mig template base"]);
r = psql("mig", quiet.concat(["-f", f(dbdir, "first-score-seed.sql")])); assert(r.code === 0, "seed + BEFORE snapshot"); if(r.code) console.log(r.out.slice(0, 600));
const beforeCols = psql("mig", ["-At", "-c", "select pg_get_function_result('public.teacher_attempt_summary(uuid)'::regprocedure)"]).out.trim();
assert(!/first_score/.test(beforeCols) && /used_thinking boolean\)$/.test(beforeCols), "BEFORE: function has the 12 original columns");
r = psql("mig", quiet.concat(["-f", f(pdir, "B1-MIGRATION-first_score.sql")])); assert(r.code === 0, "B1 migration applies cleanly"); if(r.code) console.log(r.out.slice(0, 600));
r = psql("mig", ["-At", "-F", "|", "-f", f(dbdir, "first-score-asserts.sql")]);
const rows = rowsOf(r.out); rows.forEach(l => { const p = l.split("|"); assert(p[1] === "PASS", p[2] + (p[1] === "PASS" ? "" : " (got " + p[4] + ")")); });
assert(rows.length >= 15, "focused assertions ran in full (" + rows.length + ")");

// existing security suite on a fresh migrated database
psql("postgres", ["-q", "-c", "create database sec template base"]); psql("sec", quiet.concat(["-f", f(pdir, "B1-MIGRATION-first_score.sql")]));
psql("sec", ["-q", "-o", "/dev/null", "-f", f(dbdir, "security-tests-v1.sql")]);
const t = psql("sec", ["-At", "-F", "|", "-c", "select count(*) filter (where ok), count(*) filter (where not ok) from t.res"]).out.trim().split("|").map(Number);
assert(t[1] === 0 && t[0] >= 90, "EXISTING security suite on the migrated schema: " + t[0] + " passed, " + t[1] + " failed");
// idempotent
r = psql("mig", quiet.concat(["-f", f(pdir, "B1-MIGRATION-first_score.sql"), "-f", f(pdir, "B1-MIGRATION-first_score.sql")])); assert(r.code === 0, "migration is idempotent (run twice, no error)");
const again = psql("mig", ["-At", "-c", "select pg_get_function_result('public.teacher_attempt_summary(uuid)'::regprocedure)"]).out.trim();
assert(/first_score numeric\)$/.test(again), "after re-run the 13-column shape is intact");
// rollback
r = psql("mig", quiet.concat(["-f", f(pdir, "B1-ROLLBACK-first_score.sql")])); assert(r.code === 0, "rollback applies cleanly");
const rb = psql("mig", ["-At", "-c", "select pg_get_function_result('public.teacher_attempt_summary(uuid)'::regprocedure), has_function_privilege('anon','public.teacher_attempt_summary(uuid)','EXECUTE'), has_function_privilege('authenticated','public.teacher_attempt_summary(uuid)','EXECUTE')"]).out.trim();
assert(rb === beforeCols + "|f|t", "rollback restores the exact original shape and grants");
console.log("\nRESULTS: " + passed + " passed, " + failed + " failed"); process.exit(failed ? 1 : 0);
