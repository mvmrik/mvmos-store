/*
 * Deal or Not — the game, client side.
 *
 * Runs on Game Hub's public play page. The server owns the boxes and the
 * banker: it shuffles the 36 amounts, says whose turn it is, and tells a
 * browser what a box held only when somebody opens it. The banker's offers
 * are sent to the one player they are for. This file only draws that.
 *
 *   draw    each player draws one random box, which flies to them
 *   open    the players take turns opening the others; the amount is crossed
 *           out on its side of the board
 *   offer   the banker calls every player at once, in private; the answers are
 *           shown together when the last one is in
 */
(function () {
  'use strict';
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;
  const GAME_ID = 'dealornot';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;
  const _t = (k, v) => (window.t ? window.t(k, v) : k);
  const TIMES = [10, 15, 20, 30, 45, 60];
  const TOP = 1000000;      // the biggest prize: its loss gets a drama of its own
  const BIG = 100000;       // an amount this size leaving the board is bad news
  const SMALL = 5000;       // and a small one is good news

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

  // ── Sound ──────────────────────────────────────────────────────────────────
  let _muted = store.get('dn_muted', '0') === '1';
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
  // A falling or rising pitch, for booms and sirens.
  function _sweep(f0, f1, dur, type, gain, when) {
    if (_muted) return;
    try {
      _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = _ac.currentTime + (when || 0);
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(_ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (_) {}
  }
  const sfx = {
    // The top prize leaving the board: a deep boom, then a slow sinking fanfare.
    jackpot() {
      _sweep(140, 28, 1.3, 'sine', 0.35);
      _sweep(900, 60, 0.9, 'sawtooth', 0.09);
      [392, 370, 349, 330, 294, 262, 196].forEach((f, i) => _tone(f, 0.55, 'sawtooth', 0.08, 0.25 + i * 0.3));
      _tone(98, 1.6, 'triangle', 0.2, 2.3);
    },
    tick() { _tone(520, 0.05, 'triangle', 0.07); },
    draw() { [392, 523, 659].forEach((f, i) => _tone(f, 0.14, 'sine', 0.12, i * 0.09)); },
    good() { _tone(660, 0.12, 'sine', 0.14); _tone(990, 0.2, 'sine', 0.12, 0.1); },
    bad() { _tone(220, 0.35, 'sawtooth', 0.07); _tone(160, 0.4, 'sawtooth', 0.06, 0.12); },
    open() { _tone(440, 0.1, 'triangle', 0.1); _tone(554, 0.12, 'triangle', 0.1, 0.08); },
    ring() { for (let i = 0; i < 4; i++) { _tone(880, 0.08, 'square', 0.05, i * 0.22); _tone(740, 0.08, 'square', 0.05, i * 0.22 + 0.1); } },
    deal() { [523, 659, 784, 1046].forEach((f, i) => _tone(f, 0.18, 'sine', 0.13, i * 0.1)); },
    win() { [523, 659, 784, 1046, 1318].forEach((f, i) => _tone(f, 0.22, 'sine', 0.13, i * 0.12)); },
  };

  // ── Lobby: what the host chooses ───────────────────────────────────────────
  function renderSetup(box, settings) {
    const s = Object.assign({ time: +store.get('dn_time', 60) }, settings || {});
    let cur = TIMES.indexOf(+s.time) !== -1 ? +s.time : 60;
    // A solo room has no invite column (the hub draws it only when others can
    // join) and nobody to wait for: no clock, so nothing to choose.
    const page = box.parentNode && box.parentNode.parentNode;
    if (page && !page.querySelector('#gh-lobby-icol')) {
      box.style.display = 'none';
      return () => ({ time: cur });
    }
    box.className = 'dn-setup';
    box.innerHTML = '<div class="dn-setup-l">⏱ ' + _esc(_t('dn_setup_time')) + '</div><div class="dn-pills" role="radiogroup"></div>';
    const row = box.querySelector('.dn-pills');
    const paint = () => row.querySelectorAll('.dn-pill').forEach(b => {
      const on = +b.dataset.v === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    TIMES.forEach(v => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'dn-pill'; b.dataset.v = v; b.setAttribute('role', 'radio');
      b.textContent = _t('dn_time_short', { n: v });
      b.onclick = () => { cur = v; paint(); };
      row.appendChild(b);
    });
    paint();
    return () => { store.set('dn_time', String(cur)); return { time: cur }; };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _root = null, _sm = null;
  let _ready = false, _queue = [];
  let S = null;
  let el = {};
  let _tick = 0, _deadline = 0, _gen = 0;
  let _msgText = '';
  let _inflight = false;
  const _timers = new Set();

  const meId = () => mp.youId();
  const playerOf = id => mp.players().find(p => p.id === id) || { id: id, display_name: '?' };
  const later = (fn, ms) => { const h = setTimeout(() => { _timers.delete(h); fn(); }, ms); _timers.add(h); return h; };
  const clearLater = () => { _timers.forEach(clearTimeout); _timers.clear(); };

  // ── Screen ─────────────────────────────────────────────────────────────────
  function renderGame(root) {
    _root = root;
    _ready = false;
    root.innerHTML =
      '<div class="dn-wrap">' +
        '<div class="dn-top"><div class="dn-row1"><div class="dn-players"></div>' +
          '<div class="dn-tools"><button class="dn-snd" data-snd title="' + _esc(_t('dn_sound')) + '"></button>' +
          '<button class="dn-snd" data-exit title="' + _esc(_t('gh_save_exit') !== 'gh_save_exit' ? _t('gh_save_exit') : 'Save & exit') + '" hidden>⏸</button></div></div>' +
          '<div class="dn-status"><div class="dn-msg"></div><div class="dn-bar"><i></i></div>' +
          '<div class="dn-act"></div></div></div>' +
        '<div class="dn-main">' +
          '<div class="dn-vals dn-low"></div>' +
          '<div class="dn-center"><div class="dn-grid"></div><div class="dn-mine"></div></div>' +
          '<div class="dn-vals dn-high"></div>' +
        '</div>' +
      '</div>';
    el = {
      wrap: root.querySelector('.dn-wrap'),
      players: root.querySelector('.dn-players'),
      msg: root.querySelector('.dn-msg'),
      bar: root.querySelector('.dn-status .dn-bar i'),
      low: root.querySelector('.dn-low'),
      high: root.querySelector('.dn-high'),
      grid: root.querySelector('.dn-grid'),
      mine: root.querySelector('.dn-mine'),
      act: root.querySelector('.dn-act'),
      center: root.querySelector('.dn-center'),
      banker: null, over: null,
    };
    const snd = root.querySelector('[data-snd]');
    const paintSnd = () => { snd.textContent = _muted ? '🔇' : '🔊'; };
    snd.onclick = () => { _muted = !_muted; store.set('dn_muted', _muted ? '1' : '0'); paintSnd(); sfx.tick(); };
    paintSnd();
    // Save & exit is the hub's, but its own button takes room at the bottom of
    // the screen, so the game shows the same control as an icon at the top.
    const exitBtn = root.querySelector('[data-exit]');
    exitBtn.hidden = !(mp.players().length < 2);
    exitBtn.onclick = () => mp.exitPrompt();
    el.msg.textContent = _t('dn_waiting');
    clearInterval(_tick);
    _tick = setInterval(paintClock, 200);
    if (_sm) init();
  }

  function init() {
    const sm = _sm, gen = ++_gen;
    clearLater();
    _ready = false;
    if (el.banker) { el.banker.remove(); el.banker = null; }
    if (el.over) { el.over.remove(); el.over = null; }
    S = {
      values: sm.values, low: new Set(sm.low), total: sm.total,
      time: sm.time, order: sm.order, phase: sm.phase, turn: sm.turn,
      round: sm.round, rounds: sm.rounds, toOpen: sm.to_open, final: !!sm.final,
      box: [], players: {}, out: new Set(), over: !!sm.over,
      offer: null, answered: false, pendingTotal: 0, swapPick: false,
    };
    for (let n = 1; n <= sm.total; n++) S.box[n] = { st: 'closed', v: null };
    (sm.gone || []).forEach(g => { S.box[g[0]] = { st: 'gone', v: g[1] }; S.out.add(g[1]); });
    sm.players.forEach(p => {
      S.players[p.pid] = { status: p.status, amount: p.amount, round: p.round, box: p.box, ready: !!p.ready };
      if (p.box != null) S.box[p.box] = { st: 'held', v: null, by: p.pid };
    });
    S.pendingTotal = S.order.filter(id => S.players[id].status === 'playing').length;
    _deadline = sm.left > 0 ? performance.now() + sm.left * 1000 : 0;
    buildBoard();
    paintAll();
    _ready = true;
    if (sm.offer) showOffer(sm.offer);
    if (sm.over && sm.results) showOver(sm.results);
    const q = _queue; _queue = [];
    q.forEach(m => { if (gen === _gen) apply(m); });
  }

  function buildBoard() {
    el.low.innerHTML = ''; el.high.innerHTML = '';
    S.values.forEach(v => {
      const d = document.createElement('div');
      d.className = 'dn-v' + (v >= BIG ? ' big' : '');
      d.dataset.v = v;
      d.textContent = fmt(v);
      (S.low.has(v) ? el.low : el.high).appendChild(d);
    });
    // The two columns read upwards in size, small at the top.
    el.grid.innerHTML = '';
    for (let n = 1; n <= S.total; n++) {
      const slot = document.createElement('div');
      slot.className = 'dn-slot';
      slot.dataset.n = n;
      slot.innerHTML = '<button class="dn-box" data-n="' + n + '" aria-label="' + _esc(_t('dn_box_n', { n: n })) + '"><span class="dn-num">' + n + '</span></button>';
      slot.firstChild.onclick = () => tryOpen(n);
      el.grid.appendChild(slot);
    }
  }

  const slotOf = n => el.grid.children[n - 1];
  const boxOf = n => slotOf(n).firstChild;

  function paintAll() { paintValues(); paintBoxes(); paintPlayers(); paintMine(); paintStatus(); paintAct(); }

  function paintValues() {
    el.wrap.querySelectorAll('.dn-v').forEach(d => d.classList.toggle('out', S.out.has(+d.dataset.v)));
  }

  function paintBoxes() {
    const can = canOpen() || canPickSwap();
    for (let n = 1; n <= S.total; n++) {
      const b = S.box[n], slot = slotOf(n);
      slot.classList.toggle('empty', b.st !== 'closed');
      slot.firstChild.classList.toggle('can', can && b.st === 'closed');
      slot.firstChild.disabled = !(can && b.st === 'closed');
    }
  }

  // ── Players and standings ──────────────────────────────────────────────────
  function paintPlayers() {
    const me = meId();
    const dealt = S.order.filter(id => S.players[id].status === 'dealt').sort((a, b) => S.players[b].amount - S.players[a].amount);
    const rest = S.order.filter(id => S.players[id].status !== 'dealt');
    const rank = {}; dealt.forEach((id, i) => { rank[id] = i + 1; });
    el.players.innerHTML = dealt.concat(rest).map(id => {
      const p = playerOf(id), st = S.players[id];
      const on = S.turn === id && !S.over;
      let sub;
      if (st.status === 'dealt') sub = '<b>' + _esc(_t('dn_took', { amount: fmt(st.amount) })) + '</b>';
      else if (S.over) sub = '';
      else sub = _esc(_t('dn_in_play')) + (S.phase === 'offer' && st.ready ? ' <span class="dn-rdy">✓</span>' : '');
      return '<div class="dn-chip' + (on ? ' on' : '') + (st.status === 'dealt' ? ' dealt' : '') + (id === me ? ' me' : '') + '" data-pid="' + _esc(id) + '">' +
        (st.status === 'dealt' ? '<span class="dn-rk">' + rank[id] + '</span>' : '') +
        mp.renderAvatar(p, 26) +
        '<span><span class="dn-nm">' + _esc(p.display_name) + (id === me && S.order.length > 1 ? ' · ' + _esc(_t('dn_you')) : '') + '</span>' +
        '<span class="dn-sub">' + sub + '</span></span>' +
        (st.status === 'playing' && st.box != null ? '<span class="dn-mini">' + st.box + '</span>' : '') +
        '</div>';
    }).join('');
  }

  function paintMine() {
    const me = meId(), st = S.players[me];
    if (!st) { el.mine.innerHTML = ''; return; }
    const has = st.status === 'playing' && st.box != null;
    let txt = '';
    if (st.status === 'dealt') txt = '<b>' + _esc(_t('dn_took', { amount: fmt(st.amount) })) + '</b>';
    else if (has) txt = '<b>' + _esc(_t('dn_box_n', { n: st.box })) + '</b>';
    el.mine.innerHTML =
      '<div class="dn-mine-box"><div class="dn-slot' + (has ? '' : ' empty') + '">' +
        '<div class="dn-box"><span class="dn-num">' + (has ? st.box : '') + '</span></div></div></div>' +
      '<div class="dn-mine-t">' + _esc(_t('dn_your_box')) + txt + '</div><div class="dn-draw"></div>';
    paintDraw();
  }

  // The draw button sits with the player's own box, where the drawn box lands.
  function paintDraw() {
    const host = el.mine && el.mine.querySelector('.dn-draw');
    if (!host) return;
    host.innerHTML = '';
    el.mine.classList.toggle('drawing', false);
    if (S && !S.over && S.phase === 'draw' && S.turn === meId() && S.players[meId()] && S.players[meId()].box == null) {
      const b = document.createElement('button');
      b.className = 'dn-btn';
      b.textContent = '🎁 ' + _t('dn_draw_btn');
      b.onclick = () => { b.disabled = true; mp.send({ type: 'dn_draw' }); };
      host.appendChild(b);
      el.mine.classList.add('drawing');
    }
  }

  function paintStatus() {
    const me = meId();
    let text = null, mine = false;
    if (S.over) text = _t('dn_over');
    else if (S.phase === 'draw' && S.turn) {
      mine = S.turn === me;
      text = mine ? _t('dn_draw_you') : _t('dn_draw_other', { name: playerOf(S.turn).display_name });
    } else if (S.phase === 'open' && S.turn) {
      mine = S.turn === me;
      text = mine ? _t('dn_open_you', { n: S.toOpen }) : _t('dn_open_other', { name: playerOf(S.turn).display_name, n: S.toOpen });
    } else if (S.phase === 'offer') text = S.final ? _t('dn_final_call') + ' 📞' : _t('dn_calling');
    if (text != null) _msgText = text;
    el.msg.textContent = _msgText;
    el.msg.classList.toggle('me', mine);
    paintClock();
  }

  function paintClock() {
    if (!S || !el.bar) return;
    const set = (bar, full) => {
      if (!bar) return;
      if (bar.parentNode) bar.parentNode.style.visibility = S.time ? '' : 'hidden';
      if (!_deadline || S.over) { bar.style.transform = 'scaleX(1)'; bar.classList.remove('low'); return; }
      const left = Math.max(0, _deadline - performance.now()) / 1000;
      bar.style.transform = 'scaleX(' + Math.min(1, left / Math.max(1, S.time)) + ')';
      bar.classList.toggle('low', left < 5);
    };
    set(el.bar);
    if (el.banker) set(el.banker.querySelector('.dn-bar i'));
  }

  function paintAct() {
    el.act.innerHTML = '';
    if (!S.over && S.phase === 'offer' && S.swapPick && !S.answered) {
      const msg = document.createElement('div');
      msg.className = 'dn-pick';
      msg.textContent = _t('dn_swap_pick');
      const back = document.createElement('button');
      back.className = 'dn-btn plain';
      back.textContent = _t('dn_swap_back');
      back.onclick = () => { S.swapPick = false; paintBoxes(); paintAct(); if (S.offer) showOffer(S.offer, true); };
      el.act.appendChild(msg); el.act.appendChild(back);
      return;
    }
    paintDraw();
  }

  const canOpen = () => !!S && _ready && !S.over && S.phase === 'open' && S.turn === meId();
  const canPickSwap = () => !!S && _ready && !S.over && S.phase === 'offer' && S.swapPick && !S.answered;

  function tryOpen(n) {
    if (canPickSwap() && S.box[n].st === 'closed') {
      S.answered = true; S.swapPick = false;
      mp.send({ type: 'dn_answer', accept: true, box: n });
      afterAnswer();
      return;
    }
    if (!canOpen() || _inflight || S.box[n].st !== 'closed') return;
    _inflight = true;
    later(() => { _inflight = false; }, 900);
    mp.send({ type: 'dn_open', box: n });
  }

  // ── Animations ─────────────────────────────────────────────────────────────
  // A copy of a box that travels from one place on the screen to another.
  function fly(fromEl, toEl, num, done) {
    if (!fromEl || !toEl) { done && done(); return; }
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'dn-fly dn-slot';
    f.style.cssText = 'left:' + a.left + 'px;top:' + a.top + 'px;width:' + a.width + 'px;height:' + a.height + 'px;border:0';
    f.innerHTML = '<div class="dn-box"><span class="dn-num">' + num + '</span></div>';
    document.body.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2);
      const k = Math.max(.35, Math.min(1.2, b.width / a.width));
      f.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + k + ')';
    }));
    later(() => { f.remove(); done && done(); }, 900);
  }

  function chipOf(pid) { return el.players.querySelector('[data-pid="' + pid + '"]'); }

  function onDrawn(m) {
    const closed = []; for (let n = 1; n <= S.total; n++) if (S.box[n].st === 'closed' && n !== m.box) closed.push(n);
    // The highlight wanders over the board and settles on the box that was drawn.
    const path = []; for (let i = 0; i < 11; i++) path.push(closed[Math.floor(Math.random() * closed.length)]);
    path.push(m.box);
    let at = 0;
    path.forEach((n, i) => {
      at += 55 + i * 11;
      later(() => { const b = boxOf(n); b.classList.add('glow'); sfx.tick(); later(() => b.classList.remove('glow'), 150); }, at);
    });
    later(() => {
      const dest = m.pid === meId() ? el.mine.querySelector('.dn-mine-box') : chipOf(m.pid);
      sfx.draw();
      const src = slotOf(m.box);
      src.classList.add('empty');            // the place stays empty on the board
      fly(src, dest, m.box, () => {
        S.box[m.box] = { st: 'held', v: null, by: m.pid };
        S.players[m.pid].box = m.box;
        paintBoxes(); paintPlayers(); paintMine();
      });
    }, at + 260);
  }

  function onOpened(m) {
    sfx.open();
    const b = boxOf(m.box);
    b.classList.add('opening');
    const kind = m.value >= BIG ? 'bad' : (m.value <= SMALL ? 'good' : '');
    const pop = document.createElement('div');
    const top = m.value >= TOP;
    pop.className = 'dn-pop ' + kind + (top ? ' top' : '');
    pop.innerHTML = '<small>' + _esc(_t('dn_box_n', { n: m.box })) + '</small><b>' + fmt(m.value) + '</b>';
    el.wrap.appendChild(pop);
    later(() => { if (top) sfx.jackpot(); else if (kind === 'bad') sfx.bad(); else sfx.good(); }, 450);
    if (top) { el.wrap.classList.add('shake'); later(() => el.wrap.classList.remove('shake'), 2000); }
    later(() => pop.remove(), top ? 3600 : 2500);
    later(() => {
      b.classList.remove('opening');
      S.box[m.box] = { st: 'gone', v: m.value };
      markOut(m.value);
      paintBoxes();
    }, 1450);
    S.turn = null;
    paintBoxes(); paintStatus(); paintPlayers();
    S.toOpen = Math.max(0, S.toOpen - 1);
  }

  function markOut(v) {
    S.out.add(v);
    const d = el.wrap.querySelector('.dn-v[data-v="' + v + '"]');
    if (d) { d.classList.add('flash'); later(() => d.classList.remove('flash'), 1500); }
    paintValues();
  }

  function toast(html, ms) {
    const n = document.createElement('div');
    n.className = 'dn-news';
    n.innerHTML = html;
    el.wrap.appendChild(n);
    later(() => n.remove(), ms || 3200);
  }

  // ── The banker ─────────────────────────────────────────────────────────────
  function ensureBanker() {
    if (el.banker) return el.banker;
    const d = document.createElement('div');
    d.className = 'dn-banker';
    el.center.appendChild(d);
    el.banker = d;
    return d;
  }
  function dropBanker() { if (el.banker) { el.banker.remove(); el.banker = null; } }

  function showOffer(o, silent) {
    S.offer = o; S.answered = false; S.swapPick = false;
    if (o.left != null && o.left > 0) _deadline = performance.now() + o.left * 1000;
    const d = ensureBanker();
    let body;
    if (o.kind === 'money') {
      body = '<p>' + _esc(_t('dn_offer_money')) + '</p><div class="dn-offer">' + fmt(o.amount) + '</div>' +
        '<div class="dn-acts"><button class="dn-btn yes" data-a="1">' + _esc(_t('dn_deal')) + '</button>' +
        '<button class="dn-btn no" data-a="0">' + _esc(_t('dn_nodeal')) + '</button></div>';
    } else {
      body = '<div class="dn-swapline">' + _esc(_t('dn_offer_swap', { a: '§A§' })).replace('§A§', '<b>#' + o.cur + '</b>') + '</div>' +
        '<div class="dn-acts"><button class="dn-btn yes" data-a="1">' + _esc(_t('dn_swap')) + '</button>' +
        '<button class="dn-btn plain" data-a="0">' + _esc(_t('dn_keep')) + '</button></div>';
    }
    d.innerHTML = '<div class="dn-call"><div class="dn-phone">📞</div><h3>' + _esc(_t('dn_banker')) + '</h3>' +
      (S.final ? '<span class="dn-fin">' + _esc(_t('dn_final_call')) + '</span>' : '') + body +
      '<div class="dn-bar"><i></i></div></div>';
    d.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = () => {
        if (S.answered) return;
        const yes = b.dataset.a === '1';
        if (yes && o.kind === 'swap') {      // the player chooses the box to swap with
          S.swapPick = true;
          dropBanker();
          paintBoxes(); paintAct();
          return;
        }
        S.answered = true;
        mp.send({ type: 'dn_answer', accept: yes });
        afterAnswer();
      };
    });
    if (!silent) sfx.ring();
    paintClock();
  }

  function readyCount() { return S.order.filter(id => S.players[id].status === 'playing' && S.players[id].ready).length; }

  function afterAnswer() {
    paintBoxes(); paintAct();
    // Nobody else to wait for (a solo game, or the last one still to answer):
    // the call simply ends and the answer is shown a moment later.
    if (S.pendingTotal <= 1) dropBanker(); else paintWaiting();
  }

  function paintWaiting() {
    if (!S.answered) return;
    if (!el.banker) ensureBanker();
    el.banker.innerHTML = '<div class="dn-call done"></div>';
    const call = el.banker.firstChild;
    call.innerHTML = '<div class="dn-phone">📞</div><h3>' + _esc(_t('dn_banker')) + '</h3>' +
      '<p>' + _esc(_t('dn_answered', { a: readyCount(), b: S.pendingTotal })) + '</p><div class="dn-bar"><i></i></div>';
    paintClock();
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  function apply(m) {
    if (!S) return;
    switch (m.type) {
      case 'dn_turn':
        S.phase = m.phase; S.turn = m.pid; _inflight = false;
        if (m.round) { S.round = m.round; S.rounds = m.rounds; S.toOpen = m.to_open; }
        _deadline = m.left > 0 ? performance.now() + m.left * 1000 : 0;
        dropBanker();
        paintBoxes(); paintPlayers(); paintStatus(); paintAct();
        break;
      case 'dn_drawn':
        S.turn = null;
        paintPlayers(); paintStatus(); paintAct();
        onDrawn(m);
        break;
      case 'dn_opened':
        onOpened(m);
        break;
      case 'dn_phase':
        S.phase = 'offer'; S.turn = null; S.round = m.round; S.rounds = m.rounds; S.final = !!m.final;
        S.pendingTotal = m.pending.length; S.answered = false; S.offer = null; S.swapPick = false;
        S.order.forEach(id => { S.players[id].ready = false; });
        _deadline = m.left > 0 ? performance.now() + m.left * 1000 : 0;
        paintBoxes(); paintPlayers(); paintStatus(); paintAct();
        if (!m.pending.length || m.pending.indexOf(meId()) === -1) sfx.ring();
        break;
      case 'dn_offer':
        showOffer(m);
        break;
      case 'dn_ready':
        if (S.players[m.pid]) S.players[m.pid].ready = true;
        sfx.tick();
        paintPlayers(); if (S.answered && S.pendingTotal > 1) paintWaiting();
        break;
      case 'dn_resolved':
        onResolved(m);
        break;
      case 'dn_over':
        onOver(m);
        break;
    }
  }

  function onResolved(m) {
    dropBanker();
    S.offer = null; S.swapPick = false;
    S.order.forEach(id => { S.players[id].ready = false; });
    let i = 0;
    (m.deals || []).forEach(d => {
      later(() => {
        const name = playerOf(d.pid).display_name;
        toast('🤝 ' + _esc(_t('dn_deal_event', { name: '§N§', amount: '§A§' })).replace('§N§', _esc(name)).replace('§A§', '<b>' + fmt(d.amount) + '</b>') +
          '<small>' + _esc(_t('dn_held_event', { amount: fmt(d.value) })) + '</small>', 3000);
        sfx.deal();
        const p = S.players[d.pid];
        p.status = 'dealt'; p.amount = d.amount; p.round = m.round; p.box = null;
        S.box[d.box] = { st: 'gone', v: d.value };
        markOut(d.value);
        paintBoxes(); paintPlayers(); paintMine();
      }, 700 + i * 3200);
      i++;
    });
    (m.swaps || []).forEach(w => {
      later(() => {
        const name = playerOf(w.pid).display_name;
        toast('🔁 ' + _esc(_t('dn_swap_event', { name: '§N§', a: w.give, b: w.take })).replace('§N§', _esc(name)), 3000);
        const dest = w.pid === meId() ? el.mine.querySelector('.dn-mine-box') : chipOf(w.pid);
        const p = S.players[w.pid];
        slotOf(w.take).classList.add('empty');
        fly(slotOf(w.take), dest, w.take, () => {
          S.box[w.give] = { st: 'closed', v: null };
          S.box[w.take] = { st: 'held', v: null, by: w.pid };
          p.box = w.take;
          paintBoxes(); paintPlayers(); paintMine();
        });
      }, 700 + i * 3200);
      i++;
    });
    paintStatus();
  }

  function onOver(m) {
    S.over = true; S.turn = null; _deadline = 0;
    dropBanker();
    paintStatus(); paintAct();
    const mineRow = (m.results || []).find(r => r.player_id === meId());
    // Whoever still holds a box opens it by hand, full screen, before anything
    // else is shown: nothing of the end happens on its own.
    if (mineRow && mineRow.status === 'playing') showOwnBox(mineRow, () => revealRest(m, mineRow));
    else revealRest(m, null);
  }

  function revealRest(m, mineRow) {
    const reveal = (m.reveal || []).filter(r => !mineRow || r[0] !== mineRow.box);
    if (mineRow) markOut(mineRow.box_value);
    reveal.forEach((r, i) => {
      later(() => {
        const b = boxOf(r[0]);
        b.classList.add('opening'); sfx.tick();
        later(() => { S.box[r[0]] = { st: 'gone', v: r[1] }; markOut(r[1]); paintBoxes(); }, 700);
      }, i * 260);
    });
    later(() => showOver(m.results), reveal.length * 260 + 1800);
  }

  // The last thing in the game: the player's own box, opened by the player.
  function showOwnBox(row, done) {
    const ov = document.createElement('div');
    ov.className = 'dn-over dn-own';
    ov.innerHTML =
      '<div class="dn-own-in"><div class="dn-own-t">' + _esc(_t('dn_your_box')) + ' <b>#' + row.box + '</b></div>' +
      '<div class="dn-own-box"><div class="dn-own-lid"></div><div class="dn-own-num">' + row.box + '</div>' +
      '<div class="dn-own-val">' + fmt(row.box_value) + '</div></div>' +
      '<div class="dn-acts"><button class="dn-btn" data-go>' + _esc(_t('dn_open_mine')) + '</button></div></div>';
    el.wrap.appendChild(ov);
    const btn = ov.querySelector('[data-go]');
    let opened = false;
    btn.onclick = () => {
      if (!opened) {
        opened = true;
        ov.classList.add('opened');
        btn.disabled = true;
        if (row.box_value >= TOP) sfx.jackpot(); else if (row.box_value >= BIG) sfx.win(); else sfx.open();
        later(() => { btn.disabled = false; btn.textContent = _t('dn_continue'); }, 1800);
      } else {
        ov.remove();
        done();
      }
    };
  }

  // ── End ────────────────────────────────────────────────────────────────────
  function showOver(results) {
    if (!el.wrap || el.over) return;
    S.over = true;
    paintStatus();
    const multi = results.length > 1;
    const me = meId();
    const rows = results.map((r, i) => {
      const p = playerOf(r.player_id);
      const how = r.status === 'dealt' ? _t('dn_dealt') : _t('dn_kept', { n: r.box });
      const badges = r.bonuses.length
        ? r.bonuses.map(b => '<span class="dn-badge">' + _esc(_t('dn_b_' + b.id)) + ' <b>+' + b.pct + '%</b></span>').join('')
        : '<span class="dn-badge none">' + _esc(_t('dn_no_bonus')) + '</span>';
      return '<div class="dn-row' + (multi && i === 0 ? ' win' : '') + '"><span class="rk">' + (multi && i === 0 ? '🏆' : (i + 1)) + '</span>' +
        mp.renderAvatar(p, 28) +
        '<span class="n">' + _esc(p.display_name || r.display_name) + (r.player_id === me && multi ? ' · ' + _esc(_t('dn_you')) : '') + '<small>' + _esc(how) + '</small></span>' +
        '<span class="sc">' + fmt(r.score) + '<small>' + _esc(_t('dn_won')) + ' ' + fmt(r.amount) + (r.bonus_pct ? ' · ' + _esc(_t('dn_bonus')) + ' +' + r.bonus_pct + '%' : '') + '</small></span>' +
        '<div class="dn-badges">' + badges + '</div></div>';
    }).join('');
    const ov = document.createElement('div');
    ov.className = 'dn-over';
    ov.innerHTML =
      '<div class="dn-over-card"><h2>' + _esc(multi ? '🏆 ' + _t('dn_winner') + ': ' + (playerOf(results[0].player_id).display_name || '') : '🎉 ' + _t('dn_over')) + '</h2>' +
      '<div class="dn-rows">' + rows + '</div>' +
      '<section data-gh-results></section>' +
      '<div class="dn-acts"><button class="dn-btn" data-again>' + _esc(_t('dn_play_again')) + '</button>' +
      '<a class="dn-btn plain" href="' + HUB_URL + '">' + _esc(_t('dn_back')) + '</a></div></div>';
    el.wrap.appendChild(ov);
    el.over = ov;
    const mine = results.find(r => r.player_id === me);
    if (!multi || (mine && results[0].player_id === me)) sfx.win();
    ov.querySelector('[data-again]').onclick = e => playAgain(e.currentTarget);
  }

  async function playAgain(btn) {
    btn.disabled = true;
    btn.textContent = _t('dn_starting');
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
      btn.textContent = _t('dn_play_again');
      alert(_t('dn_error_new_game'));
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  // Registered at load time, not inside renderGame: the first message follows
  // the framework's game_started immediately.
  mp.on('dn_state', msg => {
    _sm = msg; _ready = false; _queue = [];
    if (_root && el.grid) init();
  });
  ['dn_turn', 'dn_drawn', 'dn_opened', 'dn_phase', 'dn_offer', 'dn_ready', 'dn_resolved', 'dn_over'].forEach(type => {
    mp.on(type, msg => { if (_ready) apply(msg); else _queue.push(msg); });
  });

  mp.registerGame({
    id: GAME_ID,
    name: _t('dn_title'),
    renderSetup,
    renderGame,
    // Save & exit is solo only; the hub asks the server for the table.
    snapshot: () => null,
    exitButton: false,
  });
})();
