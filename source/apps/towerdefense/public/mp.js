/*
 * Tower Defense — the client half of the game.
 *
 * Runs on Game Hub's generic play page (NOT inside mvmOS): the page loads
 * gamehub/widget.js, this file, and nothing else of ours. GameHub.mp owns the
 * socket, the lobby and the roster; this file registers the setup screen and
 * the game itself, and talks to mp_game.py over GameHub.mp.send/on.
 *
 * The rhythm of a run: during a wave the player does nothing at all — the
 * tower picks targets and fires with whatever it has mounted. Every decision
 * is made in the shop between two waves, where the coins the last wave paid
 * buy weapons (three of the five can be mounted at once), power and fire
 * rate for each of them; for the tower integrity, range, regeneration, a
 * shield and a shockwave; and on the battlefield around it two rings,
 * soldiers, drones and tesla pylons.
 *
 * The waves are not received from the server — the *seed* is. Both halves grow
 * the same waves out of it with the same arithmetic, so a second player added
 * later fights an identical run without a byte of per-enemy traffic. Anything
 * that decides what the waves look like therefore has to stay in sync; what
 * happens inside a fight (who a weapon picks, where a splitter breaks) is the
 * browser's own.
 */
(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;

  const GAME_ID = 'towerdefense';
  const _t = (k, v) => (window.t ? window.t(k, v) : k);

  // ── World constants ────────────────────────────────────────────────────────
  // A fixed logical world, scaled to whatever the screen is. Everything below
  // is in world units, so the game plays identically on a phone and a desktop.
  const W = 1000, H = 1000;
  const CX = W / 2, CY = H / 2;

  const TOWER_R      = 26;
  const BASE_RANGE   = 260;
  const RANGE_STEP   = 25;
  const SPAWN_RADIUS = 700;    // enemies walk in from outside the visible box
  const MAX_MOUNTED  = 3;
  const RATE_STEP    = 0.88;   // each fire-rate level cuts the reload by 12 %
  const FIREBALL_R   = 14;
  const WAVE_POINTS  = 50;
  const BOSS_EVERY   = 10;     // a boss comes after every tenth wave
  const LEVEL_CEILING = 500;   // matches td_bank.py; only guards forged builds

  // ── Catalogue ──────────────────────────────────────────────────────────────
  // What each thing does lives here; what it costs and how far it goes comes
  // from td_bank.py in td_start (see _applyShop), because the server checks
  // permanent purchases against it. The prices below only fill in until then.
  const WEAPONS = {
    gun:    { icon: '🎯', color: '#f9e2af', price: 0,   reload: 0.45, dmg: 30, speed: 640 },
    fire:   { icon: '🔥', color: '#fab387', price: 120, reload: 1.0,  dmg: 8,  speed: 520, burn: 14, burnFor: 3 },
    ice:    { icon: '❄️', color: '#89dceb', price: 140, reload: 1.7,  dmg: 6,  speed: 560, freeze: 1.1 },
    // The laser is not a shot: its beam is there at once, has no end, and
    // burns through everything on its line, however far out.
    laser:  { icon: '🔆', color: '#cba6f7', price: 220, reload: 3.2,  dmg: 80, grow: 0.45 },
    mine:   { icon: '💣', color: '#a6e3a1', price: 180, reload: 2.8,  dmg: 90, splash: 80, max: 8 },
  };
  const WEAPON_ORDER = ['gun', 'fire', 'ice', 'laser', 'mine'];
  // Things bought once that are not weapons.
  let EXTRAS = { regen: 90, shield: 150, nova: 170, fring: 200, iring: 160, soldiers: 180, drones: 240, tesla: 220 };
  // key -> [price of the first level, price growth per level, last level].
  // A key with a dot belongs to the thing before the dot and is only sold
  // once that thing is owned. A null last level means it never runs out.
  let UPGRADES = {
    'gun.p':    [30, 1.45, null], 'gun.r':    [35, 1.45, null],
    'fire.p':   [45, 1.45, null], 'fire.r':   [45, 1.45, null],
    'ice.p':    [45, 1.45, null], 'ice.r':    [50, 1.45, null],
    'laser.p':  [60, 1.45, null], 'laser.r':  [60, 1.45, null],
    'mine.p':   [55, 1.45, null], 'mine.r':   [55, 1.45, null],
    'hp':       [60, 1.4, null],
    'range':    [70, 1.5, 17],
    'regen.r':  [60, 1.45, null],
    'shield.c': [70, 1.45, null], 'shield.r': [70, 1.45, null],
    'nova.p':   [70, 1.45, null], 'nova.r':   [75, 1.45, null],
    'fring.n':  [150, 1.55, 5], 'fring.p': [80, 1.45, null], 'fring.s': [70, 1.45, null],
    'iring.w':  [70, 1.45, 30], 'iring.s': [80, 1.5, 9],
    'soldiers.f': [75, 1.45, null], 'soldiers.p': [70, 1.45, null],
    'drones.f':   [90, 1.45, null], 'drones.p':   [80, 1.45, null],
    'tesla.n':    [140, 1.55, 4],  'tesla.p':    [80, 1.45, null],
  };
  // A permanent purchase costs the in-run price times this.
  let PERM_FACTOR = 10000 / 30;

  // What comes at the tower. `from` is the first wave a kind can appear in;
  // its share of a wave then grows over the next three waves.
  const ENEMIES = {
    grunt:    { color: '#f38ba8', hp: 1,    speed: 1,    r: 12, dmg: 1,   bounty: 3,  from: 1,  w: 10 },
    runner:   { color: '#f5c2e7', hp: 0.55, speed: 1.85, r: 9,  dmg: 0.6, bounty: 3,  from: 3,  w: 6 },
    shooter:  { color: '#eba0ac', hp: 0.9,  speed: 0.85, r: 12, dmg: 0.5, bounty: 5,  from: 4,  w: 4, shoot: 2.4, shotDmg: 0.45 },
    brute:    { color: '#e64553', hp: 3.4,  speed: 0.55, r: 21, dmg: 2.5, bounty: 9,  from: 5,  w: 3 },
    flyer:    { color: '#74c7ec', hp: 0.7,  speed: 1.25, r: 11, dmg: 0.8, bounty: 5,  from: 6,  w: 4, fly: true },
    knight:   { color: '#9399b2', hp: 1.5,  speed: 0.8,  r: 14, dmg: 1.2, bounty: 7,  from: 7,  w: 3, armor: 0.5 },
    splitter: { color: '#94e2d5', hp: 1.4,  speed: 0.9,  r: 15, dmg: 1,   bounty: 4,  from: 9,  w: 3, split: 3 },
    healer:   { color: '#a6e3a1', hp: 1.1,  speed: 0.8,  r: 13, dmg: 0.8, bounty: 8,  from: 11, w: 2, heal: true },
    // The bosses. One comes alone after every tenth wave, in this order, and
    // the order starts over at wave 60 with every boss stronger than before.
    boss:       { color: '#d20f39', hp: 22, speed: 0.42, r: 34, dmg: 3.5, bounty: 60, boss: true, armor: 0.2,
                  shoot: 1.6, shotDmg: 0.8, summon: 7, summonKinds: ['grunt', 'grunt'] },
    colossus:   { color: '#8c8fa1', hp: 34, speed: 0.3,  r: 44, dmg: 6,   bounty: 60, boss: true, armor: 0.6,
                  freezeRes: 0.1 },
    wraith:     { color: '#b4befe', hp: 14, speed: 0.75, r: 30, dmg: 4,   bounty: 60, boss: true, fly: true,
                  blink: 3.5, shoot: 2, shotDmg: 0.6 },
    queen:      { color: '#40a02b', hp: 20, speed: 0.4,  r: 36, dmg: 3,   bounty: 60, boss: true, armor: 0.15,
                  summon: 5, summonKinds: ['flyer', 'runner', 'flyer'] },
    juggernaut: { color: '#fe640b', hp: 28, speed: 0.36, r: 38, dmg: 5,   bounty: 60, boss: true, armor: 0.3,
                  regen: 0.012, shoot: 2.2, shotDmg: 0.55, spread: 3 },
    // What a splitter breaks into; never part of a wave by itself.
    shard:    { color: '#94e2d5', hp: 0.35, speed: 1.4,  r: 8,  dmg: 0.5, bounty: 1 },
  };
  const SPAWNABLE = ['grunt', 'runner', 'shooter', 'brute', 'flyer', 'knight', 'splitter', 'healer'];
  const BOSSES = ['boss', 'colossus', 'wraith', 'queen', 'juggernaut'];
  const PREVIEW_ORDER = SPAWNABLE;

  // ── Deterministic RNG (mulberry32) ─────────────────────────────────────────
  // Same seed, same waves, on every client in the room.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _root = null, _canvas = null, _ctx2d = null;
  let _hud = null, _overlay = null;
  let _pending = null;             // td_start that arrived before renderGame
  let _tuning = null, _rand = null;
  let _raf = 0, _last = 0, _time = 0;

  let _b = null;                   // what the tower owns: { own, eq, lv }
  let _tower, _enemies, _shots, _enemyShots, _mines, _lobs, _particles, _blasts;
  let _cd, _aim, _ringAngle, _seen, _banner;
  let _shield, _beams, _soldiers, _drones, _bolts, _soldierCd, _droneCd;
  let _novaCd, _waves, _teslaCd, _zaps;
  let _wave, _ws, _waveQueue, _nextList, _spawnTimer, _clearTimer, _breakTimer;
  let _score, _kills, _coins, _elapsed, _over, _reported, _inShop;
  let _cp = null;                  // the checkpoint the room keeps for us
  let _bossPhase = false;          // the wave is cleared and its boss is on
  // The permanent side: what every run starts with, and the points to spend.
  let _perm = null, _bank = null, _earned = null;
  // The furthest wave this player has reached in any run, kept by the bank.
  let _best = 0;
  let _permMode = false, _permBusy = false, _permMsg = '', _bankTimer = 0;
  let _hudTimer = 0;
  // The exit dialog stops the clock. Deciding whether to save is not part of
  // the game, and the tower must not fall while the player is reading.
  let _paused = false;
  let _muted = false;
  try { _muted = localStorage.getItem('td_muted') === '1'; } catch (_) {}
  // Fast play (Premium) lives in premium/public/fastplay.js and reaches the
  // game only through these plug points: it may run the same simulation more
  // often and start the next wave, never change what a wave or a shot does.
  // The script is handed out only by an installation that has the premium
  // module and an owner who left it on, so without it nothing here is used.
  const _plug = { step: null, cleared: null, record: null };

  // ── Game screen ───────────────────────────────────────────────────────────
  function renderGame(root) {
    _root = root;

    const page = document.createElement('div');
    page.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:10px;align-items:center';
    page.innerHTML =
      '<div id="td-hud" style="display:flex;gap:8px;width:100%;max-width:760px;flex-wrap:wrap"></div>' +
      '<div id="td-stage" style="flex:1;min-height:0;width:100%;max-width:760px;position:relative">' +
      '<canvas id="td-canvas" style="position:absolute;inset:0;width:100%;height:100%;' +
      'border:1px solid var(--border,#45475a);border-radius:12px;background:var(--surface1,#181825);touch-action:none"></canvas>' +
      '<div id="td-overlay" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center"></div>' +
      '</div>';
    root.appendChild(page);

    _hud     = page.querySelector('#td-hud');
    _canvas  = page.querySelector('#td-canvas');
    _overlay = page.querySelector('#td-overlay');
    _ctx2d   = _canvas.getContext('2d');

    _buildHud();
    _overlay.addEventListener('click', _onOverlayClick);
    _fitCanvas();
    window.addEventListener('resize', _fitCanvas);
    // The stage also changes size without the window doing so — when
    // something is added around it after load (the Fast play bar) — and the
    // canvas has to follow, or it spills over the HUD.
    if (window.ResizeObserver) new ResizeObserver(_fitCanvas).observe(_canvas.parentElement);

    if (_pending) { const m = _pending; _pending = null; _begin(m); }
    _loadFastPlay();
  }

  function _loadFastPlay() {
    const token = (window.GameHub.getToken && window.GameHub.getToken()) || '';
    fetch('/pub/' + GAME_ID + '/premium/fastplay.js', { headers: { 'X-GH-Token': token }, cache: 'no-store' })
      .then(r => (r.ok ? r.text() : null))
      .then(code => {
        if (!code || !_hud) return;
        // Handed to the script for the one synchronous moment it runs.
        window.TowerDefenseHost = {
          page: _hud.parentElement,
          t: _t, esc: _esc, sfx: _sfx,
          on: (name, fn) => { if (name in _plug) _plug[name] = fn; },
          update: dt => _update(dt),
          running: () => !_over && !_paused && !_inShop,
          idle: () => _inShop && !_over && !_paused && !_permMode,
          startWave: () => { if (_inShop && !_over && !_permMode) _startWave(); },
          openShop: () => { if (_inShop && !_over && !_permMode) _renderShop(); },
          best: () => _best,
          nextWave: () => _wave + 1,
        };
        const el = document.createElement('script');
        el.textContent = code;
        document.head.appendChild(el);
        el.remove();
        delete window.TowerDefenseHost;
      })
      .catch(() => {});
  }

  function _fitCanvas() {
    if (!_canvas) return;
    const box = _canvas.parentElement.getBoundingClientRect();
    // Square arena: the tower sits in the middle and enemies come from every
    // side, so a stretched field would give some directions more warning.
    const side = Math.max(160, Math.min(box.width, box.height));
    const dpr  = window.devicePixelRatio || 1;
    _canvas.style.width  = side + 'px';
    _canvas.style.height = side + 'px';
    _canvas.style.left   = ((box.width  - side) / 2) + 'px';
    _canvas.style.top    = ((box.height - side) / 2) + 'px';
    _canvas.style.inset  = 'auto';
    _canvas.width  = Math.round(side * dpr);
    _canvas.height = Math.round(side * dpr);
    _draw();
  }

  // ── What the tower has ────────────────────────────────────────────────────
  function _lv(k)    { return _b.lv[k] || 0; }
  function _owns(k)  { return _b.own.indexOf(k) !== -1; }
  function _range()  { return BASE_RANGE + RANGE_STEP * _lv('range'); }
  function _maxHp()  { return Math.round(_tuning.tower_hp * (1 + 0.2 * _lv('hp'))); }

  function _wstat(w) {
    const d = WEAPONS[w], p = _lv(w + '.p');
    return {
      reload: d.reload * Math.pow(RATE_STEP, _lv(w + '.r')),
      dmg:    d.dmg * (1 + (d.grow || 0.25) * p),
      burn:   d.burn ? d.burn * (1 + 0.3 * p) : 0,
      freeze: d.freeze ? d.freeze * (1 + 0.15 * p) : 0,
      splash: d.splash ? d.splash * (1 + 0.04 * p) : 0,
    };
  }
  function _regen() {
    return _owns('regen') ? _maxHp() * 0.004 * (1 + 0.45 * _lv('regen.r')) : 0;
  }
  function _fring() {
    return {
      n:    1 + _lv('fring.n'),
      dmg:  18 * (1 + 0.3 * _lv('fring.p')),
      spin: 1.1 * (1 + 0.25 * _lv('fring.s')),
    };
  }
  function _iring() {
    return {
      width: Math.min(_range() - TOWER_R - 20, 35 + 20 * _lv('iring.w')),
      slow:  0.25 + 0.07 * _lv('iring.s'),
    };
  }
  // The shield takes the hits first. Once broken it is gone until it has
  // charged back up in full; between waves it is always ready again.
  function _shieldStat() {
    return {
      max:  _maxHp() * 0.3 * (1 + 0.35 * _lv('shield.c')),
      time: 9 * Math.pow(RATE_STEP, _lv('shield.r')),
    };
  }
  // Soldiers walk out and hold the ground enemies; drones fly to anything,
  // flyers too, and shoot until their battery runs out.
  function _soldierStat() {
    const f = _lv('soldiers.f'), p = 1 + 0.35 * _lv('soldiers.p');
    return { every: 7 * Math.pow(RATE_STEP, f), max: Math.min(8, 3 + Math.floor(f / 2)), hp: 45 * p, dmg: 18 * p };
  }
  function _droneStat() {
    const f = _lv('drones.f'), p = 1 + 0.35 * _lv('drones.p');
    return { every: 8 * Math.pow(RATE_STEP, f), max: Math.min(6, 2 + Math.floor(f / 2)), dmg: 12 * p, life: 14 };
  }
  // The shockwave goes off by itself once something gets close to the tower:
  // it hurts everything around and throws it back out.
  function _novaStat() {
    return {
      radius: TOWER_R + 95,
      dmg:    40 * (1 + 0.35 * _lv('nova.p')),
      push:   90,
      every:  10 * Math.pow(RATE_STEP, _lv('nova.r')),
    };
  }
  // Tesla pylons stand evenly round the field; each one's lightning jumps
  // from enemy to enemy, flyers included.
  function _teslaStat() {
    const p = _lv('tesla.p');
    return {
      n:     2 + _lv('tesla.n'),
      dmg:   22 * (1 + 0.3 * p),
      chain: Math.min(8, 2 + Math.floor(p / 2)),
      reach: 170,
      every: 1.6,
    };
  }
  function _pylons() {
    const n = _teslaStat().n, r = _range() * 0.62, out = [];
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + Math.PI / n + k * Math.PI * 2 / n;
      out.push({ x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r });
    }
    return out;
  }
  function _fullShield() {
    _shield = { hp: _owns('shield') ? _shieldStat().max : 0, down: false, hit: 0 };
  }
  function _repairAmount() { return Math.round(_maxHp() * 0.25); }
  function _repairPrice()  { return 20 + Math.max(1, _wave) * 4; }
  // The last level an upgrade can reach. The ice ring also stops growing
  // once it fills the range, so its cap moves with the range.
  function _cap(k) {
    const c = UPGRADES[k][2];
    if (k === 'iring.w') return Math.min(c, Math.max(0, Math.ceil((_range() - TOWER_R - 20 - 35) / 20)));
    return c;
  }
  function _maxed(k) { const c = _cap(k); return c != null && _lv(k) >= c; }

  // Same rounding as td_bank.perm_price, so the shown price is the charged one.
  function _permPrice(base, mult, level) {
    return Math.floor(PERM_FACTOR * base * Math.pow(mult || 1, level || 0) / 50 + 0.5) * 50;
  }
  function _price(k) {
    const u = UPGRADES[k];
    if (_permMode) return _permPrice(u[0], u[1], _lv(k));
    return Math.round(u[0] * Math.pow(u[1], _lv(k)) / 5) * 5;
  }
  function _buyPrice(k) {
    const base = WEAPONS[k] ? WEAPONS[k].price : EXTRAS[k];
    return _permMode ? _permPrice(base) : base;
  }
  function _money() { return _permMode ? (_bank || 0) : _coins; }

  // Big numbers in a small card: exact up to 100 000, then 1.2M style.
  function _num(n) {
    n = Math.round(n);
    if (n < 100000) return n.toLocaleString();
    try { return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n); }
    catch (_) { return n.toLocaleString(); }
  }

  function _applyShop(shop) {
    if (!shop || typeof shop !== 'object') return;
    for (const w in (shop.weapons || {})) if (WEAPONS[w]) WEAPONS[w].price = shop.weapons[w];
    if (shop.extras) EXTRAS = shop.extras;
    if (shop.upgrades) UPGRADES = shop.upgrades;
    if (shop.perm_factor) PERM_FACTOR = shop.perm_factor;
  }

  function _freshBuild() { return { own: ['gun'], eq: ['gun'], lv: {} }; }
  function _copyBuild(b) { return { own: b.own.slice(), eq: b.eq.slice(), lv: Object.assign({}, b.lv) }; }

  // A saved run against what has been bought for good since: the run keeps
  // its own mounts, and gets anything permanent it did not have yet.
  function _mergeBuild(run, perm) {
    const b = _copyBuild(run);
    for (const k of perm.own) if (b.own.indexOf(k) === -1) b.own.push(k);
    for (const k in perm.lv) b.lv[k] = Math.max(b.lv[k] || 0, perm.lv[k]);
    return _cleanBuild(b);
  }

  // A build read back from the room is only trusted as far as this catalogue
  // allows: unknown items are dropped and every level is held to its cap.
  function _cleanBuild(b) {
    const own = [];
    for (const k of (Array.isArray(b.own) ? b.own : [])) {
      if ((WEAPONS[k] || EXTRAS[k]) && own.indexOf(k) === -1) own.push(k);
    }
    if (own.indexOf('gun') === -1) own.unshift('gun');
    const eq = [];
    for (const k of (Array.isArray(b.eq) ? b.eq : [])) {
      if (WEAPONS[k] && own.indexOf(k) !== -1 && eq.indexOf(k) === -1 && eq.length < MAX_MOUNTED) eq.push(k);
    }
    if (!eq.length) eq.push('gun');
    const lv = {};
    for (const k in UPGRADES) {
      const v = Math.floor(Number(b.lv && b.lv[k]) || 0);
      const cap = UPGRADES[k][2];
      if (v > 0) lv[k] = Math.min(cap == null ? LEVEL_CEILING : cap, v);
    }
    return { own, eq, lv };
  }

  // ── Run lifecycle ─────────────────────────────────────────────────────────
  function _begin(msg) {
    _tuning = msg.tuning || { enemy_hp: 0.9, enemy_speed: 0.95, spawn_rate: 0.9, tower_hp: 100 };
    _rand   = rng(msg.seed || 1);
    _applyShop(msg.shop);

    _perm = _cleanBuild(msg.perm || _freshBuild());
    _setBest(msg.best);
    _bank = null; _earned = null; _permMode = false; _permMsg = '';
    clearTimeout(_bankTimer);
    _b = _copyBuild(_perm);
    _tower = { hp: _tuning.tower_hp, maxHp: _tuning.tower_hp, hit: 0 };
    _enemies = []; _shots = []; _enemyShots = []; _mines = []; _lobs = [];
    _particles = []; _blasts = [];
    _beams = []; _soldiers = []; _drones = []; _bolts = []; _soldierCd = 1; _droneCd = 1.5;
    _novaCd = 0; _waves = []; _teslaCd = []; _zaps = [];
    _cd = {}; _aim = {}; _ringAngle = 0; _seen = {}; _banner = null;
    _wave = 0; _ws = _waveStats(1);
    _waveQueue = []; _nextList = null;
    _spawnTimer = 0; _clearTimer = 0;
    _breakTimer = 2;             // a breath before the first wave
    _score = 0; _kills = 0; _coins = 0; _elapsed = 0;
    _over = false; _reported = false; _inShop = false; _paused = false;
    _cp = null; _bossPhase = false;

    const r = msg.resume;
    if (r && r.over) {
      // Came back to a finished run: show the result, do not report it again.
      _score = r.score || 0; _kills = r.kills || 0; _elapsed = r.seconds || 0;
      _wave = r.wave || 1;
      _over = true; _reported = true;
      _renderHud(); _showGameOver(); _draw();
      _loadBank();
      return;
    }
    if (r) _resume(r);
    _fullShield();

    _renderHud();
    if (_inShop) _renderShop();
    else _overlay.style.display = 'none';
    _last = performance.now();
    cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(_loop);
  }

  // Pick the run back up where the room last saw it. The checkpoint is taken
  // in the shop and at the start of every wave, never in the middle of one,
  // so a run always comes back in the shop before the wave it was on — with
  // the coins, purchases, score and integrity it had going into that wave.
  // A wave abandoned halfway is fought again from the start; its coins were
  // never banked, so reloading cannot be used to farm them.
  function _resume(r) {
    _score   = r.score   || 0;
    _kills   = r.kills   || 0;
    _elapsed = r.seconds || 0;
    _coins   = Math.max(0, r.coins || 0);
    if (r.build && typeof r.build === 'object') _b = _mergeBuild(_cleanBuild(r.build), _perm);
    _tower.maxHp = _maxHp();
    _tower.hp = r.hp > 0 ? Math.min(_tower.maxHp, r.hp) : _tower.maxHp;

    // The waves come out of one RNG stream, so the stream has to be wound
    // forward through the waves already fought for wave N to be the same wave
    // it would have been without the reload.
    const wave = Math.max(1, r.wave || 1);
    for (let i = 1; i < wave; i++) {
      for (const s of _buildWave(i)) _seen[s.type] = true;
    }
    _wave = wave - 1;
    _ws = _waveStats(Math.max(1, _wave));
    _nextList = _buildWave(wave);
    _inShop = true;
    _checkpoint();
  }

  function _loop(now) {
    _raf = requestAnimationFrame(_loop);
    // Clamped so a backgrounded tab does not resume with one enormous step
    // that teleports every enemy into the tower.
    const dt = Math.min(0.05, (now - _last) / 1000);
    _last = now;
    _time += dt;
    if (!_over && !_paused && !_inShop) (_plug.step ? _plug.step(dt) : _update(dt));
    _draw();
  }

  // ── Waves ─────────────────────────────────────────────────────────────────
  // Grown from the seed, so this must stay identical on every client.
  function _buildWave(n) {
    const pool = [];
    let total = 0;
    for (const k of SPAWNABLE) {
      const T = ENEMIES[k];
      if (n < T.from) continue;
      const w = T.w * Math.min(1, (n - T.from + 1) / 3);
      pool.push([k, w]);
      total += w;
    }
    const count = Math.round(5 + n * 1.7);
    const list  = [];
    for (let i = 0; i < count; i++) {
      let roll = _rand() * total, type = pool[0][0];
      for (const [k, w] of pool) { roll -= w; if (roll <= 0) { type = k; break; } }
      list.push({ type, angle: _rand() * Math.PI * 2, v: 0.85 + _rand() * 0.3, stop: _rand() });
    }
    return list;
  }

  function _bossOf(n) { return BOSSES[(n / BOSS_EVERY - 1) % BOSSES.length]; }

  // How hard wave n hits. Health grows faster than linearly, so the shop has
  // to keep up; size grows a little so later waves also look heavier.
  function _waveStats(n) {
    return {
      hp:    (22 + n * 6 + n * n * 0.45) * _tuning.enemy_hp,
      speed: (36 + Math.min(n, 30) * 1.1) * _tuning.enemy_speed,
      dmg:   7 + n * 0.7,
      size:  1 + Math.min(0.45, n * 0.012),
      coin:  1 + n * 0.06,
    };
  }

  function _startWave() {
    _wave += 1;
    _ws = _waveStats(_wave);
    _waveQueue = _nextList || _buildWave(_wave);
    _nextList = null;
    for (const s of _waveQueue) _seen[s.type] = true;
    _spawnTimer = 0.4;
    _clearTimer = 1.2;
    _bossPhase = false;
    _fullShield();
    _inShop = false;
    _overlay.style.display = 'none';
    _overlay.innerHTML = '';
    _banner = { text: _t('td_incoming', { n: _wave }), t: 2 };
    _sfx('wave');
    _checkpoint();
    _report();
    _renderHud();
  }

  // After a tenth wave is cleared, its boss comes alone. Which boss follows
  // from the wave number, and it grows with the wave like everything else,
  // plus a little more each time the order comes round. Its side is fixed by
  // the wave too, so it does not draw on the seed's stream.
  function _startBoss() {
    _bossPhase = true;
    const type = _bossOf(_wave);
    const tier = _wave / BOSS_EVERY - 1;
    const a = _wave * 2.39996;
    _spawn(type, CX + Math.cos(a) * SPAWN_RADIUS, CY + Math.sin(a) * SPAWN_RADIUS, 1, 0);
    const e = _enemies[_enemies.length - 1];
    e.hp = e.maxHp = e.hp * (1 + 0.35 * tier);
    e.dmg *= 1 + 0.15 * tier;
    e.bounty = Math.round(e.bounty * (1 + 0.5 * tier));
    _seen[type] = true;
    _clearTimer = 1.2;
    _banner = { text: _t('td_boss_incoming', { name: _t('td_e_' + type) }), t: 2.5 };
    _sfx('boss');
  }

  function _waveCleared() {
    _bossPhase = false;
    _score += WAVE_POINTS;
    _coins += 15 + _wave * 4;
    _shots = []; _enemyShots = []; _bolts = []; _beams = [];
    // The units go home with the wave; the next one sends fresh ones out.
    _soldiers = []; _drones = []; _soldierCd = 1; _droneCd = 1.5;
    _novaCd = 0; _teslaCd = []; _zaps = [];
    _sfx('cleared');
    _nextList = _buildWave(_wave + 1);
    _inShop = true;
    _checkpoint();
    _report();
    _renderHud();
    // Auto waves (Premium) go straight on to the next wave: no shop at all.
    if (_plug.cleared && _plug.cleared()) return;
    _renderShop();
  }

  function _spawn(type, x, y, v, stop) {
    const T = ENEMIES[type], s = _ws;
    const hp = s.hp * T.hp * v;
    _enemies.push({
      type, T, x, y, hp, maxHp: hp,
      // The tougher ones of a kind are a little slower.
      speed: s.speed * T.speed * (2 - v),
      r: T.r * s.size,
      dmg: s.dmg * T.dmg,
      bounty: T.bounty,
      // Gunners stop short of the tower, always inside the starting range.
      stop: T.shoot && !T.boss ? 195 + stop * 45 : 0,
      shootCd: T.shoot ? T.shoot * (0.5 + Math.random() * 0.5) : 0,
      summonCd: T.summon || 0,
      blinkCd: T.blink || 0,
      healCd: 1.5, pulse: 0,
      frozen: 0, held: 0, burn: 0, burnDps: 0, ringCd: 0, flash: 0, slowed: false,
      wob: Math.random() * 6.28, dead: false,
    });
  }

  // ── Simulation ────────────────────────────────────────────────────────────
  function _update(dt) {
    if (_wave === 0) {
      _breakTimer -= dt;
      if (_breakTimer <= 0) _startWave();
      return;
    }
    _elapsed += dt;
    const range = _range();
    if (_banner) { _banner.t -= dt; if (_banner.t <= 0) _banner = null; }
    _tower.hit = Math.max(0, _tower.hit - dt);

    if (_waveQueue.length) {
      _spawnTimer -= dt;
      if (_spawnTimer <= 0) {
        const sp = _waveQueue.shift();
        _spawnTimer = Math.max(0.22, 0.75 - _wave * 0.012) / _tuning.spawn_rate;
        _spawn(sp.type, CX + Math.cos(sp.angle) * SPAWN_RADIUS, CY + Math.sin(sp.angle) * SPAWN_RADIUS, sp.v, sp.stop);
        if (sp.type === 'boss') _sfx('boss');
      }
    }

    const regen = _regen();
    if (regen) _tower.hp = Math.min(_tower.maxHp, _tower.hp + regen * dt);
    _updateShield(dt);

    _updateEnemies(dt, range);
    if (_over) return;
    _fireWeapons(dt, range);
    _updateShots(dt);
    _updateMines(dt);
    _updateFireRing(dt, range);
    _updateSoldiers(dt, range);
    _updateDrones(dt, range);
    _updateNova(dt);
    _updateTesla(dt);
    _updateEnemyShots(dt);
    if (_over) return;
    _updateFx(dt);
    _enemies = _enemies.filter(e => !e.dead);

    _hudTimer -= dt;
    if (_hudTimer <= 0) { _hudTimer = 0.2; _renderHud(); }

    if (!_waveQueue.length && !_enemies.length) {
      _clearTimer -= dt;
      if (_clearTimer <= 0) {
        if (_wave % BOSS_EVERY === 0 && !_bossPhase) _startBoss();
        else _waveCleared();
      }
    }
  }

  function _updateEnemies(dt, range) {
    const ice = _owns('iring') ? _iring() : null;
    for (const e of _enemies) {
      if (e.dead) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.pulse = Math.max(0, e.pulse - dt);
      e.ringCd -= dt;

      // Burning ignores armour: it is the answer to knights.
      if (e.burn > 0) {
        e.burn -= dt;
        _damage(e, e.burnDps * dt, false);
        if (Math.random() < dt * 10) _spark(e.x, e.y - e.r * 0.5, '#fab387', 0.4, 40);
        if (e.dead) continue;
      }

      const dx = CX - e.x, dy = CY - e.y;
      const d  = Math.hypot(dx, dy) || 1;

      let f = 1;
      if (e.frozen > 0) { e.frozen -= dt; f = 0; }
      e.slowed = false;
      if (f && ice && !e.T.fly && d <= range && d >= range - ice.width) {
        f *= 1 - ice.slow;
        e.slowed = true;
      }

      // Frozen enemies do nothing at all; slowed ones do everything slower.
      const parked = e.stop && d <= e.stop + 0.5;
      if (e.T.shoot && (parked || (e.T.boss && d <= 430))) {
        e.shootCd -= dt * f;
        if (e.shootCd <= 0) {
          e.shootCd = e.T.shoot;
          _sfx(e.T.boss ? 'bossShot' : 'enemyShot');
          // A spread is fanned around the line to the tower; the side shots
          // miss unless the tower is big, so only the middle one is sure.
          const n = e.T.spread || 1, base = Math.atan2(dy, dx);
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.12;
            _enemyShots.push({ x: e.x, y: e.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
                               dmg: _ws.dmg * e.T.shotDmg, boss: !!e.T.boss });
          }
        }
      }
      if (e.T.regen && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.T.regen * dt * f);
        if (Math.random() < dt * 4) _spark(e.x, e.y, '#a6e3a1', 0.5, 50);
      }
      // Fades out and comes back a stretch closer, so it can only be fought
      // while it is in view.
      if (e.T.blink && d > 220) {
        e.blinkCd -= dt * f;
        if (e.blinkCd <= 0) {
          e.blinkCd = e.T.blink;
          _burst(e.x, e.y, e.T.color, 14);
          const jump = Math.min(110, d - 200);
          e.x += dx / d * jump;
          e.y += dy / d * jump;
          _burst(e.x, e.y, e.T.color, 14);
          e.pulse = 0.5;
          _sfx('summon');
          continue;
        }
      }
      if (e.T.heal) {
        e.healCd -= dt * f;
        if (e.healCd <= 0) {
          e.healCd = 2;
          e.pulse = 0.5;
          for (const o of _enemies) {
            if (o !== e && !o.dead && Math.hypot(o.x - e.x, o.y - e.y) < 110) {
              o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.1);
            }
          }
        }
      }
      // Calls its reinforcements on the way in, not from the tower's doorstep.
      if (e.T.summon && d < 520 && d > 250) {
        e.summonCd -= dt * f;
        if (e.summonCd <= 0) {
          e.summonCd = e.T.summon;
          const kinds = e.T.summonKinds || ['grunt', 'grunt'];
          for (const kind of kinds) {
            const a = Math.random() * Math.PI * 2;
            _spawn(kind, e.x + Math.cos(a) * (e.r + 14), e.y + Math.sin(a) * (e.r + 14), 0.9, 0);
          }
          e.pulse = 0.5;
          _sfx('summon');
        }
      }

      if (parked) continue;
      // A soldier in the way holds it up; a boss walks on through.
      if (e.held > 0) { e.held -= dt; continue; }
      const step = e.speed * f * dt;
      e.x += dx / d * step;
      e.y += dy / d * step;
      if (d - step <= TOWER_R + e.r) {
        e.dead = true;           // reaching the tower is not a kill: no coins
        _burst(e.x, e.y, '#f38ba8', 12);
        _hurtTower(e.dmg);
        if (_over) return;
      }
    }
  }

  function _hurtTower(dmg) {
    if (_owns('shield') && !_shield.down && _shield.hp > 0) {
      const took = Math.min(dmg, _shield.hp);
      _shield.hp -= took;
      _shield.hit = 0.2;
      dmg -= took;
      if (_shield.hp <= 0.01) {
        _shield.hp = 0;
        _shield.down = true;
        _burst(CX, CY, '#89dceb', 24);
        _sfx('shieldDown');
      } else _sfx('shieldHit');
      if (dmg <= 0) return;
    }
    _sfx('hit');
    _tower.hp -= dmg;
    _tower.hit = 0.25;
    if (_tower.hp <= 0) { _tower.hp = 0; _end(); }
  }

  function _damage(e, amount, direct) {
    if (e.dead) return;
    // Armour only stops what hits the body directly; fire, explosions and the
    // fire ring go straight through it.
    if (direct && e.T.armor) amount *= 1 - e.T.armor;
    e.hp -= amount;
    if (direct) e.flash = 0.08;
    if (e.hp <= 0) _kill(e);
  }

  function _kill(e) {
    e.dead = true;
    _kills += 1;
    _coins += Math.max(1, Math.round(e.bounty * _ws.coin));
    _score += e.bounty * 4;
    _burst(e.x, e.y, e.T.color, e.T.boss ? 40 : 12);
    _sfx(e.T.boss ? 'bossDown' : 'kill');
    if (e.T.split) {
      for (let i = 0; i < e.T.split; i++) {
        const a = Math.random() * Math.PI * 2;
        _spawn('shard', e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, 1, 0);
      }
    }
  }

  // ── Weapons ───────────────────────────────────────────────────────────────
  function _dist(e) { return Math.hypot(e.x - CX, e.y - CY); }

  function _inRange(range, test) {
    return _enemies.filter(e => !e.dead && _dist(e) <= range && (!test || test(e)));
  }

  function _nearest(list) {
    let best = null, bestD = Infinity;
    for (const e of list) { const d = _dist(e); if (d < bestD) { bestD = d; best = e; } }
    return best;
  }

  // Each weapon has its own idea of a good target, so three mounted weapons
  // spread over the field instead of all hitting the same enemy.
  function _pick(w, range, st) {
    const all = _inRange(range);
    if (!all.length) return null;
    if (w === 'ice')  return _nearest(all.filter(e => e.frozen <= 0.15 && !e.T.boss)) || _nearest(all);
    if (w === 'fire') return _nearest(all.filter(e => e.burn <= 0.5)) || _nearest(all);
    return _nearest(all);
  }

  // A mine goes where an enemy is about to be, not where it is now.
  function _mineSpot(range) {
    const ground = _inRange(range + 60, e => !e.T.fly && !(e.stop && _dist(e) <= e.stop + 2))
      .sort((a, b) => _dist(a) - _dist(b));
    for (const e of ground) {
      const d  = _dist(e);
      const pd = Math.min(range, d - e.speed * 1.2);
      if (pd < TOWER_R + 30) continue;
      const x = CX + (e.x - CX) / d * pd, y = CY + (e.y - CY) / d * pd;
      const taken = _mines.some(m => Math.hypot(m.x - x, m.y - y) < 45) ||
                    _lobs.some(m => Math.hypot(m.x - x, m.y - y) < 45);
      if (!taken) return { x, y };
    }
    return null;
  }

  function _fireWeapons(dt, range) {
    for (const w of _b.eq) {
      _cd[w] = (_cd[w] || 0) - dt;
      if (_cd[w] > 0) continue;
      const st = _wstat(w);
      if (w === 'mine') {
        if (_mines.length + _lobs.length >= WEAPONS.mine.max) continue;
        const spot = _mineSpot(range);
        if (!spot) continue;
        _aim[w] = Math.atan2(spot.y - CY, spot.x - CX);
        _lobs.push({ x: spot.x, y: spot.y, t: 0 });
        _sfx('mine');
        _cd[w] = st.reload;
        continue;
      }
      if (w === 'laser') {
        if (_fireLaser(st)) { _cd[w] = st.reload; _sfx('laser'); }
        continue;
      }
      const target = _pick(w, range, st);
      if (!target) continue;
      _aim[w] = Math.atan2(target.y - CY, target.x - CX);
      const len = TOWER_R + 14;
      _shots.push({
        w, st, target, tx: target.x, ty: target.y,
        x: CX + Math.cos(_aim[w]) * len, y: CY + Math.sin(_aim[w]) * len,
        a: _aim[w], v: WEAPONS[w].speed, life: 3,
      });
      _cd[w] = st.reload;
      _sfx(w);
    }
  }

  // The laser has no range: it picks the toughest enemy anywhere on the field
  // and burns through everything on the line to it and beyond.
  function _fireLaser(st) {
    let target = null;
    for (const e of _enemies) {
      if (!e.dead && _dist(e) <= SPAWN_RADIUS + 60 && (!target || e.hp > target.hp)) target = e;
    }
    if (!target) return false;
    const a = Math.atan2(target.y - CY, target.x - CX);
    const ux = Math.cos(a), uy = Math.sin(a);
    _aim.laser = a;
    for (const e of _enemies) {
      if (e.dead) continue;
      const px = e.x - CX, py = e.y - CY, along = px * ux + py * uy;
      if (along > 0 && Math.abs(px * uy - py * ux) <= e.r + 7) {
        _damage(e, st.dmg, true);
        _burst(e.x, e.y, WEAPONS.laser.color, 6);
      }
    }
    _beams.push({ a, t: 0, w: 5 + Math.min(10, _lv('laser.p')) });
    return true;
  }

  // Shots home in, so a shot fired at a moving target still lands.
  function _updateShots(dt) {
    for (let i = _shots.length - 1; i >= 0; i--) {
      const s = _shots[i];
      s.life -= dt;
      if (!s.target.dead) { s.tx = s.target.x; s.ty = s.target.y; }
      else { _shots.splice(i, 1); continue; }
      const dx = s.tx - s.x, dy = s.ty - s.y;
      const d  = Math.hypot(dx, dy) || 1;
      const step = s.v * dt;
      s.a = Math.atan2(dy, dx);
      const reach = s.target.dead ? 4 : s.target.r;
      if (d <= step + reach || s.life <= 0) { _shots.splice(i, 1); _impact(s); continue; }
      s.x += dx / d * step;
      s.y += dy / d * step;
      if (s.w === 'fire' && Math.random() < 0.5) _spark(s.x, s.y, '#fab387', 0.25, 20);
    }
  }

  function _impact(s) {
    const e = s.target, st = s.st;
    if (e.dead) return;
    _damage(e, st.dmg, true);
    if (s.w === 'fire') {
      const still = e.burn > 0 ? e.burnDps : 0;
      e.burn = WEAPONS.fire.burnFor;
      e.burnDps = Math.max(still, st.burn);
    } else if (s.w === 'ice') {
      _sfx('freeze');
      e.frozen = Math.max(e.frozen, st.freeze * (e.T.boss ? (e.T.freezeRes != null ? e.T.freezeRes : 0.35) : 1));
    }
    _burst(e.x, e.y, WEAPONS[s.w].color, 4);
  }

  function _explode(x, y, radius, dmg, color, hitsFlyers) {
    _blasts.push({ x, y, r: radius, t: 0, color });
    _sfx('boom');
    _burst(x, y, color, 18);
    for (const e of _enemies) {
      if (!e.dead && (hitsFlyers || !e.T.fly) && Math.hypot(e.x - x, e.y - y) <= radius + e.r) {
        _damage(e, dmg, false);
      }
    }
  }

  function _updateMines(dt) {
    for (let i = _lobs.length - 1; i >= 0; i--) {
      const l = _lobs[i];
      l.t += dt / 0.55;
      if (l.t >= 1) {
        _lobs.splice(i, 1);
        _mines.push({ x: l.x, y: l.y, arm: 0.25, blink: Math.random() * 6 });
      }
    }
    if (!_mines.length) return;
    const st = _wstat('mine');
    for (let i = _mines.length - 1; i >= 0; i--) {
      const m = _mines[i];
      m.blink += dt;
      if (m.arm > 0) { m.arm -= dt; continue; }
      for (const e of _enemies) {
        if (!e.dead && !e.T.fly && Math.hypot(e.x - m.x, e.y - m.y) <= e.r + 10) {
          _mines.splice(i, 1);
          _explode(m.x, m.y, st.splash, st.dmg, WEAPONS.mine.color, false);
          break;
        }
      }
    }
  }

  function _updateFireRing(dt, range) {
    if (!_owns('fring')) return;
    const fr = _fring();
    _ringAngle += fr.spin * dt;
    for (let k = 0; k < fr.n; k++) {
      const a  = _ringAngle + k * Math.PI * 2 / fr.n;
      const bx = CX + Math.cos(a) * range, by = CY + Math.sin(a) * range;
      for (const e of _enemies) {
        if (!e.dead && e.ringCd <= 0 && Math.hypot(e.x - bx, e.y - by) <= e.r + FIREBALL_R) {
          e.ringCd = 0.45;
          e.flash = 0.08;
          _damage(e, fr.dmg, false);
          _burst(e.x, e.y, '#fab387', 5);
          _sfx('scorch');
        }
      }
    }
  }

  function _updateShield(dt) {
    _shield.hit = Math.max(0, _shield.hit - dt);
    if (!_owns('shield') || !_shield.down) return;
    const sh = _shieldStat();
    _shield.hp += sh.max / sh.time * dt;
    if (_shield.hp >= sh.max) {
      _shield.hp = sh.max;
      _shield.down = false;
      _sfx('shieldUp');
    }
  }

  // The nearest enemy to a point that `ok` accepts, within reach of it.
  function _closestTo(x, y, reach, ok) {
    let best = null, bestD = reach;
    for (const e of _enemies) {
      if (e.dead || !ok(e)) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  function _updateSoldiers(dt, range) {
    if (_owns('soldiers')) {
      const so = _soldierStat();
      _soldierCd -= dt;
      if (_soldierCd <= 0 && _soldiers.length < so.max && (_waveQueue.length || _enemies.length)) {
        _soldierCd = so.every;
        const a = Math.random() * Math.PI * 2;
        _soldiers.push({ x: CX + Math.cos(a) * TOWER_R, y: CY + Math.sin(a) * TOWER_R,
                         hp: so.hp, maxHp: so.hp, dmg: so.dmg, home: a, cd: 0, hit: 0, face: a, target: null });
        _sfx('deploy');
      }
    }
    for (let i = _soldiers.length - 1; i >= 0; i--) {
      const s = _soldiers[i];
      s.hit = Math.max(0, s.hit - dt);
      let e = s.target;
      if (!e || e.dead || _dist(e) > range + 60) {
        e = s.target = _closestTo(s.x, s.y, Infinity, o => !o.T.fly && _dist(o) <= range + 60);
      }
      let tx, ty, reach;
      if (e) { tx = e.x; ty = e.y; reach = e.r + 9; }
      else { tx = CX + Math.cos(s.home) * (TOWER_R + 34); ty = CY + Math.sin(s.home) * (TOWER_R + 34); reach = 2; }
      const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy) || 1;
      s.face = Math.atan2(dy, dx);
      if (d > reach) {
        const step = Math.min(d - reach, 95 * dt);
        s.x += dx / d * step; s.y += dy / d * step;
      } else if (e) {
        // Toe to toe: it stops the enemy, and they wear each other down.
        if (!e.T.boss) e.held = 0.12;
        s.cd -= dt;
        if (s.cd <= 0) {
          s.cd = 0.5;
          s.hit = 0.15;
          _damage(e, s.dmg * 0.5, true);
          _sfx('slash');
        }
        if (e.frozen <= 0) s.hp -= e.dmg * 1.2 * dt;
        if (s.hp <= 0) {
          _burst(s.x, s.y, '#89b4fa', 10);
          _soldiers.splice(i, 1);
        }
      }
    }
  }

  function _updateDrones(dt, range) {
    if (_owns('drones')) {
      const dr = _droneStat();
      _droneCd -= dt;
      if (_droneCd <= 0 && _drones.length < dr.max && (_waveQueue.length || _enemies.length)) {
        _droneCd = dr.every;
        _drones.push({ x: CX, y: CY, life: dr.life, dmg: dr.dmg, cd: 0.4, orbit: Math.random() * 6.28, target: null });
        _sfx('deploy');
      }
    }
    for (let i = _drones.length - 1; i >= 0; i--) {
      const d = _drones[i];
      d.life -= dt;
      if (d.life <= 0) { _burst(d.x, d.y, '#94e2d5', 8); _drones.splice(i, 1); continue; }
      let e = d.target;
      if (!e || e.dead || _dist(e) > range + 150) e = d.target = _closestTo(d.x, d.y, Infinity, o => _dist(o) <= range + 150);
      let tx, ty;
      if (e) {
        // Hangs back at shooting distance on the tower's side of its target.
        const ex = e.x - CX, ey = e.y - CY, ed = Math.hypot(ex, ey) || 1;
        const back = Math.min(110, Math.max(0, ed - TOWER_R - 20));
        tx = e.x - ex / ed * back; ty = e.y - ey / ed * back;
      } else {
        d.orbit += dt * 1.5;
        tx = CX + Math.cos(d.orbit) * 70; ty = CY + Math.sin(d.orbit) * 70;
      }
      const dx = tx - d.x, dy = ty - d.y, dd = Math.hypot(dx, dy) || 1;
      const step = Math.min(dd, 240 * dt);
      d.x += dx / dd * step; d.y += dy / dd * step;
      d.cd -= dt;
      if (e && d.cd <= 0 && Math.hypot(e.x - d.x, e.y - d.y) <= 170) {
        d.cd = 0.55;
        _bolts.push({ x: d.x, y: d.y, target: e, dmg: d.dmg });
        _sfx('drone');
      }
    }
    for (let i = _bolts.length - 1; i >= 0; i--) {
      const b = _bolts[i], e = b.target;
      if (e.dead) { _bolts.splice(i, 1); continue; }
      const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy) || 1, step = 700 * dt;
      if (d <= step + e.r) {
        _bolts.splice(i, 1);
        _damage(e, b.dmg, true);
        _burst(e.x, e.y, '#94e2d5', 3);
        continue;
      }
      b.x += dx / d * step; b.y += dy / d * step;
    }
  }

  function _updateNova(dt) {
    if (!_owns('nova')) return;
    _novaCd = Math.max(0, _novaCd - dt);
    if (_novaCd > 0) return;
    const nv = _novaStat();
    const near = _enemies.filter(e => !e.dead && _dist(e) <= nv.radius + e.r);
    if (!near.length) return;
    _novaCd = nv.every;
    _waves.push({ r: nv.radius, t: 0 });
    _sfx('nova');
    for (const e of near) {
      const d = _dist(e) || 1;
      // Bosses are only shoved; everything else is thrown well clear.
      const push = e.T.boss ? nv.push * 0.25 : nv.push;
      e.x += (e.x - CX) / d * push;
      e.y += (e.y - CY) / d * push;
      _damage(e, nv.dmg, false);
    }
  }

  function _updateTesla(dt) {
    if (!_owns('tesla')) return;
    const ts = _teslaStat(), pylons = _pylons();
    pylons.forEach((py, k) => {
      _teslaCd[k] = (_teslaCd[k] == null ? k * 0.3 : _teslaCd[k]) - dt;
      if (_teslaCd[k] > 0) return;
      let e = _closestTo(py.x, py.y, ts.reach, () => true);
      if (!e) return;
      _teslaCd[k] = ts.every;
      const hit = [], pts = [[py.x, py.y - 20]];
      let dmg = ts.dmg;
      while (e && hit.length < ts.chain) {
        hit.push(e);
        pts.push([e.x, e.y]);
        _damage(e, dmg, true);
        _burst(e.x, e.y, '#f9e2af', 3);
        dmg *= 0.85;
        const from = e;
        e = _closestTo(from.x, from.y, 110, o => hit.indexOf(o) === -1);
      }
      _zaps.push({ pts, t: 0 });
      _sfx('zap');
    });
  }

  function _updateEnemyShots(dt) {
    for (let i = _enemyShots.length - 1; i >= 0; i--) {
      const s = _enemyShots[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (Math.hypot(s.x - CX, s.y - CY) <= TOWER_R) {
        _enemyShots.splice(i, 1);
        _burst(s.x, s.y, '#f38ba8', 5);
        _hurtTower(s.dmg);
        if (_over) return;
      }
    }
  }

  function _updateFx(dt) {
    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];
      p.life -= dt;
      if (p.life <= 0) { _particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = _blasts.length - 1; i >= 0; i--) {
      _blasts[i].t += dt / 0.5;
      if (_blasts[i].t >= 1) _blasts.splice(i, 1);
    }
    for (let i = _beams.length - 1; i >= 0; i--) {
      _beams[i].t += dt / 0.35;
      if (_beams[i].t >= 1) _beams.splice(i, 1);
    }
    for (let i = _waves.length - 1; i >= 0; i--) {
      _waves[i].t += dt / 0.45;
      if (_waves[i].t >= 1) _waves.splice(i, 1);
    }
    for (let i = _zaps.length - 1; i >= 0; i--) {
      _zaps[i].t += dt / 0.25;
      if (_zaps[i].t >= 1) _zaps.splice(i, 1);
    }
  }

  function _burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 160;
      _particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, max: 0.35, color, size: 3 });
    }
  }

  function _spark(x, y, color, life, spread) {
    _particles.push({
      x, y, vx: (Math.random() - 0.5) * spread, vy: -10 - Math.random() * spread,
      life, max: life, color, size: 4,
    });
  }

  // ── Sound ─────────────────────────────────────────────────────────────────
  // Every sound is synthesised on the spot with Web Audio, so the game ships
  // no audio files. Each one has a minimum gap, so a fast gun or a crowd dying
  // at once is a rattle rather than a wall of noise.
  let _ac = null, _master = null, _noiseBuf = null;
  const _lastSfx = {};

  function _audio() {
    if (_ac) return _ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      _ac = new AC();
      _master = _ac.createGain();
      _master.gain.value = 0.35;
      _master.connect(_ac.destination);
      const len = Math.floor(_ac.sampleRate * 0.8);
      _noiseBuf = _ac.createBuffer(1, len, _ac.sampleRate);
      const data = _noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (_) { _ac = null; }
    return _ac;
  }

  function _env(g, t, vol, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function _tone(freq, to, dur, type, vol, delay) {
    const t = _ac.currentTime + (delay || 0);
    const o = _ac.createOscillator(), g = _ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    _env(g, t, vol, dur);
    o.connect(g); g.connect(_master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function _noise(dur, vol, filter, freq, to) {
    const t = _ac.currentTime;
    const src = _ac.createBufferSource(), f = _ac.createBiquadFilter(), g = _ac.createGain();
    src.buffer = _noiseBuf;
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    _env(g, t, vol, dur);
    src.connect(f); f.connect(g); g.connect(_master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // name: [minimum gap in seconds, how it sounds]
  const SFX = {
    gun:       [0.05, () => _tone(560, 240, 0.07, 'square', 0.08)],
    fire:      [0.08, () => _noise(0.16, 0.14, 'bandpass', 900, 2400)],
    ice:       [0.08, () => { _tone(1500, 2100, 0.09, 'sine', 0.07); _tone(2600, 0, 0.05, 'triangle', 0.03, 0.03); }],
    laser:     [0.2,  () => { _tone(1900, 160, 0.45, 'sawtooth', 0.09); _noise(0.3, 0.08, 'highpass', 3000, 800); }],
    shieldHit: [0.08, () => _tone(760, 520, 0.08, 'sine', 0.07)],
    shieldDown:[0.3,  () => { _tone(620, 80, 0.5, 'square', 0.09); _noise(0.4, 0.15, 'bandpass', 2400, 300); }],
    shieldUp:  [0.3,  () => { _tone(420, 980, 0.3, 'sine', 0.08); _tone(840, 1960, 0.3, 'sine', 0.04, 0.05); }],
    deploy:    [0.15, () => _tone(300, 520, 0.1, 'triangle', 0.06)],
    slash:     [0.06, () => _noise(0.06, 0.06, 'highpass', 3200)],
    drone:     [0.07, () => _tone(1300, 900, 0.04, 'square', 0.03)],
    nova:      [0.3,  () => { _tone(160, 40, 0.5, 'sine', 0.3); _noise(0.4, 0.2, 'lowpass', 1500, 150); }],
    zap:       [0.08, () => { _noise(0.12, 0.08, 'bandpass', 4000, 1500); _tone(90, 60, 0.1, 'sawtooth', 0.05); }],
    mine:      [0.1,  () => _tone(340, 180, 0.12, 'triangle', 0.1)],
    freeze:    [0.1,  () => _tone(2400, 900, 0.14, 'sine', 0.04)],
    boom:      [0.06, () => { _noise(0.45, 0.4, 'lowpass', 900, 120); _tone(130, 38, 0.4, 'sine', 0.35); }],
    scorch:    [0.08, () => _noise(0.1, 0.06, 'highpass', 2500)],
    kill:      [0.04, () => _tone(700, 1050, 0.06, 'triangle', 0.05)],
    enemyShot: [0.12, () => _tone(950, 620, 0.05, 'square', 0.03)],
    bossShot:  [0.1,  () => _tone(300, 150, 0.12, 'sawtooth', 0.07)],
    hit:       [0.1,  () => { _tone(150, 55, 0.2, 'sawtooth', 0.14); _noise(0.12, 0.12, 'lowpass', 600); }],
    summon:    [0.3,  () => _tone(110, 220, 0.35, 'sawtooth', 0.06)],
    boss:      [0.5,  () => { _tone(73, 0, 0.9, 'sawtooth', 0.12); _tone(110, 0, 0.9, 'sawtooth', 0.08, 0.05); }],
    bossDown:  [0.3,  () => { _noise(0.8, 0.4, 'lowpass', 1200, 80); _tone(220, 55, 0.8, 'sawtooth', 0.15); }],
    wave:      [0.3,  () => { _tone(392, 0, 0.16, 'square', 0.07); _tone(523, 0, 0.26, 'square', 0.07, 0.15); }],
    cleared:   [0.3,  () => [523, 659, 784, 1047].forEach((f, i) => _tone(f, 0, 0.18, 'triangle', 0.1, i * 0.09))],
    buy:       [0.04, () => { _tone(990, 0, 0.06, 'square', 0.05); _tone(1480, 0, 0.1, 'square', 0.05, 0.06); }],
    mount:     [0.04, () => _tone(420, 620, 0.08, 'triangle', 0.1)],
    over:      [1,    () => [392, 311, 233, 175].forEach((f, i) => _tone(f, 0, 0.35, 'triangle', 0.14, i * 0.22))],
  };

  function _sfx(name) {
    if (_muted || _paused) return;
    const s = SFX[name];
    if (!s || !_audio()) return;
    const now = performance.now() / 1000;
    if (now - (_lastSfx[name] || 0) < s[0]) return;
    _lastSfx[name] = now;
    if (_ac.state === 'suspended') _ac.resume().catch(() => {});
    try { s[1](); } catch (_) {}
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  function _css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function _draw() {
    if (!_ctx2d || !_b) return;
    const g = _ctx2d;
    const size = _canvas.width;
    const s = size / W;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    g.setTransform(s, 0, 0, s, 0, 0);

    const accent = _css('--accent', '#89b4fa');
    const dim    = _css('--fg2', '#a6adc8');
    const range  = _range();

    // Ice ring: a band just inside the range edge.
    if (_owns('iring')) {
      const ir = _iring();
      g.fillStyle = 'rgba(137,220,235,0.13)';
      g.beginPath();
      g.arc(CX, CY, range, 0, Math.PI * 2);
      g.arc(CX, CY, range - ir.width, 0, Math.PI * 2, true);
      g.fill();
      g.strokeStyle = 'rgba(137,220,235,0.4)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(CX, CY, range - ir.width, 0, Math.PI * 2); g.stroke();
    }

    // Range ring
    g.strokeStyle = dim;
    g.globalAlpha = 0.25;
    g.lineWidth = 2;
    g.setLineDash([10, 12]);
    g.beginPath(); g.arc(CX, CY, range, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;

    // Mines on the ground, then the ones still in the air.
    for (const m of _mines) {
      g.fillStyle = '#45475a';
      g.beginPath(); g.arc(m.x, m.y, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = WEAPONS.mine.color;
      g.globalAlpha = m.arm > 0 ? 0.3 : 0.5 + 0.5 * Math.sin(m.blink * 6);
      g.beginPath(); g.arc(m.x, m.y, 3.5, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    for (const l of _lobs) {
      const x = CX + (l.x - CX) * l.t, y = CY + (l.y - CY) * l.t;
      const lift = Math.sin(l.t * Math.PI);
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#585b70';
      g.beginPath(); g.arc(x, y - lift * 40, 7 + lift * 4, 0, Math.PI * 2); g.fill();
    }

    if (_owns('tesla')) for (const py of _pylons()) _drawPylon(g, py);

    for (const e of _enemies) if (!e.dead) _drawEnemy(g, e);

    // Fire ring
    if (_owns('fring')) {
      const fr = _fring();
      for (let k = 0; k < fr.n; k++) {
        const a = _ringAngle + k * Math.PI * 2 / fr.n;
        const x = CX + Math.cos(a) * range, y = CY + Math.sin(a) * range;
        g.fillStyle = 'rgba(250,179,135,0.25)';
        g.beginPath(); g.arc(x, y, FIREBALL_R + 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fe640b';
        g.beginPath(); g.arc(x, y, FIREBALL_R, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f9e2af';
        g.beginPath(); g.arc(x, y, FIREBALL_R * 0.5, 0, Math.PI * 2); g.fill();
      }
    }

    // Our shots
    for (const sh of _shots) {
      const c = WEAPONS[sh.w].color;
      g.fillStyle = c;
      if (sh.w === 'ice') {
        g.save(); g.translate(sh.x, sh.y); g.rotate(sh.a);
        g.beginPath(); g.moveTo(8, 0); g.lineTo(0, 4); g.lineTo(-8, 0); g.lineTo(0, -4); g.closePath(); g.fill();
        g.restore();
      } else {
        g.beginPath(); g.arc(sh.x, sh.y, sh.w === 'fire' ? 6 : 5, 0, Math.PI * 2); g.fill();
      }
    }

    for (const s of _soldiers) _drawSoldier(g, s);
    for (const d of _drones) _drawDrone(g, d);
    g.fillStyle = '#94e2d5';
    for (const b of _bolts) { g.beginPath(); g.arc(b.x, b.y, 3.5, 0, Math.PI * 2); g.fill(); }

    // Laser beams: a wide glow and a white core, from the barrel to past the
    // edge of the field.
    for (const bm of _beams) {
      const k = 1 - bm.t;
      const x0 = CX + Math.cos(bm.a) * TOWER_R, y0 = CY + Math.sin(bm.a) * TOWER_R;
      const x1 = CX + Math.cos(bm.a) * 1500, y1 = CY + Math.sin(bm.a) * 1500;
      g.lineCap = 'round';
      g.globalAlpha = 0.45 * k;
      g.strokeStyle = WEAPONS.laser.color;
      g.lineWidth = bm.w * 2.6 * k + 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.globalAlpha = k;
      g.strokeStyle = '#ffffff';
      g.lineWidth = bm.w * 0.7 * k + 1;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.lineCap = 'butt';
    }
    g.globalAlpha = 1;

    // Lightning: a jagged line through every enemy the chain reached.
    for (const z of _zaps) {
      const k = 1 - z.t;
      for (const [w, c, a] of [[7, '#f9e2af', 0.35], [2.5, '#ffffff', 1]]) {
        g.globalAlpha = a * k;
        g.strokeStyle = c;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(z.pts[0][0], z.pts[0][1]);
        for (let i = 1; i < z.pts.length; i++) {
          const [x0, y0] = z.pts[i - 1], [x1, y1] = z.pts[i];
          for (let j = 1; j <= 3; j++) {
            const f = j / 4, jit = (Math.random() - 0.5) * 18;
            g.lineTo(x0 + (x1 - x0) * f - (y1 - y0) / 60 * jit / 3, y0 + (y1 - y0) * f + jit);
          }
          g.lineTo(x1, y1);
        }
        g.stroke();
      }
    }
    // The shockwave: a thick ring rushing out from the tower.
    for (const wv of _waves) {
      const k = 1 - wv.t;
      g.globalAlpha = 0.25 * k;
      g.fillStyle = '#b4befe';
      g.beginPath(); g.arc(CX, CY, wv.r * (0.2 + 0.8 * wv.t), 0, Math.PI * 2); g.fill();
      g.globalAlpha = k;
      g.strokeStyle = '#cdd6f4';
      g.lineWidth = 10 * k + 2;
      g.beginPath(); g.arc(CX, CY, wv.r * (0.2 + 0.8 * wv.t), 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;

    // Enemy shots
    for (const sh of _enemyShots) {
      g.fillStyle = sh.boss ? '#d20f39' : '#f38ba8';
      g.beginPath(); g.arc(sh.x, sh.y, sh.boss ? 6 : 4, 0, Math.PI * 2); g.fill();
    }

    for (const p of _particles) {
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill();
    }
    for (const b of _blasts) {
      // A fireball that swells and fades, under the shock ring.
      g.globalAlpha = 0.55 * (1 - b.t);
      g.fillStyle = '#fab387';
      g.beginPath(); g.arc(b.x, b.y, b.r * (0.35 + 0.5 * b.t), 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.8 * (1 - b.t);
      g.fillStyle = '#f9e2af';
      g.beginPath(); g.arc(b.x, b.y, b.r * 0.25 * (1 - b.t), 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1 - b.t;
      g.strokeStyle = b.color;
      g.lineWidth = 6 * (1 - b.t) + 1;
      g.beginPath(); g.arc(b.x, b.y, b.r * (0.3 + 0.7 * b.t), 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;

    _drawTower(g, accent);

    if (_banner) {
      g.globalAlpha = Math.min(1, _banner.t);
      g.fillStyle = _css('--fg', '#cdd6f4');
      g.font = '700 44px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(_banner.text, CX, CY - 150);
      g.globalAlpha = 1;
    }
  }

  function _poly(g, n, r, rot) {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + i * Math.PI * 2 / n;
      if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r); else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
  }

  function _drawEnemy(g, e) {
    const T = e.T, r = e.r;
    const face = Math.atan2(CY - e.y, CX - e.x);
    g.save();
    g.translate(e.x, e.y);
    if (T.fly) {
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.beginPath(); g.ellipse(5, 12, r, r * 0.5, 0, 0, Math.PI * 2); g.fill();
      g.translate(0, -6 + Math.sin(_time * 6 + e.wob) * 2);
    }
    const body = e.flash > 0 ? '#ffffff' : T.color;
    g.fillStyle = body;
    switch (e.type) {
      case 'runner':
        g.rotate(face);
        g.beginPath(); g.moveTo(r * 1.3, 0); g.lineTo(-r, r * 0.9); g.lineTo(-r, -r * 0.9); g.closePath(); g.fill();
        break;
      case 'shooter':
        g.rotate(face);
        g.fillRect(-r, -r, r * 2, r * 2);
        g.fillStyle = '#45475a';
        g.fillRect(r * 0.3, -3, r + 7, 6);
        break;
      case 'brute':
        _poly(g, 6, r, face); g.fill();
        g.fillStyle = 'rgba(0,0,0,.25)';
        _poly(g, 6, r * 0.55, face); g.fill();
        break;
      case 'flyer': {
        g.rotate(face);
        const flap = Math.sin(_time * 14 + e.wob) * 0.4 + 0.6;
        g.beginPath(); g.moveTo(r * 0.2, 0); g.lineTo(-r * 0.6, r * 1.6 * flap); g.lineTo(-r * 0.3, 0);
        g.lineTo(-r * 0.6, -r * 1.6 * flap); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(r * 1.2, 0); g.lineTo(0, r * 0.55); g.lineTo(-r, 0); g.lineTo(0, -r * 0.55); g.closePath(); g.fill();
        break;
      }
      case 'knight':
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#cdd6f4'; g.lineWidth = 4;
        g.beginPath(); g.arc(0, 0, r - 2, 0, Math.PI * 2); g.stroke();
        break;
      case 'splitter':
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2.5;
        g.beginPath();
        for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; g.moveTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        g.stroke();
        break;
      case 'healer':
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffffff';
        g.fillRect(-r * 0.55, -r * 0.18, r * 1.1, r * 0.36);
        g.fillRect(-r * 0.18, -r * 0.55, r * 0.36, r * 1.1);
        break;
      case 'colossus':
        // A slab of stone with armour plates.
        _poly(g, 8, r, face + Math.PI / 8); g.fill();
        g.fillStyle = 'rgba(0,0,0,.3)';
        _poly(g, 8, r * 0.72, face + Math.PI / 8); g.fill();
        g.fillStyle = '#cdd6f4';
        for (let i = 0; i < 4; i++) {
          const a = face + i * Math.PI / 2 + Math.PI / 4;
          g.beginPath(); g.arc(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.11, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#f38ba8';
        g.beginPath(); g.arc(Math.cos(face) * r * 0.35, Math.sin(face) * r * 0.35, r * 0.16, 0, Math.PI * 2); g.fill();
        break;
      case 'wraith': {
        // A hooded ghost that trails off behind it, half see-through.
        g.rotate(face);
        g.globalAlpha = 0.85;
        g.beginPath();
        g.arc(r * 0.2, 0, r * 0.8, -Math.PI / 2, Math.PI / 2);
        for (let i = 0; i <= 6; i++) {
          const y = r * 0.8 - i * r * 1.6 / 6;
          const x = -r * 1.1 - (i % 2 ? 0 : r * 0.45) + Math.sin(_time * 8 + i) * 3;
          g.lineTo(x, y);
        }
        g.closePath(); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#11111b';
        g.beginPath(); g.arc(r * 0.45, -r * 0.28, r * 0.13, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(r * 0.45, r * 0.28, r * 0.13, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'queen': {
        // An insect queen: wings behind a long body and a crowned head.
        g.rotate(face);
        const flap = Math.sin(_time * 10 + e.wob) * 0.25 + 0.75;
        g.globalAlpha = 0.55;
        g.fillStyle = '#a6e3a1';
        g.beginPath(); g.ellipse(-r * 0.2, r * 0.7 * flap, r * 0.8, r * 0.4, 0.5, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(-r * 0.2, -r * 0.7 * flap, r * 0.8, r * 0.4, -0.5, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = body;
        g.beginPath(); g.ellipse(-r * 0.35, 0, r * 0.75, r * 0.5, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(r * 0.55, 0, r * 0.38, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f9e2af';
        g.beginPath(); g.moveTo(r * 0.55, -r * 0.3); g.lineTo(r * 0.75, -r * 0.55); g.lineTo(r * 0.8, -r * 0.2);
        g.lineTo(r * 0.95, -r * 0.4); g.lineTo(r * 0.9, 0); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 3;
        for (let i = 1; i <= 2; i++) {
          g.beginPath(); g.moveTo(-r * 0.35 - i * r * 0.25, -r * 0.45); g.lineTo(-r * 0.35 - i * r * 0.25, r * 0.45); g.stroke();
        }
        break;
      }
      case 'juggernaut':
        // A spiked wheel that rolls in, green with what it is mending.
        g.rotate(_time * 1.2);
        g.beginPath();
        for (let i = 0; i < 20; i++) {
          const a = i * Math.PI / 10, rr = i % 2 ? r * 0.8 : r * 1.08;
          if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(rr, 0);
        }
        g.closePath(); g.fill();
        g.fillStyle = '#45475a';
        g.beginPath(); g.arc(0, 0, r * 0.55, 0, Math.PI * 2); g.fill();
        g.fillStyle = e.hp < e.maxHp ? '#a6e3a1' : '#f9e2af';
        g.fillRect(-r * 0.32, -r * 0.1, r * 0.64, r * 0.2);
        g.fillRect(-r * 0.1, -r * 0.32, r * 0.2, r * 0.64);
        break;
      case 'boss': {
        g.rotate(_time * 0.6);
        g.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = i * Math.PI / 8, rr = i % 2 ? r * 0.78 : r;
          if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(rr, 0);
        }
        g.closePath(); g.fill();
        g.fillStyle = '#11111b';
        g.beginPath(); g.arc(0, 0, r * 0.45, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f9e2af';
        g.beginPath(); g.arc(0, 0, r * 0.18, 0, Math.PI * 2); g.fill();
        break;
      }
      default:
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    }
    g.restore();

    if (e.frozen > 0) {
      g.fillStyle = 'rgba(137,220,235,.4)';
      g.beginPath(); g.arc(e.x, e.y, r + 3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#89dceb'; g.lineWidth = 3;
      g.beginPath(); g.arc(e.x, e.y, r + 3, 0, Math.PI * 2); g.stroke();
    } else if (e.slowed) {
      g.strokeStyle = 'rgba(137,220,235,.55)'; g.lineWidth = 2;
      g.beginPath(); g.arc(e.x, e.y, r + 3, 0, Math.PI * 2); g.stroke();
    }
    if (e.burn > 0) {
      g.strokeStyle = '#fe640b'; g.lineWidth = 2;
      g.setLineDash([4, 4]);
      g.beginPath(); g.arc(e.x, e.y, r + 6, _time * 4, _time * 4 + Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    if (e.pulse > 0) {
      g.globalAlpha = e.pulse * 1.4;
      g.strokeStyle = T.color; g.lineWidth = 3;
      const reach = T.heal ? 110 : r + 30;
      g.beginPath(); g.arc(e.x, e.y, reach * (1 - e.pulse), 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    if (e.hp < e.maxHp || T.boss) {
      const w = T.boss ? 120 : Math.max(18, r * 2);
      const y = e.y - r - (T.fly ? 18 : 10);
      if (T.boss) {
        g.fillStyle = _css('--fg', '#cdd6f4');
        g.font = '700 17px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.fillText(_t('td_e_' + e.type), e.x, y - 3);
      }
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.fillRect(e.x - w / 2, y, w, T.boss ? 6 : 4);
      g.fillStyle = T.boss ? '#f9e2af' : '#a6e3a1';
      g.fillRect(e.x - w / 2, y, w * Math.max(0, e.hp / e.maxHp), T.boss ? 6 : 4);
    }
  }

  function _drawSoldier(g, s) {
    g.save();
    g.translate(s.x, s.y);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(2, 7, 8, 4, 0, 0, Math.PI * 2); g.fill();
    g.rotate(s.face);
    // A sword that swings forward with each blow, a shield on the other arm.
    g.strokeStyle = '#f5e0dc';
    g.lineWidth = 3;
    const sw = s.hit > 0 ? 0.2 : -0.6;
    g.beginPath(); g.moveTo(2, 6); g.lineTo(2 + Math.cos(sw) * 15, 6 + Math.sin(sw) * 15); g.stroke();
    g.fillStyle = '#89b4fa';
    g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1e66f5';
    g.fillRect(3, -9, 5, 8);
    g.restore();
    if (s.hp < s.maxHp) {
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.fillRect(s.x - 9, s.y - 15, 18, 3);
      g.fillStyle = '#89b4fa';
      g.fillRect(s.x - 9, s.y - 15, 18 * Math.max(0, s.hp / s.maxHp), 3);
    }
  }

  function _drawPylon(g, py) {
    g.save();
    g.translate(py.x, py.y);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath(); g.ellipse(0, 4, 13, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#585b70';
    g.beginPath(); g.moveTo(-9, 2); g.lineTo(9, 2); g.lineTo(4, -18); g.lineTo(-4, -18); g.closePath(); g.fill();
    // The coil glows while it charges and flashes when it fires.
    g.globalAlpha = 0.5 + 0.3 * Math.sin(_time * 8 + py.x);
    g.fillStyle = '#f9e2af';
    g.beginPath(); g.arc(0, -20, 9, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(0, -20, 4, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function _drawDrone(g, d) {
    g.save();
    g.translate(d.x, d.y);
    g.fillStyle = 'rgba(0,0,0,.2)';
    g.beginPath(); g.ellipse(6, 16, 10, 5, 0, 0, Math.PI * 2); g.fill();
    g.translate(0, Math.sin(_time * 5 + d.orbit) * 2);
    g.strokeStyle = '#585b70';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(-9, -9); g.lineTo(9, 9); g.moveTo(9, -9); g.lineTo(-9, 9); g.stroke();
    // The rotors blur; the body blinks as the battery runs out.
    g.fillStyle = 'rgba(148,226,213,.45)';
    for (const [x, y] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = d.life < 2.5 && Math.sin(_time * 18) > 0 ? '#f38ba8' : '#94e2d5';
    g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function _drawTower(g, accent) {
    // One barrel per mounted weapon, each turned to its own target. Before a
    // weapon has fired its barrel rests at an even spacing around the tower.
    _b.eq.forEach((w, i) => {
      const a = _aim[w] != null ? _aim[w] : -Math.PI / 2 + i * Math.PI * 2 / _b.eq.length;
      g.save();
      g.translate(CX, CY);
      g.rotate(a);
      g.fillStyle = WEAPONS[w].color;
      g.fillRect(0, -5, TOWER_R + (w === 'laser' ? 24 : w === 'mine' ? 8 : 20), 10);
      g.restore();
    });
    g.fillStyle = accent;
    g.beginPath(); g.arc(CX, CY, TOWER_R, 0, Math.PI * 2); g.fill();
    g.fillStyle = _css('--surface1', '#181825');
    g.beginPath(); g.arc(CX, CY, TOWER_R - 9, 0, Math.PI * 2); g.fill();
    // Integrity as an arc around the tower.
    const pct = Math.max(0, _tower.hp / _tower.maxHp);
    g.strokeStyle = pct > 0.5 ? '#a6e3a1' : pct > 0.2 ? '#f9e2af' : '#f38ba8';
    g.lineWidth = 4;
    g.beginPath(); g.arc(CX, CY, TOWER_R - 4.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct); g.stroke();
    if (_tower.hit > 0) {
      g.fillStyle = 'rgba(243,139,168,' + (_tower.hit * 2).toFixed(2) + ')';
      g.beginPath(); g.arc(CX, CY, TOWER_R + 4, 0, Math.PI * 2); g.fill();
    }
    // The shield: a bubble that thins as it takes hits, and while it is down
    // only the arc of its recharge.
    if (_owns('shield') && _shield) {
      const R = TOWER_R + 16, pct = _shield.hp / _shieldStat().max;
      if (_shield.down) {
        g.strokeStyle = 'rgba(137,220,235,.5)';
        g.lineWidth = 3;
        g.setLineDash([6, 6]);
        g.beginPath(); g.arc(CX, CY, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct); g.stroke();
        g.setLineDash([]);
      } else {
        g.fillStyle = 'rgba(137,220,235,' + (0.08 + 0.12 * pct + _shield.hit).toFixed(2) + ')';
        g.beginPath(); g.arc(CX, CY, R, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(137,220,235,' + (0.35 + 0.5 * pct).toFixed(2) + ')';
        g.lineWidth = 2 + 2 * pct;
        g.beginPath(); g.arc(CX, CY, R, 0, Math.PI * 2); g.stroke();
      }
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  function _cell(id, label) {
    return '<div style="flex:1;min-width:90px;background:var(--surface1,#181825);' +
      'border:1px solid var(--border,#45475a);border-radius:10px;padding:8px 12px;text-align:center">' +
      '<div id="' + id + '" style="font-size:1.05rem;font-weight:700"></div>' +
      '<div style="font-size:.68rem;color:var(--fg2,#a6adc8);text-transform:uppercase;letter-spacing:.5px">' +
      _esc(label) + '</div></div>';
  }

  // Built once and then only refreshed, so the exit button is never replaced
  // under a finger that is pressing it.
  function _buildHud() {
    _hud.innerHTML =
      _cell('td-h-wave', _t('td_wave')) +
      _cell('td-h-score', _t('td_score')) +
      _cell('td-h-coins', _t('td_coins')) +
      _cell('td-h-hp', _t('td_integrity')) +
      '<button id="td-sound" style="margin-left:auto;align-self:center;background:var(--surface2,#313244);' +
      'color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);border-radius:10px;padding:7px 11px;' +
      'font-size:.95rem;cursor:pointer"></button>' +
      '<button id="td-exit" style="align-self:center;background:var(--surface2,#313244);' +
      'color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);border-radius:10px;padding:8px 14px;' +
      'font-weight:600;font-size:.82rem;cursor:pointer">' + _esc(_t('td_exit')) + '</button>';
    _hud.querySelector('#td-exit').onclick = () => mp.exitPrompt();
    const snd = _hud.querySelector('#td-sound');
    const paint = () => { snd.textContent = _muted ? '🔇' : '🔊'; snd.title = _t('td_sound'); };
    snd.onclick = () => {
      _muted = !_muted;
      try { localStorage.setItem('td_muted', _muted ? '1' : '0'); } catch (_) {}
      paint();
      _sfx('buy');
    };
    paint();
  }

  function _renderHud() {
    if (!_hud || !_tower) return;
    const pct = Math.round((_tower.hp / _tower.maxHp) * 100);
    // "5/10": the wave now and the record, which this run may be beating.
    const wave = _wave || 1;
    _hud.querySelector('#td-h-wave').textContent  = _best ? wave + '/' + Math.max(_best, wave) : wave;
    _hud.querySelector('#td-h-score').textContent = _score;
    _hud.querySelector('#td-h-coins').textContent = '💰 ' + _coins;
    const hp = _hud.querySelector('#td-h-hp');
    // The shield is drawn around the tower, not counted here: a number that
    // comes and goes would keep resizing the HUD.
    hp.textContent = Math.ceil(_tower.hp) + ' / ' + _tower.maxHp;
    hp.style.color = pct > 50 ? 'var(--green,#a6e3a1)' : pct > 20 ? 'var(--yellow,#f9e2af)' : 'var(--red,#f38ba8)';
    _hud.querySelector('#td-exit').style.display = _over ? 'none' : '';
  }

  // ── Shop ──────────────────────────────────────────────────────────────────
  // Everything on one screen: three rows of five small cards — the weapons,
  // the tower, and the battlefield around it. What each one does is in its
  // tooltip rather than on the card, so nothing needs scrolling to be seen.
  function _upRow(key, label) {
    const lv = _lv(key), cap = UPGRADES[key][2], maxed = _maxed(key), p = _price(key);
    return '<button class="td-up" data-act="up:' + key + '"' + (maxed || _money() < p || _permBusy ? ' disabled' : '') + '>' +
      '<span class="td-up-name">' + _esc(label) + '</span>' +
      '<span class="td-lv">' + (cap == null ? lv : lv + '/' + cap) + '</span>' +
      '<span class="td-price">' + (maxed ? _esc(_t('td_max')) : _num(p)) + '</span></button>';
  }

  function _buyRow(key) {
    const price = _buyPrice(key);
    return '<button class="td-buy" data-act="buy:' + key + '"' + (_money() < price || _permBusy ? ' disabled' : '') + '>' +
      '<span>' + _esc(_t('td_buy')) + '</span><span class="td-price">' + _num(price) + '</span></button>';
  }

  function _card(icon, color, name, desc, stats, body, cls) {
    return '<div class="td-card' + (cls ? ' ' + cls : '') + '" title="' + _esc(desc) + '">' +
      '<div class="td-card-top"><span class="td-ico" style="--c:' + color + '">' + icon + '</span>' +
      '<b>' + _esc(name) + '</b></div>' +
      '<div class="td-stats">' + (stats ? _esc(stats) : '&nbsp;') + '</div>' +
      '<div class="td-actions">' + body + '</div></div>';
  }

  function _fmt(n, d) { return Number(n.toFixed(d == null ? 0 : d)); }

  function _weaponStats(w) {
    const st = _wstat(w), rate = _fmt(1 / st.reload, 1) + '/s';
    if (w === 'fire')   return '⚔' + _fmt(st.dmg) + ' 🔥' + _fmt(st.burn) + ' · ' + rate;
    if (w === 'ice')    return '❄' + _fmt(st.freeze, 1) + 's · ' + rate;
    if (w === 'laser')  return '⚔' + _fmt(st.dmg) + ' ↦∞ · ' + rate;
    if (w === 'mine')   return '💥' + _fmt(st.dmg) + ' ◎' + _fmt(st.splash) + ' · ' + rate;
    return '⚔' + _fmt(st.dmg) + ' · ' + rate;
  }

  function _nextPreview() {
    const counts = {};
    for (const s of _nextList || []) counts[s.type] = (counts[s.type] || 0) + 1;
    let chips = '';
    const fresh = [];
    for (const k of PREVIEW_ORDER) {
      if (!counts[k]) continue;
      const isNew = !_seen[k];
      chips += '<span class="td-chip" style="--c:' + ENEMIES[k].color + '" title="' + _esc(_t('td_e_' + k + '_d')) + '"><i></i>' +
        _esc(_t('td_e_' + k)) + ' ×' + counts[k] +
        (isNew ? '<em>' + _esc(_t('td_new')) + '</em>' : '') + '</span>';
      if (isNew) fresh.push('<b>' + _esc(_t('td_e_' + k)) + '</b> — ' + _esc(_t('td_e_' + k + '_d')));
    }
    const n = _wave + 1;
    const boss = n % BOSS_EVERY === 0
      ? '<div class="td-bossnext" style="--c:' + ENEMIES[_bossOf(n)].color + '">👑 ' +
        _esc(_t('td_boss_after')) + ' <b>' + _esc(_t('td_e_' + _bossOf(n))) + '</b> — ' +
        _esc(_t('td_e_' + _bossOf(n) + '_d')) + '</div>'
      : '';
    return '<div class="td-next"><span class="td-next-h">' + _esc(_t('td_next_wave', { n })) + '</span>' +
      chips + '</div>' + boss +
      (fresh.length ? '<div class="td-fresh">' + fresh.join(' · ') + '</div>' : '');
  }

  function _renderShop() {
    // Names too long for a card break onto a second line, hyphenated by the
    // rules of the language they are written in.
    _overlay.lang = (window.mvmOS && window.mvmOS.lang) || 'en';
    // Weapons
    let weapons = '';
    for (const w of WEAPON_ORDER) {
      const d = WEAPONS[w], owned = _owns(w), mounted = _b.eq.indexOf(w) !== -1;
      let body;
      if (!owned) body = _buyRow(w);
      else {
        const lock = _permBusy || (mounted ? _b.eq.length <= 1 : _b.eq.length >= MAX_MOUNTED);
        body = '<button class="td-mount' + (mounted ? ' on' : '') + '" data-act="eq:' + w + '"' +
          (lock ? ' disabled' : '') + (!mounted && lock ? ' title="' + _esc(_t('td_slots_full')) + '"' : '') + '>' +
          _esc(mounted ? _t('td_mounted') : _t('td_mount')) + '</button>' +
          _upRow(w + '.p', _t('td_power')) + _upRow(w + '.r', _t('td_rate'));
      }
      weapons += _card(d.icon, d.color, _t('td_w_' + w), _t('td_w_' + w + '_d'),
        owned ? _weaponStats(w) : '', body,
        !owned ? 'td-locked' : mounted ? 'td-on' : '');
    }

    // The tower itself
    const full = _tower.hp >= _tower.maxHp - 0.5;
    const rp = _repairPrice();
    const fr = _fring(), ir = _iring(), sh = _shieldStat(), so = _soldierStat(), dr = _droneStat();
    const nv = _novaStat(), ts = _teslaStat();
    const own = k => _owns(k) ? '' : 'td-locked';
    // Repairs are for the run in hand; the permanent shop only sells strength.
    const tower =
      _card('🏰', '#89b4fa', _t('td_integrity'), _t('td_x_hp_d'),
        _permMode ? '♥ ' + _maxHp() : '♥ ' + Math.ceil(_tower.hp) + ' / ' + _tower.maxHp,
        (_permMode ? '' :
          '<button class="td-buy" data-act="repair"' + (full || _coins < rp ? ' disabled' : '') + '>' +
          '<span>' + _esc(_t('td_repair', { n: _repairAmount() })) + '</span><span class="td-price">' + rp + '</span></button>') +
        _upRow('hp', _t('td_reinforce'))) +
      _card('📡', '#b4befe', _t('td_x_range'), _t('td_x_range_d'), '◎ ' + _range(), _upRow('range', _t('td_x_range'))) +
      _card('💚', '#a6e3a1', _t('td_x_regen'), _t('td_x_regen_d'),
        _owns('regen') ? '+' + _fmt(_regen(), 1) + ' ♥/s' : '',
        _owns('regen') ? _upRow('regen.r', _t('td_speed')) : _buyRow('regen'), own('regen')) +
      _card('🛡️', '#89dceb', _t('td_x_shield'), _t('td_x_shield_d'),
        _owns('shield') ? '🛡' + _fmt(sh.max) + ' ⟳' + _fmt(sh.time, 1) + 's' : '',
        _owns('shield') ? _upRow('shield.c', _t('td_capacity')) + _upRow('shield.r', _t('td_recharge')) : _buyRow('shield'),
        own('shield')) +
      _card('💥', '#b4befe', _t('td_x_nova'), _t('td_x_nova_d'),
        _owns('nova') ? '💥' + _fmt(nv.dmg) + ' ⟳' + _fmt(nv.every, 1) + 's' : '',
        _owns('nova') ? _upRow('nova.p', _t('td_power')) + _upRow('nova.r', _t('td_recharge')) : _buyRow('nova'),
        own('nova'));

    // The battlefield around it
    const field =
      _card('☄️', '#fab387', _t('td_r_fire'), _t('td_r_fire_d'),
        _owns('fring') ? '☄×' + fr.n + ' ⚔' + _fmt(fr.dmg) + ' ↻' + _fmt(fr.spin, 1) : '',
        _owns('fring')
          ? _upRow('fring.n', _t('td_count')) + _upRow('fring.p', _t('td_power')) + _upRow('fring.s', _t('td_speed'))
          : _buyRow('fring'),
        own('fring')) +
      _card('🌀', '#89dceb', _t('td_r_ice'), _t('td_r_ice_d'),
        _owns('iring') ? '↔' + _fmt(ir.width) + ' ↓' + Math.round(ir.slow * 100) + '%' : '',
        _owns('iring')
          ? _upRow('iring.w', _t('td_width')) + _upRow('iring.s', _t('td_slowdown'))
          : _buyRow('iring'),
        own('iring')) +
      _card('⚔️', '#89b4fa', _t('td_x_soldiers'), _t('td_x_soldiers_d'),
        _owns('soldiers') ? '⚔' + _fmt(so.dmg) + ' ♥' + _fmt(so.hp) + ' ⏱' + _fmt(so.every, 1) + 's ×' + so.max : '',
        _owns('soldiers') ? _upRow('soldiers.f', _t('td_frequency')) + _upRow('soldiers.p', _t('td_power')) : _buyRow('soldiers'),
        own('soldiers')) +
      _card('🛸', '#94e2d5', _t('td_x_drones'), _t('td_x_drones_d'),
        _owns('drones') ? '⚔' + _fmt(dr.dmg) + ' ⏱' + _fmt(dr.every, 1) + 's ×' + dr.max : '',
        _owns('drones') ? _upRow('drones.f', _t('td_frequency')) + _upRow('drones.p', _t('td_power')) : _buyRow('drones'),
        own('drones')) +
      _card('⚡', '#f9e2af', _t('td_x_tesla'), _t('td_x_tesla_d'),
        _owns('tesla') ? '⚡×' + ts.n + ' ⚔' + _fmt(ts.dmg) + ' ⛓' + ts.chain : '',
        _owns('tesla') ? _upRow('tesla.n', _t('td_pylons')) + _upRow('tesla.p', _t('td_power')) : _buyRow('tesla'),
        own('tesla'));

    const grids =
      '<div class="td-sec">' + _esc(_t('td_sec_weapons')) +
        ' <span>' + _esc(_t('td_slots', { n: _b.eq.length })) + '</span></div>' +
      '<div class="td-grid">' + weapons + '</div>' +
      '<div class="td-sec">' + _esc(_t('td_sec_tower')) + '</div>' +
      '<div class="td-grid">' + tower + '</div>' +
      '<div class="td-sec">' + _esc(_t('td_sec_field')) + '</div>' +
      '<div class="td-grid">' + field + '</div>';
    if (_permMode) return grids;

    _overlay.style.display = 'flex';
    _overlay.innerHTML =
      '<div class="td-shop">' +
        '<div class="td-shop-head">' +
          '<div class="td-shop-txt"><div class="td-shop-title">' +
            _esc(_wave > 0 ? _t('td_shop_cleared', { n: _wave }) : _t('td_shop_ready')) + '</div>' +
            '<div class="td-shop-hint">' + _esc(_t('td_shop_hint')) + '</div></div>' +
          '<div class="td-coins">💰 ' + _coins + '</div>' +
          '<button class="td-go" data-act="go">' + _esc(_t('td_start_wave', { n: _wave + 1 })) + '</button>' +
        '</div>' +
        '<div class="td-shop-body">' +
          _nextPreview() + grids +
        '</div>' +
      '</div>';
  }

  function _onOverlayClick(ev) {
    const btn = ev.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const [kind, key] = btn.dataset.act.split(':');
    if (kind === 'again') { _playAgain(btn); return; }
    if (_permMode) { _permBuy(kind, key); return; }
    if (!_inShop || _over) return;

    if (kind === 'go') { _startWave(); return; }
    _sfx(kind === 'eq' ? 'mount' : 'buy');

    if (kind === 'buy') {
      const price = _buyPrice(key);
      if (price == null || _owns(key) || _coins < price) return;
      _coins -= price;
      _b.own.push(key);
      if (WEAPONS[key] && _b.eq.length < MAX_MOUNTED) _b.eq.push(key);
      if (key === 'shield') _fullShield();
    } else if (kind === 'up') {
      const u = UPGRADES[key];
      if (!u || _maxed(key)) return;
      const owner = key.indexOf('.') !== -1 ? key.split('.')[0] : null;
      if (owner && !_owns(owner)) return;
      const p = _price(key);
      if (_coins < p) return;
      _coins -= p;
      _b.lv[key] = _lv(key) + 1;
      if (key === 'hp') {
        // New integrity arrives intact.
        const before = _tower.maxHp;
        _tower.maxHp = _maxHp();
        _tower.hp += _tower.maxHp - before;
      }
      if (key === 'hp' || key.indexOf('shield') === 0) _fullShield();
    } else if (kind === 'eq') {
      const i = _b.eq.indexOf(key);
      if (i !== -1) { if (_b.eq.length > 1) _b.eq.splice(i, 1); }
      else if (_owns(key) && _b.eq.length < MAX_MOUNTED) _b.eq.push(key);
    } else if (kind === 'repair') {
      const p = _repairPrice();
      if (_coins < p || _tower.hp >= _tower.maxHp) return;
      _coins -= p;
      _tower.hp = Math.min(_tower.maxHp, _tower.hp + _repairAmount());
    } else {
      return;
    }
    // Every purchase is kept at once, so a reload in the shop loses nothing.
    _checkpoint();
    _report();
    _renderHud();
    _renderShop();
  }

  // ── Reporting ─────────────────────────────────────────────────────────────
  // The room keeps one checkpoint per player: taken in the shop and at the
  // start of each wave (see _resume). The others see its score and wave.
  function _checkpoint() {
    _cp = {
      score: _score,
      wave: _inShop ? _wave + 1 : Math.max(1, _wave),
      kills: _kills,
      coins: _coins,
      hp: Math.max(1, Math.round(_tower.hp)),
      seconds: Math.round(_elapsed),
      build: { own: _b.own.slice(), eq: _b.eq.slice(), lv: Object.assign({}, _b.lv) },
    };
  }

  function _report() {
    if (!_cp) return;
    mp.send(Object.assign({ type: 'td_progress' }, _cp));
  }

  function _end() {
    _over = true;
    _sfx('over');
    if (!_reported) {
      _reported = true;
      mp.send({
        type: 'td_over',
        score: _score, wave: _wave, kills: _kills,
        seconds: Math.round(_elapsed),
      });
    }
    _renderHud();
    _showGameOver();
    // The room pays the score in and says so with td_bank; should that not
    // arrive, ask the bank directly.
    clearTimeout(_bankTimer);
    _bankTimer = setTimeout(() => { if (_bank == null) _loadBank(); }, 4000);
  }

  // ── Game over: the permanent shop ─────────────────────────────────────────
  // The run is over, so the screen becomes the shop that lasts: the points of
  // every finished run buy the same things as in a run, for good. The bank is
  // credited by the room itself when the run ends (td_bank arrives right
  // after td_over); a page that comes back to a finished run asks api.py.
  function _api(path, body) {
    return fetch('/pub/' + GAME_ID + path, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'X-GH-Token': (window.GameHub.getToken && window.GameHub.getToken()) || '' },
                             body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json().then(d => ({ ok: r.ok, d })));
  }

  function _loadBank() {
    _api('/bank').then(({ ok, d }) => {
      if (!ok) throw new Error('bank');
      if (_bank != null) return;           // td_bank got here first
      _applyShop(d.shop);
      _setBank(d);
    }).catch(() => { _permMsg = _t('td_perm_error'); _showGameOver(); });
  }

  function _setBest(v) {
    _best = Math.max(0, +v || 0);
    if (_plug.record) _plug.record(_best);
  }

  function _setBank(d) {
    _bank = Math.max(0, d.points || 0);
    _perm = _cleanBuild(d.build || _freshBuild());
    if (d.best != null) _setBest(d.best);
    if (_over) _showGameOver();
  }

  function _permBuy(kind, key) {
    if (_permBusy || _bank == null || ['buy', 'up', 'eq'].indexOf(kind) === -1) return;
    _permBusy = true;
    _permMsg = '';
    _sfx(kind === 'eq' ? 'mount' : 'buy');
    _showGameOver();
    _api('/buy', { act: kind, key }).then(({ ok, d }) => {
      if (!ok && d.error !== 'points' && d.error !== 'invalid') throw new Error('buy');
      if (!ok) _permMsg = _t(d.error === 'points' ? 'td_perm_points' : 'td_perm_error');
      if (d.points != null) { _bank = Math.max(0, d.points); _perm = _cleanBuild(d.build || _perm); }
    }).catch(() => { _permMsg = _t('td_perm_error'); })
      .finally(() => { _permBusy = false; _showGameOver(); });
  }

  function _showGameOver() {
    const mins = Math.floor(_elapsed / 60), secs = Math.round(_elapsed % 60);
    let body;
    if (_bank == null) {
      body = '<div class="td-perm-wait">' + _esc(_permMsg || _t('td_perm_loading')) + '</div>';
    } else {
      // The shop functions read the build in _b; lend them the permanent one
      // for the length of the render, and the run's tower stays as it fell.
      const keep = _b;
      _b = _perm;
      _permMode = true;
      try { body = _renderShop(); } finally { _b = keep; }
    }
    _permMode = _bank != null;
    _overlay.style.display = 'flex';
    _overlay.innerHTML =
      '<div class="td-shop td-perm">' +
        '<div class="td-shop-head">' +
          '<div class="td-shop-txt"><div class="td-shop-title">🏰 ' + _esc(_t('td_game_over')) + ' · ' + _num(_score) + '</div>' +
            '<div class="td-shop-hint">' +
              _esc(_t('td_wave')) + ' ' + _wave + ' · ' + _esc(_t('td_kills')) + ' ' + _kills + ' · ' +
              _esc(_t('td_survived')) + ' ' + mins + 'm ' + secs + 's' +
              (_earned ? ' · ' + _esc(_t('td_earned', { n: _num(_earned) })) : '') +
            '</div></div>' +
          '<div class="td-coins" title="' + _esc(_t('td_bank_d')) + '">🏦 ' + (_bank == null ? '…' : _num(_bank)) + '</div>' +
          '<button class="td-go" data-act="again">' + _esc(_t('td_play_again')) + '</button>' +
          '<a class="td-back" href="/pub/gamehub/?game=' + GAME_ID + '">' + _esc(_t('td_back_to_hub')) + '</a>' +
        '</div>' +
        '<div class="td-shop-body">' +
          '<div class="td-perm-intro"><b>' + _esc(_t('td_perm_title')) + '</b> — ' + _esc(_t('td_perm_hint')) +
            (_permMsg && _bank != null ? ' <span class="td-perm-msg">' + _esc(_permMsg) + '</span>' : '') + '</div>' +
          body +
        '</div>' +
      '</div>';
  }

  // A room is one run: it is finished the moment the tower falls, so playing
  // again means asking Game Hub for a fresh one rather than resetting here.
  async function _playAgain(btn) {
    btn.disabled = true;
    btn.textContent = _t('td_starting');
    try {
      const r = await fetch('/api/pub/gamehub/mp/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GH-Token': window.GameHub.getToken() || '' },
        body: JSON.stringify({ game_id: GAME_ID, max_players: 1 }),
      });
      // 409 means the choice is not this page's to make — an unfinished run
      // or a saved game is waiting, and Game Hub is where that is answered.
      if (r.status === 409) { location.href = '/pub/gamehub/?game=' + GAME_ID; return; }
      if (!r.ok) throw new Error('room');
      const d = await r.json();
      location.href = d.play_url;
    } catch (_) {
      btn.disabled = false;
      btn.textContent = _t('td_play_again');
      alert(_t('td_error_new_game'));
    }
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  // Registered at load time, not inside renderGame: td_start follows the
  // framework's game_started immediately, and a handler attached any later
  // would miss it.
  mp.on('td_start', (msg) => {
    if (_root && _canvas) _begin(msg);
    else _pending = msg;          // renderGame has not run yet
  });

  mp.on('td_bank', (msg) => {
    clearTimeout(_bankTimer);
    _earned = msg.earned || 0;
    _setBank(msg);
  });

  mp.registerGame({
    id:   GAME_ID,
    name: _t('td_title'),
    renderGame,
    // The HUD already has an exit button, so the hub does not add its own.
    exitButton: false,
    snapshot: () => { _report(); return null; },   // the room keeps the checkpoint
    pause:    () => { _paused = true; },
    resume:   () => { _paused = false; _last = performance.now(); },
  });
})();
