/*
 * Sudoku — the game, client side.
 *
 * Runs on Game Hub's public play page. The server owns the puzzle and its
 * solution and checks every number; this file draws the board and sends what
 * the player does. A number is shown at once and confirmed a moment later, so
 * a slow connection never makes the game feel slow; if the server ever
 * disagrees, it sends the board again and it is put back the way it has it.
 *
 * There is no time limit. Alone a game is one puzzle; with others everybody
 * solves the same puzzle at their own pace and, when all are done, the most
 * points win. A player who has finished watches the others' boards while they
 * play on.
 */
(function () {
  'use strict';
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'sudoku';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;
  const _t = (k, v) => (window.t ? window.t(k, v) : k);
  const DIFFS = ['easy', 'medium', 'hard', 'expert', 'master'];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Row, column and box of every cell, and the cells that see each other.
  const ROW = [], COL = [], BOX = [];
  for (let i = 0; i < 81; i++) { ROW[i] = Math.floor(i / 9); COL[i] = i % 9; BOX[i] = Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3); }
  const sees = (a, b) => a !== b && (ROW[a] === ROW[b] || COL[a] === COL[b] || BOX[a] === BOX[b]);
  const unitCells = {
    r: r => Array.from({ length: 9 }, (_, k) => r * 9 + k),
    c: c => Array.from({ length: 9 }, (_, k) => k * 9 + c),
    b: b => Array.from({ length: 9 }, (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3)),
  };

  // ── Sound ──────────────────────────────────────────────────────────────────
  let _muted = store.get('sd_muted', '0') === '1';
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
    pick() { _tone(480, 0.05, 'triangle', 0.06); },
    ok() { _tone(660, 0.09, 'sine', 0.1); _tone(880, 0.12, 'sine', 0.08, 0.07); },
    no() { _tone(150, 0.22, 'sawtooth', 0.06); },
    note() { _tone(760, 0.04, 'triangle', 0.05); },
    unit() { [523, 659, 784].forEach((f, i) => _tone(f, 0.14, 'sine', 0.09, i * 0.07)); },
    win() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => _tone(f, 0.26, 'sine', 0.12, i * 0.1)); },
  };

  // ── Lobby: what the host chooses ───────────────────────────────────────────
  function renderSetup(box, settings) {
    // A saved game carries its own difficulty, so there is nothing to choose.
    if (mp.isResume && mp.isResume()) {
      box.className = 'sd-setup';
      box.innerHTML = '<p class="sd-hint">' + _esc(_t('sd_resume_note')) + '</p>';
      return () => ({});
    }
    const s = Object.assign({ difficulty: store.get('sd_diff', 'easy') }, settings || {});
    box.className = 'sd-setup';
    box.innerHTML =
      '<label>' + _esc(_t('sd_setup_diff')) + '</label><select id="sd-s-diff"></select>' +
      '<p class="sd-hint">' + _esc(_t('sd_setup_hint')) + '</p>';
    const sel = box.querySelector('#sd-s-diff');
    sel.innerHTML = DIFFS.map(d => '<option value="' + d + '">' + _esc(_t('sd_diff_' + d)) + '</option>').join('');
    sel.value = DIFFS.indexOf(s.difficulty) !== -1 ? s.difficulty : 'easy';
    return () => { store.set('sd_diff', sel.value); return { difficulty: sel.value }; };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _root = null, _sm = null;
  let _ready = false, _queue = [];
  let M = null;                          // the model of the game
  let P = [], G = [], S = [], N = [];    // clues, numbers, state of each cell (g c h w ? .), notes as bit masks
  let cells = [];                        // the DOM cells
  let sel = -1, hiDigit = 0, noteMode = false, hist = [];
  let pts = 0, mist = 0, hintsUsed = 0, clues = 0;
  let peers = {};                        // pid → board, only once this player has finished
  let _gen = 0, _seq = 0, _results = null, _hintAsked = false, _hintWait = false;
  let _t0 = 0, _tick = 0, _stopClock = false, _ro = null, _keys = null;
  let el = {};

  const meId = () => mp.youId();
  const playerOf = id => mp.players().find(p => p.id === id) || { id: id, display_name: '?' };
  const fmt = n => Number(n || 0).toLocaleString((window.mvmOS && window.mvmOS.lang) || undefined);
  const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const tile = (k, label) => '<div class="sd-tile sd-t-' + k + '"><small>' + _esc(_t(label)) + '</small><b class="sd-' + k + '">–</b></div>';

  // ── Screen ─────────────────────────────────────────────────────────────────
  function renderGame(root) {
    _root = root;
    _ready = false;
    root.innerHTML =
      '<div class="sd-wrap">' +
        '<div class="sd-players"></div>' +
        '<div class="sd-status">' + tile('df', 'sd_hud_diff') + tile('tm', 'sd_hud_time') + tile('pts', 'sd_hud_points') + tile('er', 'sd_hud_errors') + '</div><div data-gh-stage></div>' +
        '<div class="sd-stage"><div class="sd-load">' + _esc(_t('sd_waiting')) + '</div></div>' +
        '<div class="sd-foot"><button class="sd-snd" data-snd title="' + _esc(_t('sd_sound')) + '"></button></div>' +
      '</div>';
    el = {
      players: root.querySelector('.sd-players'),
      df: root.querySelector('.sd-df'), tm: root.querySelector('.sd-tm'),
      pts: root.querySelector('.sd-pts'), er: root.querySelector('.sd-er'),
      stage: root.querySelector('.sd-stage'),
    };
    const snd = root.querySelector('[data-snd]');
    const paintSnd = () => { snd.textContent = _muted ? '🔇' : '🔊'; };
    snd.onclick = () => { _muted = !_muted; store.set('sd_muted', _muted ? '1' : '0'); paintSnd(); sfx.pick(); };
    paintSnd();
    clearInterval(_tick);
    _tick = setInterval(paintClock, 500);
    if (_keys) document.removeEventListener('keydown', _keys);
    _keys = onKey;
    document.addEventListener('keydown', _keys);
    if (_ro) _ro.disconnect();
    _ro = window.ResizeObserver ? new ResizeObserver(layout) : null;
    if (_ro) _ro.observe(el.stage);
    if (_sm) init();
  }

  function init() {
    const sm = _sm, gen = ++_gen;
    _ready = false;
    if (gen !== _gen) return;
    M = {
      multi: !!sm.multi, diff: sm.difficulty, cp: sm.cell_points, step: sm.hint_step || 1, tstep: sm.time_step || 10, order: sm.order || [], prog: sm.progress || {},
      over: !!sm.over, done: !!sm.done, quit: !!sm.quit,
    };
    P = sm.puzzle.split('').map(Number);
    G = sm.grid.split('').map(Number);
    S = sm.cells.split('');
    clues = P.filter(Boolean).length;
    pts = sm.points; mist = sm.mistakes; hintsUsed = sm.hints;
    N = new Array(81).fill(0);
    const saved = mp.savedState && mp.savedState();
    const keep = store.get('sd_notes_' + mp.roomId(), '');
    if (saved && Array.isArray(saved.notes) && saved.notes.length === 81) N = saved.notes.map(n => n | 0);
    else if (keep) { const a = keep.split(',').map(n => parseInt(n, 10) || 0); if (a.length === 81) N = a; }
    for (let i = 0; i < 81; i++) if (S[i] !== '.' && S[i] !== 'w') N[i] = 0;
    sel = -1; hiDigit = 0; noteMode = false; hist = []; peers = {};
    (sm.peers || []).forEach(b => { peers[b.pid] = b; });
    _t0 = performance.now() - (sm.elapsed || 0) * 1000;
    _stopClock = M.done;
    if (M.done) _t0 = performance.now() - (sm.time || 0) * 1000;
    buildStage();
    paintAll();
    paintPlayers();
    _ready = true;
    paintTools();                      // the buttons are there from the first move
    const q = _queue; _queue = [];
    q.forEach(apply);
    if (M.done && !_results) showDone({ points: pts, time: sm.time, clean: sm.clean, timecost: sm.timecost });
  }

  function buildStage() {
    el.stage.innerHTML =
      '<div class="sd-play">' +
        '<div class="sd-boardwrap"><div class="sd-grid"></div></div>' +
        '<div class="sd-pad">' +
          '<div class="sd-tools">' +
            '<button data-act="undo" title="' + _esc(_t('sd_undo')) + '"><i>↶</i><span>' + _esc(_t('sd_undo')) + '</span></button>' +
            '<button data-act="erase" title="' + _esc(_t('sd_erase')) + '"><i>⌫</i><span>' + _esc(_t('sd_erase')) + '</span></button>' +
            '<button data-act="notes" title="' + _esc(_t('sd_notes')) + '"><i>✎</i><span>' + _esc(_t('sd_notes')) + '</span></button>' +
            '<button data-act="hint" title="' + _esc(_t('sd_hint')) + '"><i>💡</i><span>' + _esc(_t('sd_hint')) + '</span></button>' +
            (M.multi ? '<button data-act="quit" title="' + _esc(_t('sd_give_up')) + '"><i>🏳</i><span>' + _esc(_t('sd_give_up')) + '</span></button>' : '') +
          '</div>' +
          '<div class="sd-digits">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => '<button data-d="' + d + '"><b>' + d + '</b><small></small></button>').join('') + '</div>' +
        '</div>' +
      '</div>';
    const grid = el.stage.querySelector('.sd-grid');
    cells = new Array(81);
    for (let b = 0; b < 9; b++) {
      const box = document.createElement('div');
      box.className = 'sd-box';
      unitCells.b(b).forEach(i => {
        const c = document.createElement('div');
        c.dataset.i = i;
        cells[i] = c;
        box.appendChild(c);
      });
      grid.appendChild(box);
    }
    el.grid = grid;
    el.play = el.stage.querySelector('.sd-play');
    el.pad = el.stage.querySelector('.sd-pad');
    grid.addEventListener('pointerdown', ev => {
      const c = ev.target.closest('[data-i]');
      if (!c) return;
      ev.preventDefault();
      select(+c.dataset.i);
    });
    el.pad.addEventListener('click', ev => {
      const d = ev.target.closest('button[data-d]');
      if (d) { enter(+d.dataset.d); return; }
      const a = ev.target.closest('button[data-act]');
      if (a) act(a.dataset.act);
    });
    layout();
  }

  // The board is as large as the room allows; on a wide screen the pad stands
  // beside it, on a narrow one below.
  function layout() {
    if (!el.stage || !el.play) return;
    const w = el.stage.clientWidth, h = el.stage.clientHeight;
    const wide = w >= 640 && w >= h * 1.2;
    el.play.classList.toggle('wide', wide);
    const bs = wide ? Math.min(h - 6, w - 290) : Math.min(w - 4, h - 190);
    el.play.style.setProperty('--bs', Math.max(180, Math.floor(bs)) + 'px');
  }

  // ── Painting the board ─────────────────────────────────────────────────────
  const shownDigit = () => (sel >= 0 && G[sel] ? G[sel] : hiDigit);

  function cellClass(i) {
    const s = S[i];
    let c = 'sd-cell';
    if (s === 'g') c += ' giv'; else if (s === 'c') c += ' ok'; else if (s === 'h') c += ' hnt';
    else if (s === 'w') c += ' bad'; else if (s === '?') c += ' ok pend';
    if (i === sel) c += ' sel';
    else if (sel >= 0 && sees(sel, i)) c += ' rel';
    const d = shownDigit();
    if (d && G[i] === d && i !== sel && s !== 'w') c += ' same';
    return c;
  }
  function cellHtml(i) {
    if (G[i]) return '<b>' + G[i] + '</b>';
    if (!N[i]) return '';
    let h = '<span class="sd-nt">';
    for (let d = 1; d <= 9; d++) h += '<u' + (shownDigit() === d ? ' class="m"' : '') + '>' + (N[i] & (1 << (d - 1)) ? d : '') + '</u>';
    return h + '</span>';
  }
  function paintCell(i) { cells[i].className = cellClass(i); cells[i].innerHTML = cellHtml(i); }
  function paintAll() {
    for (let i = 0; i < 81; i++) paintCell(i);
    paintStatus(); paintTools(); paintDigits();
  }
  function paintSel() {
    for (let i = 0; i < 81; i++) {
      cells[i].className = cellClass(i);
      if (!G[i] && N[i]) cells[i].innerHTML = cellHtml(i);
    }
    paintDigits();
  }

  function paintDigits() {
    if (!el.pad) return;
    const count = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) if (G[i] && 'gch?'.includes(S[i])) count[G[i]]++;
    const d = shownDigit();
    el.pad.querySelectorAll('button[data-d]').forEach(b => {
      const n = +b.dataset.d, left = 9 - count[n];
      b.classList.toggle('full', left <= 0);
      b.classList.toggle('on', n === d);
      b.querySelector('small').textContent = left > 0 ? left : '✓';
    });
  }

  function paintTools() {
    if (!el.pad || !M) return;
    const on = canPlay();
    const q = a => el.pad.querySelector('[data-act="' + a + '"]');
    q('undo').disabled = !on || !hist.length;
    q('erase').disabled = !on || sel < 0;
    q('notes').disabled = !on;
    q('notes').classList.toggle('active', noteMode);
    q('hint').disabled = !on || !S.some(s => s === '.' || s === 'w');
    const g = q('quit');
    if (g) g.disabled = !on;
  }

  function paintStatus() {
    if (!M || !el.df) return;
    el.df.textContent = _t('sd_diff_' + M.diff);
    el.pts.textContent = fmt(myPts());
    if (mp.stageRecords) mp.stageRecords(_root.querySelector('[data-gh-stage]'), 'v1:difficulty:' + M.diff, myPts(), { difficulty: true });
    el.er.textContent = mist;
    paintClock();
    const me = meId();
    M.prog[me] = Object.assign({}, M.prog[me], { filled: S.filter(s => 'gch'.includes(s)).length, points: pts, mistakes: mist });
    paintPlayers();
  }

  function paintClock() {
    if (!M || !el.tm) return;
    if (_stopClock) return;
    el.tm.textContent = clock((performance.now() - _t0) / 1000);
    el.pts.textContent = fmt(myPts());
    if (mp.stageRecords) mp.stageRecords(_root.querySelector('[data-gh-stage]'), 'v1:difficulty:' + M.diff, myPts(), { difficulty: true });
    if (M.order.length > 1) paintPlayers();
  }

  // The clock costs a point every few seconds (more on harder levels). Once somebody has finished or
  // given up the server has already taken it off; for the others it runs on.
  const timeCost = () => Math.floor(Math.max(0, performance.now() - _t0) / 1000 / M.tstep);
  const shownPts = pr => (pr.done || pr.quit ? pr.points : (pr.points || 0) - timeCost());
  const myPts = () => (M && (M.done || M.quit) ? pts : pts - timeCost());

  const pct = pr => {
    const f = pr && pr.filled != null ? pr.filled : clues;
    return Math.max(0, Math.min(100, Math.round((f - clues) / Math.max(1, 81 - clues) * 100)));
  };

  function paintPlayers() {
    if (!M || !el.players) return;
    const me = meId();
    el.players.style.display = M.order.length > 1 ? '' : 'none';
    el.players.innerHTML = M.order.map(id => {
      const p = playerOf(id), pr = M.prog[id] || {};
      const badge = pr.done ? '🏁' : (pr.quit ? '🏳' : pct(pr) + '%');
      return '<div class="sd-chip' + (pr.done ? ' done' : '') + (pr.quit ? ' quit' : '') + '">' + mp.renderAvatar(p, 26) +
        '<span class="sd-name">' + _esc(p.display_name) + (id === me ? ' · ' + _esc(_t('sd_you')) : '') + '</span>' +
        '<b>' + _esc(badge) + '</b><small>' + fmt(shownPts(pr)) + '</small></div>';
    }).join('');
  }

  // ── Play ───────────────────────────────────────────────────────────────────
  const canPlay = () => !!M && _ready && !M.over && !M.done && !M.quit && !_results;
  const open = i => S[i] === '.' || S[i] === 'w';
  // Two cells' points, and the more of the puzzle is filled in, the more on top.
  const hintCost = () => 2 * M.cp + M.step * S.filter(s => s === 'c' || s === 'h' || s === '?').length;

  function select(i) {
    if (!canPlay() && !(M && _ready)) return;
    sel = i; hiDigit = 0;
    sfx.pick();
    paintSel(); paintTools();
  }

  function saveNotes() {
    if (!M) return;
    clearTimeout(saveNotes._t);
    saveNotes._t = setTimeout(() => store.set('sd_notes_' + mp.roomId(), N.join(',')), 300);
  }

  function enter(v) {
    if (!canPlay()) return;
    if (sel < 0) { hiDigit = hiDigit === v ? 0 : v; paintSel(); return; }
    if (!open(sel)) { hiDigit = hiDigit === v ? 0 : v; paintSel(); return; }   // on a fixed number, a digit only lights its twins
    if (noteMode) {
      if (G[sel]) return;
      hist.push({ t: 'n', i: sel, prev: N[sel] });
      N[sel] ^= 1 << (v - 1);
      paintCell(sel); paintTools(); saveNotes(); sfx.note();
      return;
    }
    if (S[sel] === 'w' && G[sel] === v) return;
    hist.push({ t: 'v', i: sel, prevN: N[sel] });
    G[sel] = v; S[sel] = '?'; N[sel] = 0;
    paintCell(sel); paintSel(); paintTools(); saveNotes();
    mp.send({ type: 'sd_set', i: sel, v: v, seq: ++_seq });
  }

  function erase() {
    if (!canPlay() || sel < 0) return;
    if (S[sel] === 'w') {
      G[sel] = 0; S[sel] = '.';
      mp.send({ type: 'sd_set', i: sel, v: 0, seq: ++_seq });
    } else if (S[sel] === '.' && N[sel]) {
      hist.push({ t: 'n', i: sel, prev: N[sel] });
      N[sel] = 0; saveNotes();
    } else return;
    sfx.pick();
    paintCell(sel); paintSel(); paintTools();
  }

  // Undo takes back notes and wrong numbers; a number the server has accepted
  // stays, so such steps are skipped.
  function undo() {
    if (!canPlay()) return;
    while (hist.length) {
      const h = hist.pop();
      if (h.t === 'n' && S[h.i] === '.') { N[h.i] = h.prev; paintCell(h.i); break; }
      if (h.t === 'v' && S[h.i] === 'w') {
        G[h.i] = 0; S[h.i] = '.'; N[h.i] = h.prevN;
        mp.send({ type: 'sd_set', i: h.i, v: 0, seq: ++_seq });
        paintCell(h.i); break;
      }
    }
    saveNotes(); sfx.pick(); paintSel(); paintTools();
  }

  function act(kind) {
    if (!canPlay()) return;
    if (kind === 'undo') undo();
    else if (kind === 'erase') erase();
    else if (kind === 'notes') { noteMode = !noteMode; sfx.pick(); paintTools(); }
    else if (kind === 'hint') {
      if (_hintWait) return;
      const ask = () => {
        if (!canPlay()) return;
        _hintWait = true;
        mp.send({ type: 'sd_hint', sel: sel, seq: ++_seq });
        setTimeout(() => { _hintWait = false; }, 4000);
      };
      // The first hint of a game says what it costs; after that it just helps.
      if (_hintAsked) ask();
      else confirmBox(_t('sd_hint_q', { n: hintCost() }), _t('sd_hint'), () => { _hintAsked = true; ask(); });
    } else if (kind === 'quit') {
      confirmBox(_t('sd_give_up_q'), _t('sd_give_up'), () => {
        if (!canPlay()) return;
        M.quit = true;
        mp.send({ type: 'sd_quit', seq: ++_seq });
        paintTools();
        showWait();
      });
    }
  }

  function onKey(ev) {
    if (!M || !_ready || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = ev.key;
    if (k >= '1' && k <= '9') { enter(+k); ev.preventDefault(); }
    else if (k === '0' || k === 'Backspace' || k === 'Delete') { erase(); ev.preventDefault(); }
    else if (k === 'n' || k === 'N') { act('notes'); }
    else if (k === 'h' || k === 'H') { act('hint'); }
    else if (k === 'u' || k === 'U' || k === 'z' || k === 'Z') { undo(); }
    else if (k.startsWith('Arrow')) {
      if (!canPlay()) return;
      let i = sel < 0 ? 40 : sel;
      if (k === 'ArrowLeft' && COL[i] > 0) i--;
      else if (k === 'ArrowRight' && COL[i] < 8) i++;
      else if (k === 'ArrowUp' && ROW[i] > 0) i -= 9;
      else if (k === 'ArrowDown' && ROW[i] < 8) i += 9;
      select(i);
      ev.preventDefault();
    } else if (k === 'Escape' && sel >= 0) { sel = -1; hiDigit = 0; paintSel(); paintTools(); }
  }

  function confirmBox(text, okLabel, onOk) {
    if (!el.stage || el.stage.querySelector('.sd-confirm')) return;
    const box = document.createElement('div');
    box.className = 'sd-confirm';
    box.innerHTML = '<div class="sd-card"><p>' + _esc(text) + '</p><div class="sd-acts">' +
      '<button class="sd-btn go" data-ok>' + _esc(okLabel) + '</button>' +
      '<button class="sd-btn" data-no>' + _esc(_t('sd_cancel')) + '</button></div></div>';
    el.stage.appendChild(box);
    box.querySelector('[data-ok]').onclick = () => { box.remove(); onOk(); };
    box.querySelector('[data-no]').onclick = () => box.remove();
  }

  // ── Little effects ─────────────────────────────────────────────────────────
  function floatText(i, text, cls) {
    const c = cells[i];
    if (!c) return;
    const f = document.createElement('em');
    f.className = 'sd-float ' + cls;
    f.textContent = text;
    c.appendChild(f);
    setTimeout(() => f.remove(), 1100);
  }

  // A row, column or box that has just been completed ripples outwards.
  function celebrateUnits(i) {
    const done = [];
    [['r', ROW[i]], ['c', COL[i]], ['b', BOX[i]]].forEach(([k, n]) => {
      const list = unitCells[k](n);
      if (list.every(j => G[j] && 'gch'.includes(S[j]))) done.push(list);
    });
    if (!done.length) return;
    sfx.unit();
    done.forEach(list => list.forEach(j => {
      const d = Math.abs(ROW[j] - ROW[i]) + Math.abs(COL[j] - COL[i]);
      cells[j].style.animationDelay = (d * 45) + 'ms';
      cells[j].classList.remove('wave');
      void cells[j].offsetWidth;
      cells[j].classList.add('wave');
      setTimeout(() => { if (cells[j]) { cells[j].classList.remove('wave'); cells[j].style.animationDelay = ''; } }, 1200 + d * 45);
    }));
  }

  function confetti() {
    const host = el.stage;
    if (!host) return;
    const colors = ['#ffd60a', '#7ff0dc', '#ff6b8a', '#a58bff', '#6ec1ff', '#9bf2c8'];
    const wrap = document.createElement('div');
    wrap.className = 'sd-confetti';
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
    const old = el.stage.querySelector('.sd-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'sd-toast';
    t.textContent = text;
    el.stage.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  function takeBoard(m) {
    G = m.grid.split('').map(Number);
    S = m.cells.split('');
    pts = m.points; mist = m.mistakes; hintsUsed = m.hints != null ? m.hints : hintsUsed;
    for (let i = 0; i < 81; i++) if (S[i] !== '.' && S[i] !== 'w') N[i] = 0;
  }

  function apply(m) {
    if (!M) return;
    switch (m.type) {
      case 'sd_cell': {
        pts = m.points; mist = m.mistakes;
        if (m.v === 0) { paintStatus(); break; }
        const i = m.i;
        if (G[i] !== m.v) { paintStatus(); break; }    // the player has moved on; the next answer is the right one
        if (m.ok) {
          S[i] = 'c';
          // The number is placed: it is struck from the notes of the cells that see it.
          for (let j = 0; j < 81; j++) if (sees(i, j) && N[j] & (1 << (m.v - 1))) { N[j] &= ~(1 << (m.v - 1)); paintCell(j); }
          paintCell(i); paintSel();
          floatText(i, '+' + M.cp, 'up');
          sfx.ok();
          celebrateUnits(i);
        } else {
          S[i] = 'w';
          paintCell(i);
          cells[i].classList.add('shake');
          setTimeout(() => cells[i] && cells[i].classList.remove('shake'), 500);
          floatText(i, '−' + Math.floor(M.cp / 2), 'down');
          sfx.no();
        }
        paintStatus(); paintTools(); paintDigits();
        break;
      }
      case 'sd_sync':
        if ((m.seq || 0) >= _seq) { takeBoard(m); paintAll(); sfx.no(); }
        break;
      case 'sd_hint_res': {
        _hintWait = false;
        if (m.i < 0) { toast(_t('sd_hint_none')); break; }
        pts = m.points; mist = m.mistakes != null ? m.mistakes : mist; hintsUsed++;
        G[m.i] = m.v; S[m.i] = 'h'; N[m.i] = 0;
        for (let j = 0; j < 81; j++) if (sees(m.i, j) && N[j] & (1 << (m.v - 1))) { N[j] &= ~(1 << (m.v - 1)); paintCell(j); }
        sel = m.i; hiDigit = 0;
        paintCell(m.i); paintSel(); paintStatus(); paintTools();
        floatText(m.i, '−' + fmt(m.cost), 'down');
        toast(_t('sd_hint_cost', { n: fmt(m.cost) }));
        sfx.ok();
        celebrateUnits(m.i);
        break;
      }
      case 'sd_progress':
        M.prog[m.pid] = { filled: m.filled, points: m.points, mistakes: m.mistakes, done: m.done, quit: m.quit, rank: m.rank };
        paintPlayers();
        break;
      case 'sd_done':
        if (mp.stageRecords) mp.stageRecords(_root.querySelector('[data-gh-stage]'), 'v1:difficulty:' + M.diff, m.points, { difficulty: true, refresh: true, records: m.stage_records });
        M.done = true; _stopClock = true;
        pts = m.points; paintStatus(); paintTools();
        el.tm.textContent = clock(m.time);
        (m.peers || []).forEach(b => { peers[b.pid] = b; });
        // Alone, the result of the game takes its place a moment later.
        if (M.multi) { sfx.win(); confetti(); setTimeout(() => { if (!_results) showDone(m); }, 1100); }
        break;
      case 'sd_peer':
        peers[m.pid] = m;
        paintPeers();
        break;
      case 'sd_over':
        _results = m.results; M.over = true; _stopClock = true;
        paintPlayers(); paintTools();
        setTimeout(() => showOver(m), M.done && !M.multi ? 900 : 500);
        if (!M.multi) { sfx.win(); confetti(); }
        break;
    }
  }

  // ── Waiting, watching and the end ──────────────────────────────────────────
  function showWait() {
    if (!el.stage || el.stage.querySelector('.sd-wait') || _results) return;
    const w = document.createElement('div');
    w.className = 'sd-wait';
    w.innerHTML = '<div class="sd-card"><h3>🏳 ' + _esc(_t('sd_gave_up')) + '</h3><p>' + _esc(_t('sd_waiting_others')) + '</p></div>';
    el.stage.appendChild(w);
  }

  function mini(b) {
    let h = '<div class="sd-mini">';
    for (let i = 0; i < 81; i++) {
      const s = b.cells[i], v = b.grid[i];
      h += '<i class="' + (s === 'g' ? 'g' : s === 'c' ? 'c' : s === 'h' ? 'h' : s === 'w' ? 'w' : 'e') + '">' + (v !== '0' && s !== '.' ? v : '') + '</i>';
    }
    return h + '</div>';
  }

  function peerCard(id) {
    const b = peers[id], p = playerOf(id);
    const pr = M.prog[id] || b || {};
    let status;
    if (pr.done) status = '🏁 ' + _t('sd_solved_in', { t: clock((b && b.time) || 0) });
    else if (pr.quit) status = '🏳 ' + _t('sd_gave_up');
    else status = _t('sd_playing', { n: pct(pr) });
    return '<div class="sd-peer' + (pr.done ? ' done' : '') + '">' +
      '<div class="sd-peer-h">' + mp.renderAvatar(p, 24) + '<span class="sd-name">' + _esc(p.display_name) + '</span><small>' + fmt(shownPts(pr)) + '</small></div>' +
      (b ? mini(b) : '') + '<div class="sd-peer-s">' + _esc(status) + '</div></div>';
  }

  function paintPeers() {
    const box = el.stage && el.stage.querySelector('.sd-peers');
    if (!box || !M) return;
    box.innerHTML = M.order.filter(id => id !== meId() && peers[id]).map(peerCard).join('');
  }

  // A player who has finished, with others still playing: the result, and the
  // others' boards as they fill in.
  function showDone(m) {
    if (!el.stage || el.stage.querySelector('.sd-done') || _results) return;
    el.stage.querySelectorAll('.sd-confirm').forEach(n => n.remove());
    const d = document.createElement('div');
    d.className = 'sd-done';
    d.innerHTML =
      '<div class="sd-card wide"><div class="sd-trophy">' + '🏁' + '</div>' +
      '<h2>' + _esc(_t('sd_solved_title')) + '</h2>' +
      '<div class="sd-bd">' +
        '<div><span>' + _esc(_t('sd_hud_time')) + '</span><b>' + clock(m.time) + '</b></div>' +
        (m.clean ? '<div><span>' + _esc(_t('sd_bd_clean')) + '</span><b>+' + fmt(m.clean) + '</b></div>' : '') +
        (m.timecost ? '<div><span>' + _esc(_t('sd_bd_time')) + '</span><b>−' + fmt(m.timecost) + '</b></div>' : '') +
        '<div class="tot"><span>' + _esc(_t('sd_hud_points')) + '</span><b>' + fmt(m.points) + '</b></div>' +
      '</div>' +
      '<div data-gh-stage-done></div><h4>' + _esc(_t('sd_watching')) + '</h4>' +
      '<div class="sd-peers"></div>' +
      '<p class="sd-hint">' + _esc(_t('sd_leave_note')) + '</p>' +
      '<div class="sd-acts"><a class="sd-btn" href="' + HUB_URL + '">' + _esc(_t('sd_back')) + '</a></div></div>';
    el.stage.appendChild(d);
    if (mp.stageRecords) mp.stageRecords(d.querySelector('[data-gh-stage-done]'), 'v1:difficulty:' + M.diff, m.points, { difficulty: true });
    paintPeers();
  }

  function showOver(m) {
    if (!el.stage || el.stage.querySelector('.sd-over')) return;
    const results = m.results, multi = !!m.multi, me = meId();
    el.stage.querySelectorAll('.sd-wait,.sd-confirm,.sd-done').forEach(n => n.remove());
    const rows = results.map((r, i) => {
      const p = playerOf(r.player_id);
      const win = multi && r.rank === 1 && r.points > 0;
      const what = r.done ? _t('sd_solved_in', { t: clock(r.time) }) : _t('sd_result_pct', { n: pct(r) });
      return '<div class="sd-row' + (win ? ' win' : '') + '"><span>' + (win ? '🏆' : (i + 1)) + '</span>' +
        mp.renderAvatar(p, 28) +
        '<span class="n">' + _esc(p.display_name || r.display_name) + (r.player_id === me && multi ? ' · ' + _esc(_t('sd_you')) : '') + '</span>' +
        '<small>' + _esc(what) + '<br>' + _esc(_t('sd_errors_hints', { e: r.mistakes, h: r.hints })) + '</small>' +
        '<b>' + fmt(r.points) + '<br><small>' + _esc(_t('sd_score')) + '</small></b></div>';
    }).join('');
    const top = results[0];
    const title = multi
      ? (top.points > 0 ? '🏆 ' + _t('sd_winner') + ': ' + (playerOf(top.player_id).display_name || top.display_name || '') : _t('sd_over'))
      : '🧩 ' + _t('sd_solved_title');
    const mine = results.find(r => r.player_id === me);
    const breakdown = !multi && mine && mine.done
      ? '<div class="sd-bd"><div><span>' + _esc(_t('sd_hud_time')) + '</span><b>' + clock(mine.time) + '</b></div>' +
        (mine.clean ? '<div><span>' + _esc(_t('sd_bd_clean')) + '</span><b>+' + fmt(mine.clean) + '</b></div>' : '') +
        (mine.timecost ? '<div><span>' + _esc(_t('sd_bd_time')) + '</span><b>−' + fmt(mine.timecost) + '</b></div>' : '') +
        '</div>' : '';
    const ov = document.createElement('div');
    ov.className = 'sd-over';
    ov.innerHTML =
      '<div class="sd-card"><h2>' + _esc(title) + '</h2>' + breakdown + '<div class="sd-rows">' + rows + '</div>' +
      (multi ? '' : '<p class="sd-hint">' + _esc(_t('sd_saved_note')) + '</p>') +
      '<div data-gh-stage-final></div><section data-gh-results></section><div class="sd-acts"><button class="sd-btn go" data-again>' + _esc(multi ? _t('sd_play_again') : _t('sd_new_game')) + '</button>' +
      '<a class="sd-btn" href="' + HUB_URL + '">' + _esc(_t('sd_back')) + '</a></div></div>';
    el.stage.appendChild(ov);
    if (mp.stageRecords) mp.stageRecords(ov.querySelector('[data-gh-stage-final]'), 'v1:difficulty:' + M.diff, mine ? mine.points : null, { difficulty: true });
    if (multi && mine && mine.rank === 1 && mine.points > 0) { sfx.win(); confetti(); }
    ov.querySelector('[data-again]').onclick = e => playAgain(e.currentTarget);
  }

  async function playAgain(btn) {
    btn.disabled = true;
    btn.textContent = _t('sd_starting');
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
      btn.textContent = multiLabel();
      alert(_t('sd_error_new_game'));
    }
  }
  const multiLabel = () => _t(mp.players().length > 1 ? 'sd_play_again' : 'sd_new_game');

  // ── Wiring ─────────────────────────────────────────────────────────────────
  mp.on('sd_state', msg => {
    _sm = msg; _ready = false; _queue = []; _results = null; _hintWait = false;
    M = null;
    if (_root && el.stage) init();
  });
  ['sd_cell', 'sd_sync', 'sd_hint_res', 'sd_progress', 'sd_done', 'sd_peer', 'sd_over'].forEach(type => {
    mp.on(type, msg => { if (_ready) apply(msg); else _queue.push(msg); });
  });

  mp.registerGame({
    id: GAME_ID,
    name: _t('sd_title'),
    renderSetup,
    renderGame,
    // The board lives on the server; the notes are the browser's half of a save.
    snapshot: () => (M && M.multi ? null : { notes: N.slice() }),
  });
})();
