/*
 * Jigsaw — the game, client side.
 *
 * Runs on Game Hub's public play page. The server picks the picture and the
 * seed the pieces are cut from, says which pieces are in their place and how
 * many points that is worth; this file (and the 3D table in table3d.js) draws
 * the pieces and sends what the player does. A piece clicks into the board at
 * once and is confirmed a moment later, so a slow connection never makes the
 * game feel slow; if the server ever disagrees, it sends the pieces again and
 * they are put back the way it has them.
 *
 * There is no time limit. Alone a game is one puzzle; with others everybody
 * builds the same puzzle at their own pace and, when all are done, the most
 * points win. A player who has finished watches the others' boards while they
 * play on.
 */
(function () {
  'use strict';
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'jigsaw';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;
  const _t = (k, v) => (window.t ? window.t(k, v) : k);
  const DIFFS = ['easy', 'medium', 'hard', 'expert', 'master'];
  const GRID = { easy: [6, 4], medium: [9, 6], hard: [12, 8], expert: [15, 10], master: [18, 12] };
  // How faint the picture shows through on the board, and how close to its slot a piece clicks in.
  // The picture is never on the board by itself: only a hint shows it, for a moment.
  const HINT_GHOST = 0.6, HINT_GHOST_MS = 2200;
  const TOL = { easy: 0.62, medium: 0.52, hard: 0.46, expert: 0.4, master: 0.36 };
  const THEMES = {
    nature: ['n_lake', 'n_autumn', 'n_waterfall', 'n_lavender', 'n_coast'],
    animals: ['a_fox', 'a_parrots', 'a_savanna', 'a_reef', 'a_pets'],
    travel: ['t_venice', 't_santorini', 't_market', 't_tulips', 't_balloons'],
  };
  const imgUrl = id => window.asset('/apps/jigsaw/img/t/' + id + '.webp');
  const bigUrl = id => window.asset('/apps/jigsaw/img/' + id + '.webp');

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Sound ──────────────────────────────────────────────────────────────────
  let _muted = store.get('jp_muted', '0') === '1';
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
    pick() { _tone(420, 0.05, 'triangle', 0.06); },
    drop() { _tone(210, 0.07, 'triangle', 0.07); },
    snap() { _tone(880, 0.05, 'square', 0.05); _tone(1320, 0.09, 'sine', 0.09, 0.03); },
    no() { _tone(150, 0.22, 'sawtooth', 0.06); },
    win() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => _tone(f, 0.26, 'sine', 0.12, i * 0.1)); },
  };

  // ── Lobby: what the host chooses ───────────────────────────────────────────
  // What this player has already built, from the app's own record: {image: {size: {points, seconds, hints}}}.
  // Fetched once per lobby; the gallery works without it (nothing is marked then).
  let _mine = null;
  async function loadMine() {
    try {
      const t = (window.GameHub && GameHub.getToken && GameHub.getToken()) || localStorage.getItem('apphub_token') || localStorage.getItem('gh_token') || '';
      if (!t) return null;
      const r = await fetch('/pub/jigsaw/results', { headers: { 'X-Pub-Token': t } });
      const d = r.ok ? await r.json() : null;
      return d && d.results ? d.results : null;
    } catch (_) { return null; }
  }

  function renderSetup(box, settings) {
    box.className = 'jp-setup';
    // A saved game carries its own picture and level, so there is nothing to choose.
    if (mp.isResume && mp.isResume()) {
      box.innerHTML = '<p class="jp-hint">' + _esc(_t('jp_resume_note')) + '</p>';
      return () => ({});
    }
    const keys = Object.keys(THEMES);
    const s = Object.assign({ difficulty: store.get('jp_diff', 'easy'), theme: store.get('jp_theme', keys[0]), image: 'random' }, settings || {});
    box.innerHTML =
      '<label>' + _esc(_t('jp_setup_diff')) + '</label><select id="jp-s-diff"></select>' +
      '<label>' + _esc(_t('jp_setup_theme')) + '</label><select id="jp-s-theme"></select>' +
      '<div class="jp-gal">' +
        '<button type="button" class="jp-gal-nav" data-dir="-1" aria-label="' + _esc(_t('jp_gal_prev')) + '">‹</button>' +
        '<div class="jp-gal-view"></div>' +
        '<button type="button" class="jp-gal-nav" data-dir="1" aria-label="' + _esc(_t('jp_gal_next')) + '">›</button>' +
      '</div>' +
      '<div class="jp-gal-dots"></div>' +
      '<div class="jp-res"></div>' +
      '<p class="jp-hint">' + _esc(_t('jp_setup_hint')) + '</p>';
    const diff = box.querySelector('#jp-s-diff'), theme = box.querySelector('#jp-s-theme');
    const view = box.querySelector('.jp-gal-view'), dots = box.querySelector('.jp-gal-dots'), res = box.querySelector('.jp-res');
    diff.innerHTML = DIFFS.map(d => '<option value="' + d + '">' + _esc(_t('jp_diff_' + d) + ' – ' + _t('jp_pieces', { n: GRID[d][0] * GRID[d][1] })) + '</option>').join('');
    diff.value = DIFFS.indexOf(s.difficulty) !== -1 ? s.difficulty : 'easy';
    theme.innerHTML = keys.map(k => '<option value="' + k + '">' + _esc(_t('jp_theme_' + k)) + '</option>').join('');
    theme.value = THEMES[s.theme] ? s.theme : keys[0];
    // Slide 0 is "surprise me" (a random picture of the theme); the others are its pictures, one at a time and big.
    let idx = 0;
    const ids = () => THEMES[theme.value];
    if (s.image !== 'random' && ids().indexOf(s.image) !== -1) idx = ids().indexOf(s.image) + 1;
    const doneAt = id => (_mine && _mine[id]) || null;
    const paintRes = () => {
      if (idx === 0) { res.innerHTML = ''; return; }
      const mine = doneAt(ids()[idx - 1]) || {};
      res.innerHTML = '<b>' + _esc(_t('jp_res_title')) + '</b>' + DIFFS.map(d => {
        const r = mine[d];
        return '<div class="jp-res-row' + (d === diff.value ? ' on' : '') + (r ? ' done' : '') + '"><span>' + _esc(_t('jp_diff_' + d)) + '</span>' +
          (r ? '<em>✓ ' + _esc(clock(r.seconds)) + ' · ' + _esc(_t('jp_res_points', { n: fmt(r.points) })) + (r.hints ? ' · ' + _esc(_t('jp_hints_used', { h: r.hints })) : '') + '</em>'
             : '<em>' + _esc(_t('jp_res_none')) + '</em>') + '</div>';
      }).join('');
    };
    const paint = () => {
      const list = ids();
      if (idx < 0) idx = list.length;
      if (idx > list.length) idx = 0;
      if (idx === 0) {
        view.innerHTML = '<div class="jp-gal-rand"><span>🎲</span><b>' + _esc(_t('jp_random')) + '</b><small>' + _esc(_t('jp_random_note')) + '</small></div>';
      } else {
        const id = list[idx - 1];
        view.innerHTML = '<img alt="" src="' + bigUrl(id) + '">' + (doneAt(id) ? '<span class="jp-gal-done">✓</span>' : '') +
          '<span class="jp-gal-count">' + idx + ' / ' + list.length + '</span>';
      }
      dots.innerHTML = ['random'].concat(list).map((id, k) => '<button type="button" data-k="' + k + '" class="' + (k === idx ? 'on' : '') + (k && doneAt(id) ? ' done' : '') + '" aria-label="' + (k || '🎲') + '">' + (k ? '' : '🎲') + '</button>').join('');
      paintRes();
    };
    box.querySelectorAll('.jp-gal-nav').forEach(b => { b.onclick = () => { idx += Number(b.dataset.dir); paint(); sfx.pick(); }; });
    dots.addEventListener('click', ev => { const b = ev.target.closest('button[data-k]'); if (b) { idx = Number(b.dataset.k); paint(); } });
    // Swipe left or right over the picture, as in any gallery.
    let sx = null;
    view.addEventListener('touchstart', ev => { sx = ev.touches[0].clientX; }, { passive: true });
    view.addEventListener('touchend', ev => {
      if (sx == null) return;
      const dx = ev.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 40) { idx += dx < 0 ? 1 : -1; paint(); }
    });
    theme.onchange = () => { idx = 0; paint(); };
    diff.onchange = paintRes;
    paint();
    loadMine().then(m => { _mine = m; if (box.isConnected) paint(); });
    return () => {
      store.set('jp_diff', diff.value); store.set('jp_theme', theme.value);
      return { difficulty: diff.value, theme: theme.value, image: idx === 0 ? 'random' : ids()[idx - 1] };
    };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _root = null, _sm = null;
  let _ready = false, _queue = [];
  let _three = null, _mod = null, _no3d = false, T = null, _tableKey = '';
  let M = null;                          // the model of the game
  let PL = [];                           // which pieces are in place
  let pts = 0, hintsUsed = 0, N = 0, V = 10;
  let peers = {};                        // pid → board, only once this player has finished
  let _gen = 0, _seq = 0, _results = null, _hintAsked = false, _hintWait = false;
  let _t0 = 0, _tick = 0, _stopClock = false, _keys = null, _lastGrab = -1;
  let _ghostTimer = 0, _peek = false, _view = 'pool';
  let el = {};

  const meId = () => mp.youId();
  const playerOf = id => mp.players().find(p => p.id === id) || { id: id, display_name: '?' };
  const fmt = n => Number(n || 0).toLocaleString((window.mvmOS && window.mvmOS.lang) || undefined);
  const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const tile = (k, label) => '<div class="jp-tile jp-t-' + k + '"><small>' + _esc(_t(label)) + '</small><b class="jp-' + k + '">–</b></div>';
  const placedN = () => PL.reduce((n, x) => n + (x ? 1 : 0), 0);

  // ── Screen ─────────────────────────────────────────────────────────────────
  function renderGame(root) {
    _root = root;
    _ready = false;
    root.innerHTML =
      '<div class="jp-wrap">' +
        '<div class="jp-players"></div>' +
        '<div class="jp-status">' + tile('df', 'jp_hud_diff') + tile('tm', 'jp_hud_time') + tile('pts', 'jp_hud_points') + tile('pc', 'jp_hud_pieces') + '</div>' +
        '<div class="jp-stage"><div class="jp-load">' + _esc(_t('jp_waiting')) + '</div></div>' +
        '<div class="jp-foot"><button class="jp-snd" data-snd title="' + _esc(_t('jp_sound')) + '"></button></div>' +
      '</div>';
    el = {
      players: root.querySelector('.jp-players'),
      df: root.querySelector('.jp-df'), tm: root.querySelector('.jp-tm'),
      pts: root.querySelector('.jp-pts'), pc: root.querySelector('.jp-pc'),
      stage: root.querySelector('.jp-stage'),
    };
    const snd = root.querySelector('[data-snd]');
    const paintSnd = () => { snd.textContent = _muted ? '🔇' : '🔊'; };
    snd.onclick = () => { _muted = !_muted; store.set('jp_muted', _muted ? '1' : '0'); paintSnd(); sfx.pick(); };
    paintSnd();
    clearInterval(_tick);
    _tick = setInterval(paintClock, 500);
    if (_keys) document.removeEventListener('keydown', _keys);
    _keys = onKey;
    document.addEventListener('keydown', _keys);
    if (T) { T.destroy(); T = null; _tableKey = ''; }      // the old canvas went with the old page
    if (_sm) init();
  }

  async function init() {
    const sm = _sm, gen = ++_gen;
    _ready = false;
    if (gen !== _gen) return;
    M = {
      multi: !!sm.multi, diff: sm.difficulty, cols: sm.cols, rows: sm.rows, pp: sm.piece_points, 
      order: sm.order || [], prog: sm.progress || {}, over: !!sm.over, done: !!sm.done, quit: !!sm.quit,
      urls: sm.urls, image: sm.image, seed: sm.seed,
    };
    N = sm.cols * sm.rows; V = sm.piece_points;
    PL = sm.placed.split('').map(c => c === '1');
    pts = sm.points; hintsUsed = sm.hints;
    peers = {};
    (sm.peers || []).forEach(b => { peers[b.pid] = b; });
    _t0 = performance.now() - (sm.elapsed || 0) * 1000;
    _stopClock = M.done;
    if (M.done) _t0 = performance.now() - (sm.time || 0) * 1000;
    paintStatus();
    paintPlayers();
    try {
      if (!_three) _three = await import(sm.urls.three);
      if (!_mod) _mod = await import(sm.urls.scene);
    } catch (e) { console.error(e); _no3d = true; }
    if (gen !== _gen) return;
    if (_no3d) { el.stage.innerHTML = '<div class="jp-load">' + _esc(_t('jp_no_webgl')) + '</div>'; return; }
    const key = sm.seed + ':' + sm.image;
    if (!T || _tableKey !== key) {
      if (T) { T.destroy(); T = null; }
      buildStage();
      try {
        T = _mod.createTable(_three, el.table, {
          cols: sm.cols, rows: sm.rows, seed: sm.seed, image: sm.urls.image,
          tol: TOL[sm.difficulty] || 0.5, ghost: 0,
          onBuild: f => { const b = el.stage.querySelector('.jp-bar i'); if (b) b.style.width = Math.round(f * 100) + '%'; },
          onGrab: i => { _lastGrab = i; sfx.pick(); },
          onDrop: (i, snapped) => { if (!snapped) sfx.drop(); saveSoon(); },
          onSnap,
        });
        await T.ready;
      } catch (e) {
        console.error(e);
        _no3d = true;
        el.stage.innerHTML = '<div class="jp-load">' + _esc(_t('jp_no_webgl')) + '</div>';
        T = null;
        return;
      }
      if (gen !== _gen) return;
      T.setPlaced(sm.placed);
      const saved = mp.savedState && mp.savedState();
      const keep = store.get('jp_pos_' + mp.roomId(), '');
      const wide = el.table.clientWidth >= el.table.clientHeight * 0.95;
      T.scatter(wide ? 'ring' : 'rows');
      let pos = null;
      if (saved && Array.isArray(saved.pos)) pos = saved.pos;
      else if (keep) { try { pos = JSON.parse(keep); } catch (_) {} }
      if (pos) T.restore(pos);
      _view = 'pool';
      _tableKey = key;
      const ld = el.stage.querySelector('.jp-loading');
      if (ld) ld.remove();
    } else {
      T.setPlaced(sm.placed);
    }
    _peek = false;
    paintTools();
    _ready = true;
    paintStatus();
    paintTools();
    const q = _queue; _queue = [];
    q.forEach(apply);
    if (M.done && !_results) showDone({ points: pts, time: sm.time, clean: sm.clean, speed: sm.speed });
  }

  function buildStage() {
    el.stage.innerHTML =
      '<div class="jp-table"></div>' +
      '<div class="jp-loading"><div class="jp-card"><p>' + _esc(_t('jp_cutting')) + '</p><div class="jp-bar"><i></i></div></div></div>' +
      '<div class="jp-peek" hidden><img alt=""><button type="button" class="jp-peek-big" aria-label="' + _esc(_t('jp_enlarge')) + '">⤢</button></div>' +
      '<div class="jp-tools">' +
        btn('view', '▦', 'jp_pool') + btn('tidy', '⇅', 'jp_tidy') +
        btn('tilt', '◧', 'jp_flat') + btn('peek', '🖼', 'jp_picture') + btn('hint', '💡', 'jp_hint') +
        (M.multi ? btn('quit', '🏳', 'jp_give_up') : '') +
      '</div>';
    el.table = el.stage.querySelector('.jp-table');
    el.tools = el.stage.querySelector('.jp-tools');
    el.peek = el.stage.querySelector('.jp-peek');
    el.peek.querySelector('img').src = M.urls.image;
    el.peek.onclick = () => { _peek = false; paintTools(); };
    // The picture on the box, full screen, for anyone who wants to look at it closely.
    el.peek.querySelector('.jp-peek-big').onclick = ev => { ev.stopPropagation(); showBig(); };
    el.tools.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-act]');
      if (b) act(b.dataset.act);
    });
  }
  const btn = (a, icon, label) => '<button data-act="' + a + '" title="' + _esc(_t(label)) + '"><i>' + icon + '</i><span>' + _esc(_t(label)) + '</span></button>';

  // ── Painting ───────────────────────────────────────────────────────────────
  function paintTools() {
    if (!el.tools || !M) return;
    const on = canPlay();
    const q = a => el.tools.querySelector('[data-act="' + a + '"]');
    ['view', 'tidy', 'tilt'].forEach(a => { q(a).disabled = !T || (a === 'tidy' ? !on : false); });
    q('view').querySelector('span').textContent = _t(_view === 'board' ? 'jp_pool' : 'jp_board');
    q('view').querySelector('i').textContent = _view === 'board' ? '🧩' : '▦';
    q('peek').classList.toggle('active', _peek);
    q('hint').disabled = !on || placedN() >= N;
    const tilted = T ? T.tilted() : true;
    const tl = q('tilt');
    tl.querySelector('span').textContent = _t(tilted ? 'jp_flat' : 'jp_3d');
    tl.classList.toggle('active', !tilted);
    const g = q('quit');
    if (g) g.disabled = !on;
    if (el.peek) el.peek.hidden = !_peek;
  }

  function paintStatus() {
    if (!M || !el.df) return;
    el.df.textContent = _t('jp_diff_' + M.diff);
    el.pts.textContent = fmt(myPts());
    el.pc.textContent = placedN() + '/' + N;
    paintClock();
    const me = meId();
    M.prog[me] = Object.assign({}, M.prog[me], { placed: placedN(), points: pts, hints: hintsUsed });
    paintPlayers();
  }

  function paintClock() {
    if (!M || !el.tm) return;
    if (_stopClock) return;
    el.tm.textContent = clock((performance.now() - _t0) / 1000);
    el.pts.textContent = fmt(myPts());
    if (M.order.length > 1) paintPlayers();
  }

  // The points shown are the ones in the bank: the speed bonus is added when the puzzle is complete.
  const shownPts = pr => pr.points || 0;
  const myPts = () => pts;
  const pct = pr => Math.max(0, Math.min(100, Math.round(((pr && pr.placed != null ? pr.placed : 0) / Math.max(1, N)) * 100)));

  function paintPlayers() {
    if (!M || !el.players) return;
    const me = meId();
    el.players.style.display = M.order.length > 1 ? '' : 'none';
    el.players.innerHTML = M.order.map(id => {
      const p = playerOf(id), pr = M.prog[id] || {};
      const badge = pr.done ? '🏁' : (pr.quit ? '🏳' : pct(pr) + '%');
      return '<div class="jp-chip' + (pr.done ? ' done' : '') + (pr.quit ? ' quit' : '') + '">' + mp.renderAvatar(p, 26) +
        '<span class="jp-name">' + _esc(p.display_name) + (id === me ? ' · ' + _esc(_t('jp_you')) : '') + '</span>' +
        '<b>' + _esc(badge) + '</b><small>' + fmt(shownPts(pr)) + '</small></div>';
    }).join('');
  }

  // ── Play ───────────────────────────────────────────────────────────────────
  const canPlay = () => !!M && _ready && !!T && !M.over && !M.done && !M.quit && !_results;
  // Two pieces' points, and the more of the puzzle is in place, the more on top.
  const hintCost = () => 2 * V + Math.round(V * placedN() / 10);

  function saveSoon() {
    if (!M) return;
    clearTimeout(saveSoon._t);
    saveSoon._t = setTimeout(() => { if (T) store.set('jp_pos_' + mp.roomId(), JSON.stringify(T.positions())); }, 600);
  }

  // A piece clicked into its slot: counted at once, confirmed by the server a moment later.
  function onSnap(i, dx, dz) {
    if (!canPlay() || PL[i]) { if (T && PL[i] !== true) T.unlock(i); return; }
    PL[i] = true;
    pts += V;
    sfx.snap();
    floatText(i, '+' + V, 'up');
    paintStatus(); paintTools(); saveSoon();
    mp.send({ type: 'jp_place', i: i, dx: Math.round(dx * 1000) / 1000, dy: Math.round(dz * 1000) / 1000, seq: ++_seq });
  }

  function showBig() {
    if (document.querySelector('.jp-big')) return;
    const ov = document.createElement('div');
    ov.className = 'jp-big';
    ov.innerHTML = '<img alt="" src="' + _esc(M.urls.image) + '"><button type="button" aria-label="' + _esc(_t('jp_close')) + '">✕</button>';
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    ov.onclick = close;
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
  }

  function act(kind) {
    if (!T) return;
    if (kind === 'view') { _view = _view === 'board' ? 'pool' : 'board'; T.fit(_view); paintTools(); sfx.pick(); }
    else if (kind === 'tilt') { T.setTilt(!T.tilted()); setTimeout(paintTools, 520); sfx.pick(); }
    else if (kind === 'peek') { _peek = !_peek; sfx.pick(); paintTools(); }
    else if (!canPlay()) return;
    else if (kind === 'tidy') { T.tidy(); sfx.pick(); saveSoon(); }
    else if (kind === 'hint') {
      if (_hintWait) return;
      const ask = () => {
        if (!canPlay()) return;
        _hintWait = true;
        mp.send({ type: 'jp_hint', sel: _lastGrab, seq: ++_seq });
        setTimeout(() => { _hintWait = false; }, 4000);
      };
      // The first hint of a game says what it costs; after that it just helps.
      if (_hintAsked) ask();
      else confirmBox(_t('jp_hint_q', { n: hintCost() }), _t('jp_hint'), () => { _hintAsked = true; ask(); });
    } else if (kind === 'quit') {
      confirmBox(_t('jp_give_up_q'), _t('jp_give_up'), () => {
        if (!canPlay()) return;
        M.quit = true;
        mp.send({ type: 'jp_quit', seq: ++_seq });
        paintTools();
        showWait();
      });
    }
  }

  function onKey(ev) {
    if (!M || !_ready || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = ev.key.toLowerCase();
    if (k === 'h') act('hint');
    else if (k === 't') act('tidy');
    else if (k === 'p') act('peek');
    else if (k === 'f') act('view');
    else if (k === 'escape' && _peek) { _peek = false; paintTools(); }
  }

  function confirmBox(text, okLabel, onOk) {
    if (!el.stage || el.stage.querySelector('.jp-confirm')) return;
    const box = document.createElement('div');
    box.className = 'jp-confirm';
    box.innerHTML = '<div class="jp-card"><p>' + _esc(text) + '</p><div class="jp-acts">' +
      '<button class="jp-btn go" data-ok>' + _esc(okLabel) + '</button>' +
      '<button class="jp-btn" data-no>' + _esc(_t('jp_cancel')) + '</button></div></div>';
    el.stage.appendChild(box);
    box.querySelector('[data-ok]').onclick = () => { box.remove(); onOk(); };
    box.querySelector('[data-no]').onclick = () => box.remove();
  }

  // ── Little effects ─────────────────────────────────────────────────────────
  function floatText(i, text, cls) {
    if (!T || !el.table) return;
    const p = T.project(i);
    if (!p) return;
    const f = document.createElement('em');
    f.className = 'jp-float ' + cls;
    f.textContent = text;
    f.style.left = p.x + 'px';
    f.style.top = p.y + 'px';
    el.table.appendChild(f);
    setTimeout(() => f.remove(), 1100);
  }

  function confetti() {
    const host = el.stage;
    if (!host) return;
    const colors = ['#ffd60a', '#7ff0dc', '#ff6b8a', '#a58bff', '#6ec1ff', '#9bf2c8'];
    const wrap = document.createElement('div');
    wrap.className = 'jp-confetti';
    for (let k = 0; k < 70; k++) {
      const s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[k % colors.length];
      s.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
      s.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      s.style.animationDelay = (Math.random() * 0.8) + 's';
      s.style.animationDuration = (2.2 + Math.random() * 1.6) + 's';
      wrap.appendChild(s);
    }
    host.appendChild(wrap);
    setTimeout(() => wrap.remove(), 4800);
  }

  function toast(text) {
    if (!el.stage) return;
    const old = el.stage.querySelector('.jp-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'jp-toast';
    t.textContent = text;
    el.stage.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  function apply(m) {
    if (!M) return;
    switch (m.type) {
      case 'jp_ok':
        pts = m.points;
        paintStatus();
        break;
      case 'jp_sync':
        if ((m.seq || 0) >= _seq) {
          PL = m.placed.split('').map(c => c === '1');
          pts = m.points; hintsUsed = m.hints != null ? m.hints : hintsUsed;
          if (T) T.setPlaced(m.placed);
          paintStatus(); paintTools(); sfx.no();
        }
        break;
      case 'jp_hint_res': {
        _hintWait = false;
        if (m.i < 0) { toast(_t('jp_hint_none')); break; }
        pts = m.points; hintsUsed++;
        PL[m.i] = true;
        if (T) {
          T.setGhost(HINT_GHOST);
          clearTimeout(_ghostTimer);
          _ghostTimer = setTimeout(() => { if (T) T.setGhost(0); }, HINT_GHOST_MS);
        }
        if (T) T.flyHome(m.i, () => { floatText(m.i, '−' + fmt(m.cost), 'down'); sfx.snap(); });
        paintStatus(); paintTools();
        toast(_t('jp_hint_cost', { n: fmt(m.cost) }));
        break;
      }
      case 'jp_progress':
        M.prog[m.pid] = { placed: m.placed, points: m.points, hints: m.hints, done: m.done, quit: m.quit, rank: m.rank };
        paintPlayers();
        break;
      case 'jp_done':
        M.done = true; _stopClock = true;
        pts = m.points; paintStatus(); paintTools();
        el.tm.textContent = clock(m.time);
        (m.peers || []).forEach(b => { peers[b.pid] = b; });
        if (T) T.celebrate();
        sfx.win(); confetti();
        // Alone, the result of the game takes its place a moment later.
        if (M.multi) setTimeout(() => { if (!_results) showDone(m); }, 2200);
        break;
      case 'jp_peer':
        peers[m.pid] = m;
        paintPeers();
        break;
      case 'jp_over':
        _results = m.results; M.over = true; _stopClock = true;
        paintPlayers(); paintTools();
        setTimeout(() => showOver(m), M.done && !M.multi ? 2400 : 500);
        break;
    }
  }

  // ── Waiting, watching and the end ──────────────────────────────────────────
  function showWait() {
    if (!el.stage || el.stage.querySelector('.jp-wait') || _results) return;
    const w = document.createElement('div');
    w.className = 'jp-wait';
    w.innerHTML = '<div class="jp-card"><h3>🏳 ' + _esc(_t('jp_gave_up')) + '</h3><p>' + _esc(_t('jp_waiting_others')) + '</p></div>';
    el.stage.appendChild(w);
  }

  function mini(b) {
    let h = '<div class="jp-mini" style="background-image:url(' + _esc(M.urls.thumb) + ');grid-template-columns:repeat(' + M.cols + ',1fr)">';
    for (let i = 0; i < N; i++) h += '<i class="' + (b.placed[i] === '1' ? 'p' : '') + '"></i>';
    return h + '</div>';
  }

  function peerCard(id) {
    const b = peers[id], p = playerOf(id);
    const pr = M.prog[id] || b || {};
    let status;
    if (pr.done) status = '🏁 ' + _t('jp_solved_in', { t: clock((b && b.time) || 0) });
    else if (pr.quit) status = '🏳 ' + _t('jp_gave_up');
    else status = _t('jp_playing', { n: pct(pr) });
    return '<div class="jp-peer' + (pr.done ? ' done' : '') + '">' +
      '<div class="jp-peer-h">' + mp.renderAvatar(p, 24) + '<span class="jp-name">' + _esc(p.display_name) + '</span><small>' + fmt(shownPts(pr)) + '</small></div>' +
      (b ? mini(b) : '') + '<div class="jp-peer-s">' + _esc(status) + '</div></div>';
  }

  function paintPeers() {
    const box = el.stage && el.stage.querySelector('.jp-peers');
    if (!box || !M) return;
    box.innerHTML = M.order.filter(id => id !== meId() && peers[id]).map(peerCard).join('');
  }

  // A closable result: the player may want to admire the finished picture on the table.
  function closable(ov) {
    const x = document.createElement('button');
    x.className = 'jp-x';
    x.textContent = '✕';
    x.title = _t('jp_admire');
    x.onclick = () => { ov.hidden = true; showReopen(ov); };
    ov.querySelector('.jp-card').prepend(x);
  }
  function showReopen(ov) {
    let b = el.stage.querySelector('.jp-reopen');
    if (!b) {
      b = document.createElement('button');
      b.className = 'jp-btn go jp-reopen';
      b.textContent = '🏆 ' + _t('jp_results');
      el.stage.appendChild(b);
    }
    b.onclick = () => { ov.hidden = false; b.remove(); };
  }

  // A player who has finished, with others still playing: the result, and the
  // others' boards as they fill in.
  function showDone(m) {
    if (!el.stage || el.stage.querySelector('.jp-done') || _results) return;
    el.stage.querySelectorAll('.jp-confirm').forEach(n => n.remove());
    const d = document.createElement('div');
    d.className = 'jp-done';
    d.innerHTML =
      '<div class="jp-card wide"><div class="jp-trophy">🏁</div>' +
      '<h2>' + _esc(_t('jp_solved_title')) + '</h2>' +
      '<div class="jp-bd">' +
        '<div><span>' + _esc(_t('jp_hud_time')) + '</span><b>' + clock(m.time) + '</b></div>' +
        (m.clean ? '<div><span>' + _esc(_t('jp_bd_clean')) + '</span><b>+' + fmt(m.clean) + '</b></div>' : '') +
        (m.speed ? '<div><span>' + _esc(_t('jp_bd_speed')) + '</span><b>+' + fmt(m.speed) + '</b></div>' : '') +
        '<div class="tot"><span>' + _esc(_t('jp_hud_points')) + '</span><b>' + fmt(m.points) + '</b></div>' +
      '</div>' +
      '<div data-gh-stage-done></div><h4>' + _esc(_t('jp_watching')) + '</h4>' +
      '<div class="jp-peers"></div>' +
      '<p class="jp-hint">' + _esc(_t('jp_leave_note')) + '</p>' +
      '<div class="jp-acts"><a class="jp-btn" href="' + HUB_URL + '">' + _esc(_t('jp_back')) + '</a></div></div>';
    el.stage.appendChild(d);
    if (mp.stageRecords) mp.stageRecords(d.querySelector('[data-gh-stage-done]'), 'v1:difficulty:' + M.diff, m.points, { difficulty: true, refresh: true, records: m.stage_records });
    closable(d);
    paintPeers();
  }

  function showOver(m) {
    if (!el.stage || el.stage.querySelector('.jp-over')) return;
    const results = m.results, multi = !!m.multi, me = meId();
    el.stage.querySelectorAll('.jp-wait,.jp-confirm,.jp-done,.jp-reopen').forEach(n => n.remove());
    const rows = results.map((r, i) => {
      const p = playerOf(r.player_id);
      const win = multi && r.rank === 1 && r.points > 0;
      const what = r.done ? _t('jp_solved_in', { t: clock(r.time) }) : _t('jp_result_pct', { n: pct(r) });
      return '<div class="jp-row' + (win ? ' win' : '') + '"><span>' + (win ? '🏆' : (i + 1)) + '</span>' +
        mp.renderAvatar(p, 28) +
        '<span class="n">' + _esc(p.display_name || r.display_name) + (r.player_id === me && multi ? ' · ' + _esc(_t('jp_you')) : '') + '</span>' +
        '<small>' + _esc(what) + '<br>' + _esc(_t('jp_hints_used', { h: r.hints })) + '</small>' +
        '<b>' + fmt(r.points) + '<br><small>' + _esc(_t('jp_score')) + '</small></b></div>';
    }).join('');
    const top = results[0];
    const title = multi
      ? (top.points > 0 ? '🏆 ' + _t('jp_winner') + ': ' + (playerOf(top.player_id).display_name || top.display_name || '') : _t('jp_over'))
      : '🧩 ' + _t('jp_solved_title');
    const mine = results.find(r => r.player_id === me);
    const breakdown = !multi && mine && mine.done
      ? '<div class="jp-bd"><div><span>' + _esc(_t('jp_hud_time')) + '</span><b>' + clock(mine.time) + '</b></div>' +
        (mine.clean ? '<div><span>' + _esc(_t('jp_bd_clean')) + '</span><b>+' + fmt(mine.clean) + '</b></div>' : '') +
        (mine.speed ? '<div><span>' + _esc(_t('jp_bd_speed')) + '</span><b>+' + fmt(mine.speed) + '</b></div>' : '') +
        '</div>' : '';
    const ov = document.createElement('div');
    ov.className = 'jp-over';
    ov.innerHTML =
      '<div class="jp-card"><h2>' + _esc(title) + '</h2>' + breakdown + '<div class="jp-rows">' + rows + '</div>' +
      (multi ? '' : '<p class="jp-hint">' + _esc(_t('jp_saved_note')) + '</p>') +
      '<div data-gh-stage-final></div><section data-gh-results></section><div class="jp-acts"><button class="jp-btn go" data-again>' + _esc(multi ? _t('jp_play_again') : _t('jp_new_game')) + '</button>' +
      '<a class="jp-btn" href="' + HUB_URL + '">' + _esc(_t('jp_back')) + '</a></div></div>';
    el.stage.appendChild(ov);
    if (mp.stageRecords) mp.stageRecords(ov.querySelector('[data-gh-stage-final]'), 'v1:difficulty:' + M.diff, mine ? mine.points : null, { difficulty: true });
    closable(ov);
    if (multi && mine && mine.rank === 1 && mine.points > 0) { sfx.win(); confetti(); }
    ov.querySelector('[data-again]').onclick = e => playAgain(e.currentTarget);
  }

  async function playAgain(btn) {
    btn.disabled = true;
    btn.textContent = _t('jp_starting');
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
      btn.textContent = _t(mp.players().length > 1 ? 'jp_play_again' : 'jp_new_game');
      alert(_t('jp_error_new_game'));
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  mp.on('jp_state', msg => {
    _sm = msg; _ready = false; _queue = []; _results = null; _hintWait = false;
    M = null;
    if (_root && el.stage) init();
  });
  ['jp_ok', 'jp_sync', 'jp_hint_res', 'jp_progress', 'jp_done', 'jp_peer', 'jp_over'].forEach(type => {
    mp.on(type, msg => { if (_ready) apply(msg); else _queue.push(msg); });
  });

  mp.registerGame({
    id: GAME_ID,
    name: _t('jp_title'),
    renderSetup,
    renderGame,
    // The pieces in place live on the server; where the loose ones lie is the browser's half of a save.
    snapshot: () => (M && M.multi ? null : { pos: T ? T.positions() : [] }),
  });
})();
