/* Schema v1.1 hardening PROPOSAL, tested ONLY in a throw-away local PostgreSQL (never Supabase).
   base = shim + schema v1 + the already-applied two-function grant fix (this is what ethixo-sg-dev looks like today).
   1. V3 fingerprint BEFORE   2. migration   3. focused hardening tests   4. EXISTING security suite + Phase 3 suite + Query A on the hardened schema
   5. verify.sql   6. V3 fingerprint AFTER (only function ACLs of private helpers may differ)   7. migration twice (idempotent)   8. rollback restores the old behaviour.
   NOT RUN if PostgreSQL is missing. */
const fs = require("fs"), path = require("path"); const { spawnSync } = require("child_process");
const dbdir = path.join(__dirname, "db"), pdir = path.join(__dirname, "..", "proposals", "schema-hardening-v1.1");
let passed = 0, failed = 0; const assert = (c, m) => { if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } };
const cands = []; try{ for(const v of fs.readdirSync("/usr/lib/postgresql")) cands.push("/usr/lib/postgresql/" + v + "/bin"); }catch(e){}
const BIN = cands.reverse().find(d => fs.existsSync(path.join(d, "initdb")));
if(!BIN){ console.log("NOT RUN: PostgreSQL is not installed here."); process.exit(0); }
const isRoot = process.getuid && process.getuid() === 0; const tmp = fs.mkdtempSync("/tmp/ethixo-pg-"); const port = String(54000 + Math.floor(Math.random() * 900));
const q = a => "'" + String(a).replace(/'/g, "'\\''") + "'";
function run(cmd, args){ const w = isRoot ? { c:"su", a:["postgres", "-s", "/bin/bash", "-c", [cmd].concat(args).map(q).join(" ")] } : { c:cmd, a:args };
  const r = spawnSync(w.c, w.a, { encoding:"utf8", cwd:dbdir, env:Object.assign({}, process.env, { PGHOST:tmp, PGPORT:port, PGUSER:"postgres" }), timeout:180000 }); return { code:r.status, out:(r.stdout || "") + (r.stderr || "") }; }
const psql = (db, args) => run(path.join(BIN, "psql"), ["-d", db, "-X"].concat(args));
const file = (f) => path.join(pdir, f), dfile = (f) => path.join(dbdir, f);
process.on("exit", () => { try{ run(path.join(BIN, "pg_ctl"), ["-D", path.join(tmp, "data"), "-m", "immediate", "stop"]); fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){} });
if(isRoot){ spawnSync("chown", ["postgres:postgres", tmp]); [dbdir, pdir].forEach(d => { fs.chmodSync(d, 0o755); for(const f of fs.readdirSync(d)) try{ fs.chmodSync(path.join(d, f), 0o644); }catch(e){} }); }
let r = run(path.join(BIN, "initdb"), ["-D", path.join(tmp, "data"), "-A", "trust", "-U", "postgres"]); if(r.code) throw new Error(r.out.slice(0, 300));
r = run(path.join(BIN, "pg_ctl"), ["-D", path.join(tmp, "data"), "-o", "-c listen_addresses='' -k " + tmp + " -p " + port, "-l", path.join(tmp, "log"), "-w", "start"]); if(r.code) throw new Error(r.out.slice(0, 300));
const quiet = ["-q", "-v", "ON_ERROR_STOP=1"];
psql("postgres", ["-q", "-c", "create database base"]);
r = psql("base", quiet.concat(["-f", dfile("local-test-shim.sql"), "-f", dfile("ethixo-schema-v1.sql"), "-f", dfile("schema-fix-private-helper-grants.sql")]));
assert(r.code === 0, "base loads: shim + schema v1 + the already-applied two-function grant fix"); if(r.code) console.log(r.out.slice(0, 500));
const fp = (db) => psql(db, ["-At", "-F", "|", "-f", file("verify.sql")]).out;
const v3 = (db) => { const o = fp(db).split("\n").filter(l => /^[0-9a-f]{32}\|/.test(l)); return o[0] || ""; };
psql("postgres", ["-q", "-c", "create database hard template base"]);
const before = v3("hard"); assert(before.split("|").length >= 5, "V3 fingerprint taken BEFORE the migration (" + before.split("|").length + " parts)");
const v1b = psql("hard", ["-At", "-F", "|", "-c", "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('anon',p.oid,'EXECUTE')"]).out.trim();
assert(Number(v1b) === 4, "BEFORE: exactly the 4 helpers named in the proposal still allow anon (" + v1b + ")");
r = psql("hard", quiet.concat(["-f", file("migration.sql")])); assert(r.code === 0, "migration.sql applies cleanly"); if(r.code) console.log(r.out.slice(0, 500));
// focused tests
r = psql("hard", ["-At", "-F", "|", "-f", file("local-tests.sql")]);
const rows = r.out.split("\n").filter(l => /^\d+\|(PASS|FAIL)\|/.test(l));
rows.forEach(l => { const p = l.split("|"); assert(p[1] === "PASS", p[2] + " (got " + p[4] + ")"); });
assert(rows.length >= 18, "focused hardening tests ran in full (" + rows.length + " checks)");
// existing suites on a hardened schema (fresh database from base + migration)
psql("postgres", ["-q", "-c", "create database hsec template base"]); psql("hsec", quiet.concat(["-f", file("migration.sql")]));
psql("hsec", ["-q", "-o", "/dev/null", "-f", dfile("security-tests-v1.sql")]);
let t = psql("hsec", ["-At", "-F", "|", "-c", "select count(*) filter (where ok), count(*) filter (where not ok) from t.res"]).out.trim().split("|").map(Number);
assert(t[1] === 0 && t[0] >= 90, "EXISTING security suite on the hardened schema: " + t[0] + " passed, " + t[1] + " failed");
psql("postgres", ["-q", "-c", "create database hp3 template base"]); psql("hp3", quiet.concat(["-f", file("migration.sql")]));
psql("hp3", ["-q", "-o", "/dev/null", "-f", dfile("attempts-phase3.sql")]);
t = psql("hp3", ["-At", "-F", "|", "-c", "select count(*) filter (where ok), count(*) filter (where not ok) from t.res"]).out.trim().split("|").map(Number);
const flips = psql("hp3", ["-At", "-c", "select string_agg(substr(name,1,2), ',' order by n) from t.res where not ok"]).out.trim();
assert(t[0] >= 66 && flips === "G1,G2,K2", "EXISTING Phase 3 suite on the hardened schema: " + t[0] + " pass; the only 3 non-passes are the intended flips - G1/G2 ('anon can still EXECUTE', a pre-fix reproduction) and K2 ('one malformed row breaks the class summary', the known risk now fixed) (" + JSON.stringify(flips) + ")");
const qa = psql("hp3", ["-At", "-F", "|", "-f", dfile("preflight-query-a.sql")]).out.trim().split("\n").filter(Boolean).map(l => l.split("|").pop());
assert(qa.length === 36 && qa.filter(x => x === "FAIL").length === 0, "Preflight Query A on the hardened schema: 36 rows, no FAIL");
// verify.sql expectations
const v = psql("hsec", ["-At", "-F", "|", "-f", file("verify.sql")]).out;
const priv = v.split("\n").filter(l => /^private\./.test(l));
assert(priv.length === 6 && priv.every(l => l.split("|")[1] === "f" && l.split("|")[3] === "0"), "verify V1: all 6 private functions: anon false, no PUBLIC grant");
assert(priv.filter(l => !/touch_updated_at/.test(l)).every(l => l.split("|")[2] === "t") && priv.filter(l => /touch_updated_at/.test(l)).every(l => l.split("|")[2] === "f"), "verify V1: 5 RLS helpers keep authenticated EXECUTE; the trigger function needs none");
assert(/\|t\|search_path=""\|t/.test(v.replace(/\n/g, "|").replace(/\|\|/g, "|")) || /t\|search_path=""\|t/.test(v), "verify V2: SECURITY DEFINER, pinned search_path, filters by JSON type");
const after = v3("hsec");
const bp = before.split("|"), ap = after.split("|");
const diff = bp.map((x, i) => x === ap[i] ? null : i).filter(x => x !== null);
console.log("  (V3 parts that differ: " + (diff.length ? diff.join(",") : "none") + "; index of function-ACL part is expected only if it covers private functions)");
assert(diff.filter(i => i !== 4).length === 0, "verify V3: policies, tables, column grants and triggers are IDENTICAL before and after");
// idempotent
r = psql("hsec", quiet.concat(["-f", file("migration.sql"), "-f", file("migration.sql")])); assert(r.code === 0 && v3("hsec") === after, "migration is idempotent (run twice: no error, same fingerprint)");
// rollback
psql("postgres", ["-q", "-c", "create database hrb template base"]); psql("hrb", quiet.concat(["-f", file("migration.sql")]));
r = psql("hrb", quiet.concat(["-f", file("rollback.sql")])); assert(r.code === 0, "rollback.sql applies cleanly");
const src = psql("hrb", ["-At", "-c", "select prosrc like '%jsonb_typeof%' from pg_proc where oid=to_regprocedure('public.teacher_attempt_summary(uuid)')"]).out.trim();
assert(src === "f", "rollback restores the previous function body (no jsonb_typeof filter)");
console.log("\nRESULTS: " + passed + " passed, " + failed + " failed"); process.exit(failed ? 1 : 0);
