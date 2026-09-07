// JLPT N4 quiz app — vanilla JS, no dependencies.
(function () {
  'use strict';

  var QUESTIONS = (typeof BANK !== 'undefined' ? BANK.questions : []);
  var TESTS = (typeof BANK !== 'undefined' ? BANK.tests : []);
  var TOTAL = (typeof BANK !== 'undefined' ? BANK.total : QUESTIONS.length);
  var VERIFIED = (typeof BANK !== 'undefined' ? BANK.verified : 0);
  var FC = (typeof FLASH !== 'undefined') ? FLASH : { vocab: [], kanji: [], grammar: [] };
  var RU_MAP = {};
  var RUSSIAN_MODE = window.JLPT_DATA_SOURCE === 'ru';
  if (typeof RU_UI !== 'undefined' && typeof RU_UI_EXTRA !== 'undefined') Object.assign(RU_UI, RU_UI_EXTRA);

  // ---------- level (N2 / N3 / N4 / N5) ----------
  var LEVELS = (typeof JLPT !== 'undefined' ? Object.keys(JLPT).sort() : []);
  var LEVEL = 'n4';
  var PROFILE_KEY = 'jlpt-practice.profile.v1';
  var PROFILE_VERSION = 1;
  var SRS_KEY_PREFIX = 'jlpt-srs.' + LEVEL + '.';
  var profile = loadProfile();
  var profileNotice = '';
  var reviewThreshold = 2;

  var SRS_INTERVALS = {
    unknown: 1,
    difficult: 3,
    known: 7
  };
  
  var EXAM_CONFIG = {
    defaultTimePerQuestion: 90,
    totalQuestions: 20,
    showAnswers: false
  };
  
  if (!profile.level || LEVELS.indexOf(profile.level) === -1) {
    profile.level = LEVELS.length ? LEVELS[0] : 'n4';
    saveProfile();
  }
  if (!profile.srsData) profile.srsData = {};
  if (!profile.reviewData) profile.reviewData = {};
  if (!profile.activeExams) profile.activeExams = {};
  loadLevel(profile.level);

  var reviewQueue = [];
  function loadLevel(lv) {
    if (!LEVELS.length || !JLPT[lv]) return;
    LEVEL = lv;
    var bk = JLPT[lv].bank || {};
    QUESTIONS = bk.questions || [];
    TESTS = bk.tests || [];
    TOTAL = bk.total != null ? bk.total : QUESTIONS.length;
    VERIFIED = bk.verified || 0;
    FC = JLPT[lv].flash || { vocab: [], kanji: [], grammar: [] };
    RU_MAP = RUSSIAN_MODE && typeof RU_DATA !== 'undefined' ? (RU_DATA[lv] || {}) : {};
    prepareQuestionKeys();
  }
  if (profile.level && LEVELS.indexOf(profile.level) !== -1) loadLevel(profile.level);
  else prepareQuestionKeys();
  
  function getDueCards() {
    var now = Date.now();
    var today = new Date(now);
    today.setHours(0, 0, 0, 0);
    var todayMs = today.getTime();
    
    var result = [];
    QUESTIONS.forEach(function (q) {
      var key = questionKey(q);
      var progress = questionProgress(q);
      var srs = profile.srsData[key] || { interval: 0, nextReview: 0 };
      
      if (srs.nextReview > 0 && srs.nextReview <= todayMs) {
        var dueAnswers = (progress.answers || 0) - (progress.correct || 0);
        if (dueAnswers > reviewThreshold) {
          result.push({ q: q, srs: srs, progress: progress });
        }
      }
    });
    return result.sort(function (a, b) { return a.srs.nextReview - b.srs.nextReview; });
  }
  
  function setLevel(lv) {
    if (lv === LEVEL) return;
    loadLevel(lv);
    quiz = null; flash = null;
    profile.level = lv;
    saveProfile();
    document.title = 'JLPT ' + lv.toUpperCase() + '\u2014 Practice Tests';
    var el = document.getElementById('levelSel');
    if (el) Array.prototype.forEach.call(el.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-lv') === lv);
    });
    setView('home');
  }

  var CATS = [
    { key: 'grammar', label: 'Grammar', jp: '文法', color: '#3b4cca' },
    { key: 'kanji', label: 'Kanji', jp: '漢字', color: '#7b3ba8' },
    { key: 'reading', label: 'Reading', jp: '読解', color: '#0d8a76' },
    { key: 'vocabulary', label: 'Vocabulary', jp: '語彙', color: '#b5541c' }
  ];
  var CATMAP = {}; CATS.forEach(function (c) { CATMAP[c.key] = c; });

  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var sub = document.getElementById('sub');
  var dataToggle = document.getElementById('dataToggle');
  var view = 'home';
  var quiz = null;
  var flash = null;
  var exam = null;

  // level selector UI in the header (N3/N4/N5). Hidden if data lacks multiple levels.
  (function () {
    if (!LEVELS.length) return;
    var brand = document.querySelector('.brand');
    if (!brand) return;
    var h = document.createElement('div');
    h.id = 'levelSel';
    h.className = 'levelsel';
    h.innerHTML = LEVELS.map(function (l) {
      return '<button data-lv="' + l + '" class="' + (l === LEVEL ? 'active' : '') + '">' + l.toUpperCase() + '</button>';
    }).join('');
    brand.parentNode.insertBefore(h, brand);
    h.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      setLevel(b.getAttribute('data-lv'));
    });
  })();

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function ruText(field, value) {
    if (!RUSSIAN_MODE || value == null) return value;
    if (field === 'stem' || field === 'opts' || field === 'marks' || field === 'ans') return value;
    var map = RU_MAP[field];
    return map && Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value;
  }
  function translateUI(root) {
    if (!RUSSIAN_MODE || typeof RU_UI === 'undefined' || !root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue;
      var trimmed = text.trim();
      if (Object.prototype.hasOwnProperty.call(RU_UI, trimmed)) {
        text = text.replace(trimmed, RU_UI[trimmed]);
      } else {
        Object.keys(RU_UI)
          .sort(function (a, b) { return b.length - a.length; })
          .forEach(function (key) {
            var escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            text = text.replace(new RegExp('(^|[^A-Za-z])' + escaped + '(?=$|[^A-Za-z])', 'g'), '$1' + RU_UI[key]);
          });
      }
      node.nodeValue = text;
    }
  }
  function fmtStem(stem) {
    var s = esc(stem);
    s = s.replace(/_{3,}|＿+/g, '<span class="bl">＿＿＿</span>');
    return s;
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // ---------- offline learning profile ----------
  function newProfile() {
    return { version: PROFILE_VERSION, level: 'n4', flashKnown: {}, questions: {}, activeQuizzes: {}, activeExams: {}, srsData: {}, reviewData: {} };
  }
  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function normalizeProfile(value) {
    var clean = newProfile();
    if (!value) return clean;
    clean.level = typeof value.level === 'string' ? value.level : clean.level;
    clean.flashKnown = plainObject(value.flashKnown);
    clean.questions = plainObject(value.questions);
    clean.activeQuizzes = plainObject(value.activeQuizzes);
    clean.activeExams = plainObject(value.activeExams);
    clean.srsData = plainObject(value.srsData);
    clean.reviewData = plainObject(value.reviewData);

    Object.keys(clean.srsData).forEach(function (key) {
      var srs = clean.srsData[key];
      if (srs && typeof srs === 'object') srs.nextReview = srs.nextReview || 0;
    });
    
    // Migrate flashcard keys to include LEVEL prefix
    Object.keys(clean.flashKnown || {}).forEach(function (key) {
      if (key.indexOf(':') !== -1 && key.indexOf(LEVEL + ':') !== 0) {
        var newKey = LEVEL + ':' + key;
        if (!clean.flashKnown[newKey]) {
          clean.flashKnown[newKey] = clean.flashKnown[key];
        }
        delete clean.flashKnown[key];
      }
    });
    Object.keys(clean.srsData || {}).forEach(function (key) {
      if (key.indexOf(':') !== -1 && key.indexOf(LEVEL + ':') !== 0) {
        var newKey = LEVEL + ':' + key;
        if (!clean.srsData[newKey]) {
          clean.srsData[newKey] = clean.srsData[key];
        }
        delete clean.srsData[key];
      }
    });
    
    return clean;
  }
  function loadProfile() {
    try { return normalizeProfile(JSON.parse(window.localStorage.getItem(PROFILE_KEY))); }
    catch (e) { return newProfile(); }
  }
  function saveProfile() {
    try {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) { 
      profileNotice = 'Progress could not be saved in this browser.'; 
    }
  }
  function prepareQuestionKeys() {
    QUESTIONS.forEach(function (q, i) { 
      q._profileKey = LEVEL + ':' + i;
      q._tempKey = LEVEL + ':' + i;
    });
  }
  function questionKey(q) { 
    return q._profileKey || q._tempKey || (q._tempKey = LEVEL + ':' + QUESTIONS.indexOf(q));
  }
  function flashKey(set, index) { return LEVEL + ':' + set + ':' + index; }
  function questionProgress(q) { 
    var key = questionKey(q);
    var state = profile.questions[key];
    if (!state) {
      state = { answers: 0, correct: 0, wrong: 0, needsReview: false };
      profile.questions[key] = state;
    }
    return state; 
  }
  function countMistakes() {
    return QUESTIONS.filter(function (q) { return !!questionProgress(q).needsReview; }).length;
  }
  function countReviewToday() {
    var now = Date.now();
    var today = new Date(now);
    today.setHours(0, 0, 0, 0);
    var todayMs = today.getTime();
    
    var count = 0;
    QUESTIONS.forEach(function (q) {
      var key = questionKey(q);
      var progress = questionProgress(q);
      var srs = profile.srsData[key] || { interval: 0, nextReview: 0 };
      
      if (srs.nextReview > 0 && srs.nextReview <= todayMs) {
        var dueAnswers = (progress.answers || 0) - (progress.correct || 0);
        if (dueAnswers > reviewThreshold) {
          count++;
        }
      }
    });
    return count;
  }
  function questionInterval(q) {
    var key = questionKey(q);
    var progress = questionProgress(q);
    var srs = profile.srsData[key] || { interval: 0, nextReview: 0 };
    var now = Date.now();
    
    if (srs.nextReview > now) return null;
    return SRS_INTERVALS;
  }
  function recordAnswer(result) {
    var key = questionKey(result.q);
    var state = profile.questions[key] || { answers: 0, correct: 0, wrong: 0, needsReview: false };
    state.answers++;
    if (result.correct) { state.correct++; state.needsReview = false; }
    else { state.wrong++; state.needsReview = true; }
    state.lastAnswered = Date.now();
    profile.questions[key] = state;
    
    var srs = profile.srsData[key] || { interval: 0, nextReview: 0 };
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayMs = today.getTime();
    
    if (result.correct) {
      var interval = SRS_INTERVALS.known;
      srs.interval = interval;
      srs.nextReview = todayMs + (interval * 24 * 60 * 60 * 1000);
    } else {
      srs.interval = 0;
      srs.nextReview = todayMs + (24 * 60 * 60 * 1000);
    }
    profile.srsData[key] = srs;
    
    saveProfile();
  }
  function markCardKnown(set, index, status) {
    var key = flashKey(set, index);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayMs = today.getTime();
    
    if (status === 'unknown') {
      delete profile.flashKnown[key];
      profile.srsData[key] = {
        interval: 0,
        nextReview: todayMs + (24 * 60 * 60 * 1000),
        lastStatus: 'unknown',
        lastReview: todayMs
      };
    } else {
      var interval = SRS_INTERVALS[status] || SRS_INTERVALS.known;
      if (status === 'known') {
        profile.flashKnown[key] = true;
      } else {
        delete profile.flashKnown[key];
      }
      profile.srsData[key] = {
        interval: interval,
        nextReview: todayMs + (interval * 24 * 60 * 60 * 1000),
        lastStatus: status,
        lastReview: todayMs
      };
    }
    saveProfile();
  }
  function countAnswered() {
    return QUESTIONS.filter(function (q) { return (questionProgress(q).answers || 0) > 0; }).length;
  }
  function countKnownCards() {
    var known = 0;
    ['vocab', 'kanji', 'grammar'].forEach(function (set) {
      var deck = set === 'vocab' ? FC.vocab : set === 'kanji' ? FC.kanji : FC.grammar;
      deck.forEach(function (_, i) { if (profile.flashKnown[flashKey(set, i)]) known++; });
    });
    return known;
  }
  function getDueFlashcards() {
    var now = Date.now();
    var today = new Date(now);
    today.setHours(0, 0, 0, 0);
    var todayMs = today.getTime();
    var result = [];

    ['vocab', 'kanji', 'grammar'].forEach(function (set) {
      var deck = set === 'vocab' ? FC.vocab : set === 'kanji' ? FC.kanji : FC.grammar;
      deck.forEach(function (card, index) {
        var srs = profile.srsData[flashKey(set, index)];
        if (srs && srs.nextReview > 0 && srs.nextReview <= todayMs) {
          result.push({ set: set, index: index, card: card, srs: srs });
        }
      });
    });
    return result.sort(function (a, b) { return a.srs.nextReview - b.srs.nextReview; });
  }
  function startReviewMode() {
    var dueCards = getDueCards();
    if (!dueCards.length) { setView('home'); return; }
    var qs = dueCards.map(function (item) { return item.q; });
    quiz = { qs: qs, i: 0, picked: null, locked: false, score: 0, cfg: { mode: 'review' }, label: 'Review due cards · ' + qs.length,
      results: [], started: Date.now() };
    saveActiveQuiz();
    setView('quiz');
  }
  function startFlashReviewMode() {
    var dueCards = getDueFlashcards();
    if (!dueCards.length) { setView('home'); return; }
    flash = { set: dueCards[0].set, i: 0, order: [], dueQueue: dueCards, known: profile.flashKnown || {} };
    setView('study');
  }
  function startExamMode(cfg) {
    var pool = QUESTIONS.slice();
    if (cfg.category && cfg.category !== 'all') pool = pool.filter(function (q) { return q.category === cfg.category; });
    var totalQuestions = cfg.count || EXAM_CONFIG.totalQuestions;
    var qs = shuffle(pool).slice(0, Math.min(totalQuestions, pool.length));
    qs = qs.sort(function (a, b) { return a.id - b.id; });
    var cfgWithDefaults = {
      category: cfg.category || 'all',
      count: totalQuestions,
      timeLimit: cfg.timeLimit || 1800,
      showAnswers: false
    };
    exam = { qs: qs, i: 0, picked: null, locked: false, score: 0, cfg: cfgWithDefaults,
      label: 'Exam · ' + (cfgWithDefaults.category === 'all' ? 'Mixed' : CATMAP[cfgWithDefaults.category].label) + ' · ' + qs.length + 'q',
      results: [], started: Date.now(), timeLimit: cfgWithDefaults.timeLimit, timeLeft: cfgWithDefaults.timeLimit };
    saveActiveExam();
    setView('exam');
  }
  function activeQuiz() { return profile.activeQuizzes[LEVEL]; }
  function activeExam() { return profile.activeExams[LEVEL]; }
  function saveActiveQuiz() {
    if (!quiz || quiz.i >= quiz.qs.length) return;
    var finished = quiz.results.slice(0, quiz.i);
    profile.activeQuizzes[LEVEL] = {
      version: 1, level: LEVEL, cfg: quiz.cfg, label: quiz.label,
      questionKeys: quiz.qs.map(questionKey), i: quiz.i,
      results: finished.map(function (r) { return { key: questionKey(r.q), picked: r.picked, correct: r.correct }; }),
      started: quiz.started
    };
    saveProfile();
  }
  function saveActiveExam() {
    if (!exam) return;
    var finished = exam.results.slice(0, exam.i);
    profile.activeExams[LEVEL] = {
      version: 1, level: LEVEL, cfg: exam.cfg, label: exam.label,
      questionKeys: exam.qs.map(questionKey), i: exam.i,
      results: finished.map(function (r) { return { key: questionKey(r.q), picked: r.picked, correct: r.correct }; }),
      started: exam.started, timeLimit: exam.timeLimit, timeLeft: exam.timeLeft
    };
    saveProfile();
  }
  function clearActiveQuiz() {
    if (profile.activeQuizzes[LEVEL]) { delete profile.activeQuizzes[LEVEL]; saveProfile(); }
  }
  function clearActiveExam() {
    if (profile.activeExams[LEVEL]) { delete profile.activeExams[LEVEL]; saveProfile(); }
  }
  function restoreActiveQuiz() {
    var saved = activeQuiz();
    if (!saved || saved.version !== 1 || !Array.isArray(saved.questionKeys)) return false;
    var byKey = {};
    QUESTIONS.forEach(function (q) { byKey[questionKey(q)] = q; });
    var qs = saved.questionKeys.map(function (key) { return byKey[key]; });
    if (!qs.length || qs.some(function (q) { return !q; }) || saved.i < 0 || saved.i >= qs.length) {
      clearActiveQuiz(); return false;
    }
    var results = (Array.isArray(saved.results) ? saved.results : []).map(function (r) {
      return { q: byKey[r.key], picked: r.picked, correct: !!r.correct };
    }).filter(function (r) { return !!r.q; });
    quiz = { qs: qs, i: saved.i, picked: null, locked: false,
      score: results.filter(function (r) { return r.correct; }).length,
      cfg: saved.cfg || {}, label: saved.label || 'Saved quiz', results: results,
      started: saved.started || Date.now() };
    return true;
  }
  function restoreActiveExam() {
    var saved = activeExam();
    if (!saved || saved.version !== 1 || !Array.isArray(saved.questionKeys)) return false;
    var byKey = {};
    QUESTIONS.forEach(function (q) { byKey[questionKey(q)] = q; });
    var qs = saved.questionKeys.map(function (key) { return byKey[key]; });
    if (!qs.length || qs.some(function (q) { return !q; }) || saved.i < 0 || saved.i >= qs.length) {
      clearActiveExam(); return false;
    }
    var results = (Array.isArray(saved.results) ? saved.results : []).map(function (r) {
      return { q: byKey[r.key], picked: r.picked, correct: !!r.correct };
    }).filter(function (r) { return !!r.q; });
    exam = { qs: qs, i: saved.i, picked: null, locked: false,
      score: results.filter(function (r) { return r.correct; }).length,
      cfg: saved.cfg || {}, label: saved.label || 'Saved exam', results: results,
      started: saved.started || Date.now(), timeLimit: saved.timeLimit || 1800, timeLeft: saved.timeLeft || 1800 };
    return true;
  }
  function downloadProfile() {
    var blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'jlpt-practice-progress.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }
  function importProfile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = normalizeProfile(JSON.parse(reader.result));
        if (imported.version !== PROFILE_VERSION) throw new Error('version');
        profile = imported; flash = null; quiz = null;
        if (profile.level && LEVELS.indexOf(profile.level) !== -1) loadLevel(profile.level);
        profileNotice = 'Backup restored on this device.';
        saveProfile(); setView('home');
      } catch (e) {
        profileNotice = 'This file is not a valid JLPT Practice backup.';
        if (view === 'home') renderHome();
      }
    };
    reader.readAsText(file);
  }
  function byCatTest(cat, num) {
    return QUESTIONS.filter(function (q) { return q.category === cat && q.test_num === num; });
  }
  function countByCat(cat) {
    var n = 0; TESTS.forEach(function (t) { if (t.category === cat) n += t.n; }); return n;
  }
  function verifiedByCat(cat) {
    var n = 0; TESTS.forEach(function (t) { if (t.category === cat) n += t.verified; }); return n;
  }

  function setView(v) {
    view = v;
    Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === v);
    });
    render();
    window.scrollTo(0, 0);
    translateUI(nav);
    translateUI(app);
    translateUI(document.querySelector('.topbar'));
    translateUI(document.querySelector('.foot'));
  }
  nav.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'dataToggle') return;
    var v = b.getAttribute('data-view');
    if (v === 'quiz') { quiz = null; }
    else if (v === 'study') { quiz = null; flash = null; }
    else if (v === 'exam') { exam = null; }
    setView(v);
  });

  if (dataToggle) {
    var dataSource = window.JLPT_DATA_SOURCE === 'ru' ? 'ru' : 'ja';
    dataToggle.textContent = dataSource === 'ru' ? 'English' : 'Русский';
    dataToggle.title = dataSource === 'ru' ? 'Switch to Japanese data' : 'Переключить на русские данные';
    dataToggle.addEventListener('click', function () {
      var url = new URL(window.location.href);
      if (dataSource === 'ru') url.searchParams.delete('data');
      else url.searchParams.set('data', 'ru');
      window.location.href = url.toString();
    });
  }

  // ================= HOME =================
  function renderHome() {
    var tiles = CATS.map(function (c) {
      var n = countByCat(c.key), v = verifiedByCat(c.key);
      var tests = TESTS.filter(function (t) { return t.category === c.key; }).length;
      var catQuestions = QUESTIONS.filter(function(q) { return q.category === c.key; });
      var catAnswers = catQuestions.reduce(function(acc, q) { return acc + (questionProgress(q).answers || 0); }, 0);
      var catCorrect = catQuestions.reduce(function(acc, q) { return acc + (questionProgress(q).correct || 0); }, 0);
      var catPct = catAnswers ? Math.round(100 * catCorrect / catAnswers) : 0;
      var catColor = catPct >= 80 ? '#1f9d55' : catPct >= 50 ? '#f59e0b' : '#d64545';
      return '<div class="tile" data-cat="' + c.key + '" style="border-top:3px solid ' + c.color + '">' +
        '<div class="n">' + catAnswers + '</div>' +
        '<div class="t">' + c.jp + ' ' + c.label + ' · ' + tests + 'tests</div>' +
        '<div class="bar"><i style="width:' + catPct + '%;background:linear-gradient(90deg,' + catColor + ',#' + catColor.replace('#', '8') + ')"></i></div></div>';
    }).join('');
    var saved = activeQuiz();
    var totalCards = FC.vocab.length + FC.kanji.length + FC.grammar.length;
    var mistakes = countMistakes();
    var dueQuestions = getDueCards();
    var dueQuestionCount = dueQuestions.length;
    var dueFlashcards = getDueFlashcards();
    var dueFlashcardCount = dueFlashcards.length;
    var stats = TESTS.length ? TESTS.reduce(function(acc, t) { return acc + t.n; }, 0) : TOTAL;
    var answers = QUESTIONS.reduce(function(acc, q) { return acc + (questionProgress(q).answers || 0); }, 0);
    var correct = QUESTIONS.reduce(function(acc, q) { return acc + (questionProgress(q).correct || 0); }, 0);
    var totalAnswers = QUESTIONS.filter(function(q) { return (questionProgress(q).answers || 0) > 0; }).length;
    var accuracy = totalAnswers ? Math.round(100 * correct / answers) : 0;
    var streak = (function() {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var d = new Date(today);
      var s = 0;
      while (true) {
        var key = SRS_KEY_PREFIX + d.getTime();
        if (profile.reviewData[key]) s++;
        else break;
        d.setDate(d.getDate() - 1);
      }
      return s;
    })();

    var savedText = saved ? 'Resume quiz · question ' + (saved.i + 1) + ' / ' + saved.questionKeys.length : 'No saved quiz';

    app.innerHTML =
      '<div class="card">' +
        '<h2>Your progress</h2>' +
        '<div class="stat"><span class="k">Questions answered</span><span class="v">' + countAnswered() + ' / ' + TOTAL + '</span></div>' +
        '<div class="stat"><span class="k">Mistakes to review</span><span class="v">' + mistakes + '</span></div>' +
        '<div class="stat"><span class="k">Due questions today</span><span class="v">' + dueQuestionCount + '</span></div>' +
        '<div class="stat"><span class="k">Due flashcards today</span><span class="v">' + dueFlashcardCount + '</span></div>' +
        '<div class="stat"><span class="k">Accuracy</span><span class="v">' + accuracy + '%</span></div>' +
        '<div class="stat"><span class="k">Series</span><span class="v">' + streak + ' days</span></div>' +
        '<div class="stat"><span class="k">Known flashcards</span><span class="v">' + countKnownCards() + ' / ' + totalCards + '</span></div>' +
        '<div class="row" style="margin-top:1rem">' +
          '<button class="btn" id="resumeBtn" ' + (saved ? '' : 'disabled') + '>' + esc(savedText) + '</button>' +
          '<button class="btn ghost" id="mistakesBtn" ' + (mistakes ? '' : 'disabled') + '>Review mistakes (' + mistakes + ')</button>' +
          '<button class="btn ghost" id="dueBtn" ' + (dueQuestionCount ? '' : 'disabled') + '>Review questions (' + dueQuestionCount + ')</button>' +
          '<button class="btn ghost" id="dueFlashBtn" ' + (dueFlashcardCount ? '' : 'disabled') + '>Study flashcards (' + dueFlashcardCount + ')</button>' +
        '</div>' +
        '<div class="row" style="margin-top:.7rem">' +
          '<button class="btn ghost" id="exportBtn">Download backup</button>' +
          '<button class="btn ghost" id="importBtn">Restore backup</button>' +
          '<input id="importInput" type="file" accept="application/json,.json" hidden>' +
        '</div>' +
        (profileNotice ? '<p class="hint">' + esc(profileNotice) + '</p>' : '') +
      '</div>' +
      '<div class="card">' +
        '<h2>Ready to study? 📚</h2>' +
        '<p class="sub" style="margin-top:.2rem">' + stats + ' practice questions in 4 categories — every answer ' +
        'was checked against the source answer key (' + VERIFIED + '/' + stats + ' auto-verified, rest confirmed by hand). ' +
        'Pick a category to see the tests, or jump straight in with "Test me".</p>' +
        '<div class="grid" style="margin-top:1rem">' + tiles + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Category progress</h2>' +
        CATS.map(function(c) {
          var catQuestions = QUESTIONS.filter(function(q) { return q.category === c.key; });
          var totalCat = catQuestions.length;
          var catAnswers = catQuestions.reduce(function(acc, q) { return acc + (questionProgress(q).answers || 0); }, 0);
          var catCorrect = catQuestions.reduce(function(acc, q) { return acc + (questionProgress(q).correct || 0); }, 0);
          var pct = catAnswers ? Math.round(100 * catCorrect / catAnswers) : 0;
          var known = catQuestions.filter(function(q) { return (questionProgress(q).answers || 0) > 0; }).length;
          var dueCat = countReviewTodayByCat(c.key);
          return '<div class="statchart">' +
            '<div class="statchart-row">' +
              '<span class="statchart-label">' + c.label + '</span>' +
              '<span class="v">' + pct + '% (' + known + '/' + totalCat + ')</span>' +
            '</div>' +
            '<div class="statchart-bar"><i style="width:' + pct + '%"></i></div>' +
            '<div class="hint">' + dueCat + ' cards due</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="card">' +
        '<h2>How it works</h2>' +
        '<div class="stat"><span class="k">Take a full test</span><span class="v">Test me → pick a category &amp; number</span></div>' +
        '<div class="stat"><span class="k">Quick practice</span><span class="v">Test me → random 5 / 10 / 20</span></div>' +
        '<div class="stat"><span class="k">Instant feedback</span><span class="pill ok">✓ correct / ✗ wrong</span></div>' +
        '<div class="stat"><span class="k">Why it is right</span><span class="v">completed sentence + explanation</span></div>' +
        '<div class="stat"><span class="k">Study flashcards</span><span class="v">Study → vocab / kanji / grammar</span></div>' +
        '<div class="stat"><span class="k">Spaced repetition</span><span class="v">Cards review due based on SRS intervals</span></div>' +
      '</div>';

    Array.prototype.forEach.call(app.querySelectorAll('.tile'), function (t) {
      t.addEventListener('click', function () { startQuiz({ mode: 'category', category: t.getAttribute('data-cat') }); });
    });
    document.getElementById('resumeBtn').addEventListener('click', function () {
      if (restoreActiveQuiz()) setView('quiz');
    });
    document.getElementById('mistakesBtn').addEventListener('click', function () { startQuiz({ mode: 'mistakes', category: 'all' }); });
    document.getElementById('dueBtn').addEventListener('click', function () { startReviewMode(); });
    document.getElementById('dueFlashBtn').addEventListener('click', function () { startFlashReviewMode(); });
    document.getElementById('exportBtn').addEventListener('click', downloadProfile);
    document.getElementById('importBtn').addEventListener('click', function () { document.getElementById('importInput').click(); });
    document.getElementById('importInput').addEventListener('change', function () { importProfile(this.files && this.files[0]); });
  }
  
  function countReviewTodayByCat(cat) {
    var now = Date.now();
    var today = new Date(now);
    today.setHours(0, 0, 0, 0);
    var todayMs = today.getTime();
    
    var count = 0;
    QUESTIONS.filter(function(q) { return q.category === cat; }).forEach(function (q) {
      var key = questionKey(q);
      var progress = questionProgress(q);
      var srs = profile.srsData[key] || { interval: 0, nextReview: 0 };
      
      if (srs.nextReview > 0 && srs.nextReview <= todayMs) {
        var dueAnswers = (progress.answers || 0) - (progress.correct || 0);
        if (dueAnswers > reviewThreshold) {
          count++;
        }
      }
    });
    return count;
  }

  // ================= QUIZ SETUP =================
  function renderQuizSetup() {
    var catOpts = '<option value="all">All categories</option>' +
      CATS.map(function (c) { return '<option value="' + c.key + '">' + c.label + ' (' + c.jp + ')</option>'; }).join('');
    var saved = activeQuiz();
    app.innerHTML =
      '<div class="card">' +
        '<h2>Test me ✍️</h2>' +
        '<p class="sub">Choose a mode and category, then start.</p>' +
        '<div class="seg" id="modeSeg" style="margin-top:.9rem">' +
          '<button data-m="test" class="active">Full test</button>' +
          '<button data-m="random">Random</button>' +
        '</div>' +
        '<div class="row" style="margin-top:1rem">' +
          '<label>Category</label><select id="catSel">' + catOpts + '</select>' +
        '</div>' +
        '<div class="row" id="optRow" style="margin-top:.8rem"></div>' +
        '<div class="row" style="margin-top:1.1rem">' +
          '<button class="btn" id="startBtn">Start quiz</button>' +
          (saved ? '<button class="btn ghost" id="resumeBtn">Resume saved quiz</button>' : '') +
          '<button class="btn ghost" data-act="home">Back</button>' +
        '</div>' +
        '<p class="hint" id="setupHint"></p>' +
      '</div>';

    var mode = 'test';
    var optRow = document.getElementById('optRow');
    var hint = document.getElementById('setupHint');
    var catSel = document.getElementById('catSel');

    function testNumbers(cat) {
      return TESTS.filter(function (t) { return cat === 'all' || t.category === cat; })
        .map(function (t) { return t.num; });
    }
    function renderOpts() {
      if (mode === 'test') {
        var c = catSel.value;
        var nums = testNumbers(c).slice().sort(function (a, b) { return a - b; });
        // dedupe
        nums = nums.filter(function (x, i) { return nums.indexOf(x) === i; });
        if (!nums.length) { optRow.innerHTML = ''; hint.textContent = 'No tests found.'; return; }
        var opts = nums.map(function (n) {
          return '<option value="' + n + '">Exercise ' + (n < 10 ? '0' + n : n) + ' (' + countByCatAll(c, n) + ' Q)</option>';
        }).join('');
        var selc = c === 'all' ? '<span class="hint">mixes all categories</span>' : CATMAP[c].label;
        optRow.innerHTML = '<label>Test</label><select id="testSel">' + opts + '</select> ' + selc;
        var n = parseInt(nums[0], 10);
        hint.textContent = countByCatAll(c, n) + ' questions from ' + (c === 'all' ? 'all categories' : selc) + ', Exercise ' + n + '.';
      } else {
        optRow.innerHTML = '<label>Number</label><select id="numSel">' +
          '<option value="5">5</option><option value="10" selected>10</option>' +
          '<option value="20">20</option><option value="50">50</option></select>';
        var pool = catSel.value === 'all' ? TOTAL : countByCat(catSel.value);
        hint.textContent = 'Random mix of up to the selected number from ' +
          (catSel.value === 'all' ? 'all categories' : CATMAP[catSel.value].label) + ' (' + pool + ' available).';
      }
    }
    function countByCatAll(cat, num) {
      return TESTS.filter(function (t) { return (cat === 'all' || t.category === cat) && t.num === num; })
        .reduce(function (s, t) { return s + t.n; }, 0);
    }
    document.getElementById('modeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      mode = b.getAttribute('data-m');
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) {
        x.classList.toggle('active', x === b);
      });
      renderOpts();
    });
    catSel.addEventListener('change', renderOpts);
    renderOpts();

    app.querySelector('[data-act="home"]').addEventListener('click', function () { setView('home'); });
    document.getElementById('startBtn').addEventListener('click', function () {
      var c = catSel.value;
      if (mode === 'test') {
        var tn = parseInt(document.getElementById('testSel').value, 10);
        startQuiz({ mode: 'test', category: c, test_num: tn });
      } else {
        var nn = parseInt(document.getElementById('numSel').value, 10);
        startQuiz({ mode: 'random', category: c, count: nn });
      }
    });
    if (saved) document.getElementById('resumeBtn').addEventListener('click', function () {
      if (restoreActiveQuiz()) setView('quiz');
    });
  }

  function startQuiz(cfg) {
    var pool = QUESTIONS.slice();
    if (cfg.category && cfg.category !== 'all') pool = pool.filter(function (q) { return q.category === cfg.category; });
    var qs;
    var label;
    if (cfg.mode === 'test') {
      qs = pool.filter(function (q) { return q.test_num === cfg.test_num; });
      qs = qs.slice().sort(function (a, b) { return a.id - b.id; });
      label = (cfg.category === 'all' ? 'Mixed' : CATMAP[cfg.category].label) + ' · Test ' + (cfg.test_num < 10 ? '0' + cfg.test_num : cfg.test_num);
    } else if (cfg.mode === 'category') {
      qs = qs || pool.slice();
      label = CATMAP[cfg.category].label + ' (all)';
    } else if (cfg.mode === 'mistakes') {
      qs = shuffle(pool.filter(function (q) { return questionProgress(q).needsReview; }));
      label = 'Review mistakes · ' + qs.length;
    } else {
      qs = shuffle(pool).slice(0, cfg.count);
      qs = qs.sort(function (a, b) { return a.id - b.id; });
      label = (cfg.category === 'all' ? 'Mixed' : CATMAP[cfg.category].label) + ' · Random ' + qs.length;
    }
    if (!qs.length) { setView('home'); return; }
    quiz = { qs: qs, i: 0, picked: null, locked: false, score: 0, cfg: cfg, label: label,
      results: [], started: Date.now() };
    saveActiveQuiz();
    setView('quiz');
  }

  // ================= QUIZ PLAY =================
  function renderQuiz() {
    if (!quiz) return renderQuizSetup();
    if (quiz.i >= quiz.qs.length) return renderResults();
    var q = quiz.qs[quiz.i];
    var pct = Math.round(100 * (quiz.i) / quiz.qs.length);
    var opts = q.options.map(function (o) {
      return '<div class="opt" data-v="' + o.v + '">' +
        '<span class="mark">' + o.v + '</span><span class="txt">' + esc(ruText('opts', o.text)) + '</span></div>';
    }).join('');
    app.innerHTML =
      '<div class="card qcard">' +
        '<div class="meter"><b>' + esc(quiz.label) + '</b> &nbsp;·&nbsp; Question ' + (quiz.i + 1) + ' / ' + quiz.qs.length +
        ' &nbsp;·&nbsp; <span class="pill dim">' + esc(q.category) + '</span></div>' +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
        (q.context ? '<div class="passage">' + esc(ruText('context', q.context)) + '</div>' : '') +
        (q.image ? '<div class="diagram"><a href="' + esc(q.image) + '" target="_blank" rel="noopener"><img src="' + esc(q.image) + '" alt="diagram" loading="lazy"></a></div>' : '') +
        '<div class="qstem">' + fmtStem(ruText('stem', q.stem)) + '</div>' +
        '<div id="opts">' + opts + '</div>' +
        '<div class="explain" id="ex"></div>' +
        '<div class="row spread" style="margin-top:.9rem">' +
          '<button class="btn ghost" data-act="home">Quit</button>' +
          '<button class="btn" id="actBtn" ' + (quiz.locked ? '' : 'disabled') + '>Check answer</button>' +
        '</div>' +
      '</div>';

    var optsBox = document.getElementById('opts');
    var actBtn = document.getElementById('actBtn');
    Array.prototype.forEach.call(optsBox.querySelectorAll('.opt'), function (el) {
      el.addEventListener('click', function () {
        if (quiz.locked) return;
        quiz.picked = parseInt(el.getAttribute('data-v'), 10);
        Array.prototype.forEach.call(optsBox.querySelectorAll('.opt'), function (x) {
          x.classList.toggle('sel', x === el);
        });
        actBtn.disabled = false;
      });
    });
    actBtn.addEventListener('click', function () {
      if (!quiz.locked) {
        if (quiz.picked == null) return;
        quiz.locked = true;
        var correct = quiz.picked === q.answer;
        if (correct) quiz.score++;
        quiz.results.push({ q: q, picked: quiz.picked, correct: correct });
        recordAnswer({ q: q, correct: correct });
        Array.prototype.forEach.call(optsBox.querySelectorAll('.opt'), function (x) {
          var v = parseInt(x.getAttribute('data-v'), 10);
          if (v === q.answer) x.classList.add('correct');
          else if (v === quiz.picked) x.classList.add('wrong');
          else x.classList.add('dim');
        });
        var ansTxt = ruText('opts', q.options.filter(function (o) { return o.v === q.answer; })[0].text);
        var ex = document.getElementById('ex');
        var html = '<span class="a">' + (correct ? '✓ Correct!' : '✗ Not quite.') +
          ' Answer: ' + q.answer + ' — ' + esc(ansTxt) + '</span>';
        if (q.marked) html += '<br><span class="frag">Correct fragment: ' + esc(ruText('marks', q.marked)) + '</span>';
        if (q.answer_sentence) html += '<br><span class="hint">Completed: ' + esc(ruText('ans', q.answer_sentence)) + '</span>';
        if (q.verified) html += ' &nbsp;<span class="pill ok">✓ key-checked</span>';
        else html += ' &nbsp;<span class="pill warn">⚑ confirmed by hand</span>';
        ex.innerHTML = html;
        ex.classList.add('show');
        actBtn.textContent = (quiz.i + 1 < quiz.qs.length) ? 'Next question →' : 'See results →';
      } else {
        quiz.i++;
        quiz.picked = null;
        quiz.locked = false;
        saveActiveQuiz();
        renderQuiz();
      }
    });
    app.querySelector('[data-act="home"]').addEventListener('click', function () {
      quiz = null; setView('home');
    });
  }

  // ================= RESULTS =================
  function renderResults() {
    if (!quiz) return renderQuizSetup();
    var n = quiz.qs.length;
    var sc = quiz.score;
    var pct = n ? Math.round(100 * sc / n) : 0;
    var secs = Math.round((Date.now() - quiz.started) / 1000);
    var msg = pct >= 90 ? 'Excellent — 素晴らしい！ 🎉' : pct >= 70 ? 'Great job! 💪' :
      pct >= 50 ? 'Good effort — keep going. 📖' : 'Keep practicing — you will get there. 🌱';

    var review = quiz.results.map(function (r, idx) {
      var q = r.q;
      var yourTxt = ruText('opts', q.options.filter(function (o) { return o.v === r.picked; })[0].text);
      var ansTxt = ruText('opts', q.options.filter(function (o) { return o.v === q.answer; })[0].text);
      var _ctx = q.context ? '<div class="passage sm">' + esc(ruText('context', q.context)) + '</div>' : '';
      var _img = q.image ? '<div class="diagram sm"><a href="' + esc(q.image) + '" target="_blank" rel="noopener"><img src="' + esc(q.image) + '" alt="diagram" loading="lazy"></a></div>' : '';
      return '<div class="mini">' + _ctx + _img +
        '<div class="st"><span class="ic ' + (r.correct ? 'ok-ic">✓' : 'bad-ic">✗') + '</span> ' +
        (idx + 1) + '. ' + fmtStem(ruText('stem', q.stem)) + '</div>' +
        '<div class="hint">Your answer: ' + esc(yourTxt) +
        (r.correct ? '' : ' &nbsp;·&nbsp; <b>Correct: ' + esc(ansTxt) + '</b>') + '</div>' +
        (q.answer_sentence ? '<div class="hint">' + esc(ruText('ans', q.answer_sentence)) + '</div>' : '') +
        '</div>';
    }).join('');

    app.innerHTML =
      '<div class="card result">' +
        '<div class="big">' + sc + ' / ' + n + '</div>' +
        '<div style="font-size:1.1rem;margin:.2rem 0">' + pct + '% correct</div>' +
        '<p class="sub">' + msg + ' &nbsp;·&nbsp; ' + secs + 's</p>' +
        '<div class="row" style="justify-content:center;margin-top:1rem">' +
          '<button class="btn" id="retryBtn">Retry these</button>' +
          '<button class="btn ghost" id="againBtn">New random 10</button>' +
          '<button class="btn ghost" id="homeBtn">Home</button>' +
        '</div>' +
      '</div>' +
      '<div class="card review"><h2>Review</h2>' + review + '</div>';

    document.getElementById('retryBtn').addEventListener('click', function () {
      var cfg = quiz.cfg; startQuiz(cfg);
    });
    document.getElementById('againBtn').addEventListener('click', function () {
      startQuiz({ mode: 'random', category: quiz.cfg.category || 'all', count: 10 });
    });
    document.getElementById('homeBtn').addEventListener('click', function () { quiz = null; setView('home'); });
  }

  // ================= STUDY / FLASHCARDS =================
  function renderStudy() {
    if (!flash) {
      flash = { set: 'vocab', i: 0, order: [], known: profile.flashKnown || {} };
      // Сохраняем инициализированные данные в localStorage при первом запуске
      saveProfile();
    }
    var sets = [
      { k: 'vocab', label: 'Vocabulary', jp: '語彙', n: FC.vocab.length },
      { k: 'kanji', label: 'Kanji', jp: '漢字', n: FC.kanji.length },
      { k: 'grammar', label: 'Grammar', jp: '文法', n: FC.grammar.length }
    ];
    var seg = sets.map(function (s) {
      return '<button data-s="' + s.k + '" class="' + (flash.set === s.k ? 'active' : '') + '">' +
        s.jp + ' ' + s.label + ' (' + s.n + ')</button>';
    }).join('');
    app.innerHTML =
      '<div class="card">' +
        '<h2>Study mode 🗂️</h2>' +
        '<p class="sub">Flip cards to self-test. Mark the ones you know and they will be skipped in review order.</p>' +
        '<div class="seg" id="setSeg" style="margin-top:.9rem">' + seg + '</div>' +
      '</div>' +
      '<div id="fcMount"></div>';
    document.getElementById('setSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      flash.set = b.getAttribute('data-s');
      flash.i = 0; flash.order = [];
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) {
        x.classList.toggle('active', x === b);
      });
      renderFlash();
    });
    renderFlash();
  }

  function currentDeck() {
    return flash.set === 'vocab' ? FC.vocab : flash.set === 'kanji' ? FC.kanji : FC.grammar;
  }
  function flashFrontBack(card) {
    if (flash.set === 'vocab') return { f: card.front, b: ruText('vocabBack', card.back), sub: (card.type ? ruText('vocabType', card.type) : '') + (card.notes ? ' · ' + ruText('vocabNotes', card.notes) : '') };
    if (flash.set === 'kanji') return { f: card.front, b: (card.back ? card.back : '') + (card.meaning ? ' · ' + ruText('kanjiMeaning', card.meaning) : ''), sub: 'base: ' + card.char };
    return { f: card.front, b: ruText('grammarBack', card.back), sub: card.id ? ('id: ' + ruText('grammarId', card.id)) : '' };
  }
  function flashGetKey(index) { return flashKey(flash.set, index); }
  function flashIsKnown(index) { return !!profile.flashKnown[flashGetKey(index)]; }
  function flashGetSrsStatus(index) { return profile.srsData[flashGetKey(index)]; }
  function flashGetSrsStatusText(srs) {
    if (!srs || !srs.nextReview) return '';
    var now = Date.now();
    if (srs.nextReview <= now) return 'Due today';
    var days = Math.max(1, Math.ceil((srs.nextReview - now) / (24 * 60 * 60 * 1000)));
    if (days === 1) return 'Due tomorrow';
    if (days < 7) return days + ' days';
    var weeks = Math.floor(days / 7);
    return weeks + (weeks === 1 ? ' week' : ' weeks') + ' left';
  }
  function renderFlash() {
    if (flash.dueQueue && !flash.dueQueue.length) {
      document.getElementById('fcMount').innerHTML = '<div class="empty">All due flashcards reviewed.</div>';
      return;
    }
    var dueItem = flash.dueQueue ? flash.dueQueue[flash.i] : null;
    if (dueItem) flash.set = dueItem.set;
    var deck = currentDeck();
    if (!deck.length) { document.getElementById('fcMount').innerHTML = '<div class="empty">No cards.</div>'; return; }
    var order = flash.dueQueue ? [] : (flash.order.length ? flash.order : deck.map(function (_, i) { return i; }));
    flash.order = order;
    if (!flash.dueQueue && flash.i >= order.length) flash.i = 0;
    var cardIndex = dueItem ? dueItem.index : order[flash.i];
    var card = deck[cardIndex];
    var fb = flashFrontBack(card);
    var key = flashKey(flash.set, cardIndex);
    var profileState = profile.srsData[key] || {};
    var isKnown = !!profile.flashKnown[key];
    var dueText = flashGetSrsStatusText(profileState);
    var cardCount = flash.dueQueue ? flash.dueQueue.length : deck.length;
    
    document.getElementById('fcMount').innerHTML =
      '<div class="card fcwrap">' +
        '<div class="meter">Card ' + (flash.i + 1) + ' / ' + cardCount + (isKnown ? ' &nbsp;<span class="pill ok">known</span>' : '') + '</div>' +
        '<div class="fc' + (flash._flipped ? ' flip' : '') + '" id="fc" style="margin-top:.8rem">' +
          '<div class="face front"><div><div class="txt">' + esc(fb.f) + '</div><div class="sub2">tap to reveal</div></div></div>' +
          '<div class="face back"><div><div class="txt">' + esc(fb.b) + '</div><div class="sub2">' + esc(fb.sub) + '</div></div></div>' +
        '</div>' +
        '<div class="knownrow">' +
          '<button class="btn ghost" id="prevBtn">← Prev</button>' +
          '<div style="display:flex;gap:.5rem">' +
            '<button class="btn ghost srs-btn" data-s="unknown">✗ Не помню</button>' +
            '<button class="btn ghost srs-btn" data-s="difficult">Сложно</button>' +
            '<button class="btn srs-btn known-btn" data-s="known">✓ Знаю</button>' +
          '</div>' +
          '<button class="btn" id="nextBtn">Next →</button>' +
        '</div>' +
        '<div class="row" style="justify-content:center;margin-top:.7rem"' + (flash.dueQueue ? ' hidden' : '') + '>' +
          '<button class="btn ghost" id="shuffleBtn">🔀 Shuffle</button>' +
        '</div>' +
        (dueText ? '<p class="hint" style="margin-top:.5rem">' + dueText + '</p>' : '');
    document.getElementById('fc').addEventListener('click', function () { flash._flipped = !flash._flipped; this.classList.toggle('flip', flash._flipped); });
    document.getElementById('prevBtn').addEventListener('click', function () {
      var count = flash.dueQueue ? flash.dueQueue.length : order.length;
      flash.i = (flash.i - 1 + count) % count; flash._flipped = false; renderFlash();
    });
    document.getElementById('nextBtn').addEventListener('click', function () {
      var count = flash.dueQueue ? flash.dueQueue.length : order.length;
      flash.i = (flash.i + 1) % count; flash._flipped = false; renderFlash();
    });
    var shuffleBtn = document.getElementById('shuffleBtn');
    if (shuffleBtn) shuffleBtn.addEventListener('click', function () { flash.order = shuffle(deck.map(function (_, i) { return i; })); flash.i = 0; flash._flipped = false; renderFlash(); });
    Array.prototype.forEach.call(document.querySelectorAll('.srs-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var status = this.getAttribute('data-s');
        markCardKnown(flash.set, cardIndex, status);
        if (flash.dueQueue) {
          flash.dueQueue.splice(flash.i, 1);
          if (flash.i >= flash.dueQueue.length) flash.i = 0;
        }
        renderFlash();
      });
    });
  }
  
  function getDueDate(nextReview) {
    var now = Date.now();
    if (nextReview <= now) return 'Today';
    var days = Math.max(1, Math.ceil((nextReview - now) / (24 * 60 * 60 * 1000)));
    if (days === 1) return 'Tomorrow';
    if (days < 7) return days + ' days';
    var weeks = Math.floor(days / 7);
    return weeks + (weeks === 1 ? ' week' : ' weeks');
  }

  // ================= ROUTER =================
  function render() {
    sub.textContent = LEVEL.toUpperCase() + ' · ' + TOTAL + ' questions · ' + VERIFIED + '/' + TOTAL + ' key-verified · ' +
      (FC.vocab.length + FC.kanji.length + FC.grammar.length) + ' flashcards';
    if (view === 'home') renderHome();
    else if (view === 'quiz') { quiz ? renderQuiz() : renderQuizSetup(); }
    else if (view === 'exam') { exam ? renderExam() : renderExamSetup(); }
    else if (view === 'study') renderStudy();
  }
  render();
  translateUI(nav);
  translateUI(app);
  translateUI(document.querySelector('.topbar'));
  translateUI(document.querySelector('.foot'));

// ================= EXAM MODE =================
  function renderExamSetup() {
    app.innerHTML =
      '<div class="card">' +
        '<h2>Exam mode ⏱️</h2>' +
        '<p class="sub">Timed exam with fixed questions, no instant feedback.</p>' +
        '<div class="seg" id="examModeSeg" style="margin-top:.9rem">' +
          '<button data-m="mixed" class="active">Mixed</button>' +
          '<button data-m="category">Category</button>' +
        '</div>' +
        '<div class="row" style="margin-top:1rem">' +
          '<label>Questions</label>' +
          '<select id="examCount">' +
            '<option value="10">10</option><option value="20" selected>20</option>' +
            '<option value="30">30</option><option value="50">50</option>' +
          '</select>' +
        '</div>' +
        '<div class="row" style="margin-top:.8rem">' +
          '<label>Time limit</label>' +
          '<select id="examTime">' +
            '<option value="600">10 minutes</option>' +
            '<option value="1200">20 minutes</option>' +
            '<option value="1800" selected>30 minutes</option>' +
            '<option value="2700">45 minutes</option>' +
            '<option value="3600">60 minutes</option>' +
          '</select>' +
        '</div>' +
        '<div class="row" style="margin-top:1rem">' +
          '<label id="catLabel" style="display:none">Category</label>' +
          '<select id="examCat" style="display:none"></select>' +
        '</div>' +
        '<div class="row" style="margin-top:1.1rem">' +
          '<button class="btn" id="startExamBtn">Start exam</button>' +
          '<button class="btn ghost" id="resumeExamBtn">Resume</button>' +
          '<button class="btn ghost" data-act="home">Back</button>' +
        '</div>' +
        '<p class="hint" id="examHint"></p>' +
      '</div>';

    var examCat = document.getElementById('examCat');
    examCat.innerHTML = '<option value="all">All categories</option>' +
      CATS.map(function (c) { return '<option value="' + c.key + '">' + c.label + ' (' + c.jp + ')</option>'; }).join('');
    
    var examHint = document.getElementById('examHint');
    
    document.getElementById('examModeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var mode = b.getAttribute('data-m');
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) {
        x.classList.toggle('active', x === b);
      });
      var showCat = mode === 'category';
      document.getElementById('catLabel').style.display = showCat ? '' : 'none';
      examCat.style.display = showCat ? '' : 'none';
      if (showCat) {
        var cat = examCat.value;
        var pool = cat === 'all' ? TOTAL : countByCat(cat);
        examHint.textContent = 'Random ' + document.getElementById('examCount').value + ' questions from ' +
          (cat === 'all' ? 'all categories' : CATMAP[cat].label) + ' (' + pool + ' available).';
      } else {
        examHint.textContent = 'Random ' + document.getElementById('examCount').value + ' questions from all categories.';
      }
    });
    
    document.getElementById('examCount').addEventListener('change', function () {
      var cat = document.getElementById('examCat').value;
      var pool = cat === 'all' ? TOTAL : countByCat(cat);
      examHint.textContent = 'Random ' + this.value + ' questions from ' +
        (cat === 'all' ? 'all categories' : CATMAP[cat].label) + ' (' + pool + ' available).';
    });
    
    examCat.addEventListener('change', function () {
      var cat = this.value;
      var pool = cat === 'all' ? TOTAL : countByCat(cat);
      examHint.textContent = 'Random ' + document.getElementById('examCount').value + ' questions from ' +
        (cat === 'all' ? 'all categories' : CATMAP[cat].label) + ' (' + pool + ' available).';
    });

    app.querySelector('[data-act="home"]').addEventListener('click', function () { setView('home'); });
    
    var saved = activeExam();
    if (saved) {
      document.getElementById('resumeExamBtn').style.display = '';
      document.getElementById('resumeExamBtn').addEventListener('click', function () {
        if (restoreActiveExam()) setView('exam');
      });
    } else {
      document.getElementById('resumeExamBtn').style.display = 'none';
    }
    
    document.getElementById('startExamBtn').addEventListener('click', function () {
      var isCategory = document.getElementById('examModeSeg').querySelector('.active').getAttribute('data-m') === 'category';
      var cat = isCategory ? document.getElementById('examCat').value : null;
      startExamMode({
        category: cat,
        count: parseInt(document.getElementById('examCount').value, 10),
        timeLimit: parseInt(document.getElementById('examTime').value, 10)
      });
    });
  }

  function renderExam() {
    if (!exam) return renderExamSetup();
    if (exam.i >= exam.qs.length) return renderExamResults();
    
    var q = exam.qs[exam.i];
    var pct = Math.round(100 * (exam.i) / exam.qs.length);
    
    function formatTime(seconds) {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    
    var timeLeft = exam.timeLeft > 0 ? exam.timeLeft : 0;
    
    var opts = q.options.map(function (o) {
      return '<div class="opt' + (exam && exam.locked ? ' dim' : '') + '" data-v="' + o.v + '" role="radio" aria-checked="false">' +
        '<span class="mark">' + o.v + '</span><span class="txt">' + esc(ruText('opts', o.text)) + '</span></div>';
    }).join('');
    
    app.innerHTML =
      '<div class="card qcard">' +
        '<div class="meter"><b>' + esc(exam.label) + '</b> &nbsp;·&nbsp; Question ' + (exam.i + 1) + ' / ' + exam.qs.length +
        ' &nbsp;·&nbsp; <span class="pill dim">' + esc(q.category) + '</span> &nbsp;·&nbsp; <span class="icon">⏱ ' + formatTime(timeLeft) + '</span></div>' +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
        (q.context ? '<div class="passage">' + esc(ruText('context', q.context)) + '</div>' : '') +
        (q.image ? '<div class="diagram"><a href="' + esc(q.image) + '" target="_blank" rel="noopener"><img src="' + esc(q.image) + '" alt="diagram" loading="lazy"></a></div>' : '') +
        '<div class="qstem">' + fmtStem(ruText('stem', q.stem)) + '</div>' +
        '<div id="opts" role=" radiogroup" aria-label="Answers">' + opts + '</div>' +
        '<div class="explain" id="ex"></div>' +
        '<div class="row spread" style="margin-top:.9rem">' +
          '<button class="btn ghost" data-act="home">Quit</button>' +
          '<button class="btn" id="actBtn" ' + (exam.locked ? '' : 'disabled') + '>Check answer</button>' +
        '</div>' +
      '</div>';

    var optsBox = document.getElementById('opts');
    var actBtn = document.getElementById('actBtn');
    
    optsBox.addEventListener('keydown', function (e) {
      if (exam.locked) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        var all = optsBox.querySelectorAll('.opt');
        var curr = optsBox.querySelector('.opt.sel');
        var idx = curr ? Array.prototype.indexOf.call(all, curr) : -1;
        if (idx < 0 || idx >= all.length - 1) optsBox.querySelector('.opt').click();
        else all[idx + 1].click();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var all = optsBox.querySelectorAll('.opt');
        var curr = optsBox.querySelector('.opt.sel');
        var idx = curr ? Array.prototype.indexOf.call(all, curr) : -1;
        if (idx <= 0) all[all.length - 1].click();
        else all[idx - 1].click();
      } else if (e.key === 'Enter' && !exam.locked) {
        actBtn.click();
      }
    });
    
    Array.prototype.forEach.call(optsBox.querySelectorAll('.opt'), function (el) {
      el.addEventListener('click', function () {
        if (exam.locked) return;
        exam.picked = parseInt(el.getAttribute('data-v'), 10);
        Array.prototype.forEach.call(optsBox.querySelectorAll('.opt'), function (x) {
          x.classList.toggle('sel', x === el);
          x.setAttribute('aria-checked', x === el ? 'true' : 'false');
        });
        actBtn.disabled = false;
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
    });
    
    var timeInterval = setInterval(function () {
      if (exam && exam.timeLeft > 0) {
        exam.timeLeft--;
        var el = document.querySelector('.meter .icon');
        if (el) el.textContent = '⏱ ' + formatTime(exam.timeLeft);
      } else if (exam && exam.timeLeft <= 0) {
        clearInterval(timeInterval);
        exam.locked = true;
        exam.i = exam.qs.length;
        renderExamResults();
      }
    }, 1000);
    
    actBtn.addEventListener('click', function () {
      if (!exam.locked) {
        if (exam.picked == null) return;
        exam.locked = true;
        clearInterval(timeInterval);
        var correct = exam.picked === q.answer;
        if (correct) exam.score++;
        exam.results.push({ q: q, picked: exam.picked, correct: correct });
        recordAnswer({ q: q, correct: correct });
        Array.prototype.forEach.call(optsBox.querySelectorAll('.opt'), function (x) {
          var v = parseInt(x.getAttribute('data-v'), 10);
          x.classList.add('dim');
          if (v === q.answer) x.classList.add('correct');
          else if (v === exam.picked) x.classList.add('wrong');
        });
        var ansTxt = ruText('opts', q.options.filter(function (o) { return o.v === q.answer; })[0].text);
        var ex = document.getElementById('ex');
        var html = '<span class="a">' + (correct ? '✓ Correct!' : '✗ Not quite.') +
          ' Answer: ' + q.answer + ' — ' + esc(ansTxt) + '</span>';
        if (q.marked) html += '<br><span class="frag">Correct fragment: ' + esc(ruText('marks', q.marked)) + '</span>';
        if (q.answer_sentence) html += '<br><span class="hint">Completed: ' + esc(ruText('ans', q.answer_sentence)) + '</span>';
        if (q.verified) html += ' &nbsp;<span class="pill ok">✓ key-checked</span>';
        else html += ' &nbsp;<span class="pill warn">⚑ confirmed by hand</span>';
        ex.innerHTML = html;
        ex.classList.add('show');
        actBtn.textContent = (exam.i + 1 < exam.qs.length) ? 'Next question →' : 'See results →';
      } else {
        exam.i++;
        exam.picked = null;
        exam.locked = false;
        saveActiveExam();
        renderExam();
      }
    });
    
    app.querySelector('[data-act="home"]').addEventListener('click', function () {
      clearInterval(timeInterval);
      exam = null; setView('home');
    });
  }

  function renderExamResults() {
    if (!exam) return renderExamSetup();
    var n = exam.qs.length;
    var sc = exam.score;
    var pct = n ? Math.round(100 * sc / n) : 0;
    var secs = Math.round((Date.now() - exam.started) / 1000);
    var msg = pct >= 90 ? 'Excellent — 素晴らしい！ 🎉' : pct >= 70 ? 'Great job! 💪' :
      pct >= 50 ? 'Good effort — keep going. 📖' : 'Keep practicing — you will get there. 🌱';

    var byCategory = {};
    CATS.forEach(function (c) { byCategory[c.key] = { total: 0, correct: 0 }; });
    exam.results.forEach(function (r) {
      var cat = r.q.category;
      if (byCategory[cat]) {
        byCategory[cat].total++;
        if (r.correct) byCategory[cat].correct++;
      }
    });

    var review = exam.results.map(function (r, idx) {
      var q = r.q;
      var yourTxt = ruText('opts', q.options.filter(function (o) { return o.v === r.picked; })[0].text);
      var ansTxt = ruText('opts', q.options.filter(function (o) { return o.v === q.answer; })[0].text);
      var _ctx = q.context ? '<div class="passage sm">' + esc(ruText('context', q.context)) + '</div>' : '';
      var _img = q.image ? '<div class="diagram sm"><a href="' + esc(q.image) + '" target="_blank" rel="noopener"><img src="' + esc(q.image) + '" alt="diagram" loading="lazy"></a></div>' : '';
      return '<div class="mini">' + _ctx + _img +
        '<div class="st"><span class="ic ' + (r.correct ? 'ok-ic">✓' : 'bad-ic">✗') + '</span> ' +
        (idx + 1) + '. ' + fmtStem(ruText('stem', q.stem)) + '</div>' +
        '<div class="hint">Your answer: ' + esc(yourTxt) +
        (r.correct ? '' : ' &nbsp;·&nbsp; <b>Correct: ' + esc(ansTxt) + '</b>') + '</div>' +
        (q.answer_sentence ? '<div class="hint">' + esc(ruText('ans', q.answer_sentence)) + '</div>' : '') +
        '</div>';
    }).join('');

    var catStats = CATS.map(function (c) {
      var data = byCategory[c.key];
      var total = data.total || 0;
      var correct = data.correct || 0;
      var catPct = total ? Math.round(100 * correct / total) : 0;
      var catColor = catPct >= 80 ? '#1f9d55' : catPct >= 50 ? '#f59e0b' : '#d64545';
      return '<div class="statchart">' +
        '<div class="statchart-row">' +
          '<span class="statchart-label">' + c.label + '</span>' +
          '<span class="v">' + catPct + '% (' + correct + '/' + total + ')</span>' +
        '</div>' +
        '<div class="statchart-bar"><i style="width:' + catPct + '%;background:' + catColor + '"></i></div>' +
      '</div>';
    }).join('');

    app.innerHTML =
      '<div class="card result">' +
        '<div class="big">' + sc + ' / ' + n + '</div>' +
        '<div style="font-size:1.1rem;margin:.2rem 0">' + pct + '% correct</div>' +
        '<p class="sub">' + msg + ' &nbsp;·&nbsp; ' + secs + 's</p>' +
        '<div class="row" style="justify-content:center;margin-top:1rem">' +
          '<button class="btn" id="retryExamBtn">Retry these</button>' +
          '<button class="btn ghost" id="newExamBtn">New random 20</button>' +
          '<button class="btn ghost" id="homeBtn">Home</button>' +
        '</div>' +
      '</div>' +
      '<div class="card result">' +
        '<h2>Results by category</h2>' +
        '<div class="grid" style="margin-top:1rem">' + catStats + '</div>' +
      '</div>' +
      '<div class="card review"><h2>Review</h2>' + review + '</div>';

    document.getElementById('retryExamBtn').addEventListener('click', function () {
      var cfg = exam.cfg; startExamMode(cfg);
    });
    document.getElementById('newExamBtn').addEventListener('click', function () {
      startExamMode({ category: exam.cfg.category, count: 20, timeLimit: 1800 });
    });
    document.getElementById('homeBtn').addEventListener('click', function () { exam = null; setView('home'); });
  }

  if (!window.JLPT_PRACTICE_EXAM_EXPOSED) {
    window.JLPT_PRACTICE_EXAM_EXPOSED = true;
    if (window.exposeExamFunctions) exposeExamFunctions({ startExamMode: startExamMode });
  }
})();
