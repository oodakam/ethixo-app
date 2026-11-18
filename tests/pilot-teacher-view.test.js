// Targeted test of the pilot teacher page (teacher.html served through api/pilot-app.js). Browser + mocked Supabase network. No real project is contacted.
// Run: node tests/pilot-teacher-view.test.js   (needs playwright-core and a Chromium: CHROMIUM_PATH)
const fs = require("fs"), path = require("path"), http = require("http");
const { chromium } = require("playwright-core");
const root = path.join(__dirname, "..");
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
let passed = 0, failed = 0; const assert = (c, m) => { if(c){ passed++; console.log("  PASS:", m); } else { failed++; console.log("  FAIL:", m); } };
const FAKE = "https://fakeref.supabase.co", KEY = "sb_publishable_TESTONLY";
(async () => {
  const mod = await import(path.join(root, "api", "pilot-app.js")); const handler = mod.default;
  let envOn = true;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); 
    if(u.pathname === "/pilot-teacher"){
      const env = envOn ? { VERCEL_ENV: "preview", ETHIXO_PILOT_HOSTS: "127.0.0.1", ETHIXO_PILOT_SUPABASE_URL: FAKE, ETHIXO_PILOT_SUPABASE_PUBLISHABLE_KEY: KEY } : { VERCEL_ENV: "preview" };
      const old = process.env; process.env = Object.assign({}, old, env);
      const r = { headers: { host: req.headers.host }, query: { page: "teacher" } };
      const out = { setHeader(){}, status(c){ res.statusCode = c; return out; }, send(b){ res.setHeader("content-type", "text/html"); res.end(b); }, json(){ res.end("{}"); } };
      try { handler(r, out); } finally { process.env = old; }
      return;
    }
    const f = path.join(root, u.pathname); if(f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()){ res.setHeader("content-type", f.endsWith(".js") ? "application/javascript" : "text/plain"); res.end(fs.readFileSync(f)); } else { res.statusCode = 404; res.end(); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); const port = server.address().port;
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });

  async function open(opts){
    const ctx = await browser.newContext(); const page = await ctx.newPage(); const reqs = []; const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    if(opts.session){ await ctx.addInitScript(s => localStorage.setItem("ethixoTeacherAuth", JSON.stringify(s)), { access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: "u1", aud: "authenticated", email: "t@school.edu.sg", is_anonymous: !!opts.anon, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }); }
    await page.route(FAKE + "/**", route => {
      const rq = route.request(), u = new URL(rq.url()); reqs.push({ method: rq.method(), path: u.pathname, search: u.search, body: rq.postData() || "" });
      const j = (code, body) => route.fulfill({ status: code, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: JSON.stringify(body) });
      if(rq.method() === "OPTIONS") return j(200, {});
      if(u.pathname === "/auth/v1/otp") return j(200, {});
      if(u.pathname === "/rest/v1/profiles"){ return j(200, opts.profile ? [opts.profile] : []); }   // supabase-js maybeSingle() reads an array and takes the first row
      if(u.pathname === "/rest/v1/rpc/create_my_profile"){ opts.created = true; opts.profile = { id: "u1", role: "teacher", display_name: "Ms Tan", is_approved: false }; return j(200, opts.profile); }
      if(u.pathname === "/rest/v1/classes") return j(200, opts.classes || []);
      if(u.pathname === "/rest/v1/rpc/teacher_attempt_summary"){ if(opts.summaryError) return j(500, { code: "XX000", message: "boom" }); const b = JSON.parse(rq.postData() || "{}"); return j(200, (opts.summary || []).filter(r => !b.p_class_id || r.class_id === b.p_class_id)); }
      return j(404, { message: "unexpected " + u.pathname });
    });
    await page.goto("http://127.0.0.1:" + port + "/pilot-teacher"); await page.waitForTimeout(700);
    return { ctx, page, reqs, errors };
  }
  const text = p => p.evaluate(() => document.getElementById("app").innerText);
  const rest = reqs => reqs.filter(r => r.path.indexOf("/rest/v1/") === 0 && r.method !== "OPTIONS").map(r => r.path.replace("/rest/v1/", ""));

  console.log("Test 1: not configured (no pilot env) => inert page, no network");
  { envOn = false; const t = await open({}); assert(/not available on this address/.test(await text(t.page)) && t.reqs.length === 0, "unconfigured: message only and zero requests to any backend"); await t.ctx.close(); envOn = true; }

  console.log("\nTest 2: signed out => email sign-in screen; magic link request");
  { const t = await open({}); const tx = await text(t.page);
    assert(/Email me a link/.test(tx) && !/Class code/.test(tx), "sign-in screen shown, no data");
    await t.page.fill("#email", "bad"); await t.page.click("text=Email me a link"); assert(/valid email/.test(await text(t.page)), "invalid email rejected locally");
    await t.page.fill("#email", "t@school.edu.sg"); await t.page.click("text=Email me a link"); await t.page.waitForTimeout(500);
    const otp = t.reqs.find(r => r.path === "/auth/v1/otp" && r.method === "POST");
    assert(otp && /"email":"t@school.edu.sg"/.test(otp.body) && /"create_user":true/.test(otp.body), "magic-link request sent for that email (create_user true)");
    assert(/Check your inbox/.test(await text(t.page)), "confirmation message shown");
    assert(rest(t.reqs).length === 0, "no database tables touched while signed out"); await t.ctx.close(); }

  console.log("\nTest 3: anonymous (student) session is not a teacher session");
  { const t = await open({ session: true, anon: true }); assert(/Email me a link/.test(await text(t.page)) && rest(t.reqs).length === 0, "anonymous session => sign-in screen, zero data requests"); await t.ctx.close(); }

  console.log("\nTest 4: new teacher => name screen => profile created => waits for approval, no data");
  { const o = { session: true, profile: null }; const t = await open(o);
    assert(/Enter the name/.test(await text(t.page)), "no profile yet => asks for a name");
    await t.page.fill("#tname", "Ms Tan"); await t.page.click("text=Continue"); await t.page.waitForTimeout(700);
    const cp = t.reqs.find(r => r.path === "/rest/v1/rpc/create_my_profile");
    assert(cp && /"p_role":"teacher"/.test(cp.body), "create_my_profile called with role teacher");
    assert(/waiting for approval/.test(await text(t.page)), "unapproved => clear waiting-for-approval state");
    assert(!rest(t.reqs).some(p => /classes|teacher_attempt_summary|attempts|vault|student_state/.test(p)), "unapproved: classes and summary are never requested"); await t.ctx.close(); }

  console.log("\nTest 5: non-teacher profile");
  { const t = await open({ session: true, profile: { id: "u1", role: "student", display_name: "Kid", is_approved: true } });
    assert(/not a teacher account/.test(await text(t.page)) && !rest(t.reqs).some(p => /classes|summary/.test(p)), "student profile: refused, no class or summary request"); await t.ctx.close(); }

  console.log("\nTest 6: approved teacher dashboard");
  const C1 = "c1-uuid", C2 = "c2-uuid";
  const S = (o) => Object.assign({ student_id: "s1", display_name: "Ava", class_id: C1, level: "P6", subject_key: "EN", lesson_id: "L1", q_idx: 0, attempt_count: 2, latest_at: 3000, latest_score: 3, best_score: 3, used_thinking: true }, o);
  const summary = [S({}), S({ q_idx: 1, attempt_count: 1, latest_at: 2000, latest_score: 1, best_score: 1, used_thinking: false }), S({ student_id: "s2", display_name: "Ben", lesson_id: "L2", attempt_count: 1, latest_at: 4000, latest_score: 2, best_score: 2, used_thinking: false }), S({ class_id: C2, student_id: "s3", display_name: "Cara", attempt_count: 4, latest_at: 5000, latest_score: 1, best_score: 2, used_thinking: false })];
  { const o = { session: true, profile: { id: "u1", role: "teacher", display_name: "Ms Tan", is_approved: true }, classes: [{ id: C1, name: "Class One", join_code: "ABCD2345", created_at: "x" }, { id: C2, name: "Class Two", join_code: "WXYZ6789", created_at: "y" }], summary };
    const t = await open(o); const tx = await text(t.page);
    assert(/Class One/.test(tx) && /ABCD2345/.test(tx), "class name and class code shown");
    for(const h of ["Student", "Lesson", "Questions attempted", "Attempts", "Latest score", "Best score", "Used thinking help", "Last activity"]) assert(tx.indexOf(h) !== -1, "column: " + h);
    const rows = await t.page.$$eval("tbody tr", trs => trs.map(tr => Array.from(tr.children).map(td => td.innerText)));
    assert(rows.length === 2 && rows[0][0] === "Ava" && rows[0][2] === "2" && rows[0][3] === "3" && rows[0][4] === "3" && rows[0][5] === "3" && rows[0][6] === "Yes", "Ava / L1: 2 questions, 3 attempts, latest 3, best 3, thinking Yes");
    assert(rows[1][0] === "Ben" && rows[1][2] === "1" && rows[1][3] === "1" && rows[1][6] === "–", "Ben / L2 row correct, thinking –");
    assert(!/Cara/.test(tx), "other class's student not shown for the selected class");
    assert(await t.page.$("select") !== null, "class picker present when the teacher has 2 classes");
    await t.page.selectOption("select", C2); await t.page.waitForTimeout(600);
    const tx2 = await text(t.page); assert(/Cara/.test(tx2) && !/Ava/.test(tx2) && /WXYZ6789/.test(tx2), "switching class shows only that class and its code");
    const calls = t.reqs.filter(r => r.path === "/rest/v1/rpc/teacher_attempt_summary").map(r => JSON.parse(r.body).p_class_id);
    assert(calls.join() === C1 + "," + C2, "summary RPC called per selected class");
    const tables = Array.from(new Set(rest(t.reqs))).sort().join(",");
    assert(tables === "classes,profiles,rpc/teacher_attempt_summary", "ONLY these backend resources were requested: " + tables);
    const controls = await t.page.$$eval("button, a, input, textarea, [contenteditable]", els => els.map(e => (e.innerText || e.value || e.tagName).trim().toLowerCase()));
    assert(controls.every(c => /^(sign out|refresh|select)$/.test(c) || c === "select"), "the only interactive controls are Sign out, Refresh and sort/picker: " + JSON.stringify(controls));
    assert(!/export|download|delete|edit|remove|csv|answer text|feedback|vault/i.test(tx.replace(/students' written answers are never uploaded/i, "")), "no export, edit, delete, feedback or vault wording/controls");
    assert(t.errors.length === 0, "no JavaScript errors"); await t.ctx.close(); }

  console.log("\nTest 7: approved teacher, no class / no attempts / summary error");
  { const t = await open({ session: true, profile: { id: "u1", role: "teacher", display_name: "Ms Tan", is_approved: true }, classes: [] });
    assert(/No class yet/.test(await text(t.page)) && !rest(t.reqs).some(p => /summary/.test(p)), "no class => clear empty state, no summary call"); await t.ctx.close(); }
  { const t = await open({ session: true, profile: { id: "u1", role: "teacher", display_name: "Ms Tan", is_approved: true }, classes: [{ id: C1, name: "Class One", join_code: "ABCD2345", created_at: "x" }], summary: [] });
    assert(/No attempts yet/.test(await text(t.page)), "class without attempts => 'No attempts yet'"); await t.ctx.close(); }
  { const t = await open({ session: true, profile: { id: "u1", role: "teacher", display_name: "Ms Tan", is_approved: true }, classes: [{ id: C1, name: "Class One", join_code: "ABCD2345", created_at: "x" }], summaryError: true });
    assert(/Could not load progress/.test(await text(t.page)) && t.errors.length === 0, "summary error => friendly message, no crash"); await t.ctx.close(); }

  console.log("\nTest 8: markup injection from data is escaped");
  { const t = await open({ session: true, profile: { id: "u1", role: "teacher", display_name: "<img src=x onerror=window.__x=1>", is_approved: true }, classes: [{ id: C1, name: "<b>c</b>", join_code: "A", created_at: "x" }], summary: [S({ display_name: "<script>window.__y=1</script>" })] });
    assert(await t.page.evaluate(() => !window.__x && !window.__y && !document.querySelector("#app img") && !document.querySelector("#app script") && document.querySelectorAll("#app b").length === 1 && document.querySelector("#app b").innerText.indexOf("<b>c</b>") === 0), "names and class names render as text, not HTML"); await t.ctx.close(); }

  await browser.close(); server.close();
  console.log("\nRESULTS: " + passed + " passed, " + failed + " failed"); process.exit(failed ? 1 : 0);
})();
