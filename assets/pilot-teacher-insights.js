/* Pilot Teacher Dashboard — signal rules. Pure functions, no network, no DOM.
   INPUT is ONLY what the privacy boundary already gives the teacher:
     rows        = teacher_attempt_summary() rows: per student x question -> attempt_count, first_score, latest_score, best_score, latest_at, used_thinking
     members     = joined students ({student_id, display_name, class_id})  — so students with no attempts still appear
     assignments = the teacher's own assignments rows (class_id, level, subject_key, lesson_id, due_date)
     meta        = assets/pilot-lesson-meta.json: lesson titles, max marks per question and the curriculum question PROMPT. No answer keys.
   Nothing here can see written answers, feedback, Thinking Cycle text, ScholarVault or student_state.

   RULES (thresholds in RULES; the dashboard prints them in "How these signals work"):
   Question-level facts (per student x question): marks = max marks from meta; best/first = best/first attempt score.
     full marks ............ best >= marks            (the student app's own "complete" rule)
     first-try full marks .. first >= marks
     needed more explanation first_score < 50% of marks            (student app: "an early attempt scored under half")
     misconception corrected  first_score < 50% of marks AND best >= marks   (student app: early attempt under half, a LATER attempt full marks)
     improved after retrying  attempts > 1 AND best > first_score
     full marks without Thinking Help = best >= marks AND Thinking Help never used on that question.
        PROXY SIGNAL only: it is NOT proof that the student explained their reasoning independently.
   Student-level:
     new ideas understood = distinct lessons in which the student reached full marks on at least one question (student app: getRealGrowthData)
     performance (average of best/marks over scored questions):  0 questions "No activity yet" | <3 "Just getting started" | >=70% "Doing well" | 40-69% "Making progress" | <40% "May need attention"
     progress: improved after retrying on >= 2 questions "Improving" | < 3 questions "Just getting started" | else "Steady"
     Relies on Thinking Help: >= 3 questions attempted and Thinking Help used on >= 50% of them
     behaviour signals (student app: BEHAVIOUR_MIN_EVIDENCE = 3 distinct questions): keeps trying (improved after retrying), first-try full marks, works through thinking
   Lesson-level: a student is "struggling in a lesson" with >= 2 questions attempted there and an average under 40%.
   Assignment status per student (only from the summary rows of the assigned lesson):
     Not Started: no question of the lesson attempted | Completed: every question at full marks |
     Needs Practice: >= 2 questions attempted and their average under 40% | In Progress: anything else.
   Active recently = last activity within 3 days. */
(function (root) {
  var RULES = { minQuestions: 3, doingWell: 0.7, makingProgress: 0.4, thinkingShare: 0.5, lessonMinQuestions: 2, lessonStruggle: 0.4,
    recentDays: 3, underHalf: 0.5, behaviourMin: 3, improvingMin: 2, assignNeedsPracticeMin: 2, assignNeedsPractice: 0.4, topQuestions: 8 };
  var DAY = 86400000;
  function num(x) { var n = Number(x); return x == null || !isFinite(n) ? null : n; }
  function lessonOf(meta, level, sk, lesson) { var s = meta && meta[level] && meta[level][sk]; return s && s.lessons && s.lessons[lesson] || null; }
  function marksFor(meta, level, sk, lesson, q) { var l = lessonOf(meta, level, sk, lesson); var m = l && l.marks && l.marks[q]; return typeof m === "number" && m > 0 ? m : null; }
  function promptFor(meta, level, sk, lesson, q) { var l = lessonOf(meta, level, sk, lesson); return l && l.prompts && l.prompts[q] ? String(l.prompts[q]) : null; }
  function lessonTitle(meta, level, sk, lesson) { var l = lessonOf(meta, level, sk, lesson); return l ? l.title : (level + " " + sk + " · " + lesson); }
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
  function assignmentStatus(attempted, full, total, ratios) {
    if (!attempted) return "Not Started";
    if (total && full >= total) return "Completed";
    if (attempted >= RULES.assignNeedsPracticeMin && ratios.length && mean(ratios) < RULES.assignNeedsPractice) return "Needs Practice";
    return "In Progress";
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function compute(allRows, allMembers, meta, now, opts) {
    opts = opts || {}; now = now || Date.now();
    var classId = opts.classId && opts.classId !== "overview" ? opts.classId : null;
    var rows = (allRows || []).filter(function (r) { return !classId || r.class_id === classId; });
    var members = (allMembers || []).filter(function (m) { return !classId || m.class_id === classId; });
    var st = new Map();
    function get(id, name) {
      var s = st.get(id);
      if (!s) { s = { id: id, name: name || "Student", questions: 0, attempts: 0, ratios: [], full: 0, scored: 0, thinkingQs: 0, retried: 0, retriedFull: 0, improved: 0, firstTry: 0, corrected: 0, fullNoThinking: 0, lastAt: null, lessons: new Map(), qs: [] }; st.set(id, s); }
      else if (name && s.name === "Student") s.name = name;
      return s;
    }
    members.forEach(function (m) { get(m.student_id, m.display_name); });
    rows.forEach(function (r) {
      var s = get(r.student_id, r.display_name);
      var cnt = num(r.attempt_count) || 0, best = num(r.best_score), first = num(r.first_score), at = num(r.latest_at);
      var qi = Number(r.q_idx), marks = marksFor(meta, r.level, r.subject_key, r.lesson_id, qi);
      s.questions++; s.attempts += cnt;
      if (at != null && (s.lastAt == null || at > s.lastAt)) s.lastAt = at;
      var thinking = r.used_thinking === true; if (thinking) s.thinkingQs++;
      var q = { level: r.level, sk: r.subject_key, lesson: r.lesson_id, qi: qi, marks: marks, best: best, first: first, cnt: cnt, thinking: thinking, ratio: null, full: false, underHalfFirst: false, corrected: false, improved: false };
      if (marks != null && best != null) {
        q.ratio = Math.max(0, Math.min(1, best / marks)); q.full = best >= marks;
        s.scored++; s.ratios.push(q.ratio); if (q.full) { s.full++; if (!thinking) s.fullNoThinking++; }
        if (cnt > 1) { s.retried++; if (q.full) s.retriedFull++; }
        if (first != null) {
          if (first >= marks) s.firstTry++;
          q.underHalfFirst = first < RULES.underHalf * marks;
          q.corrected = q.underHalfFirst && q.full && cnt > 1; if (q.corrected) s.corrected++;
          q.improved = cnt > 1 && best > first; if (q.improved) s.improved++;
        }
      } else if (cnt > 1) s.retried++;
      s.qs.push(q);
      var key = r.level + "|" + r.subject_key + "|" + r.lesson_id;
      var l = s.lessons.get(key);
      if (!l) { l = { key: key, level: r.level, subjectKey: r.subject_key, lessonId: r.lesson_id, title: lessonTitle(meta, r.level, r.subject_key, r.lesson_id), subject: subjectName(meta, r.level, r.subject_key), questions: 0, attempts: 0, ratios: [], full: 0, thinkingQs: 0, lastAt: null, hasFull: false, corrected: 0, fullNoThinking: 0 }; s.lessons.set(key, l); }
      l.questions++; l.attempts += cnt; if (thinking) l.thinkingQs++;
      if (q.ratio != null) { l.ratios.push(q.ratio); if (q.full) { l.full++; l.hasFull = true; if (!thinking) l.fullNoThinking++; } if (q.corrected) l.corrected++; }
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
      var progress = s.improved >= RULES.improvingMin ? "Improving" : (s.questions < RULES.minQuestions ? "Just getting started" : "Steady");
      return { id: s.id, name: s.name, questions: s.questions, attempts: s.attempts, lessonsPractised: lessons.length, avgRatio: avg, avgPct: pct(avg),
        fullMarks: s.full, scored: s.scored, thinkingQs: s.thinkingQs, thinkingHeavy: thinkingHeavy, retried: s.retried, retriedFull: s.retriedFull,
        improved: s.improved, firstTry: s.firstTry, corrected: s.corrected, fullNoThinking: s.fullNoThinking,
        newIdeas: lessons.filter(function (l) { return l.hasFull; }).length,
        lastAt: s.lastAt, activeRecently: s.lastAt != null && now - s.lastAt <= RULES.recentDays * DAY, performance: perf, progress: progress,
        needsAttention: perf === "May need attention", doingWell: perf === "Doing well",
        focusLesson: scoredLessons.length ? scoredLessons[0] : null, lessons: lessons, qs: s.qs };
    });
    var order = { "May need attention": 0, "Just getting started": 1, "Making progress": 2, "Doing well": 3, "No activity yet": 4 };
    students.sort(function (a, b) { return (order[a.performance] - order[b.performance]) || a.name.localeCompare(b.name); });

    // ---- lessons across the class
    var lm = new Map();
    students.forEach(function (s) { s.lessons.forEach(function (l) {
      var g = lm.get(l.key); if (!g) { g = { key: l.key, level: l.level, subjectKey: l.subjectKey, lessonId: l.lessonId, title: l.title, subject: l.subject, students: 0, questions: 0, ratios: [], struggling: 0, fullStudents: 0, correctedQs: 0, fullNoThinkingQs: 0 }; lm.set(l.key, g); }
      g.students++; g.questions += l.questions; g.ratios = g.ratios.concat(l.ratios); if (l.struggling) g.struggling++; if (l.hasFull) g.fullStudents++; g.correctedQs += l.corrected; g.fullNoThinkingQs += l.fullNoThinking;
    }); });
    var lessons = Array.from(lm.values()).map(function (g) { g.avgRatio = mean(g.ratios); g.avgPct = pct(g.avgRatio); return g; })
      .sort(function (a, b) { return (b.struggling - a.struggling) || (b.students - a.students) || a.title.localeCompare(b.title); });

    // ---- question-level (Teaching Insights): which questions did students first get under half?
    var qm = new Map();
    students.forEach(function (s) { s.qs.forEach(function (q) {
      if (q.marks == null || q.first == null) return;
      var k = q.level + "|" + q.sk + "|" + q.lesson + "|" + q.qi;
      var g = qm.get(k); if (!g) { g = { key: k, level: q.level, subjectKey: q.sk, lessonId: q.lesson, qi: q.qi, title: lessonTitle(meta, q.level, q.sk, q.lesson), subject: subjectName(meta, q.level, q.sk), prompt: promptFor(meta, q.level, q.sk, q.lesson, q.qi), marks: q.marks, students: 0, underHalf: 0, full: 0, corrected: 0 }; qm.set(k, g); }
      g.students++; if (q.underHalfFirst) g.underHalf++; if (q.full) g.full++; if (q.corrected) g.corrected++;
    }); });
    var questionInsights = Array.from(qm.values()).filter(function (g) { return g.underHalf > 0; }).map(function (g) { g.pct = Math.round(100 * g.underHalf / g.students); return g; })
      .sort(function (a, b) { return (b.pct - a.pct) || (b.underHalf - a.underHalf) || a.title.localeCompare(b.title) || a.qi - b.qi; }).slice(0, RULES.topQuestions);

    // ---- exam-ready (full marks) by subject and by class
    var bySubject = new Map();
    rows.forEach(function (r) {
      var marks = marksFor(meta, r.level, r.subject_key, r.lesson_id, Number(r.q_idx)); var best = num(r.best_score);
      if (marks == null || best == null) return;
      var k = r.level + "|" + r.subject_key; var g = bySubject.get(k) || { label: subjectName(meta, r.level, r.subject_key), full: 0, scored: 0 };
      g.scored++; if (best >= marks) g.full++; bySubject.set(k, g);
    });
    var examReady = Array.from(bySubject.values()).sort(function (a, b) { return a.label.localeCompare(b.label); });
    var byClass = new Map();
    rows.forEach(function (r) {
      var marks = marksFor(meta, r.level, r.subject_key, r.lesson_id, Number(r.q_idx)); var best = num(r.best_score);
      if (marks == null || best == null) return;
      var g = byClass.get(r.class_id) || { classId: r.class_id, full: 0, scored: 0 }; g.scored++; if (best >= marks) g.full++; byClass.set(r.class_id, g);
    });

    var joined = students.length, active = students.filter(function (s) { return s.questions > 0; }).length;
    var totals = students.reduce(function (t, s) { t.questions += s.questions; t.attempts += s.attempts; t.full += s.fullMarks; t.scored += s.scored; t.thinkingQs += s.thinkingQs; t.newIdeas += s.newIdeas; t.corrected += s.corrected; t.fullNoThinking += s.fullNoThinking; return t; },
      { questions: 0, attempts: 0, full: 0, scored: 0, thinkingQs: 0, newIdeas: 0, corrected: 0, fullNoThinking: 0 });
    var recent = students.filter(function (s) { return s.activeRecently; }).length;

    // ---- metric drill-down content (Summary -> Detail -> Learning insight)
    var metrics = {
      newIdeas: { label: "New ideas understood", unit: "lessons",
        insight: totals.newIdeas ? plural(students.filter(function (s) { return s.newIdeas > 0; }).length, "student has", "students have") + " reached full marks in at least one lesson, " + totals.newIdeas + " lesson" + (totals.newIdeas === 1 ? "" : "s") + " in total." : "No lesson has a full-marks answer yet. This fills in as students practise.",
        items: lessons.filter(function (l) { return l.fullStudents > 0; }).map(function (l) { return { title: l.title, note: l.subject + " · " + plural(l.fullStudents, "student", "students") + " reached full marks" }; }) },
      misconceptionsCorrected: { label: "Misconceptions corrected", unit: "answers",
        insight: totals.corrected ? plural(totals.corrected, "answer started under half marks and later reached full marks", "answers started under half marks and later reached full marks") + "." : "No answer has gone from under half marks to full marks yet.",
        items: lessons.filter(function (l) { return l.correctedQs > 0; }).map(function (l) { return { title: l.title, note: plural(l.correctedQs, "answer", "answers") + ": the first attempt scored under half marks, a later attempt reached full marks." }; }) },
      fullNoThinking: { label: "Full marks without Thinking Help", unit: "answers",
        insight: totals.fullNoThinking ? plural(totals.fullNoThinking, "answer reached", "answers reached") + " full marks without Thinking Help being used. This is a proxy signal, not proof that students explained their reasoning independently." : "No full-marks answer without Thinking Help yet. (This is a proxy signal, not proof of independent explanation.)",
        items: lessons.filter(function (l) { return l.fullNoThinkingQs > 0; }).map(function (l) { return { title: l.title, note: l.subject + " · " + plural(l.fullNoThinkingQs, "answer", "answers") }; }) },
    };

    // ---- Ethixo Noticed: only rule-derived facts, only when the evidence bar is met
    var noticed = [];
    var keep = students.filter(function (s) { return s.improved >= RULES.behaviourMin; }).length;
    var ft = students.filter(function (s) { return s.firstTry >= RULES.behaviourMin; }).length;
    var tk = students.filter(function (s) { return s.thinkingQs >= RULES.behaviourMin; }).length;
    if (keep) noticed.push(plural(keep, "student keeps", "students keep") + " trying after a tricky first attempt and improving (3+ questions).");
    if (ft) noticed.push(plural(ft, "student is", "students are") + " reaching full marks on the first try (3+ questions).");
    if (tk) noticed.push(plural(tk, "student is", "students are") + " working through Thinking Help on 3+ questions.");
    if (joined > 0) noticed.push(active + " of " + joined + (joined === 1 ? " student has" : " students have") + " practised so far" + (recent ? " (" + recent + " in the last " + RULES.recentDays + " days)." : "."));
    var dw = students.filter(function (s) { return s.doingWell; }).length; if (dw) noticed.push(plural(dw, "student is", "students are") + " doing well (70% or more of the marks on best attempts).");
    var na = students.filter(function (s) { return s.needsAttention; }).length; if (na) noticed.push(plural(na, "student", "students") + " may need attention (under 40% of the marks on best attempts).");
    var rf = students.filter(function (s) { return s.retriedFull > 0; }).length; if (rf) noticed.push(plural(rf, "student", "students") + " reached full marks after trying a question more than once.");
    var top = lessons.slice().sort(function (a, b) { return (b.students - a.students) || (b.questions - a.questions); })[0];
    if (top && top.students > 0) noticed.push("Most-practised lesson: " + top.title + " (" + plural(top.students, "student", "students") + ").");
    var sl = lessons.filter(function (l) { return l.struggling > 0; }).length; if (sl) noticed.push(plural(sl, "lesson has", "lessons have") + " at least one student struggling.");

    // ---- Assigned Learning roster
    var assignments = (allAssign(opts.assignments, classId)).map(function (a) {
      var l = lessonOf(meta, a.level, a.subject_key, a.lesson_id); var total = l && l.marks ? l.marks.length : 0;
      var cls = students.filter(function (s) { return (allMembers || []).some(function (m) { return m.student_id === s.id && m.class_id === a.class_id; }); });
      var rowsFor = cls.map(function (s) {
        var qs = s.qs.filter(function (q) { return q.level === a.level && q.sk === a.subject_key && q.lesson === a.lesson_id; });
        var attempted = qs.filter(function (q) { return q.cnt > 0; }).length, full = qs.filter(function (q) { return q.full; }).length;
        var ratios = qs.filter(function (q) { return q.ratio != null; }).map(function (q) { return q.ratio; });
        return { studentId: s.id, name: s.name, status: assignmentStatus(attempted, full, total, ratios), done: full, total: total, attempted: attempted };
      }).sort(function (x, y) { return x.name.localeCompare(y.name); });
      return { id: a.id, classId: a.class_id, level: a.level, subjectKey: a.subject_key, lessonId: a.lesson_id, lessonTitle: lessonTitle(meta, a.level, a.subject_key, a.lesson_id), subject: subjectName(meta, a.level, a.subject_key), dueDate: a.due_date, rows: rowsFor };
    });
    function allAssign(list, cid) { return (list || []).filter(function (a) { return !cid || a.class_id === cid; }); }

    return { rules: RULES, students: students, lessons: lessons, lessonsToLookAt: lessons.filter(function (l) { return l.struggling > 0; }), questionInsights: questionInsights,
      examReady: examReady, examReadyByClass: Array.from(byClass.values()), totals: totals, joined: joined, active: active, recent: recent, noticed: noticed, metrics: metrics, assignments: assignments,
      attention: students.filter(function (s) { return s.needsAttention || s.thinkingHeavy; }), doingWell: students.filter(function (s) { return s.doingWell; }) };
  }
  var api = { compute: compute, RULES: RULES, performance: performance, assignmentStatus: assignmentStatus };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PilotInsights = api;
})(typeof window !== "undefined" ? window : this);
