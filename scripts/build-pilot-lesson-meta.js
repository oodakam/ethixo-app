// Generates assets/pilot-lesson-meta.json from the question bank in index.html.
// Contains ONLY: subject names, lesson ids/titles, and the max marks per question index.
// It deliberately contains NO question text and NO answer keys (the teacher page must never have them).
// Usage: node scripts/build-pilot-lesson-meta.js [--check]   (--check exits 1 if the committed file is out of date)
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const lines = fs.readFileSync(path.join(root, "index.html"), "utf8").split("\n");
const a = lines.findIndex(l => l.startsWith("const SUBJECT_META"));
const b = lines.findIndex((l, i) => i > a && l.startsWith("const LEVELS"));
let e = b; while (!/^};/.test(lines[e])) e++;
const ctx = {}; vm.createContext(ctx);
vm.runInContext(lines.slice(a, e + 1).join("\n") + "\nthis.__out={SUBJECT_META,LEVELS,LEVEL_LABEL};", ctx);
const { SUBJECT_META, LEVELS } = ctx.__out;
const out = {};
for (const lvl of Object.keys(LEVELS)) {
  out[lvl] = {};
  for (const sk of Object.keys(LEVELS[lvl])) {
    const lessons = {};
    for (const ch of LEVELS[lvl][sk].chapters) for (const ls of ch.lessons) lessons[ls.id] = { title: ls.title, marks: ls.questions.map(q => q.m) };
    out[lvl][sk] = { name: SUBJECT_META[sk] ? SUBJECT_META[sk].name : sk, lessons };
  }
}
const text = JSON.stringify(out) + "\n";
const file = path.join(root, "assets", "pilot-lesson-meta.json");
if (process.argv.includes("--check")) { const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; if (cur !== text) { console.error("pilot-lesson-meta.json is out of date; run: node scripts/build-pilot-lesson-meta.js"); process.exit(1); } console.log("pilot-lesson-meta.json is up to date"); }
else { fs.writeFileSync(file, text); console.log("wrote", file, text.length, "bytes"); }
