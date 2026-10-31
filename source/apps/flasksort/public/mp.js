/*
 * Flask Sort — the game, client side.
 *
 * Runs on Game Hub's public play page. The server owns the levels and checks
 * every pour; this file draws the flasks (flasks3d.js + three.js, loaded when
 * the game starts) and sends what the player does. Pours are shown at once and
 * confirmed afterwards, so a slow connection never makes the game feel slow;
 * if the server ever disagrees, it sends the level again and the flasks are
 * put back the way it has them.
 *
 * Alone the levels never end; with others everybody plays the same levels at
 * their own pace and the first to clear the last one wins, the rest play on
 * for the next places.
 */
(function () {
  'use strict';
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'flasksort';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;
  const _t = (k, v) => (window.t ? window.t(k, v) : k);
  const TARGETS = [3, 5, 8, 10, 15, 20, 30, 40, 50, 75, 100];
  const MAX_LEVEL = 100;           // the last level of a game (and of a solo game)

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Sound ──────────────────────────────────────────────────────────────────
  let _muted = store.get('fs_muted', '0') === '1';
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
    pick() { _tone(520, 0.07, 'triangle', 0.09); },
    pour(n) { for (let k = 0; k < 4 + n * 3; k++) _tone(300 + k * 22 + Math.random() * 30, 0.09, 'sine', 0.05, 0.45 + k * 0.07); },
    no() { _tone(170, 0.18, 'sawtooth', 0.05); },
    seal() { _tone(784, 0.1, 'sine', 0.1); _tone(1175, 0.16, 'sine', 0.08, 0.08); },
    clear() { [523, 659, 784, 1046, 1318].forEach((f, i) => _tone(f, 0.22, 'sine', 0.12, i * 0.1)); },
  };

  // ── Lobby: what the host chooses ───────────────────────────────────────────
  function renderSetup(box, settings) {
    const s = Object.assign({ levels: +store.get('fs_levels', 10) }, settings || {});
    box.className = 'fs-setup';
    box.innerHTML =
      '<label>' + _esc(_t('fs_setup_levels')) + '</label><select id="fs-s-levels"></select>' +
      '<p class="fs-hint">' + _esc(_t('fs_setup_hint')) + '</p>';
    const lv = box.querySelector('#fs-s-levels');
    lv.innerHTML = TARGETS.map(n => '<option value="' + n + '">' + _esc(_t('fs_levels_opt', { n: n })) + '</option>').join('');
    lv.value = TARGETS.indexOf(+s.levels) !== -1 ? String(s.levels) : '10';
    // Alone a game runs through all the levels, so there is nothing to choose.
    // A room made for several players has the invite section; a solo room has
    // none. The lobby is put on the page after this runs, so it is looked for
    // a moment later too.
    const paint = () => {
      const multi = !!document.getElementById('gh-lobby-icol') || mp.players().length > 1;
      box.style.display = multi ? '' : 'none';
    };
    paint();
    setTimeout(paint, 0);
    setTimeout(paint, 400);
    mp.on('roster', () => { if (box.isConnected) paint(); });
    return () => { store.set('fs_levels', lv.value); return { levels: +lv.value }; };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _root = null, _sm = null;
  let _ready = false, _queue = [];
  let M = null;                          // the model of the game
  let S = null;                          // the 3D scene
  let _three = null, _mod = null, _no3d = false;
  let _gen = 0, _seq = 0;
  let _sel = -1;
  let _clearing = false, _pendingClear = null, _results = null;
  let el = {};
  let _t0 = 0, _tick = 0, _overWait = null, _hintWait = false, _hintAsked = false;

  const meId = () => mp.youId();
  const playerOf = id => mp.players().find(p => p.id === id) || { id: id, display_name: '?' };
  const fmt = n => Number(n || 0).toLocaleString((window.mvmOS && window.mvmOS.lang) || undefined);

  const tile = (k, label) => '<div class="fs-tile fs-t-' + k + '"><small>' + _esc(_t(label)) + '</small><b class="fs-' + k + '">–</b></div>';

  // ── Screen ─────────────────────────────────────────────────────────────────
  function renderGame(root) {
    _root = root;
    _ready = false;
    root.innerHTML =
      '<div class="fs-wrap">' +
        '<div class="fs-players"></div>' +
        '<div class="fs-status">' +
          tile('lv', 'fs_hud_level') + tile('pts', 'fs_hud_points') + tile('mv', 'fs_hud_moves') + tile('bn', 'fs_hud_bonus') +
        '</div>' +
        '<div data-gh-stage></div><div class="fs-bar"><i></i></div>' +
        '<div class="fs-board"><div class="fs-load">' + _esc(_t('fs_waiting')) + '</div></div>' +
        // Along the bottom, beside Game Hub's Save & exit at the left, so the
        // buttons take nothing from the board.
        '<div class="fs-foot"><div class="fs-tools">' +
          '<button data-act="undo" title="' + _esc(_t('fs_undo')) + '">↶</button>' +
          '<button data-act="restart" title="' + _esc(_t('fs_restart')) + '">⟲</button>' +
          '<button data-act="hint" title="' + _esc(_t('fs_hint')) + '">💡</button>' +
          '<button data-act="quit" title="' + _esc(_t('fs_finish')) + '">🏁</button>' +
        '</div>' +
        '<button class="fs-snd" data-snd title="' + _esc(_t('fs_sound')) + '"></button></div>' +
      '</div>';
    el = {
      players: root.querySelector('.fs-players'),
      lv: root.querySelector('.fs-lv'),
      mv: root.querySelector('.fs-mv'),
      pts: root.querySelector('.fs-pts'),
      bn: root.querySelector('.fs-bn'),
      bar: root.querySelector('.fs-bar i'),
      board: root.querySelector('.fs-board'),
      tools: root.querySelector('.fs-tools'),
    };
    const snd = root.querySelector('[data-snd]');
    const paintSnd = () => { snd.textContent = _muted ? '🔇' : '🔊'; };
    snd.onclick = () => { _muted = !_muted; store.set('fs_muted', _muted ? '1' : '0'); paintSnd(); sfx.pick(); };
    paintSnd();
    el.tools.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-act]');
      if (b) act(b.dataset.act);
    });
    window.addEventListener('resize', () => { if (S) S.resize(); });
    clearInterval(_tick);
    _tick = setInterval(paintClock, 250);
    if (_sm) init();
  }

  async function init() {
    const sm = _sm, gen = ++_gen;
    _ready = false;
    try {
      if (!_three) _three = await import(sm.urls.three);
      if (!_mod) _mod = await import(sm.urls.scene);
    } catch (e) { console.error(e); _no3d = true; }
    if (gen !== _gen) return;
    if (_no3d) { el.board.innerHTML = '<div class="fs-load">' + _esc(_t('fs_no_webgl')) + '</div>'; return; }
    M = {
      multi: !!sm.multi, target: sm.target || 0, order: sm.order || [], prog: sm.progress || {},
      lv: null, over: !!sm.over, done: !!sm.done, rank: sm.rank || 0, quit: false,
    };
    el.board.querySelectorAll('.fs-load').forEach(n => n.remove());
    try {
      if (S) S.destroy();
      S = _mod.createFlasks(_three, el.board, { onPick: onPick });
    } catch (e) {
      console.error(e);
      _no3d = true;
      el.board.innerHTML = '<div class="fs-load">' + _esc(_t('fs_no_webgl')) + '</div>';
      return;
    }
    setLevel(sm.you, true);
    paintPlayers();
    _ready = true;
    paintTools();                      // restart and hint are there from the first move
    const q = _queue; _queue = [];
    q.forEach(apply);
    if (M.done) showWait();
  }

  // The level as the server has it. `fresh` plays the drop-in, a resync only
  // puts the flasks back.
  function setLevel(lv, fresh) {
    M.lv = { level: lv.level, n: lv.n, cap: lv.cap, tubes: lv.tubes.map(t => t.slice()), par: lv.par,
      moves: lv.moves, hist: (lv.hist || []).map(h => h.slice()), points: lv.points,
      allow: lv.allow || 60, speedMax: lv.speed_max || 0,
      start: (lv.start || lv.tubes).map(t => t.slice()) };
    _sel = -1;
    _clearing = false;
    _t0 = performance.now() - (lv.elapsed || 0) * 1000;
    if (fresh) S.setLevel(M.lv.tubes, M.lv.cap); else S.setTubes(M.lv.tubes);
    paintStatus();
    paintTools();
  }

  // ── Play ───────────────────────────────────────────────────────────────────
  const canPlay = () => !!M && _ready && !!S && !M.over && !M.done && !M.quit && !_clearing && !_results;

  function pourOf(a, b) {
    const T = M.lv.tubes, cap = M.lv.cap;
    const A = T[a], B = T[b];
    if (a === b || !A || !B || !A.length || B.length >= cap) return null;
    const c = A[A.length - 1];
    // A dose may be parked on a different colour to make room, so a level is never stuck.
    let k = 1;
    while (k < A.length && A[A.length - 1 - k] === c) k++;
    return { c: c, cnt: Math.min(k, cap - B.length) };
  }

  function onPick(i) {
    if (!canPlay()) return;
    const T = M.lv.tubes;
    if (_sel < 0) {
      if (!T[i].length) { S.shake(i); sfx.no(); return; }
      _sel = i; S.select(i); sfx.pick();
      return;
    }
    if (_sel === i) { _sel = -1; S.select(-1); return; }
    const a = _sel, p = pourOf(a, i);
    if (!p) {
      sfx.no();
      S.shake(a);
      if (T[i].length) { _sel = i; S.select(i); } else { _sel = -1; S.select(-1); }
      return;
    }
    _sel = -1;
    doPour(a, i, p);
  }

  function doPour(a, b, p) {
    const T = M.lv.tubes;
    T[a].splice(T[a].length - p.cnt, p.cnt);
    for (let k = 0; k < p.cnt; k++) T[b].push(p.c);
    M.lv.hist.push([a, b, p.cnt, p.c]);
    M.lv.moves += 1;
    mp.send({ type: 'fs_pour', a: a, b: b, seq: ++_seq });
    sfx.pour(p.cnt);
    paintStatus(); paintTools();
    const sealed = T[b].length === M.lv.cap && T[b].every(x => x === T[b][0]);
    S.pour(a, b, p.cnt, p.c, () => {
      if (sealed) sfx.seal();
      paintTools();
      if (_pendingClear && !S.busy()) { const m = _pendingClear; _pendingClear = null; onCleared(m); }
    });
  }

  function act(kind) {
    if (!canPlay()) return;
    if (kind === 'undo') {
      if (S.busy() || !M.lv.hist.length) return;
      const [a, b, cnt, c] = M.lv.hist.pop(), T = M.lv.tubes;
      T[b].splice(T[b].length - cnt, cnt);
      for (let k = 0; k < cnt; k++) T[a].push(c);
      _sel = -1;
      S.setTubes(T);
      mp.send({ type: 'fs_undo', seq: ++_seq });
      sfx.pick();
    } else if (kind === 'restart') {
      if (S.busy()) return;
      confirmBox(_t('fs_restart_q'), _t('fs_restart'), () => {
        if (!canPlay() || S.busy()) return;
        M.lv.tubes = M.lv.start.map(t => t.slice());
        M.lv.hist = [];
        _sel = -1;
        S.setTubes(M.lv.tubes);
        mp.send({ type: 'fs_restart', seq: ++_seq });
        paintStatus(); paintTools();
      });
      return;
    } else if (kind === 'hint') {
      if (S.busy() || _hintWait) return;
      const ask = () => {
        if (!canPlay() || S.busy()) return;
        _hintWait = true;
        mp.send({ type: 'fs_hint', seq: ++_seq });
        setTimeout(() => { _hintWait = false; }, 4000);
      };
      // The first hint of a game says what it costs; after that it just helps.
      if (_hintAsked) ask();
      else confirmBox(_t('fs_hint_q', { n: hintCost() }), _t('fs_hint'), () => { _hintAsked = true; ask(); });
      return;
    } else if (kind === 'quit') {
      confirmBox(_t(M.multi ? 'fs_quit_multi_q' : 'fs_finish_q'), _t(M.multi ? 'fs_give_up' : 'fs_finish'), () => {
        if (!canPlay()) return;
        M.quit = true;
        mp.send({ type: 'fs_quit', seq: ++_seq });
        paintTools();
        if (M.multi) showWait();
      });
      return;
    }
    paintStatus(); paintTools();
  }

  function confirmBox(text, okLabel, onOk) {
    if (!el.board || el.board.querySelector('.fs-confirm')) return;
    const box = document.createElement('div');
    box.className = 'fs-confirm';
    box.innerHTML = '<div class="fs-card"><p>' + _esc(text) + '</p><div class="fs-acts">' +
      '<button class="fs-btn go" data-ok>' + _esc(okLabel) + '</button>' +
      '<button class="fs-btn" data-no>' + _esc(_t('fs_cancel')) + '</button></div></div>';
    el.board.appendChild(box);
    box.querySelector('[data-ok]').onclick = () => { box.remove(); onOk(); };
    box.querySelector('[data-no]').onclick = () => box.remove();
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  function apply(m) {
    if (!M) return;
    switch (m.type) {
      case 'fs_level':
        // An answer to a pour the server did not accept. When the player has
        // already done something since, the next answer will be the right one.
        if (S.busy()) { setTimeout(() => apply(m), 300); break; }
        if ((m.seq || 0) >= _seq) { setLevel(m, false); sfx.no(); }
        break;
      case 'fs_hint_res':
        _hintWait = false;
        if (m.a < 0) { toast(_t('fs_hint_none')); break; }
        M.lv.points = m.points;
        paintStatus();
        // The hint is not just shown: the pour is made for the player.
        toast(_t('fs_hint_cost', { n: fmt(m.cost) }));
        { const p = pourOf(m.a, m.b); _sel = -1; S.select(-1); if (p) doPour(m.a, m.b, p); }
        break;
      case 'fs_cleared':
        if (S.busy()) _pendingClear = m; else onCleared(m);
        break;
      case 'fs_progress': {
        M.prog[m.pid] = { level: m.level, points: m.points, cleared: m.cleared, done: m.done, quit: m.quit, rank: m.rank };
        paintPlayers();
        break;
      }
      case 'fs_over':
        _results = m.results; M.over = true;
        paintPlayers(); paintTools();
        // When the last level has just been cleared, its result is read first.
        if (_pendingClear || el.board.querySelector('.fs-banner')) _overWait = m; else setTimeout(() => showOver(m), 700);
        break;
    }
  }

  // The result stays until the player chooses to go on, and the next level's
  // clock does not start before that.
  function onCleared(m) {
    _clearing = true;
    M.lv.points = m.points;
    paintStatus(); paintTools();
    S.celebrate();
    sfx.clear();
    showBanner(m);
  }

  function proceed(m) {
    hideBanner();
    if (_overWait) { const o = _overWait; _overWait = null; _clearing = false; showOver(o); return; }
    if (m.done) {
      M.done = true; M.rank = m.rank;
      _clearing = false;
      paintTools();
      if (!_results) showWait();
    } else if (m.next) {
      setLevel(m.next, true);
      mp.send({ type: 'fs_ready', seq: ++_seq });
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  function paintPlayers() {
    if (!M) return;
    const me = meId();
    el.players.innerHTML = M.order.map(id => {
      const p = playerOf(id), pr = M.prog[id] || { level: 1, points: 0 };
      const medal = pr.done ? '🏁' : '';
      const lv = M.multi ? 'Lv ' + pr.level + '/' + M.target : 'Lv ' + pr.level;
      return '<div class="fs-chip' + (pr.done ? ' done' : '') + '">' + mp.renderAvatar(p, 26) +
        '<span class="fs-name">' + _esc(p.display_name) + (id === me && M.order.length > 1 ? ' · ' + _esc(_t('fs_you')) : '') + '</span>' +
        '<b>' + (medal ? medal + ' ' : '') + _esc(lv) + '</b><small>' + fmt(pr.points) + '</small></div>';
    }).join('');
  }

  function paintStatus() {
    if (!M || !M.lv) return;
    el.lv.textContent = M.lv.level + '/' + M.target;
    el.mv.textContent = M.lv.moves + '/' + M.lv.par;
    paintClock();
    el.pts.textContent = fmt(M.lv.points);
    if (mp.stageRecords) mp.stageRecords(_root.querySelector('[data-gh-stage]'), 'v1:level:' + M.lv.level, null, { hideScore: true });
    const me = meId();
    M.prog[me] = Object.assign({}, M.prog[me], { level: M.lv.level, points: M.lv.points });
    paintPlayers();
  }

  function paintTools() {
    if (!el.tools || !M) return;
    const on = canPlay();
    const u = el.tools.querySelector('[data-act="undo"]');
    u.disabled = !on || !M.lv || !M.lv.hist.length;
    el.tools.querySelector('[data-act="restart"]').disabled = !on;
    el.tools.querySelector('[data-act="hint"]').disabled = !on;
    const q = el.tools.querySelector('[data-act="quit"]');
    q.disabled = !on;
    // Alone there is nothing to give up: a game is finished between levels.
    q.style.display = M.multi ? '' : 'none';
    q.title = _t(M.multi ? 'fs_give_up' : 'fs_finish');
  }

  // A hint costs the points of one filled flask.
  const hintCost = () => 10 * M.lv.cap;

  // The speed bonus melts away as the level goes on.
  function speedLeft() {
    if (!M || !M.lv || !M.lv.speedMax) return 0;
    const f = Math.max(0, 1 - (performance.now() - _t0) / 1000 / M.lv.allow);
    return Math.round(M.lv.speedMax * f);
  }
  function paintClock() {
    if (!M || !M.lv || !el.bar) return;
    const f = M.lv.speedMax ? speedLeft() / M.lv.speedMax : 0;
    if (!_clearing) el.bar.style.transform = 'scaleX(' + f + ')';
    el.bar.classList.toggle('low', f < 0.25);
    if (!_clearing) el.bn.textContent = '+' + speedLeft();
  }

  function toast(text) {
    if (!el.board) return;
    const old = el.board.querySelector('.fs-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'fs-toast';
    t.textContent = text;
    el.board.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function showBanner(m) {
    hideBanner();
    const b = document.createElement('div');
    b.className = 'fs-banner';
    const stars = '★'.repeat(m.stars) + '☆'.repeat(3 - m.stars);
    const levelScore = m.level_score == null ? m.gained : m.level_score;
    b.innerHTML = '<div class="fs-banner-card"><div class="fs-stars">' + stars + '</div>' +
      '<h3>' + _esc(m.done ? _t('fs_done_title') : _t('fs_cleared')) + '</h3>' +
      '<div class="fs-bd">' +
        '<div><span>' + _esc(_t('fs_bd_flasks')) + '</span><b>+' + fmt(m.base) + '</b></div>' +
        (m.speed ? '<div><span>' + _esc(_t('fs_bd_speed')) + '</span><b>+' + fmt(m.speed) + '</b></div>' : '') +
        (m.under ? '<div><span>' + _esc(_t('fs_bd_par')) + '</span><b>+' + fmt(m.under) + '</b></div>' : '') +
        (m.level_penalty ? '<div><span>' + _esc(_t('fs_hint')) + '</span><b>−' + fmt(m.level_penalty) + '</b></div>' : '') +
      '</div><div class="fs-gain">' + (levelScore < 0 ? '−' : '+') + fmt(Math.abs(levelScore)) + '</div>' +
      '<div data-gh-stage-clear></div><button class="fs-btn go" data-next>' + _esc(m.done ? _t('fs_continue') : _t('fs_next_level')) + '</button>' +
      // Alone, this is where a game is finished: the level is cleared, so the
      // score is recorded and the next game starts from level 1.
      (M.multi || m.done ? '' : '<button class="fs-btn" data-finish>' + _esc(_t('fs_finish')) + '</button>') + '</div>';
    el.board.appendChild(b);
    if (mp.stageRecords) {
      mp.stageRecords(b.querySelector('[data-gh-stage-clear]'), 'v1:level:' + m.level, levelScore, { refresh: true, records: m.stage_records });
      mp.stageRecords(_root.querySelector('[data-gh-stage]'), 'v1:level:' + m.level, null, { hideScore: true });
    }
    b.querySelector('[data-next]').onclick = () => proceed(m);
    const fin = b.querySelector('[data-finish]');
    if (fin) fin.onclick = () => confirmBox(_t('fs_finish_q'), _t('fs_finish'), () => {
      fin.disabled = true;
      hideBanner();                      // the result of the game takes its place
      M.quit = true;
      mp.send({ type: 'fs_quit', seq: ++_seq });
    });
  }
  function hideBanner() { const b = el.board && el.board.querySelector('.fs-banner'); if (b) b.remove(); }

  // A player who has finished, or given up, waits for the others here.
  function showWait() {
    if (!el.board || el.board.querySelector('.fs-wait') || _results) return;
    const w = document.createElement('div');
    w.className = 'fs-wait';
    const finished = M.done;
    const place = finished ? _t('fs_done_title') : '';
    w.innerHTML = '<div class="fs-card"><h3>' + _esc(finished ? '🏁 ' + place : _t('fs_gave_up')) + '</h3>' +
      '<p>' + _esc(_t('fs_waiting_others')) + '</p></div>';
    el.board.appendChild(w);
  }

  // ── End ────────────────────────────────────────────────────────────────────
  function showOver(m) {
    if (!el.board || el.board.querySelector('.fs-over')) return;
    const results = m.results, multi = !!m.multi, me = meId();
    el.board.querySelectorAll('.fs-wait,.fs-confirm,.fs-banner').forEach(n => n.remove());
    const rows = results.map((r, i) => {
      const p = playerOf(r.player_id);
      const win = multi && r.rank === 1 && r.points > 0;
      return '<div class="fs-row' + (win ? ' win' : '') + '"><span>' + (win ? '🏆' : (i + 1)) + '</span>' +
        mp.renderAvatar(p, 28) +
        '<span class="n">' + _esc(p.display_name || r.display_name) + (r.player_id === me && multi ? ' · ' + _esc(_t('fs_you')) : '') + '</span>' +
        '<small>' + _esc(_t('fs_reached', { n: r.level })) + '<br>' + _esc(_t('fs_cleared_n', { n: r.cleared })) + '</small>' +
        '<b>' + fmt(r.points) + '<br><small>' + _esc(_t('fs_score')) + '</small></b></div>';
    }).join('');
    const top = results[0];
    const title = multi
      ? (top.points > 0 ? '🏆 ' + _t('fs_winner') + ': ' + (playerOf(top.player_id).display_name || '') : _t('fs_over'))
      : (top && top.done ? '🏆 ' + _t('fs_all_done') : '🧪 ' + _t('fs_run_over', { n: top ? top.level : 1 }));
    const ov = document.createElement('div');
    ov.className = 'fs-over';
    ov.innerHTML =
      '<div class="fs-card"><h2>' + _esc(title) + '</h2><div class="fs-rows">' + rows + '</div>' +
      (multi ? '' : '<p class="fs-hint">' + _esc(_t('fs_saved_note')) + '</p>') +
      '<section data-gh-results></section><div class="fs-acts"><button class="fs-btn go" data-again>' + _esc(multi ? _t('fs_play_again') : _t('fs_new_game')) + '</button>' +
      '<a class="fs-btn" href="' + HUB_URL + '">' + _esc(_t('fs_back')) + '</a></div></div>';
    el.board.appendChild(ov);
    const mine = results.find(r => r.player_id === me);
    if (mine && mine.rank === 1) sfx.clear();
    ov.querySelector('[data-again]').onclick = e => playAgain(e.currentTarget);
  }

  async function playAgain(btn) {
    btn.disabled = true;
    btn.textContent = _t('fs_starting');
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
      btn.disabled = false;
      btn.textContent = _t('fs_play_again');
      alert(_t('fs_error_new_game'));
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  mp.on('fs_state', msg => {
    _sm = msg; _ready = false; _queue = []; _results = null; _pendingClear = null; _overWait = null; _hintWait = false;
    M = null;
    if (_root && el.board) init();
  });
  ['fs_level', 'fs_cleared', 'fs_progress', 'fs_over', 'fs_hint_res'].forEach(type => {
    mp.on(type, msg => { if (_ready) apply(msg); else _queue.push(msg); });
  });

  mp.registerGame({
    id: GAME_ID,
    name: _t('fs_title'),
    renderSetup,
    renderGame,
    // Save & exit is solo only; the hub asks the server for the run.
    snapshot: () => null,
  });
})();
