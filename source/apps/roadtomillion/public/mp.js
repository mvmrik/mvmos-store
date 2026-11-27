/*
 * Road to a Million — the game, client side.
 *
 * Runs on Game Hub's public play page. The server owns the questions, the
 * lifelines and the money; it sends the order the answers are shown in and the
 * text of each question arrives with it, already in the player's language.
 *
 *   pick      choose three specialists and four countries to ask later
 *   question  everybody still in answers the same question, may use a lifeline
 *             (fifty, a specialist, a country) or take the money and leave
 *   reveal    the right answer, then who got it
 */
(function () {
  'use strict';
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'roadtomillion';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;
  const _t = (k, v) => (window.t ? window.t(k, v) : k);
  const TIMES = [20, 30, 45, 60, 90];
  const LETTERS = ['A', 'B', 'C', 'D'];
  const PRO_ICON = { math: '🧮', history: '🏛️', medicine: '🩺', astronomy: '🔭', law: '⚖️', geography: '🌍', engineering: '⚙️', literature: '📚', arts: '🎭', sport: '🏅' };
  const CAT_ICON = { geography: '🗺️', history: '🏺', science: '🔬', nature: '🌿', literature: '📖', arts: '🎨', sport: '⚽', technology: '💡', society: '🏛️', everyday: '🍽️' };
  const LANG_COUNTRY = { bg: 'BG', de: 'DE', en: 'US', es: 'ES', fr: 'FR', ja: 'JP', 'pt-BR': 'BR', ru: 'RU', 'zh-CN': 'CN' };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const _nf = (() => {
    try { return new Intl.NumberFormat(document.documentElement.lang || navigator.language || 'en'); }
    catch (_) { return new Intl.NumberFormat('en'); }
  })();
  const fmt = n => _nf.format(n);
  const flag = cc => String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  const lang = () => (window.mvmOS && window.mvmOS.lang) || 'en';
  const asset = u => (window.asset ? window.asset(u) : u);

  // ── Sound ──────────────────────────────────────────────────────────────────
  let _muted = store.get('rm_muted', '0') === '1';
  let _ac = null;
  function _tone(freq, dur, type, gain, when) {
    if (_muted) return;
    try {
      _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = _ac.currentTime + (when || 0);
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(_ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (_) {}
  }
  const sfx = {
    tick() { _tone(520, 0.05, 'triangle', 0.06); },
    pick() { _tone(440, 0.08, 'triangle', 0.1); _tone(660, 0.1, 'triangle', 0.09, 0.06); },
    joker() { [392, 523, 659, 784].forEach((f, i) => _tone(f, 0.14, 'sine', 0.1, i * 0.07)); },
    right() { [523, 659, 784, 1046].forEach((f, i) => _tone(f, 0.2, 'sine', 0.13, i * 0.1)); },
    wrong() { _tone(220, 0.4, 'sawtooth', 0.07); _tone(150, 0.5, 'sawtooth', 0.06, 0.15); },
    quit() { _tone(660, 0.12, 'sine', 0.12); _tone(880, 0.2, 'sine', 0.11, 0.1); },
    win() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => _tone(f, 0.26, 'sine', 0.13, i * 0.12)); },
  };

  // ── Lobby: what the host chooses ───────────────────────────────────────────
  function renderSetup(box, settings) {
    const s = Object.assign({ time: +store.get('rm_time', 45) }, settings || {});
    let cur = TIMES.indexOf(+s.time) !== -1 ? +s.time : 45;
    // A solo room has no clock, so nothing to choose.
    const page = box.parentNode && box.parentNode.parentNode;
    if (page && !page.querySelector('#gh-lobby-icol')) {
      box.style.display = 'none';
      return () => ({ time: cur });
    }
    box.className = 'rm-setup';
    box.innerHTML = '<div class="rm-setup-l">⏱ ' + _esc(_t('rm_setup_time')) + '</div><div class="rm-pills" role="radiogroup"></div>';
    const row = box.querySelector('.rm-pills');
    const paint = () => row.querySelectorAll('.rm-pill').forEach(b => {
      const on = +b.dataset.v === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    TIMES.forEach(v => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rm-pill'; b.dataset.v = v; b.setAttribute('role', 'radio');
      b.textContent = _t('rm_time_short', { n: v });
      b.onclick = () => { cur = v; paint(); };
      row.appendChild(b);
    });
    paint();
    return () => { store.set('rm_time', String(cur)); return { time: cur }; };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _root = null, _sm = null, _ready = false, _queue = [], _gen = 0;
  let S = null, el = {}, _tick = 0, _deadline = 0, _qdur = 0;
  const _timers = new Set();
  const meId = () => mp.youId();
  const playerOf = id => mp.players().find(p => p.id === id) || { id: id, display_name: '?' };
  const later = (fn, ms) => { const h = setTimeout(() => { _timers.delete(h); fn(); }, ms); _timers.add(h); return h; };
  const clearLater = () => { _timers.forEach(clearTimeout); _timers.clear(); };

  function renderGame(root) {
    _root = root; _ready = false;
    root.innerHTML =
      '<div class="rm-wrap">' +
        '<div class="rm-top"><span class="rm-cat" hidden></span><span class="rm-sums" hidden></span><div class="rm-players"></div><div class="rm-tools">' +
          '<button class="rm-snd" data-snd title="' + _esc(_t('rm_sound')) + '"></button></div></div>' +
        '<div class="rm-body">' +
          '<aside class="rm-ladder"></aside>' +
          '<main class="rm-main">' +
            '<div class="rm-strip"></div>' +
            '<div class="rm-stage"></div>' +
          '</main>' +
        '</div><div class="rm-toasts"></div>' +
      '</div>';
    el = {
      wrap: root.querySelector('.rm-wrap'), players: root.querySelector('.rm-players'), cat: root.querySelector('.rm-cat'), sums: root.querySelector('.rm-sums'),
      ladder: root.querySelector('.rm-ladder'), strip: root.querySelector('.rm-strip'),
      stage: root.querySelector('.rm-stage'), toasts: root.querySelector('.rm-toasts'), over: null,
    };
    // On a phone the ladder is hidden; the question-and-progress strip opens it.
    el.strip.onclick = () => { el.ladder.classList.toggle('open'); el.strip.classList.toggle('open', el.ladder.classList.contains('open')); };
    el.ladder.onclick = () => { el.ladder.classList.remove('open'); el.strip.classList.remove('open'); };
    const snd = root.querySelector('[data-snd]');
    const paintSnd = () => { snd.textContent = _muted ? '🔇' : '🔊'; };
    snd.onclick = () => { _muted = !_muted; store.set('rm_muted', _muted ? '1' : '0'); paintSnd(); sfx.tick(); };
    paintSnd();
    el.stage.innerHTML = '<div class="rm-wait">' + _esc(_t('rm_waiting')) + '</div>';
    clearInterval(_tick);
    _tick = setInterval(paintClock, 200);
    if (_sm) init();
  }

  function init() {
    const sm = _sm, gen = ++_gen;
    clearLater();
    _ready = false;
    if (el.over) { el.over.remove(); el.over = null; }
    S = {
      ladder: sm.ladder, safe: sm.safe, solo: !!sm.solo, order: sm.order, phase: sm.phase, time: sm.time,
      specs: [], countries: [], used: new Set(), removed: new Set(), log: [],
      players: {}, q: null, text: null, sel: null, done: false, n: sm.n || 0,
      reveal: null, pickSpecs: [], pickCountries: [], picked: new Set(sm.picked || []),
      tray: null, compassPending: false, quitArm: false, over: !!sm.over,
    };
    sm.players.forEach(p => { S.players[p.pid] = { status: p.status, amount: p.amount, answered: p.answered, ready: !!p.ready, jokers: p.jokers || [] }; });
    if (sm.mine) {
      S.specs = sm.mine.specs; S.countries = sm.mine.countries;
      sm.mine.used.forEach(u => S.used.add(u));
      sm.mine.removed.forEach(r => S.removed.add(r));
      S.log = sm.mine.log || [];
    }
    _deadline = sm.left > 0 ? performance.now() + sm.left * 1000 : 0;
    _qdur = sm.time || 0;
    buildLadder();
    paintPlayers();
    _ready = true;
    mp.send({ type: 'rm_lang', lang: lang() });
    const me = S.players[meId()];
    if (sm.phase === 'pick') {
      if (me && me.status !== 'pick') paintStage(); else showPick();
    } else if (sm.q) {
      startQuestion(sm.q, true).then(() => {
        if (gen !== _gen) return;
        S.log.forEach(r => applyJoker(r, true));
        if (sm.phase === 'reveal' && sm.reveal) showReveal(sm.reveal, true);
        if (me && me.ready) S.done = true;
        paintStage();
      });
    }
    if (sm.over && sm.results) showOver(sm.results);
    const q = _queue; _queue = [];
    q.forEach(m => { if (gen === _gen) apply(m); });
  }

  // ── Ladder ─────────────────────────────────────────────────────────────────
  const amountFor = n => n > 0 ? Math.floor((n - 1) / S.ladder.length) * S.ladder[S.ladder.length - 1] + S.ladder[(n - 1) % S.ladder.length] : 0;
  const ladderStart = () => S.solo ? Math.floor((Math.max(1, S.n) - 1) / S.ladder.length) * S.ladder.length : 0;
  function buildLadder() {
    const L = S.ladder, start = ladderStart();
    S.ladderStart = start;
    let h = '';
    for (let i = L.length - 1; i >= 0; i--) {
      const n = start + i + 1, safe = n % S.safe === 0;
      h += '<div class="rm-step' + (safe ? ' safe' : '') + (i === L.length - 1 ? ' top' : '') + '" data-i="' + (start + i) + '" style="--rm-index:' + i + '">' +
        '<span class="no">' + n + '</span><span class="amt">' + fmt(amountFor(n)) + '</span>' + (safe ? '<span class="lock">★</span>' : '') + '</div>';
    }
    const legend = ['fifty', 'specialist', 'country', 'compass'].map(k =>
      '<div><b>' + _esc(_t('rm_j_' + k).replace(/\n/g, ' ')) + ':</b> ' + _esc(_t('rm_legend_' + k)) + '</div>'
    ).join('');
    el.ladder.innerHTML = '<div class="rm-steps">' + h + '</div><div class="rm-legend"><strong>' + _esc(_t('rm_legend_title')) + '</strong>' + legend + '</div>';
    paintLadder();
  }
  function paintLadder() {
    if (S.ladderStart !== ladderStart()) { buildLadder(); return; }
    el.ladder.querySelectorAll('.rm-step').forEach(d => {
      const i = +d.dataset.i, n = S.n;
      d.classList.toggle('cur', i + 1 === n && S.phase !== 'over');
      d.classList.toggle('past', i + 1 < n || (i + 1 === n && S.reveal && S.reveal.right != null && myRight()));
    });
    const me = S.players[meId()] || { answered: 0 };
    const next = amountFor(S.n || 1);
    el.strip.innerHTML =
      '<span class="s-n">' + _esc(_t('rm_question_n', { n: S.n || 1, total: S.ladderStart + S.ladder.length })) + '</span>' +
      '<span class="s-bar"><i style="width:' + Math.round(((S.n || 1) - S.ladderStart - 1) / S.ladder.length * 100) + '%"></i></span>' +
      '<span class="s-a">' + fmt(next || 0) + ((S.n || 1) % S.safe === 0 ? ' <span aria-hidden="true">★</span>' : '') + '</span><span class="s-c">▾</span>';
    void me;
  }
  const myRight = () => {
    const r = S.reveal && S.reveal.rows.find(x => x.pid === meId());
    return !!r && r.action === 'right';
  };

  // ── Players ────────────────────────────────────────────────────────────────
  function paintPlayers() {
    if (S.order.length < 2) { el.players.innerHTML = ''; return; }
    const me = meId();
    el.players.innerHTML = S.order.map(id => {
      const p = playerOf(id), st = S.players[id] || {};
      let sub;
      if (st.status === 'quit') sub = '<b>' + _esc(_t('rm_took', { amount: fmt(st.amount) })) + '</b>';
      else if (st.status === 'out') sub = '<span class="bad">' + _esc(_t('rm_fell', { amount: fmt(st.amount) })) + '</span>';
      else if (st.status === 'done') sub = '<b>🏆 ' + fmt(st.amount) + '</b>';
      else if (S.phase === 'pick') sub = _esc(S.picked.has(id) ? _t('rm_chosen') : _t('rm_choosing'));
      else sub = _esc(_t('rm_in_play')) + (st.ready ? ' <span class="rdy">✓</span>' : '');
      return '<div class="rm-chip' + (id === me ? ' me' : '') + (st.status === 'quit' || st.status === 'out' ? ' gone' : '') + '" data-pid="' + _esc(id) + '">' +
        mp.renderAvatar(p, 26) + '<span><span class="nm">' + _esc(p.display_name) + (id === me ? ' · ' + _esc(_t('rm_you')) : '') + '</span><span class="sub">' + sub + '</span></span></div>';
    }).join('');
  }

  function toast(text, cls) {
    const d = document.createElement('div');
    d.className = 'rm-toast' + (cls ? ' ' + cls : '');
    d.textContent = text;
    el.toasts.appendChild(d);
    later(() => d.classList.add('out'), 3200);
    later(() => d.remove(), 3800);
  }

  // ── Choices before the first question ──────────────────────────────────────
  function showPick() {
    const proList = Object.keys(PRO_ICON), ccs = _sm.countries.filter(k => k !== LANG_COUNTRY[lang()]);
    // The choices of the last game are kept in this browser, so the player can
    // start again with the same helpers or change any of them.
    const saved = (k, valid) => { try { return (JSON.parse(store.get(k, '[]')) || []).filter(x => valid.indexOf(x) >= 0).slice(0, 3); } catch (_) { return []; } };
    S.pickSpecs = saved('rm_pick_specs', proList); S.pickCountries = saved('rm_pick_countries', ccs);
    el.stage.innerHTML =
      '<div class="rm-pick"><h2>' + _esc(_t('rm_pick_title')) + '</h2><p>' + _esc(_t('rm_pick_hint')) + '</p>' +
      '<h3>' + _esc(_t('rm_pick_specs', { n: 3 })) + ' <b data-c="s">0/3</b></h3><div class="rm-grid" data-g="s"></div>' +
      '<h3>' + _esc(_t('rm_pick_countries', { n: 3 })) + ' <b data-c="c">0/3</b></h3><div class="rm-grid" data-g="c"></div>' +
      '<button class="rm-btn" data-go disabled>' + _esc(_t('rm_pick_go')) + '</button></div>';
    const gs = el.stage.querySelector('[data-g="s"]'), gc = el.stage.querySelector('[data-g="c"]');
    const go = el.stage.querySelector('[data-go]');
    const upd = () => {
      el.stage.querySelector('[data-c="s"]').textContent = S.pickSpecs.length + '/3';
      el.stage.querySelector('[data-c="c"]').textContent = S.pickCountries.length + '/3';
      go.disabled = !(S.pickSpecs.length === 3 && S.pickCountries.length === 3);
    };
    const mk = (host, key, label, arr, max) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rm-opt'; b.innerHTML = label;
      b.onclick = () => {
        const i = arr.indexOf(key);
        if (i >= 0) arr.splice(i, 1); else if (arr.length < max) arr.push(key); else return;
        b.classList.toggle('on', arr.indexOf(key) >= 0); sfx.tick(); upd();
      };
      host.appendChild(b);
    };
    proList.forEach(k => mk(gs, k, '<i>' + PRO_ICON[k] + '</i><span>' + _esc(_t('rm_pro_' + k)) + '</span>', S.pickSpecs, 3));
    ccs.forEach(k => mk(gc, k, '<i>' + flag(k) + '</i><span>' + _esc(_t('rm_cc_' + k)) + '</span>', S.pickCountries, 3));
    gs.querySelectorAll('.rm-opt').forEach((b, i) => b.classList.toggle('on', S.pickSpecs.indexOf(proList[i]) >= 0));
    gc.querySelectorAll('.rm-opt').forEach((b, i) => b.classList.toggle('on', S.pickCountries.indexOf(ccs[i]) >= 0));
    upd();
    go.onclick = () => {
      go.disabled = true;
      store.set('rm_pick_specs', JSON.stringify(S.pickSpecs));
      store.set('rm_pick_countries', JSON.stringify(S.pickCountries));
      mp.send({ type: 'rm_pick', lang: lang(), specs: S.pickSpecs, countries: S.pickCountries });
      el.stage.innerHTML = '<div class="rm-wait">' + _esc(_t('rm_pick_wait')) + '</div>';
    };
  }

  // ── A question ─────────────────────────────────────────────────────────────
  async function startQuestion(q, resume) {
    S.phase = 'question'; S.q = q; S.n = q.n; S.sel = null; S.done = false; S.reveal = null;
    S.tray = null; S.compassPending = false; S.quitArm = false;
    if (!resume) { S.removed = new Set(); S.log = []; S.advice = {}; }
    S.advice = {}; S.adv = null;
    S.text = q.text || null;      // the server sends it in this player's language
    _qdur = q.time || 0;
    if (!resume) _deadline = _qdur ? performance.now() + _qdur * 1000 : 0;
    const me = S.players[meId()];
    if (me && !resume) me.ready = false;
    Object.keys(S.players).forEach(id => {
      const pl = S.players[id];
      if (pl.status === 'pick' || pl.status === 'ready') pl.status = 'playing';
      if (!resume) pl.ready = false;
    });
    paintLadder(); paintPlayers();
    if (!resume && el.stage.querySelector('.rm-game')) swapQuestion(); else paintStage(true);
  }

  const canAct = () => S && S.phase === 'question' && !S.done && S.players[meId()] && S.players[meId()].status === 'playing';

  // Category, held/safe sums and the golden stage of a safe-sum question.
  function paintHead(q) {
    const cat = q.cat || 'everyday';
    el.cat.hidden = false;
    el.cat.textContent = (CAT_ICON[cat] || '❓') + ' ' + _t('rm_cat_' + cat);
    // What is held now (lost on a wrong answer, red) and what is safe (green).
    const held = amountFor(q.n - 1), safeAmt = amountFor(Math.floor((q.n - 1) / S.safe) * S.safe);
    el.sums.innerHTML = '<b class="risk">' + _esc(fmt(held)) + '</b><b class="safe">' + _esc(fmt(safeAmt)) + '</b>';
    el.sums.hidden = false;
    // A question that leads to a safe sum gets a golden stage.
    el.wrap.classList.toggle('safeq', q.n % S.safe === 0);
  }

  // Between two questions only the question and the answers change: the old
  // ones slide away, the texts are replaced in place and the new ones arrive.
  function swapQuestion() {
    const gen = _gen, old = el.stage.querySelector('.rm-game');
    if (!old) { paintStage(true); return; }
    el.stage.classList.add('swap');
    old.querySelectorAll('.rm-qcard, .rm-ans, .rm-float').forEach((n, i) => { n.classList.add('leave'); n.style.animationDelay = (n.classList.contains('rm-ans') ? (+n.dataset.pos || 0) * 40 : 0) + 'ms'; });
    later(() => {
      if (gen !== _gen || !S || !S.q || S.phase === 'pick') return;
      const g = el.stage.querySelector('.rm-game');
      if (!g) { paintStage(true); return; }
      const q = S.q, t = S.text;
      const lvl = g.querySelector('.rm-meta .lvl');
      if (lvl) lvl.innerHTML = _esc(_t('rm_question_n', { n: q.n, total: S.ladderStart + S.ladder.length })) + ' · <b>' + fmt(amountFor(q.n)) + '</b>';
      const card = g.querySelector('.rm-qcard');
      card.className = 'rm-qcard pop'; card.style.animationDelay = '';
      g.querySelector('.rm-q').textContent = t ? t.q : _t('rm_missing');
      g.querySelectorAll('.rm-ans').forEach((b, pos) => {
        b.className = 'rm-ans in'; b.style.animationDelay = (pos * 90) + 'ms'; b.disabled = !canAct();
        b.querySelector('.tx').textContent = t ? t.a[q.perm[pos]] : '';
      });
      const ov = g.querySelector('.rm-float');
      ov.className = 'rm-float'; ov.style.animationDelay = ''; ov.innerHTML = '';
      paintHead(q); paintActions(); paintClock(); fitQuestion();
      el.stage.classList.remove('swap');
    }, 320);
  }

  // A very long question gets a slightly smaller text instead of a scrolling screen.
  function fitQuestion() {
    const q = el.stage && el.stage.querySelector('.rm-q');
    if (!q) return;
    q.style.fontSize = '';
    let size = parseFloat(getComputedStyle(q).fontSize);
    while (size > 14 && el.stage.scrollHeight > el.stage.clientHeight + 1) { size -= 1; q.style.fontSize = size + 'px'; }
  }
  window.addEventListener('resize', () => { if (el && el.stage) fitQuestion(); });

  function paintStage(animate) {
    if (!S || !el.stage) return;
    if (S.phase === 'pick') return;
    if (!S.q) return;
    const q = S.q, t = S.text;
    const cat = q.cat || 'everyday';
    let h = '<div class="rm-game">' +
      '<div class="rm-meta"><span class="lvl">' + _esc(_t('rm_question_n', { n: q.n, total: S.ladderStart + S.ladder.length })) + ' · <b>' + fmt(amountFor(q.n)) + '</b></span></div>' +
      (S.time ? '<div class="rm-bar"><i></i></div>' : '') +
      '<div class="rm-qwrap"><div class="rm-qcard' + (animate ? ' pop' : '') + '"><div class="rm-q">' + _esc(t ? t.q : _t('rm_missing')) + '</div></div><div class="rm-float"></div></div>' +
      '<div class="rm-answers">';
    for (let pos = 0; pos < 4; pos++) {
      const idx = q.perm[pos];
      const gone = S.removed.has(pos);
      let cls = 'rm-ans' + (animate ? ' in' : '') + (gone ? ' gone' : '') + (S.sel === pos ? ' sel' : '');
      if (S.reveal) {
        if (pos === S.reveal.right) cls += ' right';
        else if (S.sel === pos) cls += ' wrong';
      }
      h += '<button class="' + cls + '" data-pos="' + pos + '" style="animation-delay:' + (pos * 90) + 'ms"' + (gone || !canAct() ? ' disabled' : '') + '>' +
        '<span class="lt">' + LETTERS[pos] + '</span><span class="tx">' + (gone ? '' : _esc(t ? t.a[idx] : '')) + '</span>' +
        '<span class="vt"></span></button>';
    }
    h += '</div><div class="rm-actions"></div></div>';
    el.stage.innerHTML = h;
    paintHead(q);
    el.stage.querySelectorAll('.rm-ans').forEach(b => { b.onclick = () => selectAnswer(+b.dataset.pos); });
    paintActions();
    if (S.reveal) paintVotes();
    paintClock();
    fitQuestion();
  }

  function selectAnswer(pos) {
    if (!canAct() || S.removed.has(pos)) return;
    if (S.tray === 'compass') {
      if (S.compassPending) return;
      S.compassPending = true;
      mp.send({ type: 'rm_joker', kind: 'compass', pos });
      return;
    }
    S.sel = pos; S.selAt = performance.now(); S.done = true; sfx.pick();
    mp.send({ type: 'rm_answer', pos: pos });
    paintStage();
  }

  function paintActions() {
    const host = el.stage.querySelector('.rm-actions');
    if (!host) return;
    host.innerHTML = '';
    const me = S.players[meId()];
    const inactive = !me || me.status !== 'playing' || S.phase !== 'question' || S.done;
    const jokersLocked = inactive || S.removed.size >= 3;
    if (jokersLocked) S.tray = null;
    const jk = document.createElement('div');
    jk.className = 'rm-jokers';
    const defs = [['fifty', '50%', _t('rm_j_fifty')], ['specialist', '✦', _t('rm_j_specialist')], ['country', '◎', _t('rm_j_country')], ['compass', '✧', _t('rm_j_compass')]];
    defs.forEach(d => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rm-jk' + (d[0] === 'fifty' ? ' half' : '') + (S.used.has(d[0]) ? ' used' : '') + (jokersLocked && !S.used.has(d[0]) ? ' unavailable' : '') + (S.tray === d[0] ? ' open' : '');
      // A used forecast lifeline stays tappable: it shows the same answer again.
      const again = (d[0] === 'specialist' || d[0] === 'country') && S.used.has(d[0]) && !jokersLocked && !!lastAdvice(d[0]);
      if (again) b.classList.add('again');
      b.disabled = jokersLocked || (S.used.has(d[0]) && !again);
      b.innerHTML = '<span class="rm-jk-mark" aria-hidden="true">' + d[1] + '</span><span class="rm-jk-label">' + _esc(d[2]) + '</span>'; 
      b.onclick = () => {
        if (S.compassPending) return;
        if (again) { S.adv = lastAdvice(d[0]); S.tray = null; paintStage(); later(() => dismissAdvice(S.adv), 6000); return; }
        if (d[0] === 'fifty') { mp.send({ type: 'rm_joker', kind: 'fifty' }); return; }
        S.tray = S.tray === d[0] ? null : d[0]; S.adv = null; paintStage();
      };
      jk.appendChild(b);
    });
    host.appendChild(jk);
    paintOver();
    const row = document.createElement('div');
    row.className = 'rm-row';
    const gain = amountFor(S.q.n - 1);
    {
      const q = document.createElement('button');
      q.className = 'rm-btn plain rm-quit' + (S.quitArm ? ' arm' : '');
      q.disabled = inactive || gain <= 0;
      q.textContent = S.quitArm ? _t('rm_quit_sure', { amount: fmt(gain) }) : _t('rm_quit', { amount: fmt(gain) });
      q.onclick = () => {
        if (!S.quitArm) { S.quitArm = true; paintActions(); later(() => { S.quitArm = false; if (canAct()) paintActions(); }, 3000); return; }
        mp.send({ type: 'rm_quit' }); S.done = true; sfx.quit(); paintStage();
      };
      row.appendChild(q);
    }
    if (row.children.length) host.appendChild(row);
  }

  // The choice of a specialist/country and their answers appear over the
  // question, so nothing below it moves. The compass makes the answers move.
  function paintOver() {
    const host = el.stage.querySelector('.rm-float');
    if (!host) return;
    host.innerHTML = '';
    const ans = el.stage.querySelector('.rm-answers');
    if (ans) ans.classList.toggle('seek', S.tray === 'compass');
    if (S.tray && S.tray !== 'compass') {
      const tr = document.createElement('div');
      tr.className = 'rm-tray';
      const list = S.tray === 'specialist' ? S.specs : S.countries;
      tr.innerHTML = '<div class="rm-tray-t">' + _esc(S.tray === 'specialist' ? _t('rm_ask_spec') : _t('rm_ask_country')) + '</div>';
      list.forEach(k => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'rm-face';
        b.innerHTML = '<i>' + (S.tray === 'specialist' ? PRO_ICON[k] : flag(k)) + '</i><span>' + _esc(S.tray === 'specialist' ? _t('rm_pro_' + k) : _t('rm_cc_' + k)) + '</span>';
        b.onclick = () => { mp.send({ type: 'rm_joker', kind: S.tray, who: k }); S.tray = null; paintActions(); };
        tr.appendChild(b);
      });
      host.appendChild(tr);
    } else if (S.adv) paintAdvice(S.adv);
  }

  // ── Lifeline results ───────────────────────────────────────────────────────
  function applyJoker(r, silent) {
    if (r.n !== S.n) return;
    S.used.add(r.kind);
    if (r.kind === 'fifty') {
      r.removed.forEach(p => S.removed.add(p));
      if (silent) return;
      sfx.joker();
      // The two wrong answers pop away one after the other, then the screen settles.
      const btns = r.removed.map(p => el.stage.querySelector('.rm-ans[data-pos="' + p + '"]')).filter(Boolean);
      paintActions();
      if (!btns.length) { paintStage(); return; }
      S.fiftyBusy = true;
      btns.forEach((b, i) => { b.disabled = true; b.style.animationDelay = (i * 380) + 'ms'; b.classList.add('poof', 'slow'); });
      later(() => { S.fiftyBusy = false; paintStage(); }, 380 * (btns.length - 1) + 900);
      return;
    }
    if (S.log.indexOf(r) < 0) S.log.push(r);
    if (silent) return;
    if (r.kind === 'compass') {
      S.compassPending = false; S.tray = null;
      if (r.correct) {
        // The compass pointed at the right answer: it is marked and counts as the answer.
        S.sel = r.pos; S.selAt = performance.now(); S.done = true; sfx.pick();
        mp.send({ type: 'rm_answer', pos: r.pos });
        paintStage();
      } else {
        S.removed.add(r.pos); sfx.joker();
        const b = el.stage.querySelector('.rm-ans[data-pos="' + r.pos + '"]');
        paintActions();
        if (b) { b.classList.add('poof'); later(() => paintStage(), 480); } else paintStage();
      }
      return;
    }
    // A forecast shows over the question for six seconds (or until tapped) and fades away.
    sfx.joker();
    S.adv = r; S.tray = null;
    const mine = r;
    paintStage();
    later(() => dismissAdvice(mine), 6000);
  }
  // Fades the forecast away; called after 6 seconds or at once when it is tapped.
  function dismissAdvice(mine) {
    if (S.adv !== mine) return;
    const bub = el.stage.querySelector('.rm-float .rm-bubble');
    if (bub) bub.classList.add('out');
    later(() => { if (S.adv === mine) { S.adv = null; const h = el.stage.querySelector('.rm-float'); if (h && !S.tray) h.innerHTML = ''; } }, 450);
  }
  function lastAdvice(kind) {
    for (let i = S.log.length - 1; i >= 0; i--) if (S.log[i].kind === kind && S.log[i].n === S.n) return S.log[i];
    return null;
  }
  function paintAdvice(r) {
    if (r.kind === 'fifty') return;
    const host = el.stage.querySelector('.rm-float');
    if (!host) return;
    const d = document.createElement('div');
    d.className = 'rm-bubble';
    if (r.kind === 'compass') {
      d.innerHTML = '<i>✧</i><div><b>' + _esc(_t('rm_j_compass')) + '</b><span>' + _esc(_t(r.correct ? 'rm_compass_correct' : 'rm_compass_wrong', { a: LETTERS[r.pos] })) + '</span></div>';
    } else if (r.kind === 'specialist') {
      const a = r.pick == null ? '' : LETTERS[r.pick];
      d.innerHTML = '<i>' + PRO_ICON[r.who] + '</i><div><b>' + _esc(_t('rm_pro_' + r.who)) + '</b><span>' + _esc(_t('rm_adv_' + r.say, { a: a })) + '</span></div>';
    } else {
      d.className += ' poll';
      let bars = '';
      for (let i = 0; i < 4; i++) {
        if (r.votes[i] == null) continue;
        bars += '<div class="pb"><span>' + LETTERS[i] + '</span><i style="width:' + r.votes[i] + '%"></i><em>' + r.votes[i] + '%</em></div>';
      }
      d.innerHTML = '<i>' + flag(r.who) + '</i><div><b>' + _esc(_t('rm_poll_title', { c: _t('rm_cc_' + r.who) })) + '</b>' + bars + '</div>';
    }
    d.onclick = () => dismissAdvice(r);
    host.appendChild(d);
  }
  function paintVotes() {}

  // ── The reveal ─────────────────────────────────────────────────────────────
  function showReveal(m, silent) {
    // A chosen answer stays yellow for a second before the verdict, for suspense.
    if (!silent && S.sel != null && S.selAt) {
      const wait = 1000 - (performance.now() - S.selAt);
      if (wait > 0) { S.selAt = 0; later(() => showReveal(m, silent), wait); return; }
    }
    S.reveal = m; S.phase = 'reveal'; S.done = true;
    S.adv = null; S.tray = null;
    m.rows.forEach(r => {
      const p = S.players[r.pid];
      if (!p) return;
      p.amount = r.amount;
      if (r.action === 'right') p.answered = m.n;
      if (r.action === 'quit') p.status = 'quit';
      else if (r.action === 'wrong' || r.action === 'timeout') p.status = 'out';
      p.ready = false;
    });
    const mine = m.rows.find(r => r.pid === meId());
    if (mine && !S.sel && mine.pos != null) S.sel = mine.pos;
    paintLadder(); paintPlayers(); paintStage();
    if (!silent) {
      if (mine) {
        if (mine.action === 'right') { sfx.right(); floatGain(amountFor(m.n)); }
        else if (mine.action === 'quit') sfx.quit();
        else sfx.wrong();
      } else sfx.tick();
      if (S.order.length > 1) {
        m.rows.forEach(r => {
          if (r.pid === meId()) return;
          const nm = playerOf(r.pid).display_name;
          toast(_t('rm_ev_' + r.action, { name: nm, amount: fmt(r.amount) }), r.action);
        });
      }
    }
  }
  function floatGain(v) {
    const d = document.createElement('div');
    d.className = 'rm-gain'; d.textContent = '+' + fmt(v);
    el.stage.appendChild(d);
    later(() => d.remove(), 1800);
  }

  // ── Clock ──────────────────────────────────────────────────────────────────
  function paintClock() {
    const bar = el.stage && el.stage.querySelector('.rm-bar i');
    if (!bar) return;
    if (!_deadline || !_qdur || S.phase !== 'question') { bar.style.width = '100%'; bar.parentNode.classList.remove('low'); return; }
    const left = Math.max(0, (_deadline - performance.now()) / 1000);
    bar.style.width = Math.max(0, Math.min(100, left / _qdur * 100)) + '%';
    bar.parentNode.classList.toggle('low', left <= 8);
  }

  // ── End ────────────────────────────────────────────────────────────────────
  function showOver(results) {
    if (!el.wrap || el.over) return;
    S.over = true;
    const multi = results.length > 1, me = meId();
    const rows = results.map((r, i) => {
      const p = playerOf(r.player_id);
      const how = r.status === 'exhausted' ? _t('rm_how_exhausted') : r.status === 'quit' ? _t('rm_how_quit', { n: r.answered }) : (r.status === 'done' ? _t('rm_how_done') : _t('rm_how_out', { n: r.answered }));
      const badges = r.bonuses.length
        ? r.bonuses.map(b => '<span class="rm-badge">' + _esc(_t('rm_b_' + b.id)) + ' <b>+' + b.pct + '%</b></span>').join('')
        : '<span class="rm-badge none">' + _esc(_t('rm_no_bonus')) + '</span>';
      return '<div class="rm-row2' + (multi && i === 0 ? ' win' : '') + '"><span class="rk">' + (multi && i === 0 ? '🏆' : (i + 1)) + '</span>' +
        mp.renderAvatar(p, 28) +
        '<span class="n">' + _esc(p.display_name || r.display_name) + (r.player_id === me && multi ? ' · ' + _esc(_t('rm_you')) : '') + '<small>' + _esc(how) + '</small></span>' +
        '<span class="sc">' + fmt(r.score) + '<small>' + _esc(_t('rm_won')) + ' ' + fmt(r.amount) + (r.bonus_pct ? ' · ' + _esc(_t('rm_bonus')) + ' +' + r.bonus_pct + '%' : '') + '</small></span>' +
        '<div class="rm-badges">' + badges + '</div></div>';
    }).join('');
    const ov = document.createElement('div');
    ov.className = 'rm-over';
    ov.innerHTML =
      '<div class="rm-over-card"><h2>' + _esc(multi ? '🏆 ' + _t('rm_winner') + ': ' + (playerOf(results[0].player_id).display_name || '') : '🎉 ' + _t('rm_over')) + '</h2>' +
      '<div class="rm-rows">' + rows + '</div><section data-gh-results></section>' +
      '<div class="rm-acts"><button class="rm-btn" data-again>' + _esc(_t('rm_play_again')) + '</button>' +
      '<a class="rm-btn plain" href="' + HUB_URL + '">' + _esc(_t('rm_back')) + '</a></div></div>';
    el.wrap.appendChild(ov);
    el.over = ov;
    const mine = results.find(r => r.player_id === me);
    if (!multi || (mine && results[0].player_id === me)) sfx.win();
    ov.querySelector('[data-again]').onclick = e => playAgain(e.currentTarget);
  }

  async function playAgain(btn) {
    btn.disabled = true; btn.textContent = _t('rm_starting');
    try {
      const r = await fetch('/api/pub/gamehub/mp/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GH-Token': window.GameHub.getToken() || '' },
        body: JSON.stringify({ game_id: GAME_ID, max_players: mp.players().length > 1 ? 6 : 1, settings: mp.settings() }),
      });
      if (r.status === 409) { location.href = HUB_URL; return; }
      if (!r.ok) throw new Error('room');
      const d = await r.json();
      location.href = d.play_url;
    } catch (_) {
      btn.disabled = false; btn.textContent = _t('rm_play_again');
      alert(_t('rm_error_new_game'));
    }
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  function apply(msg) {
    if (!S) return;
    switch (msg.type) {
      case 'rm_picked':
        S.picked.add(msg.pid); paintPlayers(); break;
      case 'rm_q':
        S.phase = 'question';
        _deadline = msg.time ? performance.now() + msg.time * 1000 : 0;
        startQuestion(msg, false);
        break;
      case 'rm_ready':
        if (S.players[msg.pid]) S.players[msg.pid].ready = true;
        paintPlayers(); break;
      case 'rm_used': {
        const st = S.players[msg.pid];
        if (st && !msg.free && st.jokers.indexOf(msg.kind) < 0) st.jokers.push(msg.kind);
        if (msg.pid !== meId()) toast(_t('rm_ev_joker', { name: playerOf(msg.pid).display_name, joker: _t('rm_j_' + msg.kind) }), 'joker');
        break;
      }
      case 'rm_mine':
        S.specs = msg.specs; S.countries = msg.countries; break;
      case 'rm_joker_res':
        applyJoker(msg, false); break;
      case 'rm_reveal': showReveal(msg, false); break;
      case 'rm_over':
        later(() => showOver(msg.results), 1200); break;
    }
  }
  mp.on('rm_state', msg => {
    _sm = msg; _ready = false; _queue = [];
    if (_root && el.stage) init();
  });
  ['rm_picked', 'rm_mine', 'rm_q', 'rm_used', 'rm_joker_res', 'rm_ready', 'rm_reveal', 'rm_over'].forEach(type => {
    mp.on(type, msg => { if (_ready) apply(msg); else _queue.push(msg); });
  });

  mp.registerGame({
    id: GAME_ID,
    name: _t('rm_title'),
    renderSetup,
    renderGame,
    snapshot: () => null,
    exitButton: false,
  });
})();
