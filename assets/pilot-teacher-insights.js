/* Pilot Teacher Dashboard — signal rules. Pure functions, no network, no DOM.
   INPUT is ONLY what the privacy boundary already gives the teacher:
     rows    = teacher_attempt_summary() rows (per student x question: attempt_count, latest_at, latest_score, best_score, used_thinking)
     members = joined students of the class ({student_id, display_name}), so students with no attempts still appear
     meta    = assets/pilot-lesson-meta.json (lesson titles + max marks per question; no question text, no answers)
   Nothing here can see written answers, feedback, Thinking Cycle text, ScholarVault or student_state.

   RULES (all thresholds are in RULES below and documented in the dashboard's "How these signals work"):
   - "Score ratio" of a question = best_score / max marks for that question (best attempt, capped at 1). Questions whose max marks are
     unknown (lesson missing from meta) are counted as attempted but not scored.
   - "Full marks" (the dashboard's "exam-ready answers") = best_score >= max marks. Same rule the student app uses (score >= q.m).
   - Student performance, over all of the student's scored questions:
       0 questions attempted ................ "No activity yet"
       fewer than 3 questions attempted ..... "Just getting started"
       average score ratio >= 70% ........... "Doing well"
       average score ratio 40%-69% .......... "Making progress"
       average score ratio < 40% ............ "May need attention"
   - Thinking Help signal: at least 3 questions attempted AND Thinking Help used on >= 50% of them -> "Relies on Thinking Help".
     (used_thinking is true if ANY attempt of that question used it.)
   - A student is "struggling in a lesson" when they attempted >= 2 questions there and their average score ratio there is < 40%.
     A lesson is flagged "to look at" when at least one student is struggling in it.
   - "Active recently" = last activity within 3 days. */
(function (root) {
  var RULES = { minQuestions: 3, doingWell: 0.7, makingProgress: 0.4, thinkingShare: 0.5, lessonMinQuestions: 2, lessonStruggle: 0.4, recentDays: 3 };
  var DAY = 86400000;
  function num(x) { var n = Number(x); return isFinite(n) ? n : null; }
  function marksFor(meta, level, sk, lesson, q) {
    var s = meta && meta[level] && meta[level][sk]; var l = s && s.lessons && s.lessons[lesson];
    var m = l && l.marks && l.marks[q]; return typeof m === "number" && m > 0 ? m : null;
  }
  function lessonTitle(meta, level, sk, lesson) {
    var s = meta && meta[level] && meta[level][sk]; var l = s && s.lessons && s.lessons[lesson];
    return l ? l.title : (level + " " + sk + " · " + lesson);
  }
  function subjectName(meta, level, sk) { var s = meta && meta[level] && meta[level][sk]; return s ? s.name : sk; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function pct(r) { return r == null ? null : Math.round(r * 100); }
  function performance(questions, avgRatio) {
    if (questions === 0) return "No activity yet";
    if (questions < RULES.minQuestions || avgRatio == null) return "Just getting started";
    if (avgRatio >= RULES.doingWell) return "Doing well";
    if (avgRatio >= RULES.makingProgress) return "Making progress";
    return "May need attention";
  }
  function compute(rows, members, meta, now) {
    now = now || Date.now();
    var st = new Map();
    function get(id, name) {
      var s = st.get(id);
      if (!s) { s = { id: id, name: name || "Student", questions: 0, attempts: 0, ratios: [], full: 0, scored: 0, thinkingQs: 0, retried: 0, retriedFull: 0, lastAt: null, lessons: new Map() }; st.set(id, s); }
      else if (name && s.name === "Student") s.name = name;
      return s;
    }
    (members || []).forEach(function (m) { get(m.student_id, m.display_name); });
    (rows || []).forEach(function (r) {
      var s = get(r.student_id, r.display_name);
      var cnt = num(r.attempt_count) || 0, best = num(r.best_score), at = num(r.latest_at);
      var marks = marksFor(meta, r.level, r.subject_key, r.lesson_id, Number(r.q_idx));
      s.questions++; s.attempts += cnt;
      if (at != null && (s.lastAt == null || at > s.lastAt)) s.lastAt = at;
      var thinking = r.used_thinking === true; if (thinking) s.thinkingQs++;
      var ratio = null, full = false;
      if (marks != null && best != null) { ratio = Math.max(0, Math.min(1, best / marks)); full = best >= marks; s.scored++; s.ratios.push(ratio); if (full) s.full++; if (cnt > 1) { s.retried++; if (full) s.retriedFull++; } }
      else if (cnt > 1) s.retried++;
      var key = r.level + "|" + r.subject_key + "|" + r.lesson_id;
      var l = s.lessons.get(key);
      if (!l) { l = { key: key, level: r.level, subjectKey: r.subject_key, lessonId: r.lesson_id, title: lessonTitle(meta, r.level, r.subject_key, r.lesson_id), subject: subjectName(meta, r.level, r.subject_key), questions: 0, attempts: 0, ratios: [], full: 0, thinkingQs: 0, lastAt: null }; s.lessons.set(key, l); }
      l.questions++; l.attempts += cnt; if (thinking) l.thinkingQs++; if (ratio != null) { l.ratios.push(ratio); if (full) l.full++; }
      if (at != null && (l.lastAt == null || at > l.lastAt)) l.lastAt = at;
    });
    var students = Array.from(st.values()).map(function (s) {
      var avg = mean(s.ratios);
      var lessons = Array.from(s.lessons.values()).map(function (l) {
        var a = mean(l.ratios);
        return Object.assign(l, { avgRatio: a, struggling: l.questions >= RULES.lessonMinQuestions && a != null && a < RULES.lessonStruggle });
      }).sort(function (x, y) { return (y.lastAt || 0) - (x.lastAt || 0); });
      var perf = performance(s.questions, avg);
      var thinkingHeavy = s.questions >= RULES.minQuestions && s.thinkingQs / s.questions >= RULES.thinkingShare;
      var scoredLessons = lessons.filter(function (l) { return l.avgRatio != null && l.questions >= RULES.lessonMinQuestions; }).sort(function (x, y) { return x.avgRatio - y.avgRatio; });
      return { id: s.id, name: s.name, questions: s.questions, attempts: s.attempts, lessonsPractised: lessons.length, avgRatio: avg, avgPct: pct(avg),
        fullMarks: s.full, scored: s.scored, thinkingQs: s.thinkingQs, thinkingHeavy: thinkingHeavy, retried: s.retried, retriedFull: s.retriedFull,
        lastAt: s.lastAt, activeRecently: s.lastAt != null && now - s.lastAt <= RULES.recentDays * DAY, performance: perf,
        needsAttention: perf === "May need attention", doingWell: perf === "Doing well",
        focusLesson: scoredLessons.length ? scoredLessons[0] : null, lessons: lessons };
    });
    var order = { "May need attention": 0, "Just getting started": 1, "Making progress": 2, "Doing well": 3, "No activity yet": 4 };
    students.sort(function (a, b) { return (order[a.performance] - order[b.performance]) || a.name.localeCompare(b.name); });

    // lessons across the class
    var lm = new Map();
    students.forEach(function (s) { s.lessons.forEach(function (l) {
      var g = lm.get(l.key); if (!g) { g = { key: l.key, title: l.title, subject: l.subject, students: 0, questions: 0, ratios: [], struggling: 0 }; lm.set(l.key, g); }
      g.students++; g.questions += l.questions; g.ratios = g.ratios.concat(l.ratios); if (l.struggling) g.struggling++;
    }); });
    var lessons = Array.from(lm.values()).map(function (g) { g.avgRatio = mean(g.ratios); g.avgPct = pct(g.avgRatio); return g; })
      .sort(function (a, b) { return (b.struggling - a.struggling) || (b.students - a.students) || a.title.localeCompare(b.title); });

    // exam-ready (full marks) by subject, over scored questions
    var bySubject = new Map();
    (rows || []).forEach(function (r) {
      var marks = marksFor(meta, r.level, r.subject_key, r.lesson_id, Number(r.q_idx)); var best = num(r.best_score);
      if (marks == null || best == null) return;
      var k = r.level + "|" + r.subject_key; var g = bySubject.get(k) || { label: subjectName(meta, r.level, r.subject_key), full: 0, scored: 0 };
      g.scored++; if (best >= marks) g.full++; bySubject.set(k, g);
    });
    var examReady = Array.from(bySubject.values()).sort(function (a, b) { return a.label.localeCompare(b.label); });

    var joined = students.length, active = students.filter(function (s) { return s.questions > 0; }).length;
    var totals = students.reduce(function (t, s) { t.questions += s.questions; t.attempts += s.attempts; t.full += s.fullMarks; t.scored += s.scored; t.thinkingQs += s.thinkingQs; return t; }, { questions: 0, attempts: 0, full: 0, scored: 0, thinkingQs: 0 });
    var recent = students.filter(function (s) { return s.activeRecently; }).length;

    // "Ethixo Noticed": only rule-derived facts, only when the count is non-zero
    var noticed = [];
    function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
    if (joined > 0) noticed.push(active + " of " + joined + (joined === 1 ? " student has" : " students have") + " practised so far" + (recent ? " (" + recent + " in the last " + RULES.recentDays + " days)." : "."));
    var dw = students.filter(function (s) { return s.doingWell; }).length; if (dw) noticed.push(plural(dw, "student is", "students are") + " doing well (70% or more of the marks on their best attempts).");
    var na = students.filter(function (s) { return s.needsAttention; }).length; if (na) noticed.push(plural(na, "student", "students") + " may need attention (under 40% of the marks on their best attempts).");
    var th = students.filter(function (s) { return s.thinkingHeavy; }).length; if (th) noticed.push(plural(th, "student", "students") + " used Thinking Help on at least half of their questions.");
    var rf = students.filter(function (s) { return s.retriedFull > 0; }).length; if (rf) noticed.push(plural(rf, "student", "students") + " reached full marks on a question after trying it more than once.");
    var top = lessons.slice().sort(function (a, b) { return (b.students - a.students) || (b.questions - a.questions); })[0];
    if (top && top.students > 0) noticed.push("Most-practised lesson: " + top.title + " (" + plural(top.students, "student", "students") + ").");
    var sl = lessons.filter(function (l) { return l.struggling > 0; }).length; if (sl) noticed.push(plural(sl, "lesson has", "lessons have") + " at least one student struggling.");
    return { rules: RULES, students: students, lessons: lessons, lessonsToLookAt: lessons.filter(function (l) { return l.struggling > 0; }),
      examReady: examReady, totals: totals, joined: joined, active: active, recent: recent, noticed: noticed,
      attention: students.filter(function (s) { return s.needsAttention || s.thinkingHeavy; }), doingWell: students.filter(function (s) { return s.doingWell; }) };
  }
  var api = { compute: compute, RULES: RULES, performance: performance };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PilotInsights = api;
})(typeof window !== "undefined" ? window : this);
