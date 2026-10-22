/*
 * Remember the Pairs — the game, client side.
 *
 * Runs on Game Hub's public play page. The server owns the table: it shuffles
 * the deck, says whose turn it is and tells every browser what a card is at
 * the moment somebody turns it over. This file only draws that, in one of two
 * views of the same game:
 *
 *   Table     a flat grid of cards, cheap and works everywhere
 *   3D cylinder   cards on a cylinder on a turntable (cylinder3d.js + three.js, loaded
 *             only when someone picks it)
 *
 * Each player chooses their own view; it makes no difference to the game.
 * What a player does *before* turning a card — spinning the cylinder, looking —
 * never leaves their browser. Others see only the card that was turned, and
 * their cylinder turns to it.
 */
(function () {
  'use strict';
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'memorypairs';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;
  const _t = (k, v) => (window.t ? window.t(k, v) : k);

  // Must match what the server offers (mp_game.py).
  const THEME_MAX = { animals: 60, food: 60, nature: 48, travel: 48, fun: 48, faces: 48, numbers: 99, colors: 24, shapes: 60 };
  const THEMES = ['animals', 'food', 'nature', 'travel', 'fun', 'faces', 'numbers', 'colors', 'shapes'];
  // Up to this many pairs the table is flat; above it, a 3D cylinder.
  const FLAT_MAX_PAIRS = 20;
  // One arrangement per size, the same on every device: whoever plays from a
  // phone and whoever plays from a computer see the same cards in the same
  // places. The arrangements are made for a phone held upright (tall and
  // narrow); a wide screen simply shows them a little smaller.
  const TABLE = { 6: [3, 4], 8: [4, 4], 10: [4, 5], 12: [4, 6], 16: [4, 8], 20: [5, 8] };      // pairs: [columns, rows]
  const CYLINDER = { 24: [4, 12], 32: [4, 16], 40: [5, 16], 48: [6, 16] };                    // pairs: [rings, cards in a ring]
  const PAIRS = [6, 8, 10, 12, 16, 20, 24, 32, 40, 48];
  const TIMES = [0, 10, 15, 20, 30, 45, 60, 90];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Sound ──────────────────────────────────────────────────────────────────
  let _muted = store.get('mp_muted', '0') === '1';
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
    flip() { _tone(620, 0.06, 'triangle', 0.1); },
    match() { _tone(660, 0.12, 'sine', 0.14); _tone(990, 0.2, 'sine', 0.12, 0.1); },
    miss() { _tone(190, 0.22, 'sawtooth', 0.06); },
    win() { [523, 659, 784, 1046].forEach((f, i) => _tone(f, 0.2, 'sine', 0.13, i * 0.12)); },
  };

  // ── Lobby: what the host chooses ───────────────────────────────────────────
  function renderSetup(box, settings) {
    const saved = {
      theme: store.get('mp_theme', 'animals'),
      pairs: +store.get('mp_pairs', 12),
      time: +store.get('mp_time', 30),
    };
    const s = Object.assign({}, saved, settings || {});
    box.className = 'mp-setup';
    box.innerHTML =
      '<label>' + _esc(_t('mp_setup_theme')) + '</label><select id="mp-s-theme"></select>' +
      '<label>' + _esc(_t('mp_setup_pairs')) + '</label><select id="mp-s-pairs"></select>' +
      '<label>' + _esc(_t('mp_setup_time')) + '</label><select id="mp-s-time"></select>';
    const th = box.querySelector('#mp-s-theme'), pr = box.querySelector('#mp-s-pairs'), tm = box.querySelector('#mp-s-time');
    th.innerHTML = THEMES.map(k => '<option value="' + k + '">' + _esc(_t('mp_th_' + k)) + '</option>').join('');
    th.value = THEMES.indexOf(s.theme) !== -1 ? s.theme : 'animals';
    tm.innerHTML = TIMES.map(v => '<option value="' + v + '">' + _esc(v ? _t('mp_time_opt', { n: v }) : _t('mp_time_off')) + '</option>').join('');
    tm.value = TIMES.indexOf(+s.time) !== -1 ? String(s.time) : '30';
    function fillPairs(keep) {
      const max = THEME_MAX[th.value];
      const opts = PAIRS.filter(p => p <= max);
      pr.innerHTML = opts.map(p => '<option value="' + p + '">' + _esc(_t('mp_pairs_opt', { n: p, c: p * 2 })) + (p > FLAT_MAX_PAIRS ? ' · 3D' : '') + '</option>').join('');
      const want = opts.filter(p => p <= keep).pop() || opts[0];
      pr.value = String(want);
    }
    fillPairs(+s.pairs || 12);
    th.onchange = () => fillPairs(+pr.value);
    return () => {
      store.set('mp_theme', th.value); store.set('mp_pairs', pr.value); store.set('mp_time', tm.value);
      return { theme: th.value, pairs: +pr.value, time: +tm.value };
    };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _root = null, _sm = null;          // the table message the server last sent
  let _ready = false, _queue = [];
  let M = null;                          // the model of the table
  let V = null;                          // the view showing it
  let _viewName = 'table';               // which view is showing: decided by the size of the table
  let _faces = null, _three = null, _cylMod = null, _no3d = false;
  let _inflight = false;
  let _gen = 0;                          // a newer table message cancels an older init
  let _tick = 0, _deadline = 0;
  let el = {};                           // pieces of the screen

  const meId = () => mp.youId();
  const playerOf = id => mp.players().find(p => p.id === id) || { id: id, display_name: '?' };

  function loadScript(url) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // ── Screen ─────────────────────────────────────────────────────────────────
  function renderGame(root) {
    _root = root;
    _ready = false;
    root.innerHTML =
      '<div class="mp-wrap">' +
        '<div class="mp-head"><div class="mp-players"></div>' +
        '</div>' +
        '<div class="mp-status">' +
          '<div class="mp-line"><span class="mp-who"></span><span class="mp-found"></span></div>' +
          '<div class="mp-bar"><i></i></div>' +
          '<div class="mp-hint"></div>' +
        '</div>' +
        '<div class="mp-board"><div class="mp-load">' + _esc(_t('mp_waiting')) + '</div></div>' +
        // Bottom right, beside the hub's Save & exit button at the bottom left.
        '<button class="mp-snd" data-snd title="' + _esc(_t('mp_sound')) + '"></button>' +
      '</div>';
    el = {
      wrap: root.querySelector('.mp-wrap'),
      players: root.querySelector('.mp-players'),
      who: root.querySelector('.mp-who'),
      found: root.querySelector('.mp-found'),
      bar: root.querySelector('.mp-bar i'),
      hint: root.querySelector('.mp-hint'),
      board: root.querySelector('.mp-board'),
      line: root.querySelector('.mp-line'),
    };
    const snd = root.querySelector('[data-snd]');
    const paintSnd = () => { snd.textContent = _muted ? '🔇' : '🔊'; };
    snd.onclick = () => { _muted = !_muted; store.set('mp_muted', _muted ? '1' : '0'); paintSnd(); sfx.flip(); };
    paintSnd();
    window.addEventListener('resize', () => { if (V && V.resize) V.resize(); });
    clearInterval(_tick);
    _tick = setInterval(paintClock, 200);
    if (_sm) init();
  }

  async function init() {
    const sm = _sm, gen = ++_gen;
    _ready = false;
    try {
      if (!window.MPFaces) await loadScript(sm.urls.faces);
    } catch (e) { console.error(e); }
    if (gen !== _gen) return;
    _faces = window.MPFaces;
    const cards = [];
    for (let i = 0; i < sm.cards; i++) cards.push({ st: 'down', sym: null });
    (sm.matched || []).forEach(m => { cards[m[0]] = { st: 'gone', sym: m[1] }; });
    (sm.up || []).forEach(m => { cards[m[0]] = { st: 'up', sym: m[1] }; });
    M = {
      theme: sm.theme, pairs: sm.pairs, picks: sm.picks, time: sm.time,
      order: sm.order || [], turn: sm.turn, urls: sm.urls,
      cards: cards, st: sm.stats || {}, locked: false, over: !!sm.over,
    };
    _deadline = sm.left != null ? performance.now() + sm.left * 1000 : 0;
    await mountView();
    if (gen !== _gen) return;
    paintPlayers(); paintStatus();
    _ready = true;
    const q = _queue; _queue = [];
    q.forEach(apply);
  }

  // ── Views ──────────────────────────────────────────────────────────────────
  // A small table is laid out flat, with cards big enough to tap on a phone.
  // From 24 pairs up the cards would get too small, so they go round a 3D
  // cylinder instead, which shows the front of it at full size and the rest as
  // it turns. Nobody chooses: the size of the table decides.
  async function mountView() {
    if (V) { V.destroy(); V = null; }
    el.board.innerHTML = '';
    el.board.classList.remove('mp-cyl');
    let used = 'table';
    if (M.pairs > FLAT_MAX_PAIRS && !_no3d) {
      el.board.innerHTML = '<div class="mp-load">' + _esc(_t('mp_loading_3d')) + '</div>';
      try {
        if (!_three) _three = await import(M.urls.three);
        if (!_cylMod) _cylMod = await import(M.urls.cylinder);
        el.board.innerHTML = '';
        el.board.classList.add('mp-cyl');
        V = cylinderView();
        used = 'cylinder';
      } catch (e) {
        console.error(e);
        _no3d = true;                  // no WebGL: the flat table, smaller cards
        el.board.innerHTML = '';
        el.board.classList.remove('mp-cyl');
        setTimeout(() => toast(_t('mp_no_webgl')), 300);
      }
    }
    if (!V) V = tableView();
    _viewName = used;
    el.hint.textContent = _t(used === 'cylinder' ? 'mp_hint_cylinder' : 'mp_hint_table');
    V.sync();
  }

  // The flat table.
  function tableView() {
    const grid = document.createElement('div');
    grid.className = 'mp-grid';
    el.board.appendChild(grid);
    const btns = [];
    const backURL = _faces.backURL(M.theme);
    grid.style.setProperty('--back', 'url(' + backURL + ')');
    M.cards.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'mp-card';
      b.innerHTML = '<div class="in"><div class="b"><img alt="" draggable="false" src="' + backURL + '"></div>' +
        '<div class="f"><img alt="" draggable="false"></div></div>';
      b.onclick = () => tryFlip(i);
      grid.appendChild(b);
      btns.push(b);
    });
    const front = i => btns[i].querySelector('.f img');
    const setFace = (i, sym) => { front(i).src = _faces.faceURL(M.theme, M.picks[sym]); };

    function fit() {
      const W = el.board.clientWidth - 16, H = el.board.clientHeight - 16, n = M.cards.length, gap = 7;
      const layout = TABLE[M.pairs] || [8, Math.ceil(n / 8)];
      const cols = layout[0], rows = layout[1];
      const best = { cols: cols, s: Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * 0.75) };
      const w = Math.max(24, Math.floor(best.s));
      grid.style.gridTemplateColumns = 'repeat(' + best.cols + ',' + w + 'px)';
      btns.forEach(b => { b.style.width = w + 'px'; b.style.height = Math.round(w / 0.75) + 'px'; });
    }
    const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el.board);

    return {
      name: 'table',
      sync() {
        fit();
        M.cards.forEach((c, i) => {
          if (c.sym != null) setFace(i, c.sym);
          btns[i].classList.toggle('up', c.st === 'up');
          btns[i].classList.toggle('gone', c.st === 'gone');
        });
        this.can();
      },
      flipUp(i, sym) { setFace(i, sym); btns[i].classList.add('up'); },
      flipDown(i) { btns[i].classList.remove('up'); },
      remove(i) { btns[i].classList.add('gone'); btns[i].classList.remove('up'); },
      focus() {},
      can() { const on = canPlay(); btns.forEach(b => b.classList.toggle('can', on)); },
      resize: fit,
      destroy() { if (ro) ro.disconnect(); grid.remove(); },
    };
  }

  // The 3D cylinder.
  function cylinderView() {
    const theme = M.theme;
    const api = _cylMod.createCylinder(_three, el.board, {
      count: M.cards.length,
      hue: _faces.BACK_HUE[theme],
      faceCanvas: sym => _faces.face(theme, M.picks[sym]),
      backCanvas: () => _faces.back(theme),
      rings: CYLINDER[M.pairs][0],
      perRing: CYLINDER[M.pairs][1],
      onPick: i => tryFlip(i),
    });
    return {
      name: 'cylinder',
      sync() {
        M.cards.forEach((c, i) => api.setCard(i, c.st, c.sym));
        api.resize();
      },
      flipUp: (i, sym) => api.flipUp(i, sym),
      flipDown: i => api.flipDown(i),
      remove: i => api.remove(i),
      focus: i => api.focus(i),
      can() {},
      resize: () => api.resize(),
      destroy: () => api.destroy(),
    };
  }

  // ── Play ───────────────────────────────────────────────────────────────────
  const canPlay = () => !!M && _ready && !M.over && !M.locked && M.turn === meId();

  function tryFlip(i) {
    if (!canPlay() || _inflight) return;
    const c = M.cards[i];
    if (!c || c.st !== 'down') return;
    if (M.cards.filter(x => x.st === 'up').length >= 2) return;
    _inflight = true;
    setTimeout(() => { _inflight = false; }, 900);
    mp.send({ type: 'mp_flip', i: i });
  }

  function apply(m) {
    if (!M) return;
    switch (m.type) {
      case 'mp_turn':
        M.turn = m.pid; M.locked = false;
        _deadline = m.left > 0 ? performance.now() + m.left * 1000 : 0;
        paintPlayers(); paintStatus();
        if (V) V.can();
        break;
      case 'mp_flipped': {
        const c = M.cards[m.i];
        c.st = 'up'; c.sym = m.sym; _inflight = false;
        V.flipUp(m.i, m.sym);
        // Somebody else chose a card: the cylinder turns to show it.
        if (m.pid !== meId()) V.focus(m.i);
        sfx.flip();
        break;
      }
      case 'mp_match': {
        M.locked = true; _deadline = 0;
        const s = M.st[m.pid] || (M.st[m.pid] = { pairs: 0, attempts: 0 });
        s.pairs = m.pairs; s.attempts += 1;
        sfx.match();
        toast(_t('mp_pair'), true);
        paintPlayers(); paintStatus();
        setTimeout(() => {
          [m.a, m.b].forEach(i => { M.cards[i].st = 'gone'; V.remove(i); });
        }, 700);
        break;
      }
      case 'mp_miss': {
        M.locked = true; _deadline = 0;
        const s = M.st[M.turn] || (M.st[M.turn] = { pairs: 0, attempts: 0 });
        s.attempts += 1;
        sfx.miss();
        toast(_t('mp_miss'));
        paintPlayers();
        setTimeout(() => {
          [m.a, m.b].forEach(i => { M.cards[i].st = 'down'; V.flipDown(i); });
        }, Math.max(300, m.hold * 1000));
        break;
      }
      case 'mp_timeout':
        M.locked = true; _deadline = 0;
        (m.down || []).forEach(i => { M.cards[i].st = 'down'; V.flipDown(i); });
        toast(_t('mp_timeout'));
        break;
      case 'mp_over':
        M.over = true; _deadline = 0;
        paintStatus();
        setTimeout(() => showOver(m.results), 1300);
        break;
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  function paintPlayers() {
    if (!M) return;
    const me = meId();
    el.players.innerHTML = M.order.map(id => {
      const p = playerOf(id), s = M.st[id] || { pairs: 0 };
      return '<div class="mp-chip' + (id === M.turn && !M.over ? ' on' : '') + '">' +
        mp.renderAvatar(p, 26) +
        '<span class="mp-name">' + _esc(p.display_name) + (id === me && M.order.length > 1 ? ' · ' + _esc(_t('mp_you')) : '') + '</span>' +
        '<b>' + s.pairs + '</b></div>';
    }).join('');
  }

  function paintStatus() {
    if (!M) return;
    const mine = M.turn === meId();
    const total = M.st && Object.values(M.st).reduce((a, s) => a + s.pairs, 0);
    el.found.textContent = _t('mp_found', { a: total, b: M.pairs });
    el.line.classList.toggle('me', mine && !M.over);
    el.who.textContent = M.over ? _t('mp_over') : (mine ? _t('mp_your_turn') : M.turn ? _t('mp_turn_of', { name: playerOf(M.turn).display_name }) : '');
    paintClock();
  }

  function paintClock() {
    if (!M || !el.bar) return;
    if (!_deadline || M.over) { el.bar.style.transform = 'scaleX(1)'; el.bar.classList.remove('low'); return; }
    const left = Math.max(0, _deadline - performance.now()) / 1000;
    el.bar.style.transform = 'scaleX(' + Math.min(1, left / Math.max(1, M.time)) + ')';
    el.bar.classList.toggle('low', left < 5);
  }

  function toast(text, ok) {
    if (!el.board) return;
    const t = document.createElement('div');
    t.className = 'mp-toast' + (ok ? ' ok' : '');
    t.textContent = text;
    el.board.appendChild(t);
    setTimeout(() => t.remove(), 1200);
  }

  // ── End ────────────────────────────────────────────────────────────────────
  function showOver(results) {
    if (!el.board || el.board.querySelector('.mp-over')) return;
    const multi = results.length > 1;
    const top = results.length ? results[0].pairs : 0;
    const me = meId();
    const rows = results.map((r, i) => {
      const p = playerOf(r.player_id);
      const win = multi && r.pairs === top && top > 0;
      return '<div class="mp-row' + (win ? ' win' : '') + '"><span>' + (win ? '🏆' : (i + 1)) + '</span>' +
        mp.renderAvatar(p, 28) +
        '<span class="n">' + _esc(p.display_name || r.display_name) + (r.player_id === me && multi ? ' · ' + _esc(_t('mp_you')) : '') + '</span>' +
        '<small>' + _esc(_t('mp_accuracy')) + ' ' + Math.round(r.accuracy) + '%<br>' + _esc(_t('mp_attempts')) + ' ' + r.attempts + '</small>' +
        '<b>' + r.pairs + ' ✓<br><small>' + _esc(_t('mp_score')) + ' ' + r.score + '</small></b></div>';
    }).join('');
    const ov = document.createElement('div');
    ov.className = 'mp-over';
    ov.innerHTML =
      '<div class="mp-over-card"><h2>' + _esc(multi ? '🏆 ' + _t('mp_winner') + ': ' + (playerOf(results[0].player_id).display_name || '') : '🎉 ' + _t('mp_over')) + '</h2>' +
      '<div class="mp-rows">' + rows + '</div>' +
      '<div class="mp-acts"><button class="mp-btn go" data-again>' + _esc(_t('mp_play_again')) + '</button>' +
      '<a class="mp-btn" href="' + HUB_URL + '">' + _esc(_t('mp_back')) + '</a></div></div>';
    el.board.appendChild(ov);
    const mine = results.find(r => r.player_id === me);
    if (!multi || (mine && mine.pairs === top)) sfx.win();
    ov.querySelector('[data-again]').onclick = e => playAgain(e.currentTarget);
  }

  async function playAgain(btn) {
    btn.disabled = true;
    btn.textContent = _t('mp_starting');
    try {
      const r = await fetch('/api/pub/gamehub/mp/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GH-Token': window.GameHub.getToken() || '' },
        body: JSON.stringify({ game_id: GAME_ID, max_players: mp.players().length > 1 ? 6 : 1, settings: mp.settings() }),
      });
      // 409: an unfinished run or a saved game is waiting; the hub asks about it.
      if (r.status === 409) { location.href = HUB_URL; return; }
      if (!r.ok) throw new Error('room');
      const d = await r.json();
      location.href = d.play_url;
    } catch (_) {
      btn.disabled = false;
      btn.textContent = _t('mp_play_again');
      toast(_t('mp_error_new_game'));
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  // Registered at load time, not inside renderGame: the first message follows
  // the framework's game_started immediately.
  mp.on('mp_state', msg => {
    _sm = msg; _ready = false; _queue = [];
    if (_root && el.board) init();
  });
  ['mp_turn', 'mp_flipped', 'mp_match', 'mp_miss', 'mp_timeout', 'mp_over'].forEach(type => {
    mp.on(type, msg => { if (_ready) apply(msg); else _queue.push(msg); });
  });

  mp.registerGame({
    id: GAME_ID,
    name: _t('mp_title'),
    renderSetup,
    renderGame,
    // Save & exit is solo only; the hub asks the server for the table.
    snapshot: () => null,
  });
})();
