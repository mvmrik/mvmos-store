/*
 * Stonehold — the client half of the game.
 *
 * Runs on Game Hub's generic play page (NOT inside mvmOS): the page loads
 * gamehub/widget.js, this file, and nothing else of ours. GameHub.mp owns the
 * socket, the lobby and saving; this file registers the setup screen and the
 * game itself, and talks to mp_game.py over GameHub.mp.send/on.
 *
 * Three things are worth knowing before reading:
 *
 * 1. **The hold is the state, and the state is one object.** `_hold` is the
 *    entire game — resources, buildings, people, deposits, how far the raiders
 *    have come along. It is reported to the server continuously, and on "save
 *    & exit" that report is what gets written down; picking the run back up
 *    hands the same object back untouched, so a saved hold resumes on the
 *    frame it was left. Nothing happens to it in between: a hold only lives
 *    while it is being played. Anything that must outlive a session goes in
 *    there; anything that is only alive this second (raiders on the field,
 *    bullets, dust) does not.
 *
 * 2. **No number lives here.** Costs, per-level effects and rates all arrive
 *    in sh_start as `tuning` and are read out of `B`. mp_game.py owns them so
 *    there is one place to balance the game.
 *
 * 3. **You do not command anyone.** The player builds, upgrades and sets one
 *    priority; every person on the map picks their own job out of that
 *    priority and walks off to do it. `_assignJob` is the whole of the "AI"
 *    and it is meant to stay that simple — the strategy is supposed to be in
 *    where you put things, not in micromanaging who does what.
 */
(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;

  const GAME_ID = 'stonehold';
  const _t = (k, v) => (window.t ? window.t(k, v) : k);

  // ── Balance, as handed over by the server ─────────────────────────────────
  let B = null;
  // 'keep' is not a building anybody can buy: it is the hold itself, put down
  // once at the start. It is a tower under the skin, so it borrows the tower's
  // shape and nothing else — see _found.
  const _bc = (type) => B.buildings[type === 'keep' ? 'tower' : type];
  // What one stat is worth at one level. Three shapes, because a hold has three
  // kinds of number in it:
  //   key_step  — a step per level, for anything that should grow steadily
  //               (range, magazine, how many soldiers a barracks holds).
  //   key_mult  — a multiplier per level, for anything that has to keep pace
  //               with the price of the level, because the price is itself a
  //               multiplier. This is what makes an upgrade worth more than
  //               another building of the same kind: a level costs
  //               upgrade_mult times the one below it and is worth about as
  //               much more, while a second building only ever repeats the
  //               first and is charged "repeat" for the privilege.
  //   key_min / key_max — where it stops, for the ones that must (reload).
  // A stat may use both shapes at once; the multiplier is applied first.
  function _lv(type, lvl, key) {
    const c = _bc(type);
    const n = Math.max(1, lvl) - 1;
    let v = (c[key] || 0) * Math.pow(c[key + '_mult'] || 1, n) +
            (c[key + '_step'] || 0) * n;
    if (c[key + '_min'] != null) v = Math.max(c[key + '_min'], v);
    if (c[key + '_max'] != null) v = Math.min(c[key + '_max'], v);
    return v;
  }
  // Integrity grows by a multiplier instead, so a high tower is worth defending.
  // The keep is the same tower built to hold: it takes far more than the rest.
  // A building rebuilt in another material (the wall, in stone from level 2)
  // jumps once at that level and is worth a multiple of itself from then on.
  function _maxHp(type, lvl, keep) {
    const c = _bc(type);
    const l = Math.max(1, lvl);
    let hp = c.hp * Math.pow(c.hp_step || 1, l - 1);
    if (c.stone_from && l >= c.stone_from) hp *= (c.stone_hp || 1);
    return hp * (keep ? B.start.keep_hp : 1);
  }
  // Room for rounds in the keep. The keep is the hold's storehouse, so building
  // it up is how a hold stops living raid to raid. Mirrors _keep_store().
  const _keepStore = (lvl) =>
    Math.round(B.start.store *
               Math.pow(B.start.store_mult || 1, Math.max(1, lvl) - 1) +
               (B.start.store_step || 0) * (Math.max(1, lvl) - 1));
  // What a level costs, in every material it wants. The listed cost is the
  // wood; from the level in the building's "tier" it also wants stone, and
  // higher up iron. Mirrors _cost() in mp_game.py — the server charges the same
  // thing the player is shown, so the two must never drift apart.
  function _cost(type, lvl, extra) {
    const c = _bc(type);
    const l = Math.max(1, lvl);
    const m = Math.pow(B.upgrade_mult, l - 1) * (extra || 1);
    const out = {};
    // The wall stops being a timber palisade at stone_from: from that level it
    // is priced off its own stone line and asks for no wood at all.
    const base = (c.stone_from && l >= c.stone_from) ? c.stone_cost : c.cost;
    for (const res of RESOURCES) if (base[res]) out[res] = Math.round(base[res] * m);
    // The tiers are a share of whatever this level is priced in, not of its
    // timber — the wall is rebuilt in stone from level 2 and has no timber
    // line left for a share to be taken of. Mirrors _cost() in mp_game.py.
    const lead = RESOURCES.find(res => base[res]);
    const leadAmt = lead ? base[lead] * m : 0;
    for (const res in (c.tier || {})) {
      if (res !== lead && l >= c.tier[res] && leadAmt)
        out[res] = (out[res] || 0) + Math.round(leadAmt * B.tier_share[res]);
    }
    return out;
  }
  // How many of a kind the hold already has standing or going up. The keep is
  // not one of them: it was put down, not bought.
  const _have = (type) =>
    _hold.buildings.filter(b => b.type === type && !b.keep).length;
  // What putting up another one of these costs today. A level is worth about
  // what it costs, so it is priced off the level alone; another building of a
  // kind the hold already has only repeats what is standing, and is charged
  // "repeat" for every one already there. That, and nothing else, is why
  // upgrading beats building wide — see the note on "repeat" in mp_game.py.
  // One building on the map is free and it is the first house: a keep with
  // nobody in it can neither gather nor build, so the roof that brings the
  // first person is part of founding rather than something to be paid for. It
  // stays on offer for as long as the hold has no house, so a hold that loses
  // its last one is never left with nothing it can do.
  const _freeFirst = (type) => !!_bc(type).first_free && _have(type) === 0;
  // What putting up another one of these costs today. A level is worth about
  // what it costs, so it is priced off the level alone; another building of a
  // kind the hold already has only repeats what is standing, and is charged
  // "repeat" for every one already there. That, and nothing else, is why
  // upgrading beats building wide — see the note on "repeat" in mp_game.py.
  const _newCost = (type) =>
    _freeFirst(type) ? {}
                     : _cost(type, 1, Math.pow(_bc(type).repeat || 1, _have(type)));
  // Room in a house. Every level adds as many people as the level it is, so a
  // house holds 1, 3, 6, 10, 15 — the first tenant is kept for ever and each
  // level after is worth more than the one before it, which is what makes the
  // upgrade the better buy against a second house at the repeat price.
  const _houseCap = (lvl) => { const l = Math.max(1, lvl); return (l * (l + 1)) / 2; };
  // What one sortie out of a barracks costs: wooden spears low down, stone
  // heads from the second level, iron once the barracks is worth having.
  function _armCost(lvl) {
    const c = _bc('barracks'), n = _lv('barracks', lvl, 'soldiers'), out = {};
    const l = Math.max(1, lvl);
    for (const res in c.arm) out[res] = Math.round(c.arm[res] * n);
    if (c.arm_stone_from && l >= c.arm_stone_from)
      out.stone = Math.round((out.stone || 0) + c.arm_stone * n);
    if (l >= c.arm_iron_from) out.iron = Math.round(c.arm_iron * n);
    return out;
  }
  // What a raider of this camp's level is carrying when it dies. It is what
  // his camp armed him with, so a camp that keeps losing parties is a camp
  // paying the player's wages.
  function _loot(level) {
    const out = {};
    for (const res in B.faction.loot) {
      const cfg = B.faction.loot[res];
      if (level < cfg.from) continue;
      out[res] = cfg.base + cfg.step * (level - cfg.from);
    }
    return out;
  }
  const _barrels = (lvl) => 1 + Math.floor((lvl - 1) / _bc('tower').weapons_per);
  const _reload  = (lvl) => Math.max(_bc('tower').reload_min, _lv('tower', lvl, 'reload'));

  const RESOURCES = ['wood', 'stone', 'iron'];
  // Colour emoji only. ⛓ (U+26D3) is a text-default symbol: on a canvas it is
  // drawn as a thin monochrome glyph in the current fill colour, which on the
  // dark map was invisible — the iron was on the ground the whole time and
  // simply could not be seen.
  const RES_GLYPH = { wood: '🪵', stone: '🪨', iron: '🟤' };
  // What a gain is written in. The mark alone says which material it is; the
  // colour is so the number reads at a glance against grass and stone.
  const RES_TINT = { wood: '#cba06a', stone: '#c3c8d8', iron: '#e09a55',
                     ammo: '#f9e2af' };
  // The order the buttons come in is the order a hold is built in: somewhere to
  // live, something to cut timber with, then stone, then everything stone buys.
  // How long a barracks takes to arm and send out one more soldier. It speeds
  // up with the level, but never below interval_min.
  const _muster = (lvl) =>
    Math.max(_bc('barracks').interval_min, _lv('barracks', lvl, 'interval'));

  const BUILD_ORDER = ['house', 'tower', 'workshop', 'barracks', 'wall'];
  const GLYPH = {
    keep: '🏯', tower: '🗼', house: '🏠',
    workshop: '🔧', barracks: '⚔', wall: '▮', gate: '🚪',
    // The camps build in the same hand, so their buildings have marks too.
    hut: '🛖', fkeep: '🏕',
  };
  const JOB_GLYPH = { build: '🔨', mine: '⛏', ammo: '🎯', idle: '💤' };
  // What a champion is carrying, over his head. A raid has to be readable
  // before it arrives: which corner it came from is the colour, and what the
  // big one in the middle of it does is this.
  const BOSS_GLYPH = { bolt: '🏹', breaker: '🔨', warlord: '🚩', shaman: '✚' };
  // What one trip to a patch of this material is worth, and how long it takes.
  // Nothing stands on a deposit any more: a person walks to the ground itself,
  // works it where it lies and carries the load home.
  const _gat = (kind) => (B.gather || {})[kind] || { load: 5, time: 5 };

  // ── State ─────────────────────────────────────────────────────────────────
  let _root = null, _canvas = null, _g = null, _hud = null, _bar = null, _overlay = null;
  let _hint = null, _dock = null, _strip = null, _stage = null;
  // The camera. z is how much closer than "the whole map at once" we are, and
  // x/y is what the middle of the canvas is looking at, in world units. A map
  // this size is unreadable on a phone otherwise.
  const _cam = { x: 0, y: 0, z: 1 };
  // The world is five holds wide now, so seeing all of it and reading any of it
  // are two different zooms and both have to be reachable.
  const ZOOM_MAX = 14;
  const _ptrs = new Map();          // live pointers, for drag and pinch
  let _pan = null, _pinch = 0, _moved = 0;
  // Whether the last thing to touch the map was a finger. A finger has no
  // hover, so it aims and confirms where a mouse simply clicks.
  let _touch = false;
  let _pending = null;               // sh_start that arrived before renderGame
  let _hold = null;                  // the saved half: everything that lasts
  // The war parties on the field. They belong to the hold — a party halfway
  // across the map is still halfway across it after a save — so this is the
  // same array, held here only to keep every reader short.
  let _raiders = [];
  let _bullets = [], _dust = [], _floats = [];
  let _raf = 0, _last = 0, _paused = false, _over = false, _reported = false;
  let _pushTimer = 0, _hudTimer = 0;
  let _placing = null;               // building type waiting for a tap
  let _ghost = null;                 // where that building would go, in world units
  let _selected = null;              // building whose panel is open
  let _selFac = null;                // enemy camp whose panel is open
  let _selDep = null;                // deposit whose reach is being shown
  // The champion whose reach is being shown. Nothing is saved about him — he is
  // the object itself, so he goes with him when he falls.
  let _selBoss = null;
  let _toast = 0, _toastText = '';
  let _raidFlash = 0, _raidColor = '';
  let _dpr = 1;                      // canvas pixels per CSS pixel, for the insets
  let _hudH = 0, _dockH = 0;         // what the floating strips cover, in CSS pixels

  // ── Multiplayer presence ─────────────────────────────────────────────────
  // Whether anybody else is in this room. Everything below is dormant while
  // this is true — a solo hold has nobody to show a chip for.
  let _solo = true;
  let _others = {};                  // player_id -> {score, elapsed, fallen}
  let _spectating = false;           // our own hold fell, the room has not
  let _playersOpen = false;          // the collapsed panel on a phone
  let _players = null;               // #sh-players container
  let _peekOverlay = null, _peekCanvas = null, _peekCtx = null;
  let _peekFor = null, _peekTimer = null;

  const W = () => B.world.size;
  const _dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // Whether this screen is a phone in the hand. It decides nothing about the
  // rules and everything about where a panel is allowed to appear: on a narrow
  // screen a panel that opens by itself is a panel over the whole map.
  const _narrow = () => (window.innerWidth || 900) < 760;

  // ── Setup screen ──────────────────────────────────────────────────────────
  // Nothing to choose: a hold is shaped by where the map put the stone, and
  // that is drawn by the server. The lobby only explains what is about to
  // start.
  function renderSetup(box) {
    box.innerHTML =
      '<div style="font-size:.82rem;color:var(--fg2,#a6adc8);line-height:1.5">' +
      _esc(_t('sh_pri_hint')) + '</div>';
    return () => ({});
  }

  // ── Game screen ───────────────────────────────────────────────────────────
  function renderGame(root) {
    _root = root;
    const page = document.createElement('div');
    page.style.cssText = 'flex:1;min-height:0;position:relative';
    // The map is the whole page and everything else floats on top of it: on a
    // phone a boxed map leaves almost nothing to look at. Covering a corner of
    // the map costs nothing, because the map moves under the controls.
    page.innerHTML =
      '<div id="sh-stage">' +
      '<canvas id="sh-canvas"></canvas>' +
      '<div id="sh-hud"></div>' +
      '<div id="sh-players"></div>' +
      '<div id="sh-dock">' +
      '<div id="sh-zoom">' +
      '<button data-zoom="home">\u2302</button>' +
      '<button data-zoom="in">+</button>' +
      '<button data-zoom="out">\u2212</button>' +
      '<button data-zoom="fit">\u26f6</button>' +
      '<button data-zoom="sound">\ud83d\udd0a</button>' +
      '</div>' +
      '<div id="sh-place"></div>' +
      '<div id="sh-hint"></div>' +
      '<div id="sh-bar"></div>' +
      '</div>' +
      '<div id="sh-overlay"></div>' +
      '<div id="sh-peek">' +
      '<div class="sh-peek-hd">' +
      '<span id="sh-peek-name"></span>' +
      '<span id="sh-peek-stats"></span>' +
      '<button id="sh-peek-close" class="sh-btn">' + _esc(_t('sh_close')) + '</button>' +
      '</div>' +
      '<canvas id="sh-peek-canvas"></canvas>' +
      '</div>' +
      '</div>';
    root.appendChild(page);

    _hud     = page.querySelector('#sh-hud');
    _dock    = page.querySelector('#sh-dock');
    _hint    = page.querySelector('#sh-hint');
    _bar     = page.querySelector('#sh-bar');
    _strip   = page.querySelector('#sh-place');
    _canvas  = page.querySelector('#sh-canvas');
    _overlay = page.querySelector('#sh-overlay');
    _stage   = page.querySelector('#sh-stage');
    _players = page.querySelector('#sh-players');
    _g       = _canvas.getContext('2d');

    _peekOverlay = page.querySelector('#sh-peek');
    _peekCanvas  = page.querySelector('#sh-peek-canvas');
    _peekCtx     = _peekCanvas.getContext('2d');
    _peekOverlay.querySelector('#sh-peek-close').onclick = _closePeek;
    // A panel on a phone is a sheet sitting on the dock, so it has to know how
    // tall the dock is. Told rather than guessed, and re-told whenever the dock
    // changes shape.
    _measure();

    // Pointer events rather than click: the same gesture has to be able to
    // become a drag, and a drag must not end up placing a building.
    _canvas.addEventListener('pointerdown', _onDown);
    _canvas.addEventListener('pointermove', _onMove);
    _canvas.addEventListener('pointerup', _onUp);
    _canvas.addEventListener('pointercancel', _onUp);
    _canvas.addEventListener('wheel', _onWheel, { passive: false });
    // Right-click puts a held building down. The menu has to be suppressed
    // whether or not anything was being placed, otherwise a right-click on the
    // map opens the browser's menu over the game.
    _canvas.addEventListener('contextmenu', _onContext);
    // Escape listens on the window: the canvas is never focused, so a keydown
    // bound to it would only fire after the player had clicked the map first.
    // renderGame runs again on every entry into the game and the hub gives it
    // no teardown, so the old binding comes off before the new one goes on —
    // otherwise a second visit would handle every key twice.
    window.removeEventListener('keydown', _onKey);
    window.addEventListener('keydown', _onKey);
    page.querySelectorAll('[data-zoom]').forEach(el => {
      el.onclick = () => {
        const what = el.dataset.zoom;
        if (what === 'sound') { _soundToggle(); return; }
        // ⛶ is the whole world at once — five holds and everything between
        // them — and ⌂ is the way back from it, because on a map this wide
        // finding your own keep again is otherwise a hunt.
        if (what === 'fit')  { _cam.z = _minZoom(); _clampCam(); _draw(); return; }
        // Before the keep exists ⌂ is the middle of the map: there is no home
        // to go back to yet, and a button that does nothing reads as broken.
        if (what === 'home') {
          const keep = _keep();
          if (keep) _lookAt(keep, _homeZoom());
          else _lookAt({ x: W() / 2, y: W() / 2 }, _minZoom());
          return;
        }
        _zoomAt(_cam.x, _cam.y, what === 'in' ? 1.5 : 1 / 1.5);
      };
    });
    _soundBtn();
    // A browser will not let a page make a noise until the player has touched
    // it, and it hands back a dead context to anyone who asks too early — so
    // the first touch of the map, whatever it was for, is what builds it.
    page.addEventListener('pointerdown', _wake, true);
    window.removeEventListener('keydown', _wake, true);
    window.addEventListener('keydown', _wake, true);

    _fitCanvas();
    window.removeEventListener('resize', _fitCanvas);
    window.addEventListener('resize', _fitCanvas);

    if (_pending) { const m = _pending; _pending = null; _begin(m); }
  }

  // The canvas takes the whole stage, whatever shape that is. The world stays
  // square — raiders come from every side, so no direction may get more warning
  // than another — and the camera decides how much of it a screen shows.
  // How tall the floating strips are, told to the stylesheet: the panel is a
  // sheet that sits on the dock on a phone, and a sheet that guesses the dock's
  // height either covers the build bar or floats above nothing.
  function _measure() {
    // Set on the root rather than on the stage: the panel is a sibling of the
    // stage, not a child of it, so a variable written on the stage would be
    // invisible to the one element that needs it.
    const at = _root || _stage;
    if (!at) return;
    _dockH = (_dock && _dock.offsetHeight) || 0;
    _hudH  = (_hud && _hud.offsetHeight) || 0;
    at.style.setProperty('--sh-dock', _dockH + 'px');
    at.style.setProperty('--sh-hud', _hudH + 'px');
    if (_hold) _clampCam();
  }

  function _fitCanvas() {
    if (!_canvas) return;
    _measure();
    const box = _canvas.parentElement.getBoundingClientRect();
    const w = Math.max(200, box.width  || 0);
    const h = Math.max(200, box.height || 0);
    const dpr = _dpr = window.devicePixelRatio || 1;
    _canvas.style.width  = w + 'px';
    _canvas.style.height = h + 'px';
    _canvas.width  = Math.round(w * dpr);
    _canvas.height = Math.round(h * dpr);
    _clampCam();
    if (_hold) _draw();
  }

  // ── Run lifecycle ─────────────────────────────────────────────────────────
  function _begin(msg) {
    B     = msg.tuning;
    _hold = msg.state;
    // The war parties are part of the world, not of this frame: they are saved
    // with everything else and picked up where they were left.
    if (!Array.isArray(_hold.raiders)) _hold.raiders = [];
    if (!Array.isArray(_hold.factions)) _hold.factions = [];
    _raiders = _hold.raiders;
    _bullets = []; _shots = []; _dust = []; _floats = [];
    _over = false; _reported = false; _paused = false;
    _placing = null; _selected = null; _selFac = null; _selBoss = null;
    _solo = msg.solo !== false;
    _others = {};
    _spectating = false;
    _closePeek();
    _navChanged();
    // Fields the browser needs but nobody should save: reload clocks, spawn
    // clocks, what each person is in the middle of doing.
    for (const b of _hold.buildings) {
      b._rl = 0; b._sp = 0;
      // A workshop keeps its own finished rounds now. A hold saved before that
      // was true simply starts with an empty floor.
      if (b.type === 'workshop' && b.ammo == null) b.ammo = 0;
      // The keep no longer keeps a magazine beside its store: it fires out of
      // the store. Whatever an older save left in its rack is poured back in,
      // so no rounds are lost to the change.
      if (b.type === 'tower' && b.keep && (b.ammo || 0) > 0) {
        _hold.ammo = (_hold.ammo || 0) + b.ammo;
        b.ammo = 0;
      }
      // A magazine can never hold more than its level allows. Holds saved while
      // the keep was handed the whole opening stock show things like 8/1; the
      // overflow belongs in the store, where somebody can actually fetch it.
      if (b.type === 'tower' && !b.keep) {
        const mag = _lv('tower', b.lvl, 'mag');
        if ((b.ammo || 0) > mag) {
          _hold.ammo = (_hold.ammo || 0) + (b.ammo - mag);
          b.ammo = mag;
        }
      }
    }
    for (const w of _hold.workers) { w.job = null; if (w.hp == null) w.hp = B.worker.hp; }
    if (PRIORITIES.indexOf(_hold.priority) === -1) _hold.priority = 'balanced';
    // Every patch of ground has to be nameable now that people walk to the
    // ground itself: a hold written down before that has deposits with no name.
    let nid = _hold.next_dep || 0;
    for (const d of _hold.deposits) nid = Math.max(nid, d.id || 0);
    for (const d of _hold.deposits) if (!d.id) d.id = ++nid;
    _hold.next_dep = nid;
    // A worked-out deposit used to stay on the map as a pale mark that could
    // not be used for anything. It has no business being there: sweep the ones
    // an older hold is carrying and put the same kind back somewhere else.
    for (const d of _hold.deposits.slice()) if (d.amount <= 0) _drain(d, 0, true);
    for (const f of _hold.factions) _facFix(f);
    // Every colour that will walk about this map is known now, so the figures
    // are drawn once here rather than on the frame that first needs one.
    _figWarm();

    if (_hold.founding) {
      // Nothing has been settled yet, so the game opens on the whole map: the
      // ground, the four corners and the distances between them are the only
      // things there are to judge, and the decision is unmakeable once made.
      _placing = 'keep';
      _ghost = null;
      _lookAt({ x: W() / 2, y: W() / 2 }, _minZoom());
      _say(_t(_touch ? 'sh_found_touch' : 'sh_found_hint'));
      // Wide screens have room for the whole explanation beside the map, and
      // the first thing a new player is asked for is also the least obvious.
      if (!_narrow()) _previewPanel('keep');
    } else {
      // A hold opens looking at itself, close enough to read. Everything else —
      // the ground in the middle, the four camps in the corners — is a pinch
      // away, and ⛶ shows the lot.
      _lookAt(_keep(), _homeZoom());
    }

    _renderHud();
    _renderBar();
    _renderStrip();
    _draw();

    _overlay.style.display = 'none';

    _last = performance.now();
    cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(_loop);
  }

  function _loop(now) {
    _raf = requestAnimationFrame(_loop);
    // Clamped so a backgrounded tab does not resume with one enormous step:
    // a hold advances by the time somebody watched it, not by wall clock.
    const dt = Math.min(0.05, (now - _last) / 1000);
    _last = now;
    if (!_over && !_paused) _update(dt);
    _draw();
  }

  // ── Simulation ────────────────────────────────────────────────────────────
  function _update(dt) {
    // Before the hold is founded the world is a map and nothing else: no time
    // passes, the camps do not grow and nothing marches. Choosing where to
    // settle has to be free — a clock running while somebody reads the ground
    // turns the first decision of the game into a thing to hurry through.
    const live = !_hold.founding;

    if (live) {
      _hold.elapsed = (_hold.elapsed || 0) + dt; // how long the hold has stood
      _navBudget = 0;                            // routes worked out this frame

      // Who is standing on whom, and who has walked into somebody of another
      // colour. First, because everything that moves below asks it whether it
      // is free to move at all.
      _meet(dt);
      _camps(dt);
      _buildings(dt);
      _people(dt);
      _soldiers(dt);
      _towers(dt);
      _projectiles(dt);
      // Before they move, because a warlord's word and a healer's hands are
      // read off where everybody is standing this frame, not where they were
      // standing before the party walked on.
      _bossPowers(dt);
      _bossShots(dt);
      _raidersMove(dt);
    }

    for (let i = _dust.length - 1; i >= 0; i--) {
      const p = _dust[i];
      p.life -= dt;
      if (p.life <= 0) { _dust.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = _floats.length - 1; i >= 0; i--)
      if ((_floats[i].life -= dt) <= 0) _floats.splice(i, 1);

    if (_toast > 0) _toast -= dt;
    if (_raidFlash > 0) _raidFlash -= dt;

    if (live) _score();

    _hudTimer -= dt;
    if (_hudTimer <= 0) {
      _hudTimer = 0.5;
      _syncHud();
      _syncStrip();
      // The build bar has to keep up with the purse, or it goes on saying a
      // thing is out of reach long after the wood for it came in. Only the
      // affordability is refreshed, never the markup: rewriting the buttons
      // twice a second would drop the tap that is already on its way to one.
      _markAffordable();
      if (_selected) _renderPanel();
      if (_selFac) _renderFacPanel();
    }

    // The hold goes to the server on a timer, so a crashed tab loses seconds.
    _pushTimer -= dt;
    if (_pushTimer <= 0) { _pushTimer = 4; _push(); }
  }

  // ── The four camps ────────────────────────────────────────────────────────
  // Nobody is spawned at the edge of the map any more. There are four other
  // holds out there, one to a corner, and every raider on the field was armed
  // by one of them out of resources it dug up itself. They live by the same
  // rules the player does — people, deposits, buildings that take time to go up
  // — with two differences: they build no towers and no walls, and everything
  // they raise walks at the player sooner or later.
  //
  // What that buys the game is that a raid is now a consequence of something
  // the player could have watched happening. A camp that has been quiet for ten
  // minutes has been growing for ten minutes, and it will show.
  // The hold has no last level either — max_level 0 means no ceiling, and the
  // price of the next one is what actually stops a building. The check stays
  // in, so an installation that does want a ceiling only has to set the number.
  const _atMax = (lvl) => B.max_level > 0 && lvl >= B.max_level;

  const _fc = () => B.faction;
  // ── A camp is a hold ──────────────────────────────────────────────────────
  // Everything below reads out of the player's own tables. A camp's roof is a
  // house, its barracks is a barracks, its keep is priced like the hold's keep,
  // and its men are the hold's men at the hold's level. Not one of these
  // numbers is a camp's own, so there is no second balance to keep in step with
  // the first — move a house and you have moved five holds.
  //
  // The single thing that is theirs is "pace", and it only ever slows time
  // down: a quarter of a load per trip, a quarter of the building done per
  // second, a quarter of the arrivals, a quarter of the muster. Four of them
  // at a quarter each come to about one hold.
  const _pace = () => {
    const p = _fc().pace;
    return p == null ? 1 : Math.max(0.01, p);
  };
  // Their roof is the player's house under another name and another sprite:
  // "hut" on the map, "house" in the table.
  const _facType = (type) => (type === 'hut' ? 'house' : type);
  const _facOf = (f, type) => f.buildings.filter(b => b.type === type);
  // How many men a camp can keep standing: every barracks it owns, each holding
  // what the hold's own barracks holds at the level that barracks is at. A camp
  // used to read this off its keep, which meant a level on a barracks bought it
  // nothing at all and the only thing worth doing with a barracks was putting
  // another one next to it — see _facRank.
  const _facSoldiers = (f) => f.buildings.reduce(
    (n, b) => n + (b.type === 'barracks' && b.built >= 1
                   ? _lv('barracks', b.lvl, 'soldiers') : 0), 0);
  // The same sum for the hold, and it has to be the same sum: it is the ceiling
  // _buildings musters against, one barracks at a time, so the HUD says what
  // the barracks are actually going to do rather than a number of its own.
  const _holdSoldiers = () => _hold.buildings.reduce(
    (n, b) => n + (b.type === 'barracks' && b.built >= 1
                   ? _lv('barracks', b.lvl, 'soldiers') : 0), 0);
  // Where their men are armed: the deepest barracks in the camp. Everything a
  // soldier is worth is read off it — integrity, damage, what the sortie costs
  // and how long it takes — exactly as the player's man is worth what the
  // barracks he walked out of is worth. The keep is the camp's standing on the
  // map and what it is built to survive; it is not what arms anybody.
  const _facRank = (f) => f.buildings.reduce(
    (n, b) => (b.type === 'barracks' && b.built >= 1 ? Math.max(n, b.lvl || 1) : n), 1);
  // And it is what marches: a camp fills every barracks it owns and then sends
  // the lot. Nobody is left at home to watch the raid lose.
  const _facParty = (f) => _facSoldiers(f);

  // ── The champion ──────────────────────────────────────────────────────────
  // The keep's own man. Everything about him is read off the keep's level and
  // nothing off the barracks: he is what a camp's main building is for, now
  // that its men belong to the barracks they were armed in. At level one he is
  // an ordinary member of the party — same size, same integrity — and every
  // level on the keep makes him bigger on the map and worth another man or so
  // in a fight.
  const _bs = () => _fc().boss || {};
  const _bossMult = (lvl, step) => 1 + Math.max(0, lvl - 1) * (step || 0);
  const _bossHp = (lvl) =>
    _lv('barracks', lvl, 'hp_soldier') * _bossMult(lvl, _bs().hp_step);
  const _bossDmg = (lvl) =>
    _lv('barracks', lvl, 'damage') * _bossMult(lvl, _bs().dmg_step);
  const _bossSize = (lvl) =>
    (_bs().size || 26) + Math.max(0, lvl - 1) * (_bs().size_step || 0);
  // Which power a corner's champion carries. Fixed to the corner, so a hold
  // learns that the north-west throws and the south-east mends rather than
  // learning nothing at all about four camps that behave identically.
  const _bossPower = (f) => {
    const list = _bs().powers || [];
    return list.length ? list[(f.id || 0) % list.length] : null;
  };
  // Their men, not counting him: the barracks are what hold soldiers, and a
  // champion standing in the yard must not read as a barracks being full.
  const _facMen = (f) => f.army.reduce((n, s) => n + (s.boss ? 0 : 1), 0);
  // Whether the camp has one at all, at home or on the road.
  const _facBoss = (f) =>
    f.army.some(s => s.boss) || _raiders.some(r => r.fx === f.id && r.boss);
  // How many men a camp thinks it needs before it is worth going. It counts
  // one man per level of every tower its scout saw — a tower fires once per
  // level — and never sets out under "party_min" whatever it saw. A camp that
  // has not looked yet needs a number nobody can reach, because it does not
  // march at all.
  const _facNeed = (f) =>
    Math.max(_fc().party_min || 1, (f.known && f.known.threat) || 0);
  // How long one more man takes out of this barracks: what the hold's own
  // barracks takes at that level, stretched by pace, because that is the only
  // edge the player is given. Every barracks in the camp arms on its own clock,
  // exactly as the hold's do — which is also why a second barracks is worth
  // building rather than being a slower share of the same queue.
  const _facMuster = (b) => _muster(b.lvl) / _pace();
  // Room under a camp's roofs, counted the way the hold counts it: 1, 3, 6, 10
  // per roof by its level. The first hut is standing when the game opens and it
  // holds one person, so a camp and a hold open on the same single digger.
  const _facCap = (f) =>
    _facOf(f, 'hut').reduce((n, b) => n + (b.built >= 1 ? _houseCap(b.lvl) : 0), 0);
  // How long somebody takes to move in. The hold's own wait, set by the best
  // roof in the camp, over pace.
  const _facSpawn = (f) => {
    let best = 1;
    for (const b of f.buildings)
      if (b.type === 'hut' && b.built >= 1) best = Math.max(best, b.lvl || 1);
    return _lv('house', best, 'spawn') / _pace();
  };
  // What the next one of something costs a camp: the player's price for the
  // level, with the player's repeat charge for every one already standing. A
  // camp's fourth roof is dearer than its first, exactly as the hold's is.
  const _facNewCost = (f, type) => {
    const t = _facType(type);
    return _cost(t, 1, Math.pow(_bc(t).repeat || 1, _facOf(f, type).length));
  };
  // What raising their keep a level costs. A keep is a tower under the skin on
  // both sides of the map, so this is the same bill the player is handed for
  // the level above the one they are on.
  const _facKeepCost = (f) => _cost('tower', f.lvl + 1);
  // What arming one of their men costs: the hold's own bill for a sortie out of
  // a barracks at that level. Wooden spears low down, stone from the second and
  // iron from the third — a camp that wants better men has to put people on the
  // rock and the seam, and everything else it is building slows down while it
  // does.
  const _facArm = (f) => _armCost(_facRank(f));
  const _facCanPay = (f, cost) => {
    for (const res in cost) if ((f[res] || 0) < cost[res]) return false;
    return true;
  };
  const _facPay = (f, cost) => { for (const res in cost) f[res] -= cost[res]; };
  const _facSize = (type) =>
    (type === 'keep' ? B.world.keep_radius : _bc(_facType(type)).size);
  // Integrity, off the same line as the hold's. Their keep is the hold's keep:
  // built to outlast everything around it.
  const _facHp = (type, lvl) =>
    _maxHp(type === 'keep' ? 'tower' : _facType(type), lvl, type === 'keep');

  // How many of a kind a camp has, and how deep the best of them is. The count
  // on its own said nothing once a camp could raise a level as well as put
  // another one down: four huts is a very different corner depending on
  // whether they are level one or level four.
  const _facCount = (f, type) => {
    const all = _facOf(f, type);
    const best = all.reduce((n, b) => Math.max(n, b.lvl || 1), 0);
    return best > 1 ? all.length + ' · ' + _t('sh_level', { n: best })
                    : String(all.length);
  };

  // Fields a camp needs that a hold saved before it had them will not carry.
  function _facFix(f) {
    if (!Array.isArray(f.buildings)) f.buildings = [];
    if (!Array.isArray(f.workers)) f.workers = [];
    if (!Array.isArray(f.army)) f.army = [];
    if (!f.stats) f.stats = { sent: 0, lost: 0, built: 0 };
    // Their diggers can be killed now — by a rival's party that walked through
    // the wrong field, never by the hold, which never goes out there — so they
    // need something to lose. A camp saved before that has people with no hp.
    for (const u of f.workers) {
      u.job = null; u.carry = 0;
      if (u.hp == null) u.hp = B.worker.hp;
    }
    for (const s of f.army) if (s.hp == null) s.hp = 1;
    // A camp saved before they started looking before they march has no report
    // and nobody out, and has learned nothing yet about what it takes to win.
    if (f.known === undefined) f.known = null;
    if (f.scout === undefined) f.scout = null;
    if (typeof f.needFloor !== 'number') f.needFloor = 0;
    if (typeof f.raidOut !== 'number') f.raidOut = 0;
    if (typeof f.raidSize !== 'number') f.raidSize = 0;
    // Their keep used to house a digger of its own; now every head in a camp
    // comes out of a hut, and the first hut is the one they are given. A camp
    // saved before that has none, and without one it could never replace
    // anybody it lost — so it gets the free hut here, standing, exactly as a
    // camp on a new map does.
    if (f.buildings.length && !f.buildings.some(b => b.type === 'hut')) {
      const half = W() / 2, hp = _facHp('hut', 1);
      if (typeof f.next_id !== 'number')
        f.next_id = Math.max(0, ...f.buildings.map(b => +b.id || 0)) + 1;
      f.buildings.push({
        id: f.next_id++, type: 'hut', lvl: 1, built: 1,
        build: _bc('house').build,
        x: Math.round(f.x + (f.x < half ? 62 : -62)),
        y: Math.round(f.y + (f.y < half ? 46 : -46)),
        hp: hp, maxHp: hp,
      });
    }
    // Their men used to be armed at the rank of the camp's keep, whatever the
    // barracks they walked out of happened to be — so a camp never had any
    // reason to raise one, and every save has a corner full of level ones. The
    // barracks is what arms a man now, on both sides of the map, and a camp
    // carried across unchanged would have been quietly disarmed back to the
    // bottom of the table. So once, and only once, every barracks is lifted to
    // the rank the camp was already fielding: they keep the men they had.
    if (!f.ranked) {
      for (const b of f.buildings)
        if (b.type === 'barracks') b.lvl = Math.max(b.lvl || 1, f.lvl || 1);
      f.ranked = 1;
    }
    // And once the barracks arm for themselves, every man standing has to
    // belong to one of them. Men saved before that belong to nobody, and a
    // barracks counting only its own would read an empty yard and arm a second
    // camp's worth on top of the one already there. They are shared out over
    // the barracks that exist, deepest first, up to what each can hold.
    if (!f.mustered) {
      const bar = _facOf(f, 'barracks').filter(b => b.built >= 1)
        .sort((a, b) => (b.lvl || 1) - (a.lvl || 1));
      let i = 0, room = bar.length ? _lv('barracks', bar[0].lvl, 'soldiers') : 0;
      for (const s of f.army) {
        while (i < bar.length && room <= 0) {
          i++;
          room = i < bar.length ? _lv('barracks', bar[i].lvl, 'soldiers') : 0;
        }
        if (i >= bar.length) break;
        if (s.from == null) s.from = bar[i].id;
        room--;
      }
      f.mustered = 1;
    }
    // A camp saved under the old table carried its own numbers into every
    // building on the ground: their own integrity, their own build time. They
    // are the hold's numbers now, so anything standing is re-measured off the
    // level it is at — a roof does not get to keep a stat nobody else has.
    for (const b of f.buildings) {
      b.lvl = Math.max(1, b.lvl || 1);
      if (b.type === 'keep') b.lvl = f.lvl;
      const max = _facHp(b.type, b.lvl);
      const share = b.maxHp > 0 ? Math.min(1, (b.hp || 0) / b.maxHp) : 1;
      b.maxHp = max;
      b.hp = b.built >= 1 ? max * share : max;
      if (b.type !== 'keep') b.build = _bc(_facType(b.type)).build;
    }
  }

  function _camps(dt) {
    for (const f of _hold.factions) {
      if (f.grace > 0) f.grace -= dt;
      _facPeople(f, dt);
      _facBuild(f, dt);
      _facArmy(f, dt);
      _facScout(f, dt);
      _facWar(f, dt);
    }
  }

  // ── What a camp knows ─────────────────────────────────────────────────────
  // Nobody marches on a hold they have not counted. A camp sends one man over:
  // he walks to the hold, goes round it, counts the towers he can see and
  // walks home, and only then is there anything to decide. He is unarmed and
  // nothing the hold owns will shoot at him — towers and soldiers answer
  // raiders, and he is not one — so the only answer the player has is to be
  // bigger than he reported, which means finishing a tower after he has turned
  // for home. See the long note in mp_game.py for why it works this way.
  const _sc = () => _fc().scout || {};

  function _facScout(f, dt) {
    const keep = _keep();
    if (!keep || f.grace > 0) return;
    const c = _sc();
    const s = f.scout;

    if (!s) {
      // A scout only goes out for a party actually worth pricing, and never
      // twice for the same report. "floor" is what the camp has learned it
      // takes: scout_min men the very first time, and — once a raid has come
      // home short — whatever that raid needed, so a camp beaten at five
      // does not walk a man over to learn it still needs five.
      if (f.known) return;                            // waiting to grow into the last report
      if (_raiders.some(r => r.fx === f.id)) return;   // their own party is still out
      const floor = f.needFloor || c.scout_min || 1;
      if (_facMen(f) < floor) return;
      f.scout = {
        x: f.x, y: f.y, phase: 'out', t: 0, seen: {},
        ang: Math.atan2(f.y - keep.y, f.x - keep.x),
      };
      return;
    }

    // He counts what is in front of him, wherever he happens to be — but not
    // through a wall by more than the wall's own depth and twice that again.
    // Near enough to read what is standing just behind one, not far enough to
    // read the whole hold from outside the ring: anything set back further
    // than that is only found by walking in, which nothing stops him doing
    // on the "look" pass below.
    const sight = _bc('wall').size * 3;
    for (const b of _hold.buildings) {
      // The keep counts as well: it fires out of the store like any tower, and
      // its level is written on it for anybody standing close enough to look.
      if (b.type !== 'tower' || b.built < 1) continue;
      if (_dist(s, b) <= sight) s.seen[b.id] = b.lvl;
    }

    const ring = c.ring || 210, speed = c.speed || 70;
    const round = () => ({ x: keep.x + Math.cos(s.ang) * ring,
                           y: keep.y + Math.sin(s.ang) * ring });

    // He is not a raider and he breaks nothing, so a ring of finished wall is
    // an answer to him: he walks round what is built and, if there is no way in
    // at all, he prices the hold from outside instead of leaning on the wall
    // for the rest of the game. That is not a way of keeping a camp off for
    // ever — what he could not walk to he could not count, so the party they
    // send is sized for a hold they never saw properly, and a party that comes
    // home beaten raises what the camp waits to field before the next one. A
    // sealed hold buys one cheap raid, not peace.
    //
    // A gate is not a sealed hold. It is a door standing open, and one unarmed
    // man strolling through it is the whole reason a hold with a road through
    // it is a hold that can be read: everything he passes on the way in he
    // counts. That is the price of the convenience, and it is paid only by
    // this one — anybody who comes back with a spear finds the same gate as
    // solid as the wall it is set in.
    const patience = c.patience || 6;
    if (s.phase === 'out') {
      // Getting there is worth working a route out for: the way in is a gap in
      // a ring he cannot see the far side of, and feeling along the wall for it
      // is not what a man sent to look at a place does.
      s._straight = false;
      if (_facStep(s, round(), dt, speed, 8, true) || (s._stall || 0) > patience) {
        s.phase = 'look'; s.t = 0;
        _say(_t('sh_scout_here', { camp: _facName(f) }));
      }
      return;
    }
    if (s.phase === 'look') {
      s.t += dt;
      s.ang += dt * 0.45;
      // Going round it is not going anywhere in particular, so this is the one
      // walk that is not worth routing: the spot he is making for moves the
      // whole time, and working out a fresh route to it every few paces would
      // cost the hold's own people theirs. He follows the wall instead, which
      // is what walking round the outside of a hold looks like anyway.
      s._straight = true;
      _facStep(s, round(), dt, speed, 4, true);
      if (s.t >= (c.look || 14)) { s.phase = 'back'; s._straight = false; }
      return;
    }
    // Home, or word sent home. A man who has been built in behind a wall while
    // he was looking would otherwise stand there for ever with a report nobody
    // ever hears, and a camp waiting on him never marches again.
    if (_facStep(s, { x: f.x, y: f.y }, dt, speed, B.world.keep_radius + 10, true) ||
        (s._stall || 0) > patience * 4) {
      let threat = 0, towers = 0;
      for (const id in s.seen) { threat += Math.max(1, s.seen[id] || 1); towers++; }
      f.known = { threat: threat, towers: towers, at: _hold.elapsed || 0 };
      f.scout = null;
      f.ready = 0;
    }
  }

  // Their people. The same errand the player's people run — walk to the ground,
  // work it, carry it home — with none of the routing: a camp sits in an open
  // corner with nothing to walk round, and the map is wide enough that paying
  // for four camps' worth of pathfinding would be paying for nothing.
  function _facPeople(f, dt) {
    const cap = _facCap(f);
    const speed = B.worker.speed;
    const reach = B.world.keep_radius + 10;
    if (f.workers.length < cap) {
      // The hold's own wait, stretched by pace — and banked to one arrival, so
      // a camp that has just finished a roof does not fill it the same second.
      const every = _facSpawn(f);
      f.spawn = Math.min((f.spawn || 0) + dt, every);
      if (f.spawn >= every) {
        f.spawn = 0;
        f.workers.push({ x: f.x + (Math.random() - 0.5) * 50,
                         y: f.y + (Math.random() - 0.5) * 50,
                         hp: B.worker.hp, job: null });
      }
    } else {
      f.spawn = 0;
    }
    // Somewhere to put the hands: a camp with something going up puts people on
    // it and takes them off the ground to do it, the same as the hold does. A
    // building is never raised by people who are also out digging.
    //
    // New work first, mending second — the worst-hurt building of the lot, and
    // only when there is nothing being raised. A camp that stopped growing
    // every time somebody scratched a hut would never grow at all.
    const site = f.buildings.find(b => b.built < 1 || b.up != null) ||
      f.buildings.filter(_facHurt)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    let onSite = 0;
    for (const u of f.workers) {
      // Somebody with a rival's soldier in front of him is not going anywhere,
      // and the errand waits: see _meet.
      if (u._lock) continue;
      // Ground they cannot get to. A patch that has ended up inside the hold's
      // walls is a patch nobody from a camp will ever work, and somebody who
      // has taken it would otherwise stand against that wall for the rest of
      // the game. Long enough without getting any nearer and they leave that
      // patch alone for a while and go and find other ground — the hold's own
      // people do exactly this with work they cannot reach, and it is the same
      // ruler: see _giveUp.
      if (u._skipFor > 0 && (u._skipFor -= dt) <= 0) u._skipDep = null;
      if (u.job === 'mine' && (u._stall || 0) > GIVE_UP) {
        if (u.phase === 'walk') { u._skipDep = u.dep; u._skipFor = LEAVE_ALONE; }
        // A load in hand is counted as home rather than dropped: timber that
        // vanished because a wall went up behind somebody is the kind of loss
        // nobody can see happening and everybody notices afterwards.
        else if (u.carry && u.res) f[u.res] = (f[u.res] || 0) + u.carry;
        u.job = null; u.dep = null; u.carry = 0; u._stall = 0;
      }
      // Half the camp downs tools for whatever is going up, and never the last
      // person: somebody has to keep carrying or the site is never paid for.
      if (site && u.job !== 'build' && !u.carry &&
          onSite < Math.max(1, Math.floor(f.workers.length / 2))) {
        u.job = 'build'; u.phase = 'walk'; u.t = 0;
      }
      if (u.job === 'build') {
        if (!site) { u.job = null; continue; }
        onSite++;
        if (_facStep(u, site, dt, speed, _facSize(site.type) + 10)) {
          // A day's work per day at pace, and nothing else touched: the
          // building takes what the hold's own takes, at the pace they work at.
          if (_facProgress(f, site, dt * B.worker.build_rate * _pace()))
            for (const o of f.workers) if (o.job === 'build') o.job = null;
        }
        continue;
      }
      if (!u.job) {
        const d = _facPick(f, u);
        if (!d) { _facIdle(f, u, dt); continue; }
        u.job = 'mine'; u.dep = d.id; u.phase = 'walk'; u.t = 0; u.carry = 0;
      }
      const dep = _depById(u.dep);
      if (!dep || dep.amount <= 0) { u.job = null; u.carry = 0; continue; }
      if (u.phase === 'walk') {
        if (_facStep(u, dep, dt, speed, _depReach(dep))) { u.phase = 'work'; u.t = 0; }
        continue;
      }
      if (u.phase === 'work') {
        u.t += dt;
        if (u.t >= (_gat(dep.kind).time || 5)) {
          // The hold's own load, scaled by pace and by nothing else: their
          // people work the same ground for the same time at the same speed.
          // Any handicap belongs on what they carry home, never on the clock —
          // a slower dig would not be a clean fraction of anything, because the
          // walk home is not part of the dig.
          const load = Math.min(_gat(dep.kind).load * _pace(), dep.amount);
          _drain(dep, load);
          u.carry = load; u.res = dep.kind; u.phase = 'home';
        }
        continue;
      }
      // Home is a place, not a building: the camp and its huts number
      // themselves off the same counter, and a walk judged under the same name
      // as the last one carries the last one's tally of getting nowhere.
      if (_facStep(u, { x: f.x, y: f.y }, dt, speed, reach)) {
        f[u.res] = (f[u.res] || 0) + (u.carry || 0);
        _float(f.x, f.y, (RES_GLYPH[u.res] || '📦') + ' ', u.carry, RES_TINT[u.res]);
        u.carry = 0; u.job = null;
      }
    }
  }

  // Which patch one of their people goes to. The player's rule, and it is a
  // price rather than a rule: the walk out, the walk home, and a charge for
  // everybody already standing on that patch — so a crowded wood nearby beats
  // an empty one across the corner, right up until the crowd is real.
  //
  // "range" is a first look, not a fence. On a map where the ground falls where
  // it falls, a corner can come up with no iron at all inside any sane circle,
  // and a camp that answers that by standing still is a camp that has lost the
  // game to the map rather than to the player. So: near ground first, and if
  // there is none of what they need, the whole world — a long walk being its
  // own punishment, exactly as it is for the hold.
  // The material comes first and the circle second, which is the way round it
  // has to be: the near look used to fall through to the next material before
  // it fell through to the rest of the map, so a corner with no timber inside
  // its circle dug the stone next to it for ever and starved of the one thing
  // every building it wanted was priced in. What it needs most is asked of the
  // near ground and then of the whole world, and only then does it settle for
  // the next material down.
  function _facPick(f, u) {
    const reach = _fc().range || 1500;
    for (const res of _facWants(f)) {
      const d = _facNear(f, u, reach, res) || _facNear(f, u, Infinity, res);
      if (d) return d;
    }
    return null;
  }

  function _facNear(f, u, reach, res) {
    const share = B.worker.share_penalty || 300;
    let best = null, bd = Infinity;
    for (const d of _hold.deposits) {
      if (d.kind !== res || d.amount <= 0) continue;
      if (u && d.id === u._skipDep) continue;   // ground he has just failed to reach
      if (_dist(f, d) > reach) continue;
      const on = f.workers.filter(
        x => x !== u && x.job === 'mine' && x.dep === d.id).length;
      const cost = _dist(u || f, d) + _dist(f, d) + share * on;
      if (cost >= bd) continue;
      bd = cost; best = d;
    }
    return best;
  }

  // Everything a camp could pay for next, as a list of prices rather than one
  // heap. The hold's own _wants under another name, and every line of it is a
  // price out of the player's table: another roof, another barracks, a level on
  // anything standing, the next rank on the keep, and arms.
  function _facBills(f) {
    const list = [{ cost: _facNewCost(f, 'hut'), w: 0.5 },
                  { cost: _facNewCost(f, 'barracks'), w: 0.5 }];
    if (!_atMax(f.lvl)) list.push({ cost: _facKeepCost(f), w: 0.5 });
    for (const b of f.buildings) {
      if (b.built < 1 || b.type === 'keep' || _atMax(b.lvl)) continue;
      list.push({ cost: _cost(_facType(b.type), b.lvl + 1), w: 0.5 });
    }
    // Arms are spent again at every soldier, so they weigh most: a camp that
    // cannot arm anybody is a camp that is not a threat, and it knows it.
    list.push({ cost: _facArm(f), w: 4 });
    return list;
  }

  // What a camp is short of, worst first — and it is the hold's own _byNeed,
  // because it has to be. Adding every price up and going after whatever came
  // to the biggest number is a rule that answers "timber" for the rest of the
  // game: new buildings are priced in wood alone, so wood wins that sum for
  // ever while the corner stands on five thousand stone it cannot spend and the
  // one roof it is actually waiting on never goes up. A price a camp can
  // already pay is not a shortage. So each price is asked only what it is still
  // missing, counted in journeys — see the long note on _byNeed.
  function _facWants(f) {
    const miss = { wood: 0, stone: 0, iron: 0 };
    const want = { wood: 0, stone: 0, iron: 0 };
    for (const it of _facBills(f)) {
      for (const res in it.cost) {
        want[res] += it.cost[res] * it.w;
        const gap = it.cost[res] - (f[res] || 0);
        if (gap > 0) miss[res] += (gap / (_gat(res).load || 1)) * it.w;
      }
    }
    // Short of nothing: then it is the old question again, which is simply what
    // there is most left to spend.
    return RESOURCES.slice().sort((a, b) =>
      (miss[b] - miss[a]) ||
      ((want[b] - (f[b] || 0)) - (want[a] - (f[a] || 0))));
  }

  function _facIdle(f, u, dt) {
    if (!u.rest || u.rest <= 0) {
      const a = Math.random() * Math.PI * 2;
      u.wx = f.x + Math.cos(a) * (40 + Math.random() * 70);
      u.wy = f.y + Math.sin(a) * (40 + Math.random() * 70);
      u.rest = 3 + Math.random() * 4;
    }
    u.rest -= dt;
    _facStep(u, { x: u.wx, y: u.wy }, dt, B.worker.speed * 0.5, 6);
  }

  // A step towards something. Out in the corners there is nothing to walk
  // round — the camps build no walls and they are the only ones who live there
  // — so out there this stays the straight line it always was, and a camp costs
  // nothing to run.
  //
  // What the corners have no business ignoring is the hold. A scout strolling
  // through a finished wall makes the wall look like scenery, and it is the one
  // thing the player paid for with the whole of a hold's timber. So anybody
  // from a camp whose way passes anywhere near what has been built walks it the
  // way the hold's own people walk it: round what is standing, or not at all.
  // `thru` is the one of them who uses a door as a door: their scout. He is
  // unarmed, he breaks nothing, and a gate left standing open is exactly the
  // hole in a ring that a man sent to look at a place walks in through. Their
  // diggers and their armies never get it — see _solidAt.
  function _facStep(u, to, dt, speed, reach, thru) {
    if (_nearHold(u, to)) return _walk(u, to, dt, speed, reach || 6, thru);
    const dx = to.x - u.x, dy = to.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= (reach || 6)) return true;
    const step = Math.min(speed * dt, d);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
    return false;
  }

  // One building at a time, and it takes time — which is the whole point: a
  // camp getting bigger is something the player can see happening and, if they
  // are watching, something they can read as a warning.
  // Work done on a camp's site, the hold's own _progress under another name:
  // a new building goes up, and a level on a building that is already standing
  // goes up more slowly, because the place keeps working while they do it.
  function _facProgress(f, b, secs) {
    const step = secs / (_bc(_facType(b.type)).build || 10);
    if (b.built < 1) {
      b.built = Math.min(1, b.built + step);
      if (b.built < 1) return false;
      b.hp = b.maxHp;
      f.stats.built = (f.stats.built || 0) + 1;
      _burst(b.x, b.y, f.color, 10);
      return true;
    }
    if (b.up != null) {
      b.up = Math.min(1, b.up + step * 0.8);
      if (b.up < 1) return false;
      b.up = null;
      b.lvl += 1;
      b.maxHp = _facHp(b.type, b.lvl);
      b.hp = b.maxHp;
      _burst(b.x, b.y, f.color, 14);
      return true;
    }
    // Patching up what a raid chewed on, the hold's own repair at the hold's
    // own rate and for the hold's own price, which is nothing but the hands.
    // Without it a camp only ever gets worse: every party the player beats off
    // used to leave permanent holes in the corner it came from, so one good
    // defence was the end of that camp for the rest of the game.
    if (_facHurt(b)) {
      b.hp = Math.min(b.maxHp, b.hp + step * b.maxHp * REPAIR_RATE);
      if (_facHurt(b)) return false;
      b.hp = b.maxHp;
      _burst(b.x, b.y, '#a6e3a1', 8);
    }
    return true;
  }

  // Worth mending: the same half-a-hitpoint deadband the hold uses, so nobody
  // stands over an untouched wall for ever because of rounding.
  function _facHurt(b) {
    return b.built >= 1 && b.up == null && b.hp < b.maxHp - 0.5;
  }

  // What a camp buys next. The order is the order a hold is built in — room
  // before soldiers before rank — and a camp with nobody digging never gets to
  // the third of those. There is no cap on any of it: what stops a camp is the
  // price of the next thing, exactly as it is what stops the player.
  function _facBuild(f, dt) {
    // Something already going up is what the hands are on: see _facPeople.
    if (f.buildings.some(b => b.built < 1 || b.up != null)) return;
    // Room first, and only when the roofs they have are full — a camp does not
    // pay for an empty house any more than the player would.
    if (f.workers.length >= _facCap(f) && _facWiden(f, 'hut')) return;
    // Then somewhere to arm men, and only when every barracks standing is full
    // — and a level on one counts as somewhere, because it is: a deeper
    // barracks holds more men and arms better ones, on both sides of the map.
    if (_facMen(f) >= _facSoldiers(f) && _facWiden(f, 'barracks')) return;
    // And then rank, for as long as they can pay for it. There is no last
    // level: what stops a camp is the price of the next one, not a number.
    const cost = _facKeepCost(f);
    if (!_atMax(f.lvl) && _facCanPay(f, cost)) {
      _facPay(f, cost);
      f.lvl += 1;
      const keep = f.buildings.find(b => b.type === 'keep') || f.buildings[0];
      if (keep) {
        keep.lvl = f.lvl;
        keep.maxHp = _facHp('keep', f.lvl);
        keep.hp = keep.maxHp;
      }
      _burst(f.x, f.y, f.color, 16);
    }
  }

  // What a bill comes to, for comparing two of them — counted in journeys, so
  // a level that wants iron is priced as the walking it takes rather than as a
  // number that happens to be small. Materials are not interchangeable, but a
  // camp choosing between another building and a level only needs to know which
  // of the two it can be standing under sooner.
  const _facWeight = (cost) =>
    RESOURCES.reduce((n, r) => n + (cost[r] || 0) / (_gat(r).load || 1), 0);

  // Another one of these, or a level on the cheapest one already standing —
  // whichever is the cheaper bill today. That is the fork the player stands at
  // every time a house fills up or a barracks comes to strength, and a camp
  // reads it the same way: the repeat charge is what eventually makes the level
  // the buy. Nothing here is roofs-only any more, which is the whole point —
  // a camp that could only ever put another barracks next to the last one was
  // a camp whose soldiers stayed at the bottom of the table all game.
  function _facWiden(f, type) {
    const nu = _facNewCost(f, type);
    let best = null, up = null;
    for (const b of _facOf(f, type)) {
      if (b.built < 1 || _atMax(b.lvl)) continue;
      const c = _cost(_facType(type), b.lvl + 1);
      if (!up || _facWeight(c) < _facWeight(up)) { up = c; best = b; }
    }
    if (best && _facWeight(up) < _facWeight(nu)) {
      if (!_facCanPay(f, up)) return false;
      _facPay(f, up);
      best.up = 0;              // the people have to build it, level by level
      return true;
    }
    return _facTry(f, type);
  }

  // Buying one more of something, if the store runs to it.
  function _facTry(f, type) {
    const cost = _facNewCost(f, type);
    if (!_facCanPay(f, cost)) return false;
    _facPay(f, cost);
    if (_facRaise(f, type)) return true;
    for (const res in cost) f[res] += cost[res];   // nowhere to put it
    return false;
  }

  // Somewhere in the camp for it to stand: a ring round the keep, first spot
  // that is not on top of something else or on somebody's ground.
  function _facRaise(f, type) {
    const size = _facSize(type);
    for (let ring = 70; ring <= 260; ring += 34) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const x = f.x + Math.cos(a) * ring, y = f.y + Math.sin(a) * ring;
        if (x < size + 20 || y < size + 20 || x > W() - size - 20 || y > W() - size - 20) continue;
        if (f.buildings.some(b => Math.hypot(b.x - x, b.y - y) < _facSize(b.type) + size + 14)) continue;
        if (_hold.deposits.some(d => Math.hypot(d.x - x, d.y - y) < _depR(d) + size)) continue;
        const hp = _facHp(type, 1);
        f.buildings.push({
          id: f.next_id++, type: type, x: Math.round(x), y: Math.round(y),
          lvl: 1, built: 0, build: _bc(_facType(type)).build,
          hp: hp, maxHp: hp,
        });
        return true;
      }
    }
    return false;
  }

  // Arming one more man. He costs the camp materials it dug up, which is why
  // killing a war party is not only survival — it is a bill sent back to the
  // corner it came from.
  // The keep raising its own man. One at a time and one at all: while he is
  // standing — in the yard or out on a raid — the keep is done. When he falls,
  // it takes "muster" seconds at their pace and the price of two ordinary
  // sorties to put another one out, paid out of the same stores that arm the
  // rest, so a camp that has just lost its champion arms fewer men while it
  // makes the next.
  function _facChampion(f, dt, m) {
    if (_facBoss(f)) { f.bossAt = 0; f.bossFor = 0; return; }
    // Never before the corner's first raid. A keep stands in every corner from
    // the first second of the game, so a champion who only wants time arrived
    // while the player was still choosing where to put a house. The first party
    // out of a camp is ordinary men and nothing else — it is the raid the hold
    // is meant to survive on a wall and two towers — and the keep only starts
    // on him once that party has walked out. After that the gate is behind him
    // for good: it is the first champion that is late, not every one of them,
    // and a camp whose champion falls replaces him on the clock below.
    //
    // Read off what the camp has actually sent rather than a flag of its own:
    // a scout is not a raid, and a party is counted where it sets out — see
    // _facWar.
    if (!(f.stats && f.stats.sent > 0)) return;
    // What he is worth in men is what he costs in time. The wait is set once
    // per champion rather than read every frame, so a keep raised while he is
    // being made does not reset the clock — and it is jittered, because a
    // champion who reappears on the tick is a champion the player can plan
    // around.
    if (!f.bossFor) {
      const j = _bs().muster_jitter || 0;
      f.bossFor = _muster(1) * (_bs().muster || 1) * Math.max(1, f.lvl) /
                  _pace() * (1 + (Math.random() * 2 - 1) * j);
    }
    f.bossAt = (f.bossAt || 0) + dt;
    if (f.bossAt < f.bossFor) return;
    const one = _armCost(f.lvl), arm = {};
    for (const res in one) arm[res] = Math.round(one[res] * (_bs().arm || 1));
    if (!_facCanPay(f, arm)) return;
    f.bossAt = 0;
    f.bossFor = 0;
    _facPay(f, arm);
    const hp = _bossHp(f.lvl);
    f.army.push({
      x: f.x + (Math.random() - 0.5) * 40, y: f.y + (Math.random() - 0.5) * 40,
      hp: hp, maxHp: hp,
      dmg: _bossDmg(f.lvl),
      boss: 1, blvl: f.lvl, power: _bossPower(f),
      // He is heavier than the men he walks in with, and he arrives with them
      // rather than behind them: a party whose champion is still on the road
      // when it reaches the wall is a party that has already lost him.
      speed: ((m.speed || 44) + (m.speed_step || 0) * (f.lvl - 1)),
      pa: Math.random() * Math.PI * 2,
    });
    _burst(f.x, f.y, f.color, 20);
    _sfx('champ', f.x, f.y);
  }

  // Their men, one barracks at a time — the hold's own rule, in the hold's own
  // words. A man is worth what the roof he was armed under is worth: a camp
  // with a deep barracks and a shallow one fields both kinds side by side, the
  // shallow one keeps arming its own weaker men rather than being carried by
  // its neighbour, and a level on any one barracks is felt by everybody who
  // walks out of that one and by nobody else. It used to read the deepest
  // barracks in the camp for the whole army, which made every barracks after
  // the first a free upgrade for all of them.
  function _facArmy(f, dt) {
    const m = _fc().march || {};
    _facChampion(f, dt, m);
    for (const b of f.buildings) {
      if (b.type !== 'barracks' || b.built < 1) continue;
      const max  = _lv('barracks', b.lvl, 'soldiers');
      const mine = f.army.filter(s => s.from === b.id).length;
      if (mine >= max) { b._sp = 0; continue; }
      b._sp = (b._sp || 0) + dt;
      if (b._sp < _facMuster(b)) continue;
      const arm = _armCost(b.lvl);
      if (!_facCanPay(f, arm)) continue;
      b._sp = 0;
      _facPay(f, arm);
      // A camp's man is a hold's man: the same integrity and the same damage
      // the barracks he was armed in gives the player. They are not a weaker
      // kind of soldier fielded in numbers — they are the player's soldier,
      // mustered slower and armed dearer.
      const hp = _lv('barracks', b.lvl, 'hp_soldier');
      f.army.push({
        x: f.x + (Math.random() - 0.5) * 70, y: f.y + (Math.random() - 0.5) * 70,
        hp: hp, maxHp: hp,
        dmg: _lv('barracks', b.lvl, 'damage'),
        from: b.id,
        // The one thing a hold's garrison has no number for, because it never
        // leaves the ring it patrols. This is the walk out to the hold.
        speed: ((m.speed || 44) + (m.speed_step || 0) * (f.lvl - 1)) *
               (0.9 + Math.random() * 0.2),
        pa: Math.random() * Math.PI * 2,
      });
    }
  }

  // Waiting, then going. A camp does not trickle men across the map one at a
  // time: it musters a party and sends the lot, so a raid is one event with a
  // direction, and the direction is a corner the player can point at.
  function _facWar(f, dt) {
    for (const s of f.army) {
      // A man with a fight on his hands stands and fights it, wherever the
      // circle he was walking had got to.
      if (s._lock) continue;
      // Milling about outside the keep while they wait.
      s.pa = (s.pa || 0) + dt * 0.4;
      const r = 60 + (s.maxHp % 30);
      _facStep(s, { x: f.x + Math.cos(s.pa) * r, y: f.y + Math.sin(s.pa) * r }, dt, 22, 4);
    }
    if (f.grace > 0) return;
    // Nobody marches on a hold nobody has looked at, and nobody marches under
    // what the last look said it would take.
    if (!f.known) { f.ready = 0; return; }
    // Counted in ordinary men, and the champion is not one of them. He is
    // whatever the keep has managed to make by the time the party is ready:
    // sometimes he walks out with it, and sometimes — because a deep one takes
    // several raids to replace — they go without him and the hold gets the one
    // party it can actually beat. A camp that waited for him would have made
    // him a thing on a timetable.
    const need = _facNeed(f);
    if (_facMen(f) < need) { f.ready = 0; return; }
    // A short pause once they are enough, so parties arrive in gusts rather
    // than the instant the last man is armed.
    f.ready = (f.ready || 0) + dt;
    if (f.ready < _fc().ready_wait) return;
    f.ready = 0;

    const keep = _keep();
    const going = f.army.splice(0, f.army.length);
    for (const s of going) {
      _raiders.push({
        x: s.x, y: s.y, hp: s.hp, maxHp: s.maxHp, dmg: s.dmg, speed: s.speed,
        fx: f.id, lvl: f.lvl,
        // The champion walks out as himself. A man on the road is a fresh
        // object rather than the one that was standing in the yard, so
        // anything that makes him what he is has to be carried across it —
        // without this he arrived as an ordinary raider with a champion's
        // integrity, and the camp went straight on making another.
        boss: s.boss, blvl: s.blvl, power: s.power,
      });
    }
    // What they knew walks out with the party. The next raid needs another
    // pair of eyes, which is the player's chance to become a different hold
    // from the one that was counted. And the size of this party is tracked
    // against who comes home from it — see _killRaider — so a camp wiped out
    // learns to send more next time instead of walking the same five in again.
    f.known = null;
    f.raidSize = going.length;
    f.raidOut = going.length;
    f.stats.sent = (f.stats.sent || 0) + going.length;
    _hold.stats.raids = (_hold.stats.raids || 0) + 1;
    _raidFlash = 3;
    // Whose party it is, kept for the warning across the top: four camps walk
    // out of four corners and the one word that says which is on the way is
    // worth more than the alarm being red. The colour is the same one their
    // men, their camp and their arrows off the edge of the screen are drawn
    // in, so the banner names them without having to be read.
    _raidColor = f.color;
    _sfx('raid');
    _say(_t('sh_raid_from', { camp: _facName(f), n: going.length }));
    if (keep) { /* they walk from their own corner: no spawn ring any more */ }
  }

  // Which corner a camp sits in, said in words. The chips in the HUD, the
  // warning when a party sets out and the panel all name it the same way.
  function _facName(f) {
    const half = W() / 2;
    const k = (f.y < half ? 'n' : 's') + (f.x < half ? 'w' : 'e');
    return _t('sh_camp_' + k);
  }
  const _facShort = (f) => {
    const half = W() / 2;
    return _t('sh_camp_short_' + (f.y < half ? 'n' : 's') + (f.x < half ? 'w' : 'e'));
  };
  const _facById = (id) => _hold.factions.find(f => f.id === id) || null;
  // The worst of them, which is what the HUD calls "threat" and what the end
  // card reports.
  const _worstLvl = () =>
    Math.max.apply(null, _hold.factions.map(f => f.lvl || 1).concat(1));

  // ── Bodies on the map ─────────────────────────────────────────────────────
  // Two things that have to know about everybody at once rather than about one
  // side: nobody walks through anybody, and two sides that walk into each other
  // fight.
  //
  // The camps are not at war with each other and never go looking for one
  // another — they all want the same hold, and a party spent on a neighbour is
  // a party the player never has to meet. What they no longer do is share a
  // square. Two parties whose roads cross walk into each other and swing, and
  // whoever is left standing carries on to the hold. So where the player
  // settles decides more than how far each camp has to walk: it decides whose
  // road crosses whose.
  //
  // The hold is deliberately kept out of the fighting half of this. A raider
  // and a soldier of the hold already have a fight of their own — with chasing,
  // wounds, healing and loot in it — and running it a second time here would
  // double every blow. The hold's people are only bodies to this: they take up
  // room like everybody else.
  const _cl        = () => _fc().clash || {};
  const _clashReach = () => _cl().reach || 18;
  const _clashBody  = () => _cl().body  || 15;

  // A nudge, taken only if it does not push somebody inside something built.
  // Being eased out of a crowd into the middle of a wall is worse than the
  // crowd was.
  function _shove(u, dx, dy) {
    const nx = u.x + dx, ny = u.y + dy;
    if (_solidAt(nx, ny, null)) return;
    u.x = nx; u.y = ny;
  }

  // Killed by another camp. The hold had no hand in it, so there is no kill on
  // its board and no loot on the ground — the only thing that changes is that a
  // camp is one man lighter, and it will feel that when it next counts a party.
  function _fell(e) {
    const u = e.u;
    if (e.side < 0) return;
    const f = _facById(e.side);
    const outOf = (arr) => {
      const i = arr ? arr.indexOf(u) : -1;
      if (i !== -1) arr.splice(i, 1);
      return i !== -1;
    };
    const gone = outOf(_raiders) || (f && (outOf(f.army) || outOf(f.workers)));
    if (!gone) return;
    if (_selBoss === u) _selBoss = null;
    _burst(u.x, u.y, (f && f.color) || '#f38ba8', 10);
    if (f) f.stats.lost = (f.stats.lost || 0) + 1;
  }

  function _meet(dt) {
    const reach = _clashReach(), body = _clashBody();
    const cell  = Math.max(reach, body) * 2;
    const grid  = new Map();
    const all   = [];

    // Everybody standing on the map, with the side they are on: -1 is the hold,
    // 0-3 are the corners. Rebuilt every frame, because people are born, killed
    // and sent out constantly and a stale list would push ghosts about.
    const add = (u, side, dmg) => {
      u._lock = false;
      const i = all.push({ u: u, side: side, dmg: dmg, dead: false }) - 1;
      const key = Math.floor(u.x / cell) + ',' + Math.floor(u.y / cell);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i); else grid.set(key, [i]);
    };
    for (const w of _hold.workers)  add(w, -1, 0);
    for (const s of _hold.soldiers) add(s, -1, 0);
    for (const r of _raiders)       add(r, r.fx, _rdmg(r));
    for (const f of _hold.factions) {
      for (const u of f.workers) add(u, f.id, 0);
      for (const s of f.army)    add(s, f.id, s.dmg || 0);
    }

    const dead = [];
    const hit = (e, dmg) => {
      if (e.dead || !(dmg > 0)) return;
      e.u.hp = (e.u.hp == null ? 1 : e.u.hp) - dmg * dt;
      if (e.u.hp <= 0) { e.dead = true; dead.push(e); }
    };

    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.dead) continue;
      const cx = Math.floor(a.u.x / cell), cy = Math.floor(a.u.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(gx + ',' + gy);
          if (!bucket) continue;
          for (const j of bucket) {
            // Every pair once: the second half of it would only undo the first.
            if (j <= i) continue;
            const b = all[j];
            if (b.dead) continue;
            const dx = b.u.x - a.u.x, dy = b.u.y - a.u.y;
            const d2 = dx * dx + dy * dy;
            // Two different corners, at least one of them carrying something to
            // fight with, near enough to swing: that is a fight, and neither of
            // them walks away from it while the other is standing. An unarmed
            // digger caught by a rival's party does not fight back — he is
            // simply in the wrong field.
            const cross = a.side !== b.side;
            const camps = cross && a.side >= 0 && b.side >= 0;
            if (camps && (a.dmg > 0 || b.dmg > 0) && d2 < reach * reach) {
              a.u._lock = true; b.u._lock = true;
              hit(b, a.dmg);
              hit(a, b.dmg);
              if (a.dead) break;
              continue;
            }
            // Not a fight — just two people in the same spot. Ease them apart,
            // half the overlap each. Two rules about who is left alone: anybody
            // in a fight, because they are meant to be standing on top of each
            // other, and any pair of the hold's and a camp's, because a raider
            // has to be able to reach the man he came for and a soldier the
            // raider. That fight is fought elsewhere and this must not hold
            // them a pace apart for ever.
            if (cross && !camps) continue;
            if (d2 > 0.01 && d2 < body * body && !a.u._lock && !b.u._lock) {
              const d = Math.sqrt(d2);
              const p = (body - d) * 0.3 / d;
              _shove(a.u, -dx * p, -dy * p);
              _shove(b.u,  dx * p,  dy * p);
            }
          }
          if (a.dead) break;
        }
        if (a.dead) break;
      }
    }

    for (const e of dead) _fell(e);
  }

  // Buildings do their own work: workshops make ammunition, barracks send out
  // soldiers, houses ask for people. None of it needs a person standing there.
  function _buildings(dt) {
    // The keep houses nobody: it is a storehouse. Every person in the hold came
    // out of a house, which is why the first house is free — the same rule the
    // camps live by, where every digger came out of a hut.
    let cap = B.start.keep_people || 0;
    // The best roof on the map sets how fast people come to the hold at all.
    let best = 0;
    for (const b of _hold.buildings) {
      if (b.built < 1) continue;
      if (b.type === 'workshop') {
        // A workshop forges rounds out of iron and stacks them on its own floor.
        // Nothing arrives in the keep by itself: somebody has to carry it, which
        // is why a workshop out by the mine is a decision and not just a spot.
        const room = _lv('workshop', b.lvl, 'stock') - (b.ammo || 0);
        if (room > 0) {
          const per  = _lv('workshop', b.lvl, 'iron_per_ammo');
          let made   = _lv('workshop', b.lvl, 'rate') * dt;
          if (made > room) made = room;
          if (per > 0) made = Math.min(made, (_hold.iron || 0) / per);
          if (made > 0) {
            _hold.iron = Math.max(0, (_hold.iron || 0) - made * per);
            b.ammo = (b.ammo || 0) + made;
          }
        }
      } else if (b.type === 'house') {
        cap += _houseCap(b.lvl);
        if (b.lvl > best) best = b.lvl;
      } else if (b.type === 'barracks') {
        const max = _lv('barracks', b.lvl, 'soldiers');
        const mine = _hold.soldiers.filter(s => s.from === b.id).length;
        if (mine < max) {
          b._sp = (b._sp || 0) + dt;
          const every = _muster(b.lvl);
          // A soldier walks out armed, and the hold pays for the arms: a spear
          // at first, iron once the barracks is worth having. With nothing to
          // arm him with, nobody goes.
          const squad = _armCost(b.lvl), arm = {};
          for (const res in squad) arm[res] = squad[res] / max;
          if (b._sp >= every && _canPay(arm)) {
            b._sp = 0;
            _pay(arm);
            const shp = _lv('barracks', b.lvl, 'hp_soldier');
            _hold.soldiers.push({
              x: b.x + (Math.random() - 0.5) * 30, y: b.y + (Math.random() - 0.5) * 30,
              hp: shp, maxHp: shp, dmg: _lv('barracks', b.lvl, 'damage'), from: b.id,
              // Where on the ring he starts and how wide his own circuit is, so
              // a garrison spreads round the hold instead of marching in file.
              pa: Math.random() * Math.PI * 2, pr: 0.9 + Math.random() * 0.2,
            });
          }
        }
      }
    }

    // People are hired by the houses, not placed by the player: a house is the
    // decision, the person is the consequence — and the house is the whole
    // price of it. Nobody is charged for by the head afterwards, so timber that
    // is lying in the store stays there until the player spends it.
    _hold._cap = cap;
    if (_hold.workers.length < cap) {
      // Time is banked up to one arrival and no further, so a hold that has
      // just built its first house does not fill it the same second.
      // And the better the best house, the sooner the next arrival: a deep
      // house is worth more than a wide one twice over, in room and in speed.
      const every = _lv('house', best || 1, 'spawn');
      // An empty hold does not wait: there is nobody to wait with. The first
      // roof of the game is answered on the spot, and so is the roof of a hold
      // whose last person has been killed — waiting half a minute at a hold
      // that cannot act is not difficulty, it is a blank screen.
      if (!_hold.workers.length) _hold._hire = every;
      _hold._hire = Math.min((_hold._hire || 0) + dt, every);
      if (_hold._hire >= every) {
        _hold._hire = 0;
        const keep = _keep();
        _hold.workers.push({ x: keep.x + (Math.random() - 0.5) * 40,
                             y: keep.y + (Math.random() - 0.5) * 40,
                             hp: B.worker.hp, job: null });
      }
    } else {
      _hold._hire = 0;
    }
  }

  // Room for rounds in the keep, which is the only place the hold stores them.
  function _ammoCap() {
    const keep = _keep();
    return _keepStore(keep ? keep.lvl : 1);
  }

  // ── People ────────────────────────────────────────────────────────────────
  // Four things a hold can be told, and only one of them is an opinion.
  //
  // The three narrow ones are orders: everybody drops everything else and does
  // that, which is the point of giving one — 🔨 Build means the whole hold
  // throws itself at the scaffolding, 🎯 Arm means every pair of hands is
  // running rounds to the towers, and nothing else happens meanwhile.
  //
  // ⚖ Balanced is the opinion: nobody is told anything, and each person looks
  // at the hold and picks the job it is shortest of. That is where the game
  // normally lives; the orders are for the minute you need one thing now.
  const PRIORITIES = ['balanced', 'build', 'gather', 'ammo'];
  const JOB_OF = { build: 'build', gather: 'mine', ammo: 'ammo' };

  function _people(dt) {
    const speed = B.worker.speed;
    // Nothing in a hold attacks a digger except a raider who caught up with
    // one, and until now nothing mended him afterwards either: a soldier has a
    // barracks to go back to, a person has nowhere. So a scratch taken in the
    // first raid of the game was still over his head at the end of it, which
    // reads as somebody permanently broken rather than somebody who had a bad
    // afternoon — and it left the player looking for a wound nobody had just
    // taken. They mend where they stand now, on their own time, and only once
    // the map is quiet: being chased is not when anybody gets better.
    const mend = _raiders.length ? 0 : (B.worker.mend || 0.017) * B.worker.hp * dt;
    for (let i = _hold.workers.length - 1; i >= 0; i--) {
      const w = _hold.workers[i];
      if (mend && w.hp != null && w.hp < B.worker.hp)
        w.hp = Math.min(B.worker.hp, w.hp + mend);
      // Deciding comes before running. A hold under attack used to deadlock
      // here: everybody was close enough to a raider to be frightened, being
      // frightened cleared the job, and a person without a job never got as far
      // as volunteering to reload the tower that would have driven the raiders
      // off. Now they work out what they would be doing first, and only then
      // decide whether they dare — because whether it is worth standing your
      // ground depends entirely on what you were about to do.
      // Work nobody can get to. A wall closed round a site, or a corner with
      // built wall on both sides of it, leaves an errand that can be started
      // and never finished — and a person who has taken one would otherwise
      // stand against that wall for the rest of the game. Long enough without
      // getting any nearer and they give it up, leave it alone for a while and
      // find something else; somebody on the other side may be able to reach it.
      if (w._skipFor > 0 && (w._skipFor -= dt) <= 0) { w._skip = null; w._skipDep = null; }
      _checkWedged(w, dt);
      if (w.job && (w._stall || 0) > GIVE_UP) _giveUp(w);
      if (!w.job) _assignJob(w);
      if (_flee(w, dt, speed)) continue;
      if (!w.job) { _idle(w, dt, speed); continue; }

      if (w.job === 'build')      _doBuild(w, dt, speed);
      else if (w.job === 'mine')  _doMine(w, dt, speed);
      else if (w.job === 'ammo')  _doAmmo(w, dt, speed);
    }
    _elbowRoom();
  }

  // Two people sent to the same site walk the same line to it and end up on the
  // same pixel, and then one of them has simply vanished as far as anyone
  // watching is concerned. They keep an elbow's room from each other instead.
  function _elbowRoom() {
    const ws = _hold.workers, gap = 20;
    for (let i = 0; i < ws.length; i++) {
      for (let j = i + 1; j < ws.length; j++) {
        const a = ws[i], b = ws[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= gap) continue;
        if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy) || 1; }
        const push = (gap - d) / 2;
        // Room is made sideways, never into a wall. Shoving somebody into a
        // building only to have it push them straight back out is how two
        // people end up shivering against a house for the rest of the game.
        _nudge(a, -(dx / d) * push, -(dy / d) * push);
        _nudge(b, (dx / d) * push, (dy / d) * push);
      }
    }
  }

  // Move somebody by this much unless it would put them inside something. What
  // they are already standing in does not count: a builder is meant to be at
  // its own site, and refusing to shift it there would leave two people on the
  // same pixel, which is the whole thing this is for.
  function _nudge(p, ox, oy) {
    const here = _solidAt(p.x, p.y, null);
    if (_solidAt(p.x + ox, p.y + oy, here)) return;
    p.x += ox; p.y += oy;
  }

  // How long somebody keeps trying to get somewhere they are not getting any
  // nearer to before they call it impossible, and how long they then leave that
  // one job alone. Long enough that walking the length of a wall to get round
  // it is never mistaken for being stuck.
  const GIVE_UP = 9, LEAVE_ALONE = 25;
  // How long a person is watched before deciding they are not walking at all,
  // and how little ground they have to have covered in that time to count. Not
  // measured frame by frame: somebody wedged in a corner still shivers there a
  // pixel at a time, and that shivering is exactly what has to be caught.
  const WEDGE_WATCH = 6, WEDGE_MOVED = 10;

  function _checkWedged(w, dt) {
    w._anchorT = (w._anchorT || 0) + dt;
    if (w._anchorX == null) { w._anchorX = w.x; w._anchorY = w.y; }
    if (w._anchorT < WEDGE_WATCH) return;
    const went = Math.hypot(w.x - w._anchorX, w.y - w._anchorY);
    w._anchorT = 0; w._anchorX = w.x; w._anchorY = w.y;
    // Six seconds, nowhere covered, and still not where they were going. Note
    // that somebody resting between errands counts as arrived — standing at the
    // spot you chose to stand at is not being stuck.
    if (went < WEDGE_MOVED && !w._arrived) _unwedge(w);
  }

  // Somebody walled into a pocket with no way out of it — the gap they walked
  // in through was built up behind them, or the hold is an old one from before
  // buildings were made to leave a person's width between them. They climb out
  // to the nearest clear ground rather than stand there for the rest of the
  // game, because a figure that never moves again reads as a broken game and
  // not as a mistake the player made with a wall.
  // Climbing out is about where they stand, not about the errand: nothing of
  // the errand is forgotten here, neither the tally of getting nowhere nor the
  // nearest they have ever been to it. Somebody leaning on a wall with no way
  // round shuffles a pixel at a time, is fished out every few seconds and walks
  // straight back to the same spot — and walking back is not getting nearer
  // than he has already been, so it buys him no more patience. Forgetting here
  // is how he comes to lean on that wall for the rest of the game.
  function _unwedge(w) {
    for (let ring = 30; ring <= 150; ring += 20) {
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2 + ring;
        const x = w.x + Math.cos(ang) * ring, y = w.y + Math.sin(ang) * ring;
        if (!_solidAt(x, y, null)) { w.x = x; w.y = y; return; }
      }
    }
    const keep = _keep();
    if (keep) { w.x = keep.x; w.y = keep.y + _clearance(keep) + 4; }
  }


  // Drop an errand that cannot be finished. Whatever is in hand goes back where
  // it came from: the hold has already paid for those rounds, and timber that
  // vanished because the way home was walled off is exactly the kind of loss
  // nobody can see happening and everybody notices afterwards.
  function _giveUp(w) {
    if (w.carry > 0) {
      if (w.job === 'ammo') _hold.ammo = Math.min(_ammoCap(), (_hold.ammo || 0) + w.carry);
      else if (w.res) _hold[w.res] = (_hold[w.res] || 0) + w.carry;
    }
    // Exactly the thing they could not get to, which is the leg they were on
    // and not necessarily the job's target: a carrier can reach the workshop
    // perfectly well and still find no way back to the keep.
    const leg = typeof w._leg === 'string' ? w._leg : '';
    w._skip    = leg[0] === 'b' ? +leg.slice(1) : null;
    w._skipDep = leg[0] === 'd' ? +leg.slice(1) : null;
    w._skipFor = LEAVE_ALONE;
    w.job = null; w.dep = null; w.carry = 0; w.phase = null;
    w._leg = null; w._near = null; w._stall = 0;
  }

  // People are not soldiers. Raiders anywhere near and they drop what they are
  // doing and run for the keep — which is what makes a quarry on the far side
  // of the map a decision and not just a longer walk.
  function _flee(w, dt, speed) {
    const foe = _nearest(w, _raiders);
    if (!foe) return false;
    // How close a raider has to get before this person gives up on what they
    // are doing. Somebody running rounds to a tower holds their nerve almost to
    // the last step — that errand is what ends the raid, and a hold whose
    // carriers all bolted is a hold whose towers stay empty until it falls.
    const nerve = (w.job === 'ammo' && w.toTower) ? 40 : 130;
    if (_dist(w, foe) > nerve) return false;

    // They run from the raider, not to the keep. Running to the keep was the
    // deadlock: a raider standing at the keep put every person inside its
    // nerve range at once, and each of them dropped their job every frame to
    // flee to the spot they were already standing on — the whole hold asleep
    // in a heap while the walls came down, and no order the player gave could
    // change it, because the fleeing ran after the deciding and undid it.
    //
    // Away from the raider is a direction that always exists. Once they are
    // out of its reach the fear is over, _flee stops answering, and they pick
    // up a job again on their own — which is the whole behaviour: run while it
    // is near, work as soon as it is not.
    w.job = null;
    const a  = Math.atan2(w.y - foe.y, w.x - foe.x);
    const to = { x: w.x + Math.cos(a) * 200, y: w.y + Math.sin(a) * 200 };
    // Not past the edge of the world, and not out into open ground when the
    // keep is a safer place to put their back to: given the choice of two
    // directions away, they take the one that keeps them inside the hold.
    const keep = _keep();
    if (keep && _dist(foe, keep) > nerve) {
      to.x = keep.x; to.y = keep.y;
    }
    to.x = Math.max(20, Math.min(W() - 20, to.x));
    to.y = Math.max(20, Math.min(W() - 20, to.y));
    _walk(w, to, dt, speed * 1.1, 6, true);
    return true;
  }

  // What one person decides to do next. Nobody is handed a job by the hold —
  // everyone works out for themselves what is worth doing, and the only thing
  // the player's order changes is which questions they are allowed to ask.
  function _assignJob(w) {
    const pri = _hold.priority || 'balanced';

    if (pri !== 'balanced') {
      // An order is an order: try the one thing, and if there is genuinely
      // nothing of it to do, stand around rather than quietly doing something
      // else. That is what makes an order readable — the hold does what it was
      // told, including nothing.
      const only = JOB_OF[pri];
      if (_take(w, only)) return;
      w.job = null;
      return;
    }

    // Balanced: score every job this person could start right now and take the
    // best one. Scores are "how badly does the hold want this", so two people
    // rarely reach the same conclusion — the second one sees the first already
    // on it and finds the next-most-wanted thing instead.
    //
    // Wanting something is not the same as being able to do it: the hold can be
    // desperate for timber while its only lumber camp is still scaffolding. So
    // the whole list is walked in order of preference and the first job that
    // can actually be started wins. Standing idle is the last answer, not the
    // second one.
    const ranked = ['build', 'ammo', 'mine']
      .map(kind => ({ kind: kind, score: _score_job(w, kind) }))
      .filter(o => o.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const o of ranked) if (_take(w, o.kind)) return;
    w.job = null;
  }

  // How much the hold wants one more person on this kind of work, given who is
  // already on it. Every extra pair of hands on the same job is worth less than
  // the last, which is the whole of why they spread out instead of swarming.
  function _score_job(w, kind) {
    const busy = _hold.workers.filter(x => x !== w && x.job === (kind === 'mine' ? 'mine' : kind)).length;
    const crowding = 1 / (1 + busy);

    if (kind === 'build') {
      const sites = _buildSites();
      if (!sites.length) return 0;
      const alone = (b) => !_hold.workers.some(x => x !== w && x.job === 'build' && x.target === b.id);
      // Scaffolding standing with nobody on it is the most wasteful thing in a
      // hold: it has already been paid for and it is doing nothing.
      const raw = sites.filter(b => b.built < 1 || b.up != null);
      if (raw.length) return (raw.some(alone) ? 3.2 : 1.4) * crowding;
      // Only mending left, and that is worth what is missing: a wall with a
      // scratch on it is not a reason to stop cutting timber, a keep at a third
      // of its health is a reason to stop everything.
      const worst = Math.max.apply(null, sites.filter(alone).map(_hurt).concat(0));
      return worst <= 0 ? 0 : (0.5 + 2.7 * worst) * crowding;
    }

    if (kind === 'ammo') {
      const t = _ammoTask(w);
      if (!t) return 0;
      // A tower with an empty magazine is a tower that is not firing, and that
      // is worth more the closer the raiders are. With a raid actually on the
      // map this outruns everything else a person could be doing: no amount of
      // timber wins a fight, and a hold that keeps mining through a raid loses
      // the buildings it was mining for.
      const urgent = t.toTower ? (t.tower.ammo || 0) < _volley(t.tower.lvl) : false;
      let s = t.toTower ? (urgent ? 3.6 : 1.8) : 1.5;
      if (_raiders.length) s *= t.toTower ? 4 : 2.2;
      return s * crowding;
    }

    // Gathering is worth how short the hold is of the material it would run out
    // of first — but only counting materials there is still ground for. Nothing
    // has to be built to work a forest: a person walks to it, cuts, and carries
    // it home, which is why where the deposits lie is the map's whole opening
    // question and not a place to put a building.
    const res = _byNeed().find(r => _hold.deposits.some(d => d.kind === r && d.amount > 0));
    if (!res) return 0;
    const want = _demand()[res] || 0;
    const have = _hold[res] || 0;
    if (!want) return 0.6 * crowding;
    // Never quite zero: there is always something worth building next, and the
    // stockpile is what pays for it.
    return (0.7 + 2.7 * Math.max(0, Math.min(1, (want - have) / want))) * crowding;
  }

  // Actually start a job of this kind, or say there was none to start.
  function _take(w, kind) {
    if (kind === 'build') {
      // Prefer a site nobody is on: two people on one wall while another site
      // stands empty is the one thing a hold should never do.
      let sites = _buildSites().filter(b => b.id !== w._skip);
      if (!sites.length) return false;
      // Something half built beats something already standing that only wants
      // patching: the hold paid for the scaffolding and gets nothing until it
      // is finished, while a damaged building is still doing its work.
      const raw = sites.filter(b => b.built < 1 || b.up != null);
      if (raw.length) sites = raw;
      const free = sites.filter(b => !_hold.workers.some(x => x !== w && x.job === 'build' && x.target === b.id));
      const site = _nearest(w, free.length ? free : sites);
      if (!site) return false;
      w.job = 'build'; w.target = site.id; w.phase = 'walk';
      return true;
    }

    if (kind === 'mine') {
      // Which material, nobody says: they go for whatever the hold would run
      // out of first, and fall back to whatever else there is still ground for.
      //
      // Which patch is a price, not a rule. The errand is the whole round trip
      // — out to the ground and back with the load — so both halves are paid
      // for, and somebody already digging there is a cost rather than a
      // disqualification. That last part matters: treating a taken patch as
      // out of bounds sent the second person across the map while the first
      // one stood on wood fifty paces from the keep. Sharing near ground beats
      // walking to empty ground, until enough people are on it that it doesn't.
      const keep  = _keep();
      const share = (B.worker && B.worker.share_penalty) || 300;
      for (const res of _byNeed()) {
        const all = _hold.deposits.filter(
          d => d.kind === res && d.amount > 0 && d.id !== w._skipDep);
        if (!all.length) continue;
        let q = null, best = Infinity;
        for (const d of all) {
          const on = _hold.workers.filter(
            x => x !== w && x.job === 'mine' && x.dep === d.id).length;
          const cost = _dist(w, d) + (keep ? _dist(keep, d) : 0) + share * on;
          if (cost < best) { best = cost; q = d; }
        }
        if (q) {
          w.job = 'mine'; w.dep = q.id; w.target = null;
          w.phase = 'walk'; w.carry = 0; w.t = 0;
          return true;
        }
      }
      return false;
    }

    if (kind === 'ammo') {
      const t = _ammoTask(w);
      if (!t) return false;
      w.job = 'ammo'; w.carry = 0; w.phase = 'pickup';
      w.source = t.source.id;
      w.target = t.target.id;
      w.toTower = !!t.toTower;
      return true;
    }
    return false;
  }

  // Carrying rounds is two different errands and the hold needs both: bringing
  // what the workshops have forged home to the keep, and running what the keep
  // has out to a tower that is dry. Whichever is worth doing, nearest first.
  function _ammoTask(w) {
    // A round is carried one at a time, so a tower that is five short is five
    // errands and not one. What limits how many people are on it is how many
    // rounds there actually are to move — never a headcount, or a hold told to
    // arm itself would stand and watch one person do all the walking.

    // Rounds already promised to somebody: out of the store on their way to a
    // tower, or on their way home and about to want room in the store.
    const outbound = _hold.workers.filter(x => x !== w && x.job === 'ammo' && x.toTower).length;
    const inbound  = _hold.workers.filter(x => x !== w && x.job === 'ammo' && !x.toTower).length;

    // A tower that wants filling, if there is anything in the keep to fill it
    // with. This is the errand that keeps a hold alive during a raid.
    const store = Math.floor(_hold.ammo || 0) - outbound;
    if (store >= 1) {
      let best = null, worst = 1;
      for (const b of _hold.buildings) {
        if (b.type !== 'tower' || b.built < 1 || b.keep || b.id === w._skip) continue;
        const mag = _lv('tower', b.lvl, 'mag');
        // What it is short by, to the nearest whole round — the same rounding
        // the number under the tower is written with. Flooring it left every
        // tower that had ever fired a fraction short for the rest of the game:
        // a magazine holding 6.4 of 7 is one round short to anybody looking at
        // it, but floor(0.6) is no errand at all, so nobody ever set out and it
        // read 6/7 for ever. The last delivery pours in only what fits and
        // walks the remainder back, so asking for the round that finishes it
        // costs nothing.
        const short = Math.round(mag - (b.ammo || 0));
        if (short < 1) continue;
        const coming = _hold.workers.filter(
          x => x !== w && x.job === 'ammo' && x.toTower && x.target === b.id).length;
        if (coming >= short) continue;      // enough is already walking to it
        const f = (b.ammo || 0) / mag;      // the emptiest tower first
        if (f < worst) { worst = f; best = b; }
      }
      if (best) return { source: _keep(), target: best, tower: best, toTower: true };
    }

    // Otherwise: a workshop with finished rounds on its floor and room for them
    // in the keep. Without this nobody ever has anything to run to a tower.
    // Room in the keep, rounded for the same reason the tower's shortfall is:
    // a store reading 22 of 23 with a fraction of a round in hand is a store
    // with room in it, and flooring that stopped the workshops being emptied
    // for good the first time anything was fired.
    const room = Math.round(_ammoCap() - (_hold.ammo || 0)) - inbound;
    if (room >= 1) {
      const full = _hold.buildings.filter(b => {
        if (b.type !== 'workshop' || b.built < 1 || b.id === w._skip) return false;
        const waiting = Math.min(Math.floor(b.ammo || 0), room);
        const coming = _hold.workers.filter(
          x => x !== w && x.job === 'ammo' && !x.toTower && x.source === b.id).length;
        return waiting > coming;
      });
      const shop = _nearest(w, full);
      if (shop) return { source: shop, target: _keep(), toTower: false };
    }
    return null;
  }

  // Everything a person could pick up a hammer for: scaffolding, an upgrade
  // half done, and anything a raid left standing but broken. Patching a wall
  // back up is the same work as putting it there, so it is the same job.
  function _buildSites() {
    return _hold.buildings.filter(b => b.built < 1 || b.up != null || _hurt(b));
  }

  // How much of a building is missing, as a fraction. Anything under a hair is
  // nothing: rounding at the last pixel of health would leave people patching
  // an untouched wall for ever.
  function _hurt(b) {
    const max = _maxHp(b.type, b.lvl, b.keep);
    return b.hp < max - 0.5 ? (max - b.hp) / max : 0;
  }

  // Everything the hold could pay for next, as a list of prices rather than one
  // heap: arms for whatever the barracks keep sending out, the next level of
  // everything already standing, and the iron a workshop eats. How much of a
  // material the hold wants and how much of it is actually standing in the way
  // are two different questions, and the second one can only be asked of a
  // price at a time — see _byNeed.
  function _wants() {
    const list = [];
    // Another house is always a thing the hold could want, and it is what
    // makes timber worth carrying before anything else is standing.
    list.push({ cost: _newCost('house'), w: 0.5 });
    for (const b of _hold.buildings) {
      if (b.built < 1) continue;
      if (!_atMax(b.lvl)) list.push({ cost: _cost(b.type, b.lvl + 1), w: 0.5 });
      // Arms are spent again at every sortie, so they weigh more than a
      // one-off upgrade: an army that cannot be armed is the worst shortage
      // a hold can have.
      if (b.type === 'barracks') list.push({ cost: _armCost(b.lvl), w: 4 });
      // So is the iron a workshop eats. Rounds are burned every raid and never
      // come back, so a hold that stops digging iron stops shooting — and the
      // people have to be able to see that coming, not discover it dry.
      if (b.type === 'workshop') {
        const per = _lv('workshop', b.lvl, 'iron_per_ammo');
        list.push({ cost: { iron: _lv('workshop', b.lvl, 'stock') * per }, w: 5 });
      }
    }
    return list;
  }

  // What the hold could spend next, added up per material. This is how much
  // there is left to want, and it is what decides whether going out is worth
  // anybody's time at all — not which material they go out for.
  function _demand(list) {
    const want = { wood: 0, stone: 0, iron: 0 };
    for (const it of (list || _wants()))
      for (const res in it.cost) want[res] += it.cost[res] * it.w;
    return want;
  }

  // The materials, whichever is most in the way first. Nobody is told to fetch
  // wood or iron — this is how the people work out for themselves which one the
  // hold is stuck for.
  //
  // Being in the way is not the same as being wanted, and the difference is the
  // whole of this. Adding every price up and going after whatever came to the
  // biggest number sent a grown hold out for timber for the rest of the game:
  // every upgrade left on the board is priced in hundreds of wood against a
  // hundred-odd iron, so wood wins that sum for ever — while the hold stands on
  // nine hundred timber it cannot spend, because iron is the only thing any of
  // it is actually waiting on. A price the hold can already pay is not a
  // shortage. So each price is asked only what it is still missing, whatever
  // is covered counts for nothing, and what is left is the real answer to "what
  // is stopping us".
  //
  // Counted in journeys rather than in units: what being short of something
  // costs is the walking it takes to put right, and iron comes home four at a
  // time where timber comes eight and from further out.
  function _byNeed() {
    const list = _wants();
    const miss = { wood: 0, stone: 0, iron: 0 };
    for (const it of list) {
      for (const res in it.cost) {
        const gap = it.cost[res] - (_hold[res] || 0);
        if (gap > 0) miss[res] += (gap / (_gat(res).load || 1)) * it.w;
      }
    }
    // Nothing missing anywhere — everything on the board is affordable. Then it
    // is the old question again, which is simply what there is most left to
    // spend, so a hold that is on top of its purchases keeps stocking up for
    // the ones after them instead of standing on whichever pile is biggest.
    const want = _demand(list);
    return RESOURCES.slice().sort((a, b) =>
      (miss[b] - miss[a]) ||
      ((want[b] - (_hold[b] || 0)) - (want[a] - (_hold[a] || 0))));
  }

  // Work done on a site, whoever did it. Returns true when the site is finished
  // and whoever was working on it needs a new job.
  // How fast a broken building comes back compared with how fast it went up.
  // Mending is quicker than building: the stone is already there and stacked,
  // it is only back in the wrong place.
  const REPAIR_RATE = 1.6;

  function _progress(b, secs) {
    const step = secs / _bc(b.type).build;
    if (b.built < 1) {
      b.built = Math.min(1, b.built + step);
      if (b.built < 1) return false;
      _hold.stats.built = (_hold.stats.built || 0) + 1;
      _burst(b.x, b.y, '#a6e3a1', 10);
      _sfx('build', b.x, b.y);
      return true;
    }
    if (b.up != null) {
      // An upgrade is built on a building that keeps working while they do it,
      // and it goes slower for it.
      b.up = Math.min(1, b.up + step * 0.8);
      if (b.up < 1) return false;
      b.up = null;
      b.lvl += 1;
      b.hp = _maxHp(b.type, b.lvl, b.keep);
      _burst(b.x, b.y, '#f9e2af', 14);
      _sfx('up', b.x, b.y);
      return true;
    }
    // Patching up what a raid chewed on. Putting a building back to new takes
    // as long as putting it there did, so half a wall is half a wall's work,
    // and the materials are already in it — this costs the hold nothing but
    // the hands. There is no keeping the damage: a hold that could never mend
    // anything is a hold that only ever gets worse.
    const max = _maxHp(b.type, b.lvl, b.keep);
    if (b.hp < max - 0.5) {
      b.hp = Math.min(max, b.hp + step * max * REPAIR_RATE);
      if (b.hp < max - 0.5) return false;
      b.hp = max;
      _burst(b.x, b.y, '#a6e3a1', 8);
    }
    return true;
  }

  function _doBuild(w, dt, speed) {
    const b = _byId(w.target);
    if (!b || (b.built >= 1 && b.up == null && !_hurt(b))) { w.job = null; return; }
    // Near enough to work on it — from the corner too, which is the only way in
    // to a wall piece with finished wall on both sides of it.
    if (!_walk(w, b, dt, speed, _reachTo(b), true)) return;
    if (_progress(b, dt * B.worker.build_rate)) w.job = null;
  }

  function _doMine(w, dt, speed) {
    const dep = _depById(w.dep);
    if (!dep || dep.amount <= 0) { w.job = null; w.dep = null; return; }

    if (w.phase === 'walk') {
      if (_walk(w, dep, dt, speed, _depReach(dep), true)) { w.phase = 'mine'; w.t = 0; }
      return;
    }
    if (w.phase === 'mine') {
      w.t += dt;
      const g = _gat(dep.kind);
      if (w.t >= g.time) {
        const load = Math.min(g.load, dep.amount);
        _drain(dep, load);
        w.carry = load;
        w.res = dep.kind;
        w.phase = 'home';
      }
      return;
    }
    const keep = _keep();
    if (_walk(w, keep, dt, speed, _reachTo(keep), true)) {
      const res = w.res || 'wood';
      _hold[res] = (_hold[res] || 0) + (w.carry || 0);
      _float(keep.x, keep.y, (RES_GLYPH[res] || '📦') + ' ', w.carry, RES_TINT[res]);
      w.carry = 0;
      w.job = null;
    }
  }

  // One errand, two directions. `toTower` says which: rounds out of the keep to
  // a dry tower, or rounds off a workshop floor back to the keep. Rounds never
  // move on their own — every one of them is walked there by somebody.
  function _doAmmo(w, dt, speed) {
    const src = _byId(w.source);
    const dst = _byId(w.target);
    if (!src || !dst || dst.built < 1) { w.job = null; return; }

    if (w.phase === 'pickup') {
      if (!_walk(w, src, dt, speed, _reachTo(src), true)) return;
      // Out of the keep's store, or off the workshop's own floor.
      const have = w.toTower ? Math.floor(_hold.ammo) : Math.floor(src.ammo || 0);
      // One round per trip, on both legs. An armful was impossible to follow:
      // five left the store, one fitted into a level-one magazine and four
      // walked back, so the store read 10, then 5, then 9 and none of it was
      // visible on the map. One out, one in, and every number on screen moves
      // by exactly what somebody is carrying.
      const take = Math.min(1, have);
      if (take <= 0) { w.job = null; return; }
      if (w.toTower) _hold.ammo -= take; else src.ammo -= take;
      w.carry = take;
      w.phase = 'deliver';
      return;
    }

    if (!_walk(w, dst, dt, speed, _reachTo(dst), true)) return;
    if (w.toTower) {
      const mag  = _lv('tower', dst.lvl, 'mag');
      const room = Math.max(0, mag - (dst.ammo || 0));
      const put  = Math.min(room, w.carry || 0);
      dst.ammo = (dst.ammo || 0) + put;
      _float(dst.x, dst.y, JOB_GLYPH.ammo + ' ', put, RES_TINT.ammo);
      // What the tower had no room for goes back into the store — but the
      // store is the keep's own magazine now, with a ceiling of its own, so
      // this cannot be a plain refund. These rounds came out of that store a
      // moment ago and the room they left is still there, so they always fit;
      // the clamp is only here so no path can ever push it over its own limit.
      const back = (w.carry || 0) - put;
      _hold.ammo = Math.min(_ammoCap(), (_hold.ammo || 0) + back);
    } else {
      // Into the keep, as far as there is room for it. Anything that will not
      // fit stays on the workshop floor rather than evaporating.
      const room = Math.max(0, _ammoCap() - (_hold.ammo || 0));
      const put  = Math.min(room, w.carry || 0);
      _hold.ammo = (_hold.ammo || 0) + put;
      _float(dst.x, dst.y, JOB_GLYPH.ammo + ' ', put, RES_TINT.ammo);
      src.ammo = (src.ammo || 0) + ((w.carry || 0) - put);
    }
    w.carry = 0;
    w.job = null;
  }

  function _idle(w, dt, speed) {
    // Nothing to do: drift around the keep rather than stand in a heap.
    if (!w.rest || w.rest <= 0) {
      const keep = _keep();
      const a = Math.random() * Math.PI * 2;
      w.wx = keep.x + Math.cos(a) * (50 + Math.random() * 90);
      w.wy = keep.y + Math.sin(a) * (50 + Math.random() * 90);
      w.rest = 3 + Math.random() * 4;
    }
    w.rest -= dt;
    _walk(w, { x: w.wx, y: w.wy }, dt, speed * 0.55, 8, true);
  }

  // ── Soldiers ──────────────────────────────────────────────────────────────
  // Where the guard walks when there is nobody to fight: a ring outside
  // everything that has been built. A soldier standing in the middle of his own
  // hold guards nothing and sees a raid the moment it is already inside.
  const PATROL_MIN = 165, PATROL_PAD = 60, PATROL_STEP = 0.32, PATROL_GIVE = 3;
  function _patrolRing() {
    const keep = _keep();
    if (!keep) return PATROL_MIN;
    let far = 0;
    for (const b of _hold.buildings) far = Math.max(far, _dist(keep, b) + _bc(b.type).size);
    return Math.max(PATROL_MIN, Math.min(far + PATROL_PAD, W() / 2 - 70));
  }

  // How far past his beat a guard will follow a raider. A raid is somebody
  // else's business only until it is inside the hold, and by then it is his
  // however far away it started — a guard who keeps walking his rounds while
  // the far side of the hold is being chewed on is worse than no guard.
  const CHASE_OUT = 220;
  // Whichever raider is doing the most harm right now: the one deepest inside
  // the hold, and among equals the one nearest to hand. Distance from the keep
  // counts for less than distance from the guard, so five men do not all cross
  // the map past a raider each to reach the same one.
  function _threat(s, keep, ring) {
    let best = null, bd = Infinity;
    for (const r of _raiders) {
      const inside = keep ? _dist(keep, r) : 0;
      if (inside > ring + CHASE_OUT) continue;
      const d = _dist(s, r) + inside * 0.4;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // Being hurt is not a thing that wears off by itself: a soldier who has been
  // in a fight goes back to the barracks that armed him and is patched up
  // there. Only when there is nothing left to fight — a wounded man walking off
  // a raid is deserting it.
  const HEAL_RATE = 0.05, HEAL_UNTIL = 0.999;

  // The barracks he came out of, or — if it has been knocked down under him —
  // any other one still standing. Without a barracks there is nowhere to be
  // patched up, and he walks his rounds hurt.
  function _home(s) {
    let mine = null, other = null;
    for (const b of _hold.buildings) {
      if (b.type !== 'barracks' || b.built < 1) continue;
      if (b.id === s.from) mine = b;
      else if (!other || _dist(s, b) < _dist(s, other)) other = b;
    }
    return mine || other;
  }

  function _soldiers(dt) {
    const keep = _keep();
    const ring = _patrolRing();
    for (let i = _hold.soldiers.length - 1; i >= 0; i--) {
      const s = _hold.soldiers[i];
      const foe = _threat(s, keep, ring);
      const hurt = s.maxHp && s.hp < s.maxHp * HEAL_UNTIL;
      const home = !foe && hurt ? _home(s) : null;
      s.fighting = !!foe;
      s.healing = !!home;
      if (foe) {
        // Wherever the fight leaves him, his rounds start again from there.
        s.pa = null;
        if (_walk(s, foe, dt, 78, 18, true)) {
          foe.hp -= s.dmg * dt;
          if (foe.hp <= 0) _killRaider(foe);
        }
      } else if (home) {
        // He is counted as hurt until he is whole again, so nobody turns back
        // to the beat half mended — and a raid takes him off it at once,
        // however little of him is left.
        s.pa = null;
        if (_walk(s, home, dt, 60, _reachTo(home), true)) {
          s.hp = Math.min(s.maxHp, s.hp + s.maxHp * HEAL_RATE * dt);
          // Mended means mended. The last sliver is rounded off rather than
          // left there, because a man who counts as whole and still carries a
          // wound mark over his head is telling the player something untrue.
          if (s.hp >= s.maxHp * HEAL_UNTIL) s.hp = s.maxHp;
        }
      } else if (keep) {
        if (s.pa == null) s.pa = Math.atan2(s.y - keep.y, s.x - keep.x);
        if (s.pr == null) s.pr = 0.9 + Math.random() * 0.2;   // no two on one line
        const R = ring * s.pr;
        const at = { x: keep.x + Math.cos(s.pa) * R, y: keep.y + Math.sin(s.pa) * R };
        const there = _walk(s, at, dt, 46, 14, true);
        // Round he goes, one point at a time. Anything that will not let him
        // past is left behind by taking the next point instead: a patrol that a
        // hut can stop is not a patrol.
        if (there || (s._stall || 0) > PATROL_GIVE) {
          s.pa += PATROL_STEP; s._stall = 0; s._near = null;
        }
      }
      if (s.hp <= 0) {
        _burst(s.x, s.y, '#f38ba8', 8);
        _sfx('fallen', s.x, s.y);
        _hold.soldiers.splice(i, 1);
      }
    }
  }

  // ── Towers ────────────────────────────────────────────────────────────────
  // What a tower may fire from. The keep is the storehouse, so it fires out of
  // the store itself rather than keeping a second pile of its own: one number
  // for the rounds that are in the keep, whether they are about to be fired or
  // about to be carried to a tower.
  const _mag   = (b) => b.keep ? (_hold.ammo || 0) : (b.ammo || 0);
  // What one volley takes out of it.
  const _volley = (lvl) => _lv('tower', lvl, 'ammo_per');
  const _spend = (b, n) => { if (b.keep) _hold.ammo -= n; else b.ammo -= n; };

  function _towers(dt) {
    for (const b of _hold.buildings) {
      if (b.type !== 'tower' || b.built < 1) continue;
      b._rl = (b._rl || 0) - dt;
      if (b._rl > 0) continue;
      // A grown tower throws a heavier round, so what one volley takes out of
      // the magazine is a property of the level as much as the damage is. It
      // is the reason a hold never outgrows the people carrying ammunition to
      // it, however deep its towers get.
      const takes = _volley(b.lvl);
      if (_mag(b) < takes) continue;

      const range = _lv('tower', b.lvl, 'range');
      const barrels = _barrels(b.lvl);
      const near = (p, q) => _dist(b, p) - _dist(b, q);
      const targets = _raiders
        .filter(r => _dist(b, r) <= range)
        .sort(near)
        .slice(0, barrels);
      // And then the diggers. A camp's people work whatever ground they find,
      // and the ground they find is increasingly the hold's own — a man with a
      // pick inside the range of a tower is carrying away what the hold was
      // going to spend, and the hold is not obliged to watch. Never in front of
      // a raider, though, and never with the last rounds in the magazine: a
      // tower that emptied itself on thieves is a tower that is not there when
      // the party arrives, so one full volley is always held back for them.
      const fxOf = new Map();
      if (targets.length < barrels && _mag(b) >= takes * 2) {
        const thieves = [];
        for (const f of _hold.factions)
          for (const u of f.workers)
            if (_dist(b, u) <= range) { thieves.push(u); fxOf.set(u, f.id); }
        thieves.sort(near);
        for (const u of thieves.slice(0, barrels - targets.length)) targets.push(u);
      }
      if (!targets.length) continue;

      // One volley, however many barrels the tower has grown: the barrels are
      // about how many it can answer at once, not how much it spends.
      _spend(b, takes);
      b._rl = _reload(b.lvl);
      _sfx('shot', b.x, b.y);
      const dmg = _lv('tower', b.lvl, 'damage');
      for (const tgt of targets) {
        _bullets.push({ x: b.x, y: b.y, target: tgt, dmg: dmg, life: 2.5,
                        fx: fxOf.has(tgt) ? fxOf.get(tgt) : null });
      }
      b.angle = Math.atan2(targets[0].y - b.y, targets[0].x - b.x);
    }
  }

  function _projectiles(dt) {
    for (let i = _bullets.length - 1; i >= 0; i--) {
      const p = _bullets[i];
      p.life -= dt;
      // A round in the air outlives nothing: whoever it was thrown at has to
      // still be standing where he was, whether he came to fight or to dig.
      const fac = p.fx == null ? null : _facById(p.fx);
      const standing = fac ? fac.workers.indexOf(p.target) !== -1
                           : _raiders.indexOf(p.target) !== -1;
      if (p.life <= 0 || !standing) { _bullets.splice(i, 1); continue; }
      const dx = p.target.x - p.x, dy = p.target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = 640 * dt;
      if (d <= step + 10) {
        p.target.hp -= p.dmg;
        // A bolt landing is a real blow and not a sliver, so it is written the
        // moment it lands, in the tower's own yellow rather than the red the
        // hold's losses are in: what a tower is worth per round is otherwise
        // guesswork, and it is the number a magazine is being filled for.
        _float(p.target.x, p.target.y - 12, '−', p.dmg, '#f9e2af');
        _burst(p.target.x, p.target.y, '#f9e2af', 3);
        _sfx('hit', p.target.x, p.target.y);
        _bullets.splice(i, 1);
        if (p.target.hp <= 0) {
          if (fac) _killThief(p.target, fac); else _killRaider(p.target);
        }
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
  }

  // ── Champions' powers ─────────────────────────────────────────────────────
  // What a raider actually hits for. Ordinarily his own damage; under a warlord
  // of his own camp, more — and it is asked rather than stored, because a party
  // that has walked out from under him, or whose champion has just fallen, is
  // an ordinary party again from that instant.
  const _rdmg = (r) => (r.dmg || 0) * (r._rally || 1);
  // And the same for a wall. The ram is the only one of them that treats a
  // building differently from a man.
  const _rsmash = (r) =>
    _rdmg(r) * (r.boss && r.power === 'breaker'
                ? ((_bs().breaker || {}).smash || 1) : 1);

  // Their bolts. The hold's rounds are _bullets and fly the other way; these
  // are their own list because everything about them differs — who threw them,
  // who they hurt, and what is left standing when they land.
  let _shots = [];

  function _bossPowers(dt) {
    for (const r of _raiders) { r._rally = 1; r._rush = 1; }
    for (const r of _raiders) {
      if (!r.boss || !r.power) continue;
      const lvl = r.blvl || 1;
      if (r.power === 'warlord') {
        // Men fight better with him watching. Nothing is written on them that
        // outlives the frame — see _rdmg.
        const c = _bs().warlord || {};
        const rad = c.radius || 190;
        for (const o of _raiders) {
          if (o.fx !== r.fx || _dist(r, o) > rad) continue;
          o._rally = Math.max(o._rally, c.damage || 1);
          o._rush  = Math.max(o._rush,  c.speed || 1);
        }
      } else if (r.power === 'shaman') {
        // Wounds closing as fast as a tower opens them. He mends himself too,
        // which is what makes a hold that ignores him regret it.
        const c = _bs().shaman || {};
        const rad = c.radius || 170;
        for (const o of _raiders) {
          if (o.fx !== r.fx || !o.maxHp || o.hp >= o.maxHp) continue;
          if (_dist(r, o) > rad) continue;
          o.hp = Math.min(o.maxHp, o.hp + o.maxHp * (c.heal || 0) * dt);
        }
      } else if (r.power === 'bolt') {
        const c = _bs().bolt || {};
        r._rl = (r._rl || 0) - dt;
        if (r._rl > 0) continue;
        const range = (c.range || 150) + (c.range_step || 0) * (lvl - 1);
        // People before buildings, and never a wall: a champion who could open
        // a hold from outside its own towers' reach would be a siege engine,
        // and the answer to a siege engine is a wall he cannot shoot.
        const near = (list) => {
          const in_ = list.filter(t => _dist(r, t) <= range);
          return in_.length ? _nearest(r, in_) : null;
        };
        const tgt = near(_hold.soldiers) || near(_hold.workers) ||
          near(_hold.buildings.filter(b => b.type !== 'wall' && b.built >= 1));
        if (!tgt) continue;
        const wait = c.reload || 2.6;
        r._rl = wait;
        _shots.push({ x: r.x, y: r.y, target: tgt, life: 3, fx: r.fx,
                      dmg: _rdmg(r) * wait * (c.hit || 1) });
        _sfx('bolt', r.x, r.y);
      }
    }
  }

  // Whether a thing thrown at the hold still has anything to land on.
  const _holdHas = (t) =>
    t.type ? _hold.buildings.indexOf(t) !== -1
           : (_hold.soldiers.indexOf(t) !== -1 || _hold.workers.indexOf(t) !== -1);

  // One of the hold's own, gone. Soldiers are cleared where they are walked —
  // see _soldiers — so this is people, and it is said out loud: they are
  // counted by looking at the map, and one fewer would otherwise simply have
  // gone missing.
  function _fallen(u) {
    const i = _hold.workers.indexOf(u);
    if (i === -1) return;
    _hold.workers.splice(i, 1);
    _burst(u.x, u.y, '#f38ba8', 10);
    _hold.stats.people_lost = (_hold.stats.people_lost || 0) + 1;
    _sfx('fallen', u.x, u.y);
    _say(_t('sh_lost_person'));
  }

  // A blow landing on the hold from something that is not standing next to it.
  // Written as one number rather than as a sliver, because it is one blow.
  function _hurtHold(tgt, dmg) {
    if (tgt.type) {
      tgt.hp -= dmg;
      _blow(tgt, tgt.x, tgt.y - 14, dmg);
      if (tgt.hp <= 0) _lose(tgt);
      return;
    }
    tgt.hp = (tgt.hp == null ? B.worker.hp : tgt.hp) - dmg;
    _float(tgt.x, tgt.y - 12, '−', dmg, '#f38ba8');
    if (tgt.hp <= 0) _fallen(tgt);
  }

  function _bossShots(dt) {
    for (let i = _shots.length - 1; i >= 0; i--) {
      const p = _shots[i];
      p.life -= dt;
      if (p.life <= 0 || !_holdHas(p.target)) { _shots.splice(i, 1); continue; }
      const dx = p.target.x - p.x, dy = p.target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = 520 * dt;
      if (d <= step + 10) {
        _shots.splice(i, 1);
        _burst(p.target.x, p.target.y, '#f38ba8', 3);
        _sfx('hit', p.target.x, p.target.y);
        _hurtHold(p.target, p.dmg);
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
  }

  // ── Raiders ───────────────────────────────────────────────────────────────
  function _raidersMove(dt) {
    for (let i = _raiders.length - 1; i >= 0; i--) {
      const r = _raiders[i];
      // Held up by somebody of another colour who was in the way. The hold is
      // still where he is going; it can wait until this is settled — see _meet.
      if (r._lock) continue;
      // Whatever is closest — but never a wall. A wall is not worth anything to
      // them: it holds nothing, makes nothing and lives nowhere. They come for
      // the hold, and they only ever start on a wall when one is between them
      // and what they came for, which is the whole point of building it. A raid
      // that stops to demolish a fence it could have walked round is a raid
      // doing the player a favour.
      //
      // People are chased only if they are nearly within reach. A raider is
      // slower than a frightened worker, so chasing one across the map is a
      // chase it can never win — and a raid that spent itself chasing was a
      // raid that never touched the hold, which left the map with permanent
      // raiders on it and every person permanently running. They came for the
      // buildings; the buildings are what they go for.
      const targets = _hold.buildings.filter(b => b.type !== 'wall').concat(
        _hold.soldiers,
        _hold.workers.filter(p => _dist(r, p) < 90));
      let tgt = _nearest(r, targets);
      if (!tgt) { tgt = _keep(); }
      if (!tgt) continue;

      // Near enough to hit it. A wall is a square, so its far corner is a good
      // deal further out than its side: measured as a circle, a raider coming at
      // one diagonally would stop short of a reach it can never make and walk up
      // and down the wall for ever instead of breaking it.
      const reach = tgt.type ? _reachTo(tgt) : 14;
      // Round it, or through it? Asked once a second, because it is a question
      // about the shape of the hold and not about this frame. A wall that adds
      // a few paces is walked round without a thought; one that means going all
      // the way about the map, or that has no way round at all, is what a wall
      // is for and is broken. Deciding to smash also turns the routing off:
      // somebody who has decided to come through the wall walks at the wall.
      r._routeT = (r._routeT || 0) - dt;
      // A ram does not ask. He came for the wall and he walks at it, which is
      // what makes him worth sending: his party arrives through the ring
      // instead of round it, at whatever piece was in front of him.
      if (r.boss && r.power === 'breaker') { r._straight = true; r._routeT = 1; }
      if (r._routeT <= 0) {
        const round = _routeLen(r, tgt, reach);
        if (round != null) {
          r._routeT = 1;
          r._straight = round > _dist(r, tgt) * DETOUR_MAX + DETOUR_SLACK;
        }
      }
      const there = _walk(r, tgt, dt, r.speed * (r._rush || 1), reach);
      // Not there, and no nearer for a while: something is in the way and going
      // round it is not working. Only now does the wall become worth breaking —
      // and only the piece actually standing between them and where they were
      // going, not the nearest one.
      if (!there && (r._stall || 0) > WALL_PATIENCE) {
        const inTheWay = _blocking(r, tgt);
        if (inTheWay) {
          const hit = _rsmash(r) * dt;
          inTheWay.hp -= hit;
          _blow(inTheWay, inTheWay.x, inTheWay.y - 14, hit);
          _sfx('clash', r.x, r.y);
          if (inTheWay.hp <= 0) { _lose(inTheWay); r._stall = 0; r._near = null; }
          continue;
        }
      }
      if (there) {
        if (tgt.type) {
          const hit = _rsmash(r) * dt;
          tgt.hp -= hit;
          _blow(tgt, tgt.x, tgt.y - 14, hit);
          _sfx('clash', r.x, r.y);
          if (tgt.hp <= 0) _lose(tgt);
        } else if (tgt.dmg) {                 // a soldier fights back
          tgt.hp -= _rdmg(r) * dt;
          r.hp   -= tgt.dmg * dt * 0.6;
          _sfx('clash', r.x, r.y);
          if (r.hp <= 0) { _killRaider(r); continue; }
        } else {                              // a worker only runs
          tgt.hp = (tgt.hp == null ? B.worker.hp : tgt.hp) - _rdmg(r) * dt;
          if (tgt.hp <= 0) _fallen(tgt);
        }
      }
    }
  }

  // How long a raider tries to get round something before deciding to go
  // through it. Long enough to walk the length of a short fence, short enough
  // that a ring around the whole hold does not keep them out for ever.
  const WALL_PATIENCE = 4;
  // How much further round than through it has to be before a raid stops
  // walking and starts breaking. Just over twice the distance, and never for
  // the sake of a hundred paces.
  const DETOUR_MAX = 2.2, DETOUR_SLACK = 200;

  // The wall piece standing between somebody and where they are going, if there
  // is one. Looked for straight ahead, because that is the direction they keep
  // failing to walk in.
  function _blocking(a, to) {
    const dx = to.x - a.x, dy = to.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    for (let ahead = 6; ahead <= 46; ahead += 8) {
      const b = _solidAt(a.x + (dx / d) * ahead, a.y + (dy / d) * ahead, to);
      if (b && b.type === 'wall') return b;
    }
    return null;
  }

  // A digger shot off the hold's ground. He is not a raid and he is not scored
  // as one — the hold's tally is about parties turned back, and a man with a
  // pick would water it down to nothing. What he was carrying goes to the hold
  // instead: it came out of ground the hold could have worked itself, so what
  // is recovered is exactly what was being taken, and no more. His camp counts
  // him among its losses, which is where the cost of sending people this far
  // in shows up.
  function _killThief(u, f) {
    const i = f.workers.indexOf(u);
    if (i === -1) return;
    f.workers.splice(i, 1);
    _burst(u.x, u.y, f.color || '#f38ba8', 10);
    f.stats.lost = (f.stats.lost || 0) + 1;
    if (u.carry > 0 && u.res) {
      _hold[u.res] = (_hold[u.res] || 0) + u.carry;
      _float(u.x, u.y - 12, (RES_GLYPH[u.res] || '📦') + ' ', u.carry,
             RES_TINT[u.res]);
    }
  }

  function _killRaider(r) {
    const idx = _raiders.indexOf(r);
    if (idx === -1) return;
    _raiders.splice(idx, 1);
    if (_selBoss === r) _selBoss = null;
    _burst(r.x, r.y, '#a6e3a1', 12);
    _sfx('kill', r.x, r.y);
    _hold.stats.kills = (_hold.stats.kills || 0) + 1;
    // Raiders carry what they came to take, and the better they are, the better
    // it is. Killing one is the hold's only income that does not come out of
    // the ground — and it is a loss on the other side too: the camp that armed
    // him paid for those arms out of ground it dug itself, and it is one man
    // further from being able to send the next party.
    // A champion is carrying what his keep spent on him, which is a good deal
    // more than a spear — and he is worth saying out loud, because a party
    // that has just lost him is a different party from the one that arrived.
    const loot = _loot(r.lvl || 1);
    const share = r.boss ? (_bs().loot || 1) : 1;
    for (const res in loot) _hold[res] = (_hold[res] || 0) + loot[res] * share;
    const f = _facById(r.fx);
    if (r.boss) {
      _burst(r.x, r.y, '#f9e2af', 24);
      _sfx('slain', r.x, r.y);
      _say(_t('sh_boss_down', { camp: f ? _facName(f) : '' }));
    }
    if (f) {
      f.stats.lost = (f.stats.lost || 0) + 1;
      // The last man down off a party that never took the keep is the camp
      // finding out, the hard way, that the number its scout brought back
      // was not enough — so it raises its own floor and will not walk a
      // scout out again until it has grown past what just failed.
      if (f.raidOut > 0) {
        f.raidOut--;
        if (f.raidOut === 0) f.needFloor = Math.max(f.needFloor || 0, (f.raidSize || 0) + 1);
      }
    }
  }

  function _lose(b, torn) {
    _burst(b.x, b.y, torn ? '#a6adc8' : '#f38ba8', 22);
    if (b.keep) { _sfx('over'); _end(); return; }
    _sfx('wreck', b.x, b.y);
    const idx = _hold.buildings.indexOf(b);
    if (idx !== -1) _hold.buildings.splice(idx, 1);
    _navChanged();
    if (!torn) _hold.stats.lost = (_hold.stats.lost || 0) + 1;
    // Anyone who was working on it needs a new job.
    for (const w of _hold.workers) if (w.target === b.id) w.job = null;
    if (_selected === b) { _selected = null; _closePanel(); }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  // ── Getting about ─────────────────────────────────────────────────────────
  // How much room somebody on foot takes up. Buildings are drawn as what they
  // are — a wall is the square it fills, everything else the disc it stands on
  // — and this is the margin that keeps a person from standing half inside one.
  const UNIT_R = 7;
  // How much ground a deposit covers. A forest is a stand of trees and a seam
  // is a field of rock, not one icon on a pin, and the ground they cover is
  // ground nobody else may build on — so the same number has to answer where
  // the trees are drawn, where the tap lands and what the rule refuses. How
  // rich it was to begin with sets how wide it ever gets; what is left of it
  // sets how much of that width is still standing, by area rather than by
  // radius, because half a forest ought to look like half a forest.
  function _depR(d) {
    const dep  = B.deposit || {};
    const base = ((dep.kinds || {})[d.kind] || {}).amount || d.max || 1;
    const rich = Math.max(0.6, Math.min(1.6, (d.max || base) / base));
    const left = Math.sqrt(Math.max(0, (d.amount || 0) / (d.max || 1)));
    return Math.max(dep.min_radius || 12, (dep.radius || 46) * rich * left);
  }
  // The widest it will ever be, which is what a new one has to find room for.
  const _depMaxR = (d) => _depR({ kind: d.kind, max: d.max, amount: d.max });
  // Deposits are worked by hand now, so they are errands and errands need
  // names: everybody who is on their way to one is remembered by its id.
  const _depById = (id) => (id == null ? null
    : _hold.deposits.find(d => d.id === id) || null);
  // How close somebody has to stand to work it. The edge of the patch and not
  // its middle — walking into the centre of a forest to cut one tree looked
  // like walking through it.
  const _depReach = (d) => _depR(d) + UNIT_R + 4;
  // Things built as a run of squares rather than one at a time. These stay in
  // hand after they are put down; see _place.
  const LAID_IN_RUNS = new Set(['wall']);

  const _clearance = (b) => _bc(b.type).size + UNIT_R;
  // Close enough to touch it, from any side. Round things are the same distance
  // away whichever way you come at them; a square is further off at the corner.
  const _reachTo = (b) => (b.type === 'wall' ? _clearance(b) * Math.SQRT2 : _clearance(b)) + 3;

  // What is standing at this spot, if anything. `ignore` is whatever the walker
  // is walking up to: a builder has to be able to reach the site, and a raider
  // the wall it is hitting, so the thing being approached is never in the way.
  //
  // `thru` is the hold's own people, who have keys. A gate is a wall in every
  // other respect — same stone, same levels, same integrity, and anybody who
  // comes to break it breaks a wall — but it is not standing in the way of the
  // hold that built it. Nobody else is given it: a raider walks into a gate
  // exactly as he walks into the wall it is set in.
  function _solidAt(x, y, ignore, thru) {
    for (const b of _hold.buildings) {
      if (b === ignore) continue;
      if (thru && b.gate) continue;
      const c = _clearance(b);
      if (b.type === 'wall') {
        // Square, because that is what a wall is: tested as the box it fills,
        // so a run of them has no diagonal gap to slip through at the corners.
        if (Math.abs(x - b.x) < c && Math.abs(y - b.y) < c) return b;
      } else if ((x - b.x) * (x - b.x) + (y - b.y) * (y - b.y) < c * c) {
        return b;
      }
    }
    return null;
  }

  // One step in a direction, taken only if there is nothing standing there.
  function _tryStep(a, dx, dy, len, ignore, thru) {
    const nx = a.x + dx * len, ny = a.y + dy * len;
    if (_solidAt(nx, ny, ignore, thru)) return false;
    a.x = nx; a.y = ny;
    return true;
  }

  // Somebody who is already inside something — a building went up around them,
  // or a wall was dropped on the spot they were standing on — is put back
  // outside by the shortest way rather than left stuck in it forever.
  // `ignore` is the thing being walked up to, exactly as in _solidAt: a builder
  // stands at the site it is building and a raider up against the wall it is
  // hitting, and shoving them back off it would leave both of them jittering on
  // the spot for ever instead of arriving.
  function _expel(a, ignore, thru) {
    // Pushed out of one thing straight into another is how somebody wedged
    // between two buildings stands still forever, so it is done over until
    // there is nothing left to be inside of — and if four goes are not enough,
    // the way out is looked for in a ring instead of shoved at.
    for (let n = 0; n < 4; n++) {
      const b = _solidAt(a.x, a.y, ignore, thru);
      if (!b) return;
      let dx = a.x - b.x, dy = a.y - b.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) { dx = 1; dy = 0; }
      const out = _clearance(b) + 0.5;
      if (b.type === 'wall') {
        // Out through the nearest side of the square, never through a corner.
        if (Math.abs(dx) > Math.abs(dy)) a.x = b.x + Math.sign(dx) * out;
        else                             a.y = b.y + Math.sign(dy) * out;
      } else {
        const d = Math.hypot(dx, dy);
        a.x = b.x + (dx / d) * out;
        a.y = b.y + (dy / d) * out;
      }
    }
    if (!_solidAt(a.x, a.y, ignore, thru)) return;
    for (let ring = 24; ring <= 96; ring += 24) {
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const x = a.x + Math.cos(ang) * ring, y = a.y + Math.sin(ang) * ring;
        if (!_solidAt(x, y, ignore, thru)) { a.x = x; a.y = y; return; }
      }
    }
  }

  // ── Finding the way ───────────────────────────────────────────────────────
  // Feeling along whatever you bump into is enough to get round a hut. It is
  // not enough to get round a wall: every step square to a hundred-pace barrier
  // is still a step into it further along, so a person who walks at one leans
  // on it until somebody gives up on his behalf. What is needed is the thing
  // people actually do — look at the obstacle, see where it ends, and go that
  // way — so the map is kept as a coarse grid of where a person fits, and
  // anybody whose way is blocked walks a route worked out over that grid.
  //
  // The route is a field of distances flooded outwards from the destination
  // rather than a line drawn per walker: everybody heading for the same place
  // shares one, which is the usual case in a hold — the whole shift walks to
  // the same camp and back to the same keep.
  // The cell is wider than it was because the world is: flooding a 4200-wide
  // map at the old 20 units a cell is four times the work per route, and the
  // route is worked out in the same frame somebody is walking. Nothing is lost
  // by it — a person is 7 units across and the grid only has to know where one
  // fits, not where a plank fits. One route a frame for the same reason: it is
  // a frame's worth of work, and the walker keeps going straight meanwhile.
  const NAV_CELL = 28;
  const NAV_FIELDS = 14;          // how many destinations are remembered
  const NAV_PER_FRAME = 1;        // and how many new ones are worked out a frame
  // Two of them: the map as everybody else finds it, and the same map with the
  // hold's own gates open. One grid cannot answer both — a route is flooded
  // over squares, and whether a gate's square is a square depends entirely on
  // who is asking.
  let _navGrid = null, _navOpen = null, _navW = 0, _navDirty = true;
  // Everything the hold has built, as one box. It is the cheap answer to "is
  // any of this his problem at all", which is the question every man in four
  // corners of a very wide map asks about the hold on every frame of his life.
  let _navBox = null;
  let _navFields = new Map();
  let _navBudget = 0;

  // Anything that changes what stands where makes the grid a lie.
  function _navChanged() { _navDirty = true; }

  function _grid(thru) {
    if (!_navDirty && _navGrid) return thru ? _navOpen : _navGrid;
    _navW = Math.max(1, Math.ceil(W() / NAV_CELL));
    const g = new Uint8Array(_navW * _navW);
    const o = new Uint8Array(_navW * _navW);
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const b of _hold.buildings) {
      // A shade wider than the walker's own clearance: a route that shaves a
      // corner ends with somebody scraping along it.
      const c = _clearance(b) + 2;
      if (b.x - c < bx0) bx0 = b.x - c;
      if (b.y - c < by0) by0 = b.y - c;
      if (b.x + c > bx1) bx1 = b.x + c;
      if (b.y + c > by1) by1 = b.y + c;
      const x0 = Math.max(0, Math.floor((b.x - c) / NAV_CELL));
      const x1 = Math.min(_navW - 1, Math.floor((b.x + c) / NAV_CELL));
      const y0 = Math.max(0, Math.floor((b.y - c) / NAV_CELL));
      const y1 = Math.min(_navW - 1, Math.floor((b.y + c) / NAV_CELL));
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const x = (gx + 0.5) * NAV_CELL, y = (gy + 0.5) * NAV_CELL;
          const dx = x - b.x, dy = y - b.y;
          const hit = b.type === 'wall'
            ? (Math.abs(dx) < c && Math.abs(dy) < c)
            : (dx * dx + dy * dy < c * c);
          if (!hit) continue;
          g[gy * _navW + gx] = 1;
          if (!b.gate) o[gy * _navW + gx] = 1;
        }
      }
    }
    _navBox = bx1 > bx0 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null;
    _navGrid = g; _navOpen = o; _navDirty = false; _navFields.clear();
    return thru ? o : g;
  }

  // Does the way from here to there come anywhere near what the hold has built?
  // A box against a box, so a camp working its own corner is told no in four
  // comparisons and walks its straight line as it always did. The margin is a
  // wall's own width: brushing past the outside of one still has to count, or
  // the last pace of the way round would be taken through it.
  function _nearHold(a, b) {
    _grid();
    if (!_navBox) return false;
    const pad = NAV_CELL * 2;
    return Math.min(a.x, b.x) <= _navBox.x1 + pad &&
           Math.max(a.x, b.x) >= _navBox.x0 - pad &&
           Math.min(a.y, b.y) <= _navBox.y1 + pad &&
           Math.max(a.y, b.y) >= _navBox.y0 - pad;
  }

  const _ci = (v) => Math.max(0, Math.min(_navW - 1, Math.floor(v / NAV_CELL)));
  const _cellPoint = (i) => ({ x: (i % _navW + 0.5) * NAV_CELL, y: (Math.floor(i / _navW) + 0.5) * NAV_CELL });
  const NAV_FAR = 0xffff;

  // Distances to one destination, in steps, over every square a person fits in.
  function _field(gx, gy, reach, thru) {
    const g = _grid(thru);
    // The two sides remember their routes apart: the same errand to the same
    // keep is a different walk depending on whether the gates are open to you.
    const key = ((gy * _navW + gx) * 32 + Math.min(31, Math.round(reach / NAV_CELL))) * 2 +
                (thru ? 1 : 0);
    const had = _navFields.get(key);
    if (had) return had;
    if (_navBudget >= NAV_PER_FRAME) return null;   // next frame will do
    _navBudget++;
    const n = _navW * _navW;
    const dist = new Uint16Array(n).fill(NAV_FAR);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    // Standing at the destination means standing near enough to touch it, so
    // everything within reach of it is where the walk ends.
    const span = Math.max(1, Math.ceil(reach / NAV_CELL));
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= _navW || y >= _navW) continue;
        const i = y * _navW + x;
        if (g[i] || dist[i] === 0) continue;
        dist[i] = 0; q[tail++] = i;
      }
    }
    while (head < tail) {
      const i = q[head++];
      const x = i % _navW, y = (i - x) / _navW;
      const d = dist[i] + 1;
      for (let k = 0; k < 8; k++) {
        const nx = x + NAV_DX[k], ny = y + NAV_DY[k];
        if (nx < 0 || ny < 0 || nx >= _navW || ny >= _navW) continue;
        const j = ny * _navW + nx;
        if (g[j] || dist[j] <= d) continue;
        // No slipping through the diagonal join of two corners: a person is
        // wider than a mathematical point.
        if (k >= 4 && (g[y * _navW + nx] || g[ny * _navW + x])) continue;
        dist[j] = d; q[tail++] = j;
      }
    }
    if (_navFields.size >= NAV_FIELDS) _navFields.delete(_navFields.keys().next().value);
    _navFields.set(key, dist);
    return dist;
  }
  const NAV_DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const NAV_DY = [0, 0, 1, -1, 1, -1, 1, -1];

  // Is there anything between these two points? The last stretch is not asked
  // about: walking up to a building means the building itself is at the end of
  // the line, and it is supposed to be.
  function _clearLine(x0, y0, x1, y1, stopShort, thru) {
    const g = _grid(thru);
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const to = Math.max(0, len - (stopShort || 0));
    if (to <= 0) return true;
    const stepN = Math.ceil(to / (NAV_CELL * 0.5));
    for (let i = 1; i <= stepN; i++) {
      const t = (to * (i / stepN)) / len;
      if (g[_ci(y0 + dy * t) * _navW + _ci(x0 + dx * t)]) return false;
    }
    return true;
  }

  // Where the walker's route starts: his own square, or — if he is standing in
  // something, or in a pocket the route never got to — the best one near him.
  // Near him is not enough: it has to be a square he can walk to from where he
  // stands. A square on the far side of a wall he is leaning on is a foot away
  // and a world away, and taking it for a starting point is how somebody walled
  // out of a place comes to believe he is nearly there.
  function _startCell(f, a, thru) {
    const here = _ci(a.y) * _navW + _ci(a.x);
    if (f[here] !== NAV_FAR) return here;
    let best = -1, bd = NAV_FAR;
    const cx = _ci(a.x), cy = _ci(a.y);
    for (let ring = 1; ring <= 3 && best < 0; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= _navW || y >= _navW) continue;
          const i = y * _navW + x;
          if (f[i] >= bd) continue;
          const p = _cellPoint(i);
          if (!_clearLine(a.x, a.y, p.x, p.y, 0, thru)) continue;
          bd = f[i]; best = i;
        }
      }
    }
    return best;
  }

  function _downhill(f, i) {
    const x = i % _navW, y = (i - x) / _navW;
    let best = -1, bd = f[i];
    for (let k = 0; k < 8; k++) {
      const nx = x + NAV_DX[k], ny = y + NAV_DY[k];
      if (nx < 0 || ny < 0 || nx >= _navW || ny >= _navW) continue;
      const j = ny * _navW + nx;
      if (f[j] < bd) { bd = f[j]; best = j; }
    }
    return best;
  }

  // The next place to make for on the way to somewhere that cannot simply be
  // walked at. Null means there is no way there at all — or that this frame has
  // worked out its share of routes and this one can wait a frame, which nobody
  // will see.
  function _waypoint(a, to, reach, thru) {
    _grid();
    const f = _field(_ci(to.x), _ci(to.y), reach, thru);
    if (!f) return null;
    let i = _startCell(f, a, thru);
    if (i < 0 || f[i] === NAV_FAR) return null;
    // How much walking is left by the route, which is what "getting somewhere"
    // means while going the long way round — see _walk.
    a._routeD = f[i] * NAV_CELL;
    // A route made of squares is a staircase, and people do not walk in
    // staircases: aim at the furthest step still in plain sight.
    let aim = null;
    for (let n = 0; n < 8; n++) {
      const nx = _downhill(f, i);
      if (nx < 0) break;
      i = nx;
      const p = _cellPoint(i);
      if (aim && !_clearLine(a.x, a.y, p.x, p.y, 0, thru)) break;
      aim = p;
      if (f[i] === 0) break;
    }
    return aim;
  }

  // Roughly how far the walk actually is, as against how far the thing looks.
  // Infinity means there is no way round at all.
  function _routeLen(a, to, reach, thru) {
    _grid();
    const f = _field(_ci(to.x), _ci(to.y), reach, thru);
    if (!f) return null;                       // not worked out yet, ask later
    const i = _startCell(f, a, thru);
    if (i < 0 || f[i] === NAV_FAR) return Infinity;
    return f[i] * NAV_CELL * 1.15;             // diagonals cost a little more
  }

  // Walking, for everybody who walks: people, soldiers and raiders alike.
  // Nothing goes through what is built. The step is tried straight at the
  // target first; when something is standing in the way the same step is tried
  // square to it, which is what walking along a wall until it ends looks like.
  // The side that worked is remembered, because a walker that picks a fresh
  // side every frame leans on the obstacle and shivers there instead of getting
  // anywhere.
  function _walk(a, b, dt, speed, reach, thru) {
    _expel(a, b, thru);
    // Every leg of an errand is judged on its own: walking back to the keep is
    // not failing to reach the mine.
    // Buildings and deposits number themselves separately, so the leg says
    // which of the two it is: 'b3' and 'd3' are different errands.
    const leg = b.id != null ? (b.kind ? 'd' : 'b') + b.id
                             : Math.round(b.x) + ',' + Math.round(b.y);
    if (a._leg !== leg) { a._leg = leg; a._near = null; a._nearK = null; a._stall = 0; }
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d <= reach) { a._side = 0; a._stall = 0; a._arrived = true; return true; }
    const step = Math.min(speed * dt, d);
    // Straight at it while the way is open. When it is not, the next corner of
    // a worked-out route is what is walked at instead — and the feeling-along
    // below stays exactly where it was, for the last pace or two and for
    // squeezing past whoever else is on the same errand.
    let mx = dx, my = dy;
    a._routeD = null;
    if (!a._straight && !_clearLine(a.x, a.y, b.x, b.y, reach + NAV_CELL, thru)) {
      const p = _waypoint(a, b, reach, thru);
      if (p) { mx = p.x - a.x; my = p.y - a.y; }
    }
    const md = Math.hypot(mx, my) || 1;
    const ux = mx / md, uy = my / md;
    if (_tryStep(a, ux, uy, step, b, thru)) {
      a._side = 0;
    } else {
      const side = a._side || (Math.random() < 0.5 ? 1 : -1);
      // Square to the way home first — that is walking along the obstacle —
      // then half a turn off it, which is what threads a gap between two
      // things that a full sidestep is too wide for.
      const ways = [];
      for (const s of [side, -side]) {
        ways.push([-uy * s, ux * s]);
        ways.push([(ux - uy * s) / Math.SQRT2, (uy + ux * s) / Math.SQRT2]);
      }
      let went = 0;
      for (let i = 0; i < ways.length; i++) {
        if (_tryStep(a, ways[i][0], ways[i][1], step, b, thru)) { went = i < 2 ? side : -side; break; }
      }
      a._side = went;
    }
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    // Nearer than they have ever been on this errand, or getting nowhere? A
    // person who spends long enough not closing the distance is not walking
    // round something, they are walking into it — see _people, which is where
    // the giving up happens. Going the long way round is measured along the way
    // round: half of a detour is spent walking away from where you are going,
    // and that is progress, not failure.
    // The two are not the same ruler, and a frame that measured one after a
    // frame that measured the other has not made progress — it has changed the
    // subject. Take the new reading, keep the tally of getting nowhere.
    const left = a._routeD != null ? a._routeD : gap;
    const rule = a._routeD != null ? 1 : 0;
    if (a._near == null || rule !== a._nearK) { a._near = left; a._nearK = rule; }
    else if (left < a._near - 0.5) { a._near = left; a._stall = 0; }
    else a._stall = (a._stall || 0) + dt;
    a._arrived = gap <= reach;
    return a._arrived;
  }

  function _nearest(from, list) {
    let best = null, bd = Infinity;
    for (const it of list) {
      const d = _dist(from, it);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // A deposit is the resource, not the ground under it. When the last of it has
  // been carried away it is gone from the map — no pale ghost of a forest that
  // is not a forest any more — and the same kind turns up somewhere else, so
  // the map never runs out of a material for good. Nothing was built on it, so
  // nothing is left standing on nothing: the people who were working it simply
  // look up, see that it is finished, and walk to the next one.
  function _drain(dep, load, quiet) {
    dep.amount = Math.max(0, dep.amount - load);
    if (dep.amount > 0) return;
    const i = _hold.deposits.indexOf(dep);
    if (i !== -1) _hold.deposits.splice(i, 1);
    if (_selDep === dep) _selDep = null;
    // Everybody who was on their way to it, and everybody in the camps too.
    for (const w of _hold.workers) if (w.dep === dep.id) { w.job = null; w.dep = null; }
    for (const f of _hold.factions) {
      for (const u of f.workers) if (u.dep === dep.id) { u.job = null; u.dep = null; }
    }
    const moved = _spawnDeposit(dep.kind);
    if (quiet) return;
    if (moved) _say(_t('sh_dep_moved', { res: _t('sh_' + dep.kind) }));
  }

  // Somewhere new for it. The map has five holds on it now, so a deposit that
  // has been worked out comes back near one of them rather than in the middle
  // of nowhere: ground nobody can reach is ground that is not in the game.
  function _spawnDeposit(kind) {
    const d = B.deposit;
    const sites = _sites();
    for (let n = 0; n < 200; n++) {
      const amount = Math.round(d.kinds[kind].amount * (0.7 + Math.random() * 0.8));
      const r      = _depMaxR({ kind: kind, max: amount, amount: amount });
      const room   = n < 100 ? 30 : 0;
      // Thrown, exactly the way the map was thrown to begin with: anywhere at
      // all, and where it lands is where it is. Ground that grows back near
      // whoever wore it out would quietly undo the map — the corner that dug
      // itself dry would be handed it back, and the walk that costs a hold its
      // afternoon would never get any longer.
      const x = r + 20 + Math.random() * (W() - 2 * (r + 20));
      const y = r + 20 + Math.random() * (W() - 2 * (r + 20));
      // Never on top of anybody's hold — theirs included, or a camp wakes up
      // with a forest through its barracks.
      if (sites.some(s => Math.hypot(s.x - x, s.y - y) < r + (d.clear || 120))) continue;
      if (_hold.buildings.some(b =>
        Math.hypot(b.x - x, b.y - y) < _bc(b.type).size + r + 10 + room)) continue;
      if (_hold.deposits.some(o =>
        Math.hypot(o.x - x, o.y - y) < _depMaxR(o) + r + 12 + room)) continue;
      _hold.deposits.push({ id: _hold.next_dep = (_hold.next_dep || 1) + 1,
                            x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
                            kind: kind, amount: amount, max: amount });
      return true;
    }
    return false;
  }

  // Where the five holds are: the player in the middle, a camp in each corner.
  // Laid out on the server when the world was made; worked out again here the
  // same way, so both halves agree without having to be told.
  // The four corners, and only so that nothing lands on top of one. The middle
  // of the map is not a site any more: no ground is reserved for anybody, and
  // the centre is worth settling on only if the throw happened to favour it.
  // Mirrors _sites() in mp_game.py.
  function _sites() {
    const i = B.faction.inset;
    const out = [];
    for (const f of (_hold.factions || [])) out.push({ x: f.x, y: f.y });
    if (!out.length) {
      out.push({ x: i, y: i }, { x: W() - i, y: i },
               { x: i, y: W() - i }, { x: W() - i, y: W() - i });
    }
    return out;
  }

  const _byId  = (id) => _hold.buildings.find(b => b.id === id) || null;
  const _keep  = () => _hold.buildings.find(b => b.keep) || _hold.buildings[0];

  // What just arrived, written where it arrived and drifting off. The numbers
  // at the top of the screen are the truth about the hold, but they are a long
  // way from the man who walked the load in, and a store climbing by five with
  // nothing to say who did it is a number rather than an event.
  //
  // Two people reaching the keep in the same breath would write over one
  // another, so a fresh one landing on a fresh one starts below it and rises
  // with it, keeping the order they arrived in.
  const FLOAT_LIFE = 1.5;
  function _float(x, y, glyph, n, color) {
    n = Math.round(n);
    if (!(n > 0)) return;
    let drop = 0;
    for (const f of _floats)
      if (Math.abs(f.x - x) < 30 && Math.abs(f.y - y) < 30 &&
          f.life > FLOAT_LIFE - 0.6)
        drop = Math.max(drop, f.drop + 15);
    _floats.push({ x: x, y: y, glyph: glyph, n: n, color: color,
                   life: FLOAT_LIFE, drop: drop });
  }

  // Damage does not arrive in blows. A raider leans on a wall for as long as he
  // is standing there and every frame takes a sliver of it, so a number per
  // frame would be a blur and a number per blow does not exist to be written.
  // The slivers are added up per target instead and written out a couple of
  // times a second — what that wall lost while you were watching it, which is
  // what a blow looks like from the outside anyway.
  //
  // Kept off the objects themselves on purpose: buildings are saved, and a
  // running total of this morning's damage has no business in the save file.
  const _blowAcc = new WeakMap();
  const BLOW_TICK = 0.55;
  function _blow(o, x, y, amount) {
    if (!(amount > 0)) return;
    // The clock is read off the hold rather than added up out of the dt handed
    // in, because three raiders on one wall call this three times in the same
    // frame. Adding their dt up would run the tick three times as fast and
    // write a number every other frame — which the whole thing exists to avoid.
    const now = _hold.elapsed || 0;
    let a = _blowAcc.get(o);
    if (!a) { a = { n: 0, t: now }; _blowAcc.set(o, a); }
    a.n += amount;
    // Both gates matter: the tick keeps a heavy beating from writing every
    // frame, and the half-point keeps a slow chip from writing a nought. What
    // is under a whole point stays on the tally for the next one.
    if (now - a.t >= BLOW_TICK && a.n >= 0.5) {
      const n = Math.round(a.n);
      _float(x, y, '−', n, '#f38ba8');
      a.n -= n;
      a.t = now;
    }
  }

  function _burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 50 + Math.random() * 150;
      _dust.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, color });
    }
  }

  // ── Sound ─────────────────────────────────────────────────────────────────
  // Everything the hold says out loud is made here, on the spot. No files ship
  // with the app: a folder of samples is a bigger archive, a licence to keep
  // track of and one more thing that can fail to load on a slow line, and
  // nothing here needs more than a shaped tone and a hiss. It is deliberately
  // not music — a game that is meant to be left running in a window is a game
  // that must not be a soundtrack; these are the events, and only the events.
  //
  // The context is built on the first thing the player touches, because a
  // browser refuses one made any earlier and a refused context stays broken
  // for the whole visit. Everything goes through one gain, so the switch is one
  // number, and it is remembered between visits.
  const SND_KEY = 'sh_sound';
  let _ac = null, _acOut = null, _muted = false;
  try { _muted = localStorage.getItem(SND_KEY) === 'off'; } catch (e) {}

  function _audio() {
    if (_ac) {
      // A context made during a gesture can still be handed back suspended —
      // a tab that was in the background when it was built, most often.
      if (_ac.state === 'suspended') _ac.resume().catch(() => {});
      return _ac;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { _ac = new AC(); } catch (e) { return null; }
    _acOut = _ac.createGain();
    _acOut.gain.value = 0.5;
    _acOut.connect(_ac.destination);
    return _ac;
  }

  // How loud something happening out there is in here. What is on screen is
  // heard properly and what is off it is heard faintly: a raid three holds
  // away hammering on somebody else's wall is not an event in this room.
  function _near(x, y) {
    if (x == null || !_canvas) return 1;
    const v = _view();
    const sx = v.tx + x * v.k, sy = v.ty + y * v.k;
    const pad = 40 * _dpr;
    return (sx >= -pad && sx <= v.w + pad && sy >= -pad && sy <= v.h + pad)
      ? 1 : 0.3;
  }

  // One shaped voice: a tone that slides from one pitch to another across its
  // own length, with the attack and the tail written into the gain. Every
  // sound below is a handful of these, and nothing is left connected once it
  // has finished — an oscillator that is never stopped is a leak that hums.
  function _tone(o) {
    const ac = _audio(); if (!ac) return;
    const t = ac.currentTime + (o.at || 0);
    const len = o.len || 0.12;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = o.wave || 'sine';
    osc.frequency.setValueAtTime(o.from, t);
    if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + len);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, o.vol || 0.2), t + Math.min(0.02, len / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(gain); gain.connect(_acOut);
    osc.start(t); osc.stop(t + len + 0.02);
  }

  // A hiss with a shape: stone giving way, a blow landing, a thing coming
  // apart. Made once and reused, because building a noise buffer per shot is
  // the one thing here that would actually cost anything.
  let _noiseBuf = null;
  function _noise(o) {
    const ac = _audio(); if (!ac) return;
    if (!_noiseBuf) {
      _noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
      const d = _noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + (o.at || 0);
    const len = o.len || 0.15;
    const src = ac.createBufferSource();
    src.buffer = _noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const flt = ac.createBiquadFilter();
    flt.type = o.type || 'bandpass';
    flt.frequency.setValueAtTime(o.from || 900, t);
    if (o.to) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + len);
    flt.Q.value = o.q == null ? 1 : o.q;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, o.vol || 0.2), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(flt); flt.connect(gain); gain.connect(_acOut);
    src.start(t); src.stop(t + len + 0.02);
  }

  // The voices themselves. Each takes how loud it is allowed to be, so the
  // same shot is the same shot whether it is under the camera or across the
  // map. Kept short on purpose: a tower firing every two seconds is a sound
  // that will be heard some thousands of times in one hold's life.
  const SFX = {
    // A tower letting one go: a hard, short crack, high and falling.
    shot:   (v) => { _tone({ from: 880, to: 240, len: 0.09, wave: 'square', vol: 0.09 * v });
                     _noise({ from: 2200, to: 700, len: 0.07, vol: 0.06 * v }); },
    // And that round landing on somebody.
    hit:    (v) => { _noise({ from: 1400, to: 300, len: 0.09, vol: 0.09 * v, q: 0.7 });
                     _tone({ from: 320, to: 150, len: 0.07, wave: 'triangle', vol: 0.05 * v }); },
    // A champion's bolt, thrown the other way: deeper, and it takes its time.
    bolt:   (v) => { _tone({ from: 420, to: 120, len: 0.22, wave: 'sawtooth', vol: 0.08 * v }); },
    // Spear on shield. This is the one that happens most, so it is the
    // quietest thing here and the most tightly rationed — see SFX_GAP.
    clash:  (v) => { _noise({ from: 2600, to: 1200, len: 0.06, vol: 0.05 * v, q: 2 });
                     _tone({ from: 640, to: 380, len: 0.05, wave: 'square', vol: 0.03 * v }); },
    // A party stepping off towards the hold: a horn, two notes, and it is
    // meant to be heard over whatever else is going on.
    raid:   (v) => { _tone({ from: 196, to: 196, len: 0.34, wave: 'sawtooth', vol: 0.11 * v });
                     _tone({ from: 262, to: 262, len: 0.5, wave: 'sawtooth', vol: 0.11 * v, at: 0.3 }); },
    // Something new standing where there was ground: two notes up.
    build:  (v) => { _tone({ from: 523, to: 523, len: 0.1, wave: 'triangle', vol: 0.09 * v });
                     _tone({ from: 784, to: 784, len: 0.16, wave: 'triangle', vol: 0.09 * v, at: 0.09 }); },
    // A building grown a level: the same idea, one note further.
    up:     (v) => { _tone({ from: 523, to: 523, len: 0.09, wave: 'triangle', vol: 0.08 * v });
                     _tone({ from: 659, to: 659, len: 0.09, wave: 'triangle', vol: 0.08 * v, at: 0.08 });
                     _tone({ from: 988, to: 988, len: 0.2, wave: 'triangle', vol: 0.09 * v, at: 0.16 }); },
    // Stone coming down.
    wreck:  (v) => { _noise({ from: 900, to: 90, len: 0.55, vol: 0.16 * v, q: 0.5, type: 'lowpass' });
                     _tone({ from: 160, to: 55, len: 0.4, wave: 'sawtooth', vol: 0.08 * v }); },
    // One of the hold's own, gone. Low, and it does not resolve.
    fallen: (v) => { _tone({ from: 300, to: 90, len: 0.3, wave: 'sine', vol: 0.11 * v }); },
    // A camp's keep finishing its champion, somewhere out there.
    champ:  (v) => { _tone({ from: 110, to: 110, len: 0.45, wave: 'sawtooth', vol: 0.1 * v });
                     _tone({ from: 165, to: 220, len: 0.4, wave: 'square', vol: 0.06 * v, at: 0.12 }); },
    // And that champion face down in the mud, which is worth a fanfare.
    slain:  (v) => { _tone({ from: 784, to: 784, len: 0.1, wave: 'triangle', vol: 0.1 * v });
                     _tone({ from: 1047, to: 1047, len: 0.1, wave: 'triangle', vol: 0.1 * v, at: 0.09 });
                     _tone({ from: 1319, to: 660, len: 0.3, wave: 'triangle', vol: 0.1 * v, at: 0.18 }); },
    // A raider down. Almost nothing on its own — it is the drumbeat of a
    // battle going well, not an announcement.
    kill:   (v) => { _noise({ from: 700, to: 200, len: 0.12, vol: 0.06 * v, q: 0.8 }); },
    // Something put down on the map, and something the hold will not do.
    place:  (v) => { _tone({ from: 440, to: 660, len: 0.07, wave: 'triangle', vol: 0.07 * v }); },
    deny:   (v) => { _tone({ from: 220, to: 130, len: 0.16, wave: 'square', vol: 0.06 * v }); },
    // The keep gone, and with it the hold.
    over:   (v) => { _noise({ from: 700, to: 60, len: 1.1, vol: 0.2 * v, q: 0.4, type: 'lowpass' });
                     _tone({ from: 220, to: 55, len: 1.0, wave: 'sawtooth', vol: 0.12 * v }); },
  };

  // The shortest gap between two of the same voice. Ten towers firing in the
  // same frame are one crack, not ten stacked on top of each other — stacking
  // is both deafening and, for a browser, expensive.
  const SFX_GAP = { shot: 90, hit: 70, clash: 220, kill: 120, bolt: 140,
                    fallen: 300, wreck: 200 };
  const _sfxAt = {};

  // Say it. Takes where it happened, when that is known, so the map decides
  // how loud it is.
  function _sfx(name, x, y) {
    if (_muted || !_ac || _paused || document.hidden) return;
    const v = SFX[name]; if (!v) return;
    const now = performance.now();
    const gap = SFX_GAP[name] || 40;
    if (_sfxAt[name] && now - _sfxAt[name] < gap) return;
    _sfxAt[name] = now;
    try { v(_near(x, y)); } catch (e) {}
  }

  // The first touch of the game, whatever it was aimed at. It only ever builds
  // the context — nothing is played here — and it keeps working after it has
  // fired, because a context can be closed under the page by the system and
  // asking for it again is how it comes back.
  function _wake() { if (!_muted) _audio(); }

  // The switch. The context is made here rather than at load, because this is
  // a click and a click is what a browser wants to see before it will let
  // anything make a noise at all.
  function _soundToggle() {
    _muted = !_muted;
    try { localStorage.setItem(SND_KEY, _muted ? 'off' : 'on'); } catch (e) {}
    if (!_muted) { _audio(); _sfx('place'); }
    _soundBtn();
  }

  function _soundBtn() {
    if (!_root) return;
    const el = _root.querySelector('[data-zoom="sound"]');
    if (!el) return;
    el.textContent = _muted ? '🔇' : '🔊';
    el.title = _t(_muted ? 'sh_sound_off' : 'sh_sound_on');
  }

  function _score() {
    const s = _hold.stats;
    let levels = 0;
    for (const b of _hold.buildings) levels += b.lvl;
    s.score = Math.round((s.kills || 0) * 10 + (s.raids || 0) * 25 +
                         levels * 15 + (_hold.elapsed || 0) / 6);
  }

  // ── Building and upgrading ────────────────────────────────────────────────
  function _canPay(cost) {
    for (const res in cost) if ((_hold[res] || 0) < cost[res]) return false;
    return true;
  }
  function _pay(cost) {
    for (const res in cost) _hold[res] = (_hold[res] || 0) - cost[res];
  }
  // A price, as it is written on a button: only the materials it actually wants.
  // With `mark`, each material says for itself whether the hold has it, so a
  // price that cannot be met names the one thing that is missing instead of
  // leaving the whole button greyed and the player guessing which of two.
  // Half of everything that went into a building, which is what tearing it
  // down gives back. Rounded the same way _demolish pays it out, so the button
  // and the storehouse never disagree by one.
  function _refundLabel(b) {
    const spent = _spent(b);
    const back = {};
    for (const res in spent) {
      const n = Math.round(spent[res] / 2);
      if (n > 0) back[res] = n;
    }
    return _costLabel(back, false);
  }

  function _costLabel(cost, mark) {
    // A price of nothing still has to be read as a price, or the button that
    // matters most in the opening minute is the one with a blank where every
    // other button has numbers.
    if (!RESOURCES.some(res => cost[res]))
      return '<span class="sh-c free">' + _esc(_t('sh_found_free')) + '</span>';
    return RESOURCES.filter(res => cost[res])
      .map(res => {
        const short = mark && (_hold[res] || 0) < cost[res];
        return '<span class="sh-c' + (short ? ' short' : '') + '" data-res="' + res + '">' +
               RES_GLYPH[res] + ' ' + cost[res] + '</span>';
      }).join(' ');
  }

  // A wall is a square tile the width of one cell, and the map is laid out in
  // those cells wherever a wall is concerned. That is the whole of how walls
  // come to touch: dropped anywhere inside a cell, a wall fills that cell
  // exactly, so the next one along either axis sits against it with no gap and
  // no overlap to argue about.
  const _wallCell = () => _bc('wall').size * 2;

  // Where a building actually lands when it is dropped here. Only the wall
  // moves — everything else stands where it was put.
  function _snap(type, p) {
    if (type !== 'wall') return { x: p.x, y: p.y };
    const cell = _wallCell();
    return { x: (Math.floor(p.x / cell) + 0.5) * cell,
             y: (Math.floor(p.y / cell) + 0.5) * cell };
  }

  // How far apart two kinds of building have to stand. Two walls only have to
  // be in different cells: laying them against each other is the point of them,
  // and anything more turns a wall into a fence. A wall against anything else
  // just may not overlap it — no extra air, or a hold could never wall its own
  // towers in. Everything else keeps the room it always kept.
  function _spacing(a, b) {
    const cell = _wallCell();
    if (a === 'wall' && b === 'wall') return cell - 1;
    const ra = a === 'wall' ? cell / 2 : _bc(a).size;
    const rb = b === 'wall' ? cell / 2 : _bc(b).size;
    // Nothing is walked through any more, so two buildings put down next to
    // each other are a fence. That is the wall's job and only the wall's: every
    // other pair has to leave a gap somebody can actually get through, or a
    // hold would seal itself in by accident and wonder why nobody is working.
    // A wall may still touch a building — otherwise a hold could never wall its
    // own towers in, which is the one thing walls are for.
    return ra + rb + (a === 'wall' || b === 'wall' ? 0 : UNIT_R * 2 + 10);
  }

  // Why this building may not stand here, or null if it may. One answer for
  // both the tap that places it and the ghost that shows where it would go, so
  // what the map promises and what the tap does can never disagree.
  function _canPlace(type, x, y) {
    const c = _bc(type);
    const half = c.size + 8;
    if (x < half || y < half || x > W() - half || y > W() - half) return 'sh_no_room';
    // Founding the hold answers to its own rules: it costs nothing, there is
    // nothing standing to keep clear of, and the only thing the map insists on
    // is that a camp is not moved in on. Anywhere else is fair ground — which
    // stretch of it is worth settling is the whole decision.
    if (type === 'keep') {
      for (const d of _hold.deposits) {
        if (Math.hypot(d.x - x, d.y - y) < c.size + _depR(d) + 8) return 'sh_on_deposit';
      }
      for (const f of _hold.factions) {
        if (Math.hypot(f.x - x, f.y - y) < _foundClear()) return 'sh_too_close';
      }
      return null;
    }
    for (const b of _hold.buildings) {
      if (_dist(b, { x, y }) < _spacing(type, b.type)) return 'sh_bad_spot';
    }
    // Nothing is built on top of a resource, without exception now: the ground
    // is worked by hand, so building on a forest would only mean putting a
    // house where the timber is and losing the timber.
    for (const d of _hold.deposits) {
      if (Math.hypot(d.x - x, d.y - y) < c.size + _depR(d)) return 'sh_on_deposit';
    }
    // Nor on anybody else's hold. The corners are theirs and the map says so.
    for (const f of _hold.factions) {
      for (const b of f.buildings) {
        if (Math.hypot(b.x - x, b.y - y) < c.size + _facSize(b.type) + 12) return 'sh_their_ground';
      }
    }
    if (!_canPay(_newCost(type))) return 'sh_cant_afford';
    return null;
  }

  // Put down whatever was picked up for building. Escape and the right button
  // both land here, and so does a second tap on the button that started it —
  // changing your mind should cost the same gesture wherever you make it.
  function _cancelPlacing() {
    if (!_placing) return false;
    // Founding is not something to change your mind about: with nothing on the
    // map, putting the keep down is the only move there is.
    if (_placing === 'keep') return false;
    _placing = null;
    _ghost = null;
    if (!_selected && !_selFac) _closePanel();
    _say('');
    _renderBar();
    _renderStrip();
    return true;
  }

  // How much room the camps are left when the hold is founded. Comes from the
  // balance table so the rule is the server's, like every other number here.
  const _foundClear = () => (B.world && B.world.found_clear) || 900;

  // The first free building: the keep. Nobody lives in it — it is a storehouse
  // with walls — so founding hands the free first house straight back to the
  // player, and the person who moves into it is the hold's first pair of hands.
  // Everything the hold ever becomes is measured from here, so this is the one
  // decision the game asks for before it starts, and the reason nothing moves
  // until it is made. It comes with nothing: the first timber of the game is
  // cut by that one person, which is exactly what the four camps are doing in
  // their own corners while it happens.
  function _found(x, y) {
    const why = _canPlace('keep', x, y);
    if (why) return _say(_t(why));
    _hold.buildings.push({
      id: _hold.next_id++, type: 'tower', x: x, y: y, lvl: 1,
      hp: _maxHp('tower', 1, true),
      // No magazine of its own: the keep fires out of the store it already is.
      built: 1, ammo: 0, _rl: 0, _sp: 0, keep: true,
    });
    for (let i = 0; i < (B.start.keep_people || 0); i++) {
      _hold.workers.push({ x: x + 18 + i * 14, y: y + 18 - i * 10,
                           hp: B.worker.hp, job: null });
    }
    _hold.founding = false;
    // Straight on to the second half of the founding: the free house, already
    // in hand, because a keep on its own is a hold that cannot do anything at
    // all. Put it down anywhere and somebody moves in.
    _placing = _freeFirst('house') ? 'house' : null;
    _ghost = null;
    _selected = null; _selDep = null; _selFac = null; _selBoss = null;
    if (_placing && !_narrow()) _previewPanel(_placing); else _closePanel();
    _navChanged();
    _lookAt({ x: x, y: y }, _homeZoom());
    _say(_placing ? _t(_touch ? 'sh_first_house_touch' : 'sh_first_house') : '');
    _renderBar();
    _renderStrip();
    _renderHud();
    _push();
  }

  function _place(type, x, y) {
    if (type === 'keep') return _found(x, y);
    const why = _canPlace(type, x, y);
    if (why) { _sfx('deny'); return _say(_t(why)); }
    const cost = _newCost(type);
    _pay(cost);
    // The free first house is up the moment it is placed. Everything else is
    // raised by somebody standing at it, and at this point in the game there is
    // nobody — a site waiting for hands that do not exist yet is a hold that
    // never starts.
    const done = _freeFirst(type) && !_hold.workers.length;
    _hold.buildings.push({
      id: _hold.next_id++, type: type, x: x, y: y, lvl: 1,
      hp: _maxHp(type, 1), built: done ? 1 : 0, ammo: 0, _rl: 0, _sp: 0,
    });
    if (done) _burst(x, y, _css('--green', '#a6e3a1'), 10);
    _sfx(done ? 'build' : 'place', x, y);
    _navChanged();          // one more thing to walk round
    // A wall is laid piece by piece and nobody ever means to lay one square, so
    // it stays in hand: put one down and the next is already picked up. Going
    // back to the bar between every square is the whole complaint. Everything
    // else is put down once and let go of, or a stray tap builds a second one.
    if (LAID_IN_RUNS.has(type)) {
      // Staying in hand is as far as it goes. The next piece is aimed and
      // confirmed exactly like the first: a tap that builds by itself is a tap
      // that builds a wall square where a finger happened to land.
      _ghost = null;
      _say(_t(_touch ? 'sh_place_run_touch' : 'sh_place_run'));
    } else {
      _placing = null;
      _ghost = null;
      _closePanel();
    }
    _renderBar();
    _renderStrip();
    _push();
  }

  // Whether this very building could be raised right now — the same three
  // questions _upgrade asks, in the same order, so what the map offers and what
  // the button does can never drift apart.
  function _canUp(b) {
    return b.built >= 1 && b.up == null && !_atMax(b.lvl) &&
           _canPay(_cost(b.type, b.lvl + 1));
  }

  // A doorway cut into a piece of wall the hold already owns. It is the same
  // wall afterwards — the same stone at the same level with the same integrity,
  // and anybody who comes to break it is breaking a wall — except that the
  // hold's own people walk through it instead of round the whole ring. What it
  // costs is another piece of wall's worth of materials: the frame, the hinges
  // and the leaf, and the point of charging for it is that a hold has to decide
  // where the way in goes rather than putting one in every square.
  //
  // Bricking it up again is free and gives nothing back. A hold that changes
  // its mind about where its road runs should not be punished for it, and
  // nobody has ever been paid for filling a hole in.
  function _gateWay(b) {
    if (b.type !== 'wall' || b.built < 1 || b.up != null) return;
    if (b.gate) {
      delete b.gate;
    } else {
      const cost = _newCost('wall');
      if (!_canPay(cost)) { _sfx('deny'); return _say(_t('sh_cant_afford')); }
      _pay(cost);
      b.gate = 1;
    }
    // The ring the hold walks has changed shape, for the hold only.
    _navChanged();
    _sfx('place', b.x, b.y);
    _renderPanel();
    _push();
  }

  function _upgrade(b) {
    if (_atMax(b.lvl)) return;
    if (b.up != null) return;
    const cost = _cost(b.type, b.lvl + 1);
    if (!_canPay(cost)) { _sfx('deny'); return _say(_t('sh_cant_afford')); }
    _pay(cost);
    _sfx('place', b.x, b.y);
    b.up = 0;                    // the people have to build it, level by level
    _renderPanel();
    _push();
  }

  // Everything the hold has ever put into a building: the price of putting it
  // up plus every upgrade paid for since, and the upgrade being built right
  // now, which was paid for the moment it was ordered. A level-three quarry
  // was three payments, not one — half of "what it cost" has to mean half of
  // all three, or pulling down a built-up building is a punishment.
  function _spent(b) {
    const top = b.lvl + (b.up != null ? 1 : 0);
    const total = {};
    for (let l = 1; l <= top; l++) {
      const c = _cost(b.type, l);
      for (const res in c) total[res] = (total[res] || 0) + c[res];
    }
    return total;
  }

  function _demolish(b) {
    if (b.keep) return;
    const back = _spent(b);
    for (const res in back) _hold[res] = (_hold[res] || 0) + Math.round(back[res] / 2);
    // Pulled down on purpose is not lost to a raider: the score counts what
    // was taken from the hold, not what the hold decided it no longer wanted.
    _lose(b, true);
    _selected = null;
    _closePanel();
    _push();
  }

  // ── Reporting to the server ───────────────────────────────────────────────
  // Everything that must survive is in `_hold`, so the report is the hold. The
  // live-only fields go with it and are simply ignored on the way back.
  function _push() {
    if (!_hold || _over) return;
    mp.send({ type: 'sh_state', state: _hold });
  }

  function _end() {
    _over = true;
    if (!_reported) {
      _reported = true;
      mp.send({ type: 'sh_over', state: _hold });
    }
    _renderHud();
    _renderBar();
    // Solo: this is the run, and it is over — the card says so. Multiplayer:
    // it is only this hold's turn that is over, others may still be
    // standing, so the map stays up and the room says when it is truly done
    // (sh_game_over, see _showFinalStandings).
    if (_solo) { _showOver(); return; }
    _spectating = true;
    _say(_t('sh_mp_spectating'));
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  // Built once and then only written into. It used to be thrown away and made
  // again twice a second, which on a phone meant every third tap landed on a
  // button that had been replaced between touchstart and touchend and did
  // nothing at all.
  function _cell(key, label) {
    return '<div class="sh-cell">' +
      '<div class="sh-val" data-k="' + key + '">–</div>' +
      '<div class="sh-lbl">' + _esc(label) + '</div></div>';
  }

  function _renderHud() {
    if (!_hud || !_hold) return;
    _hud.innerHTML =
      _cell('wood',  _t('sh_wood')) +
      _cell('stone', _t('sh_stone')) +
      _cell('iron',  _t('sh_iron')) +
      // No ammo cell: the keep writes its own rounds under itself, against the
      // limit they count towards, at the place where they are fired from. Up
      // here the same number carried no ceiling and no location, and said the
      // thing twice.
      _cell('people', _t('sh_people')) +
      // Men standing against the men the barracks can hold. Without the second
      // number a full army and an empty one read the same, and the answer to
      // "why is nobody walking out" is another barracks, not more waiting.
      _cell('army',   _t('sh_army')) +
      _cell('score',  _t('sh_score')) +
      // The four corners, always on screen. This is the answer to never seeing
      // the enemy: each one says who it is, what rank its keep has reached and
      // whether its men are on the road — and tapping it takes the camera
      // there, so "how is the north-west getting on" is one thumb away.
      '<div class="sh-facs" id="sh-facs"></div>' +
      // Solo hides the button once the card is up — it has its own way back
      // to the hub. Multiplayer never gets that card (see _end), so leaving
      // while spectating needs its own door.
      (_over && _solo ? '' : '<button id="sh-exit" class="sh-btn">' + _esc(_t('sh_exit')) + '</button>');
    const exit = _hud.querySelector('#sh-exit');
    if (exit) exit.onclick = () => {
      if (!_solo) {
        // No save in multiplayer — everyone plays together, so there is
        // nothing here to hand back later, only a room to walk out of.
        if (confirm(_t('sh_mp_leave_confirm'))) mp.leave();
        return;
      }
      // The hub only opens its stop-for-now prompt while the run can actually
      // be saved, and it says nothing when it cannot — which is
      // indistinguishable from a dead button. It cannot when the room is
      // gone: the backend was restarted, or the socket has been down long
      // enough to lose it. Say that, because the hold itself is not lost —
      // it is written down, and reloading picks it back up.
      if (typeof mp.canSave === 'function' && !mp.canSave()) return _say(_t('sh_no_room_left'));
      mp.exitPrompt();
    };
    _renderChips();
    _renderPresence();
    _syncHud();
  }

  // The number on a camp's chip. Two different things, and which one it is is
  // decided by whether that camp has anybody on the map: while a party of
  // theirs is out, the chip is the party — how many are still coming, counting
  // down as the towers take them, which is the one number worth watching while
  // it is happening. The rest of the time it is the camp itself, standing
  // armed at home, which is how a raid is seen coming before it leaves. The
  // chip goes red for exactly as long as it means the first of the two, and
  // the camp's own panel always shows both.
  const _facOut  = (f) => _raiders.filter(r => r.fx === f.id).length;
  const _facChip = (f) => { const out = _facOut(f); return out || f.army.length; };

  function _renderChips() {
    const box = _hud && _hud.querySelector('#sh-facs');
    if (!box || !_hold) return;
    let html = '';
    for (const f of _hold.factions) {
      html += '<button class="sh-fac" data-fac="' + f.id + '" ' +
              'style="--fc:' + f.color + '">' +
              '<span class="sh-fdot"></span>' +
              '<span class="sh-fnm">' + _esc(_facShort(f)) + '</span>' +
              '<span class="sh-flv" data-fl="' + f.id + '">' + _facChip(f) + '</span></button>';
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-fac]').forEach(el => {
      el.onclick = () => {
        const f = _facById(+el.dataset.fac);
        if (!f) return;
        _selFac = f; _selected = null; _selDep = null;
        _lookAt(f, Math.min(_cam.z, 1.4));
        _renderFacPanel();
      };
    });
    // The chips are a row of their own, so the HUD is taller once they exist
    // and the camera has to be told: it keeps the map out from under it.
    _measure();
  }

  // Who else is in this room, as a row of chips a solo game never shows. On
  // a phone the row is a single button that opens into the same list, so a
  // panel nobody asked for never sits on top of the map.
  function _renderPresence() {
    if (!_players) return;
    if (_solo || mp.players().length < 2) { _players.innerHTML = ''; return; }
    const you = mp.youId();
    const roster = mp.players().filter(p => p.id !== you);
    const chip = (p) => {
      const o = _others[p.id] || {};
      const cls = o.fallen ? 'fallen' : (p.connected ? 'live' : 'gone');
      const score = o.score != null ? o.score : '–';
      return '<button class="sh-plr sh-plr-' + cls + '" data-peek="' + _esc(p.id) + '">' +
        mp.renderAvatar(p, 22) +
        '<span class="sh-plr-nm">' + _esc(p.display_name || '?') + '</span>' +
        '<span class="sh-plr-sc">' + score + '</span>' +
        '</button>';
    };
    if (_narrow()) {
      _players.innerHTML =
        '<button id="sh-plr-toggle" class="sh-plr-toggle">👥<span class="sh-plr-count">' +
        roster.length + '</span></button>' +
        '<div class="sh-plr-list' + (_playersOpen ? ' open' : '') + '">' +
        roster.map(chip).join('') + '</div>';
      _players.querySelector('#sh-plr-toggle').onclick = () => {
        _playersOpen = !_playersOpen;
        _renderPresence();
      };
    } else {
      _players.innerHTML = '<div class="sh-plr-list open">' + roster.map(chip).join('') + '</div>';
    }
    _players.querySelectorAll('[data-peek]').forEach(el => {
      el.onclick = (ev) => { ev.stopPropagation(); _peek(el.dataset.peek); };
    });
  }

  // One frame of somebody else's hold, asked for on a tap. sh_peek_result
  // answers once, not on a subscription — see _drawPeek — so this asks again
  // every few seconds for as long as the sheet stays open.
  function _peek(pid) {
    if (!pid || pid === mp.youId() || !_peekOverlay) return;
    _peekFor = pid;
    _peekOverlay.classList.add('open');
    const p = mp.players().find(pl => pl.id === pid) || {};
    const nameEl = _peekOverlay.querySelector('#sh-peek-name');
    if (nameEl) nameEl.textContent = p.display_name || '?';
    const ask = () => { if (_peekFor) mp.send({ type: 'sh_peek', player_id: _peekFor }); };
    ask();
    clearInterval(_peekTimer);
    _peekTimer = setInterval(ask, 4000);
  }

  function _closePeek() {
    _peekFor = null;
    clearInterval(_peekTimer);
    _peekTimer = null;
    if (_peekOverlay) _peekOverlay.classList.remove('open');
  }

  // Read-only, and drawn on a canvas of its own: nothing here may touch
  // _hold, _cam or the render loop, or a peek could stall the very clock
  // _plausible on the server is checking it against.
  function _drawPeek(msg) {
    if (!_peekOverlay || !_peekCanvas || !_peekCtx || _peekFor !== msg.player_id) return;
    const state = msg.state;
    const statEl = _peekOverlay.querySelector('#sh-peek-stats');
    if (!state) {
      if (statEl) statEl.textContent = _t('sh_peek_empty');
      _peekCtx.clearRect(0, 0, _peekCanvas.width, _peekCanvas.height);
      return;
    }
    if (statEl) {
      statEl.textContent = ((state.stats && state.stats.score) || 0) + ' · ' +
        _fmtSpan(Math.round(state.elapsed || 0));
    }

    const box = _peekCanvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(100, Math.round(box.width * dpr));
    const h = Math.max(100, Math.round(box.height * dpr));
    if (_peekCanvas.width !== w) _peekCanvas.width = w;
    if (_peekCanvas.height !== h) _peekCanvas.height = h;

    const buildings = state.buildings || [];
    const keep = buildings.find(b => b.keep) || buildings[0];
    const cx = keep ? keep.x : W() / 2, cy = keep ? keep.y : W() / 2;
    const k = Math.min(w, h) / 1400;

    // A synchronous swap, restored before this function returns — the RAF
    // loop only ever runs between script turns, never inside one, so the
    // real hold and its own canvas are exactly as they were the moment this
    // returns. See the comment above: this is what keeps that true.
    const savedG = _g, savedHold = _hold;
    _g = _peekCtx; _hold = state;
    try {
      _g.setTransform(1, 0, 0, 1, 0, 0);
      _g.fillStyle = _css('--bg', '#11111b');
      _g.fillRect(0, 0, w, h);
      _g.setTransform(k, 0, 0, k, w / 2 - cx * k, h / 2 - cy * k);
      _g.fillStyle = _css('--surface1', '#181825');
      _g.fillRect(0, 0, W(), W());

      const acc = _css('--accent', '#89b4fa'), green = _css('--green', '#a6e3a1'),
            red = _css('--red', '#f38ba8');
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      for (const b of buildings) _drawBuilding(b, acc, green, red);
      for (const w2 of (state.workers || [])) _fig('worker', w2.x, w2.y, 20, acc, 1);
      for (const s of (state.soldiers || [])) _fig('soldier', s.x, s.y, 20, green, 1);
      for (const r of (state.raiders || [])) {
        const f = (state.factions || []).find(f2 => f2.id === r.fx);
        // A champion is the one thing worth picking out of somebody else's
        // raid at this size: whether the party over there has one is most of
        // what the player is looking at another hold to find out.
        _fig('raider', r.x, r.y, r.boss ? _bossSize(r.blvl || 1) - 4 : 22,
             (f && f.color) || red, 1);
      }
      // Somebody else's hold gets its badges put down here and now: they are
      // collected as the buildings are drawn, and a collection left standing
      // would come out on the next frame of this player's own map.
      _flushBadges();
    } finally {
      _g = savedG; _hold = savedHold;
    }
  }

  // The room is done: everyone's hold has fallen, ranked by score. The
  // multiplayer counterpart to _showOver — same overlay, a ranking instead
  // of one card, and no play-again: a room is one race, not a queue of them.
  function _showFinalStandings(standings) {
    _over = true;
    _spectating = false;
    _closePeek();
    const you = mp.youId();
    const rows = standings.map((s, i) => {
      const p = mp.players().find(pl => pl.id === s.player_id) || {};
      return '<div class="sh-rank-row' + (s.player_id === you ? ' me' : '') + '">' +
        '<div class="sh-rank-n">' + (i + 1) + '</div>' +
        mp.renderAvatar(p, 28) +
        '<div class="sh-rank-nm">' + _esc(p.display_name || '?') + '</div>' +
        '<div class="sh-rank-sc">' + (s.score || 0) + '</div>' +
        '<div class="sh-rank-tm">' + _fmtSpan(Math.round(s.elapsed || 0)) + '</div>' +
        '</div>';
    }).join('');
    _overlay.style.display = 'flex';
    _overlay.innerHTML =
      '<div class="sh-card sh-card-wide">' +
      '<div style="font-size:2.4rem;line-height:1">🏯</div>' +
      '<div class="sh-card-t">' + _esc(_t('sh_mp_over_title')) + '</div>' +
      '<div class="sh-rank-list">' + rows + '</div>' +
      '<div class="sh-card-r">' +
      '<a href="/pub/gamehub/?game=' + GAME_ID + '" class="sh-link">' + _esc(_t('sh_back_to_hub')) + '</a>' +
      '</div></div>';
  }

  // Twice a second: numbers only, no markup. Everything here is a text node
  // that already exists.
  function _syncHud() {
    if (!_hud || !_hold) return;
    const put = (k, v, color) => {
      const el = _hud.querySelector('[data-k="' + k + '"]');
      if (!el) return;
      const s = String(v);
      if (el.textContent !== s) el.textContent = s;
      el.style.color = color || '';
    };
    put('wood',  Math.floor(_hold.wood || 0));
    put('stone', Math.floor(_hold.stone || 0));
    put('iron',  Math.floor(_hold.iron || 0));
    put('people', _hold.workers.length + (_hold._cap ? ' / ' + _hold._cap : ''));
    put('army', _hold.soldiers.length + ' / ' + _holdSoldiers());
    put('score', _hold.stats.score || 0);
    // A chip goes red while that camp has men on the map: the raid says where
    // it came from before it arrives. The number on it is men, never the keep's
    // level — a camp can be high level and thin, or low level and swarming, and
    // the level told the player neither — and which men it counts is _facChip:
    // the party while one is out, the camp the rest of the time.
    for (const f of _hold.factions) {
      const el = _hud.querySelector('[data-fl="' + f.id + '"]');
      if (!el) continue;
      const s = String(_facChip(f));
      if (el.textContent !== s) el.textContent = s;
      el.parentNode.classList.toggle('war', _facOut(f) > 0);
    }
    _renderHint();
  }

  // The hold explains itself. Nothing else does: there is no tutorial, and a
  // player who has just built a house and sees two people walking in circles
  // has to be told why. First match wins, most urgent first.
  function _hintKey() {
    // Nothing has happened yet: the only thing to say is what the empty map is
    // waiting for.
    if (_hold.founding) return 'sh_hint_found';
    const bs = _hold.buildings;
    const has = (type) => bs.some(b => b.type === type && !b.keep);
    const pri = _hold.priority;

    if (_raiders.length && pri !== 'ammo') return 'sh_hint_raid';
    // The opening. A keep with no house has nobody in it and no way of getting
    // anybody, so the free house is the only thing there is to say — and once
    // it is standing, that nobody has to be told to work: the first timber is
    // being carried before the player has decided anything else.
    if (!has('house')) return 'sh_hint_house';
    if (!_hold.workers.length) return 'sh_hint_first_wood';
    // Towers only: the keep is never dry while the store has anything in it,
    // because the store is what it fires from.
    const dry = bs.some(b => b.type === 'tower' && !b.keep && b.built >= 1 &&
                            (b.ammo || 0) < _volley(b.lvl));
    if (dry && _hold.ammo >= 1 && pri !== 'ammo') return 'sh_hint_ammo';
    // A camp with its men already on the road outranks everything except a
    // raid that has arrived: this is the warning the player is meant to act on.
    const marching = _hold.factions.find(f => _raiders.some(r => r.fx === f.id));
    if (marching) return 'sh_hint_incoming';
    // Somebody is walking round the hold counting towers. He cannot be shot and
    // he is not an attack, but what he goes home with decides whether one comes.
    if (_hold.factions.some(f => f.scout && f.scout.phase === 'look'))
      return 'sh_hint_scout';
    // Nothing to work is a real dead end, and a quiet one: the hold looks
    // healthy and the people stand about because the last seam of its kind was
    // carried away and the new one has not been found yet.
    if (!_hold.deposits.length) return 'sh_hint_no_ground';
    if (!has('workshop')) return 'sh_hint_workshop';
    if (!has('tower') && _worstLvl() > 1) return 'sh_hint_tower';
    // A workshop that has run dry is the quietest way for a hold to lose: the
    // towers keep their rounds for one more raid and then stop.
    if (has('workshop') && (_hold.iron || 0) < 1) return 'sh_hint_no_iron';
    // Rounds made and never fetched: the priority is telling everyone to do
    // something else while the towers sit empty.
    if (bs.some(b => b.type === 'workshop' && b.built >= 1 && (b.ammo || 0) >= 3) &&
        pri !== 'ammo' && pri !== 'balanced') return 'sh_hint_fetch';
    if (_hold.workers.length && _hold.workers.every(w => !w.job)) return 'sh_hint_idle';
    if (_hold.workers.length < 4) return 'sh_hint_grow';
    return 'sh_hint_ok';
  }

  function _renderHint() {
    if (!_hint || !_hold) return;
    if (_over) { _hint.textContent = ''; return; }
    // Cached per key and per language: the text only has to be looked up when
    // the hold's situation changes, but it must follow a language switch.
    const lang = (window.mvmOS && window.mvmOS.lang) || 'en';
    const key  = _hintKey();
    if (_hint.dataset.key === key && _hint.dataset.lang === lang) return;
    _hint.dataset.key  = key;
    _hint.dataset.lang = lang;
    _hint.textContent  = _t(key);
  }

  // ── Build bar ─────────────────────────────────────────────────────────────
  function _renderBar() {
    if (!_bar || !_hold) return;
    // Nothing to build and nobody to build it until the hold is founded, and
    // a priority for two people who do not exist yet is noise.
    if (_over || _hold.founding) { _bar.innerHTML = ''; return; }

    let html = '<div class="sh-pri">';
    for (const p of PRIORITIES) {
      html += '<button class="sh-pbtn' + (_hold.priority === p ? ' on' : '') +
              '" data-pri="' + p + '">' + _esc(_t('sh_pri_' + p)) + '</button>';
    }
    html += '</div><div class="sh-builds">';
    for (const type of BUILD_ORDER) {
      const c = _newCost(type);
      const ok = _canPay(c);
      html += '<button class="sh-bbtn' + (_placing === type ? ' on' : '') + (ok ? '' : ' poor') +
              // On a phone the button is the mark alone, so the name has to be
              // carried somewhere a screen reader can still reach it.
              '" data-build="' + type + '" title="' + _esc(_t('sh_b_' + type)) +
              '" aria-label="' + _esc(_t('sh_b_' + type)) + '">' +
              '<span class="sh-gl">' + GLYPH[type] + '</span>' +
              '<span class="sh-nm">' + _esc(_t('sh_b_' + type)) + '</span>' +
              '<span class="sh-cost">' + _costLabel(c, true) + '</span>' +
              '</button>';
    }
    html += '</div>';
    _bar.innerHTML = html;

    _bar.querySelectorAll('[data-pri]').forEach(el => {
      el.onclick = () => {
        _hold.priority = el.dataset.pri;
        // Everyone reconsiders at once — that is what changing a priority is.
        for (const w of _hold.workers) if (!w.carry) w.job = null;
        _renderBar();
        _push();
      };
    });
    _bar.querySelectorAll('[data-build]').forEach(el => {
      el.onclick = () => {
        _placing = (_placing === el.dataset.build) ? null : el.dataset.build;
        _ghost = null;
        _selected = null; _selDep = null; _selFac = null; _selBoss = null;
        // Picking a building up shows what it would do before a spot is chosen:
        // the same panel a finished one opens, minus everything that only a
        // standing building can answer.
        //
        // Only where there is room for it. On a phone that panel is the width
        // of the screen, so opening it here meant picking up a tower and being
        // shown a wall of text instead of the ground you were about to put it
        // on. The strip says what is in hand; ℹ on it opens this when asked.
        if (_placing && !_narrow()) _previewPanel(_placing); else _closePanel();
        const run = _placing && LAID_IN_RUNS.has(_placing);
        _say(_placing ? _t(_touch ? (run ? 'sh_place_run_touch' : 'sh_place_touch')
                                  : (run ? 'sh_place_run' : 'sh_place_hint')) : '');
        _renderBar();
        _renderStrip();
      };
    });
    _markAffordable();
  }

  // Repaint the build bar's affordability in place, without touching a single
  // node's markup. Called twice a second, so it must stay cheap and must never
  // replace a button the finger is already travelling towards.
  function _markAffordable() {
    if (!_bar || !_hold || _over) return;
    _bar.querySelectorAll('[data-build]').forEach(el => {
      const cost = _newCost(el.dataset.build);
      el.classList.toggle('poor', !_canPay(cost));
      el.querySelectorAll('.sh-c').forEach(tag => {
        const res = tag.dataset.res;
        tag.classList.toggle('short', (_hold[res] || 0) < (cost[res] || 0));
      });
    });
  }

  function _say(text) {
    _toastText = text || '';
    _toast = text ? 2.6 : 0;
  }

  // ── Camera ────────────────────────────────────────────────────────────────
  // One place decides how the world maps onto the canvas, and both drawing and
  // tapping go through it — otherwise zooming in would move what you see away
  // from what you touch.
  // The HUD floats over the top of the canvas and the dock over the bottom, so
  // the part of it anybody can actually look at is the band between them. Both
  // are measured in CSS pixels and the canvas is in device pixels.
  function _insets() {
    const h = (_canvas && _canvas.height) || 1;
    return {
      top: Math.min(_hudH * _dpr, h * 0.3),
      bot: Math.min(_dockH * _dpr, h * 0.45),
    };
  }

  // How far out the camera is allowed to go: far enough that the whole world
  // fits the band, controls included. At exactly 1 the map fills the shorter
  // side of the canvas, which on a phone means its bottom edge lives under the
  // build bar for good — and that is where two of the four camps are.
  function _minZoom() {
    if (!_canvas) return 1;
    const w = _canvas.width || 1, h = _canvas.height || 1;
    const ins = _insets();
    const band = Math.max(h - ins.top - ins.bot, 120);
    return Math.max(0.4, Math.min(1, Math.min(w, band) / Math.min(w, h)));
  }

  function _view() {
    const w = _canvas.width || 1;
    const h = _canvas.height || 1;
    const ins = _insets();
    // At z = 1 the whole square world spans the shorter side of the canvas; the
    // longer side simply shows some ground beyond the map's edge. The camera
    // aims at the middle of the visible band rather than the middle of the
    // canvas, so nothing is permanently parked behind the controls.
    const k = (Math.min(w, h) / W()) * _cam.z;
    return { w, h, k, top: ins.top, bot: ins.bot,
             tx: w / 2 - _cam.x * k,
             ty: (ins.top + h - ins.bot) / 2 - _cam.y * k };
  }

  // Empty ground the camera is allowed to travel into past the map's edge,
  // measured on screen so it feels the same at every zoom. Without it the rim
  // of the map can only ever be looked at from the very edge of the view, with
  // the controls sitting on top of it.
  const _panPad = (k) => Math.min(W() * 0.25, 150 * _dpr / Math.max(k, 1e-6));

  function _clampCam() {
    if (!B || !_canvas) return;
    _cam.z = Math.max(_minZoom(), Math.min(ZOOM_MAX, _cam.z));
    const v = _view();
    if (!v.k) return;
    // Per axis, in world units: half of what the visible band shows. The
    // vertical one counts the band, not the whole canvas, so a map that fits
    // the canvas but not the band can still be panned — that is exactly the
    // case that used to hide the bottom corners.
    const hx = v.w / (2 * v.k);
    const hy = Math.max(v.h - v.top - v.bot, 1) / (2 * v.k);
    const m  = _panPad(v.k);
    const mid = W() / 2;
    // Where the map is smaller than the view across an axis it stays centred,
    // give or take the slack; where it is bigger the camera may travel the
    // full span, edge and corner included, plus the same slack.
    const lo = (half) => (half * 2 >= W() ? mid : 0) - m;
    const hi = (half) => (half * 2 >= W() ? mid : W()) + m;
    _cam.x = Math.max(lo(hx), Math.min(hi(hx), _cam.x));
    _cam.y = Math.max(lo(hy), Math.min(hi(hy), _cam.y));
  }

  // Zoom about a point in the world: that point stays where it is on screen,
  // which is what makes pinching feel like moving a map and not a slider.
  function _zoomAt(wx, wy, factor) {
    const before = _cam.z;
    _cam.z = Math.max(_minZoom(), Math.min(ZOOM_MAX, _cam.z * factor));
    const f = _cam.z / before;
    if (f !== 1) {
      _cam.x = wx + (_cam.x - wx) / f;
      _cam.y = wy + (_cam.y - wy) / f;
    }
    _clampCam();
    _draw();
  }

  function _world(ev) {
    const rect = _canvas.getBoundingClientRect();
    const v = _view();
    const px = (ev.clientX - rect.left) * (_canvas.width / (rect.width || 1));
    const py = (ev.clientY - rect.top) * (_canvas.height / (rect.height || 1));
    return { x: (px - v.tx) / v.k, y: (py - v.ty) / v.k };
  }

  // ── Map interaction ───────────────────────────────────────────────────────
  function _onDown(ev) {
    if (!_hold || _over) return;
    // The right button is a cancel, not a gesture: taking it into _ptrs would
    // start a pan that no pointerup arrives to end, because the context menu
    // that follows is prevented.
    if (ev.button === 2) return;
    _touch = ev.pointerType === 'touch' || ev.pointerType === 'pen';
    _ptrs.set(ev.pointerId, ev);
    // The ghost does not jump to a finger that has only just landed. It used
    // to, and the map then had two jobs at once: the same drag that was meant
    // to look around was dragging a tower about, so on a phone neither worked.
    // A finger aims by tapping and confirms with ✓; only a mouse, which can
    // hover, moves the ghost by moving.
    if (_placing && !_touch) _ghost = _snap(_placing, _world(ev));
    if (_canvas.setPointerCapture) { try { _canvas.setPointerCapture(ev.pointerId); } catch (_) {} }
    if (_ptrs.size === 1) { _pan = _world(ev); _moved = 0; }
    else if (_ptrs.size === 2) { _pan = null; _pinch = _spread(); }
  }

  function _onMove(ev) {
    // With a mouse the ghost follows the cursor whether or not anything is
    // pressed — that is what hover is for. A finger never drags the ghost.
    if (_placing && _hold && !_over && !_touch) _ghost = _snap(_placing, _world(ev));
    if (!_ptrs.has(ev.pointerId)) return;
    const prev = _ptrs.get(ev.pointerId);
    _ptrs.set(ev.pointerId, ev);
    _moved += Math.hypot(ev.clientX - prev.clientX, ev.clientY - prev.clientY);

    if (_ptrs.size === 2 && _pinch) {
      const now = _spread();
      const mid = _midWorld();
      if (now > 0) _zoomAt(mid.x, mid.y, now / _pinch);
      _pinch = now;
      return;
    }
    // Dragging works at every zoom now, including the one the game starts at.
    // Refusing to pan while the whole map fitted was the reason a first drag
    // did nothing: the map is wide enough that it never all fits on a phone,
    // and _clampCam already refuses on an axis with nothing to pan to.
    if (_ptrs.size === 1 && _pan) {
      // Drag the map itself: the point under the finger stays under it.
      const here = _world(ev);
      _cam.x += _pan.x - here.x;
      _cam.y += _pan.y - here.y;
      _clampCam();
      _draw();
    }
  }

  function _onUp(ev) {
    const had = _ptrs.size;
    _ptrs.delete(ev.pointerId);
    if (_ptrs.size < 2) _pinch = 0;
    // A tap is a press that did not travel: anything else was a gesture, and a
    // gesture must never place a building. A finger is allowed more travel than
    // a mouse — nobody holds a phone perfectly still.
    if (had === 1 && _moved < (_touch ? 16 : 10)) _tap(_world(ev));
    if (_ptrs.size === 0) { _pan = null; _moved = 0; }
  }

  function _onWheel(ev) {
    if (!_hold || _over) return;
    ev.preventDefault();
    const at = _world(ev);
    _zoomAt(at.x, at.y, ev.deltaY < 0 ? 1.18 : 1 / 1.18);
  }

  // The right button is the map's "never mind". The browser menu is suppressed
  // either way: on a game canvas it has nothing useful to offer, and it would
  // open on top of the hold.
  function _onContext(ev) {
    ev.preventDefault();
    if (!_hold || _over) return;
    _cancelPlacing();
  }

  function _onKey(ev) {
    if (!_hold || _over) return;
    if (ev.key !== 'Escape') return;
    // Only swallow the key when it actually cancelled something, so Escape
    // still reaches the hub — and its exit prompt — when nothing is held.
    if (_cancelPlacing()) ev.preventDefault();
  }

  function _spread() {
    const p = [..._ptrs.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY);
  }

  function _midWorld() {
    const p = [..._ptrs.values()];
    if (p.length < 2) return { x: _cam.x, y: _cam.y };
    return _world({ clientX: (p[0].clientX + p[1].clientX) / 2,
                    clientY: (p[0].clientY + p[1].clientY) / 2 });
  }

  // Whoever of them is standing under the tap and is a champion: out on the
  // march, or still in his own corner where he can be looked at before he ever
  // walks out.
  function _bossAt(w, slack) {
    const near = (u) => Math.hypot(u.x - w.x, u.y - w.y) <=
                        _bossSize(u.blvl || 1) * 0.6 + slack;
    const out = _raiders.find(r => r.boss && near(r));
    if (out) return out;
    for (const f of _hold.factions) {
      const home = f.army.find(u => u.boss && near(u));
      if (home) return home;
    }
    return null;
  }

  function _tap(w) {
    if (!_hold || _over || _paused) return;
    if (_placing) {
      const at = _snap(_placing, w);
      // A mouse click is a decision and goes down where it was clicked. A tap
      // only aims — the ✓ on the strip is what puts it there — and that holds
      // for every piece of a wall as well as the first. A finger is wide and a
      // wall is long: a tap that built by itself put squares where nobody
      // meant them, and taking one back costs half of it.
      if (!_touch) { _place(_placing, at.x, at.y); return; }
      _ghost = at;
      _syncStrip();
      _draw();
      return;
    }

    // A little more forgiving the further out you are: the same building is a
    // smaller target on a map drawn whole, and a fingertip is wider than a
    // cursor whatever the zoom.
    const slack = (_touch ? 14 : 8) + 10 / _cam.z;

    // A champion first. He is the one thing on the map that is worth asking a
    // question about while it is moving — how far his power carries — and he
    // is drawn over everything he is standing on, so a tap that landed on him
    // meant him. Tapping him again puts the circle away.
    const boss = _bossAt(w, slack);
    if (boss) {
      _selBoss = _selBoss === boss ? null : boss;
      _draw();
      return;
    }
    _selBoss = null;

    const hit = _hold.buildings.find(b => Math.hypot(b.x - w.x, b.y - w.y) <= _bc(b.type).size + slack);
    if (hit) { _selected = hit; _selDep = null; _selFac = null; _renderPanel(); return; }

    // Anything of theirs, anywhere on the map: a camp keep, a hut, a barracks.
    // Tapping one opens the same kind of panel a building of the player's own
    // does, because "what is that corner up to" is the question the whole map
    // is now built around.
    for (const f of _hold.factions) {
      const b = f.buildings.find(x => Math.hypot(x.x - w.x, x.y - w.y) <= _facSize(x.type) + slack);
      if (b) {
        _selFac = f; _selected = null; _selDep = null;
        _renderFacPanel();
        return;
      }
    }

    // Nothing built here — but a deposit under the tap answers the question
    // "how far from this can I build", which is the reason the rings came off
    // the deposits in the first place.
    _selected = null; _selFac = null; _closePanel();
    _selDep = _hold.deposits.find(d =>
      d.amount > 0 && Math.hypot(d.x - w.x, d.y - w.y) <= _depR(d) + slack) || null;
  }

  // Put the camera on something, at a zoom. Everything that moves the view on
  // the player's behalf goes through here.
  function _lookAt(at, z) {
    if (!at) return;
    if (z) _cam.z = Math.max(_minZoom(), Math.min(ZOOM_MAX, z));
    _cam.x = at.x; _cam.y = at.y;
    _clampCam();
    _draw();
  }

  // Close enough in to read the hold, on any screen. The map is four times the
  // area it was, so opening it whole would put the keep a few pixels across —
  // the game would begin by showing the player nothing they could use.
  function _homeZoom() {
    // The short side of the view shows exactly W()/z of the world, so asking
    // for a span is asking for a zoom.
    const want = _narrow() ? 1400 : 2000;    // how much ground to have in view
    return Math.max(_minZoom(), Math.min(ZOOM_MAX, W() / want));
  }

  // ── Building panel ────────────────────────────────────────────────────────
  // What a building of this kind is worth at a given level, as a list of rows.
  // It takes a level rather than a building so that one description serves
  // three questions: what would this be if I built it, what is it now, and what
  // would it become. `b` is the standing building when there is one — only the
  // rows that count something present (rounds in the magazine, ore left in the
  // ground) need it, and those are the rows an upgrade column has nothing to
  // say about.
  function _statList(type, l, b) {
    const rows = [];
    const row = (label, value, now) => rows.push({ label: label, value: value, now: !!now });

    if (type === 'tower') {
      row(_t('sh_stat_damage'), Math.round(_lv('tower', l, 'damage')) + ' × ' + _barrels(l));
      row(_t('sh_stat_rate'), _reload(l).toFixed(2) + 's');
      row(_t('sh_stat_range'), Math.round(_lv('tower', l, 'range')));
      // How much it holds is a property of the level and belongs in the
      // comparison; how much is in it right now is not, and would only ever
      // show a dot there. Two rows, so the upgrade can say what it widens.
      //
      // The keep has one magazine, not two: it is the storehouse, and it fires
      // out of it. So it reads the store's capacity where a tower reads its
      // own, and the hold's rounds where a tower reads what is in its rack.
      const keep = b ? b.keep : false;
      row(_t('sh_stat_mag'), String(keep ? _keepStore(l) : _lv('tower', l, 'mag')));
      // What a volley takes out of it, which is the other half of the same
      // question: a deeper magazine that spends faster is not more shots.
      row(_t('sh_stat_volley'), _volley(l).toFixed(2));
      if (b) row(_t('sh_stat_loaded'), String(Math.floor(keep ? (_hold.ammo || 0) : (b.ammo || 0))), true);
    } else if (type === 'house') {
      // The house is paid for once and the people are what it pays out, so the
      // rows say how many and how soon — the two questions somebody watching an
      // empty house asks — and nothing about a price, because there is none.
      row(_t('sh_stat_people'), _houseCap(l));
      row(_t('sh_stat_moves_in'), Math.round(_lv('house', l, 'spawn')) + 's');
      if (b) row(_t('sh_stat_living'),
                 _hold.workers.length + ' / ' + (_hold._cap || 0), true);
    } else if (type === 'workshop') {
      const per = _lv('workshop', l, 'iron_per_ammo');
      row(_t('sh_stat_rate_ammo'), (_lv('workshop', l, 'rate') * 60).toFixed(1));
      row(_t('sh_stat_ammo_cost'), RES_GLYPH.iron + ' ' + per.toFixed(2));
      row(_t('sh_stat_stock'), String(_lv('workshop', l, 'stock')));
      if (b) row(_t('sh_stat_waiting'), String(Math.floor(b.ammo || 0)), true);
    } else if (type === 'barracks') {
      // A barracks looks like it is doing nothing, because most of the time it
      // is: its soldiers stand outside it and only move when a raider comes
      // near. So the rows have to answer the questions that idleness raises —
      // how many are supposed to be out there, how long the next one takes,
      // what he costs, and how many are actually standing there now.
      row(_t('sh_stat_soldiers'), _lv('barracks', l, 'soldiers'));
      row(_t('sh_stat_damage'), Math.round(_lv('barracks', l, 'damage')));
      row(_t('sh_stat_soldier_hp'), Math.round(_lv('barracks', l, 'hp_soldier')));
      row(_t('sh_stat_muster'), Math.round(_muster(l)) + 's');
      row(_t('sh_stat_mend'), Math.round(1 / HEAL_RATE) + 's');
      row(_t('sh_stat_arm'), _stripTags(_costLabel(_armCost(l))));
      if (b) row(_t('sh_stat_onguard'),
                 String(_hold.soldiers.filter(s => s.from === b.id).length), true);
    } else if (type === 'wall') {
      // Standing in the way is all a wall does, so how much of it there is to
      // chew through is the whole stat — and it is the one that jumps when the
      // wall stops being timber and becomes stone.
      row(_t('sh_stat_toughness'), Math.round(_maxHp('wall', l)));
      const c = _bc('wall');
      row(_t('sh_stat_material'),
          _t(c.stone_from && l >= c.stone_from ? 'sh_mat_stone' : 'sh_mat_wood'));
    }
    return rows;
  }

  // A single line outside the comparison table — the ones that have no "after"
  // to show, like the standing damage or the price of the building itself.
  function _statRow(label, value) {
    return '<div class="sh-row"><span>' + _esc(label) + '</span>' +
           '<b>' + _esc(value) + '</b></div>';
  }

  // _costLabel wraps each material in a span so the build bar can colour them.
  // A stat row is plain text, so the markup comes back off.
  function _stripTags(html) {
    return String(html).replace(/<[^>]*>/g, '');
  }

  // The stat table. With `next` it grows a second column showing what each
  // number becomes one level up, so the upgrade price can be judged against
  // what it buys instead of being taken on faith.
  function _statTable(type, lvl, b, next) {
    const now  = _statList(type, lvl, b);
    const then = next ? _statList(type, lvl + 1, b) : null;
    let html = '';
    if (then) {
      html += '<div class="sh-row sh-hdr"><span></span>' +
              '<b>' + _esc(_t('sh_col_now')) + '</b>' +
              '<b class="sh-next">' + _esc(_t('sh_col_next')) + '</b></div>';
    }
    now.forEach((r, i) => {
      const after = then && then[i] && !r.now && then[i].value !== r.value
        ? '<b class="sh-next">' + _esc(then[i].value) + '</b>'
        : (then ? '<b class="sh-next sh-same">·</b>' : '');
      html += '<div class="sh-row"><span>' + _esc(r.label) + '</span>' +
              '<b>' + _esc(r.value) + '</b>' + after + '</div>';
    });
    return html;
  }

  // The panel is refreshed twice a second — hitpoints, rounds, whether the
  // purse has caught up with the price — and every refresh used to replace the
  // whole of it, buttons included. Press "upgrade", have the tick land between
  // the press and the release, and the button the release belonged to no
  // longer exists: the tap goes nowhere. It reads as the game ignoring you,
  // and it happens more the longer the finger is down, which is exactly what
  // a careful press is. The build bar has always known this — see the note on
  // _markAffordable — and the panel is the same thing with the same answer.
  //
  // So the panel is never rewritten under a finger, and never rewritten when
  // the markup has not actually changed.
  let _panelHtml = '';
  let _panelKey  = '';
  let _panelDown = 0;

  function _panel() {
    let panel = _root.querySelector('#sh-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'sh-panel';
      panel.addEventListener('pointerdown', () => { _panelDown = Date.now(); });
      // Let go, cancelled, or the finger has left the panel: the refresh is
      // allowed back in on the next tick rather than in the middle of the
      // click still being dispatched, which is what the timeout is for.
      const free = () => setTimeout(() => { _panelDown = 0; }, 0);
      panel.addEventListener('pointerup', free);
      panel.addEventListener('pointercancel', free);
      panel.addEventListener('pointerleave', free);
      _root.appendChild(panel);
    }
    return panel;
  }

  // Put markup in the panel, or leave it exactly as it is. The key is what the
  // panel is about: two towers at the same level with the same rounds in them
  // write the same markup, and swapping selection between them has to rebind
  // the buttons even though nothing on screen moves.
  function _panelSet(panel, key, html) {
    if (key === _panelKey && html === _panelHtml) return false;
    // Held no longer than a real press can last, so a pointerup that never
    // arrives cannot leave the panel frozen.
    if (_panelDown && Date.now() - _panelDown < 3000) return false;
    panel.innerHTML = html;
    _panelHtml = html;
    _panelKey  = key;
    return true;
  }

  function _renderPanel() {
    const b = _selected;
    if (!b || !_hold.buildings.includes(b)) { _closePanel(); return; }
    const panel = _panel();
    const name = b.keep ? _t('sh_b_keep') : _t(b.gate ? 'sh_b_gate' : 'sh_b_' + b.type);
    const desc = b.keep ? _t('sh_d_keep') : _t(b.gate ? 'sh_d_gate' : 'sh_d_' + b.type);
    const hp   = Math.max(0, Math.round((b.hp / _maxHp(b.type, b.lvl, b.keep)) * 100));
    const max  = _atMax(b.lvl);
    const cost = _cost(b.type, b.lvl + 1);

    let action;
    if (b.built < 1) {
      action = '<div class="sh-note">' + _esc(_t('sh_building_up', { n: Math.round(b.built * 100) })) + '</div>';
    } else if (b.up != null) {
      action = '<div class="sh-note">' + _esc(_t('sh_building_up', { n: Math.round(b.up * 100) })) + '</div>';
    } else if (max) {
      action = '<div class="sh-note">' + _esc(_t('sh_max_level')) + '</div>';
    } else {
      action = '<button id="sh-up" class="sh-go' + (_canPay(cost) ? '' : ' poor') + '">' +
               // Marked, like the build bar: when the upgrade is out of reach
               // the button should name which material is holding it up, not
               // just refuse as a whole.
               _esc(_t('sh_upgrade')) + ' · ' + _costLabel(cost, true) + '</button>';
    }

    const html =
      '<div class="sh-head"><span class="sh-gl">' +
        (b.keep ? GLYPH.keep : b.gate ? GLYPH.gate : GLYPH[b.type]) + '</span>' +
      '<span><b>' + _esc(name) + '</b><small>' + _esc(_t('sh_level', { n: b.lvl })) + '</small></span>' +
      '<button id="sh-x" class="sh-x">✕</button></div>' +
      '<div class="sh-desc">' + _esc(desc) + '</div>' +
      _stalled(b) +
      _statRow(_t('sh_stat_hp'), hp + '%') +
      _mending(b) +
      // The upgrade column is only worth the width when there is an upgrade to
      // judge: at max level, or mid-build, it would be a column of dots.
      _statTable(b.type, b.lvl, b, !max && b.built >= 1 && b.up == null) +
      action +
      // A way through, on the wall itself: the wall is the only thing on the
      // map with a second thing it can be, and the piece being looked at is
      // where that decision belongs.
      (b.type === 'wall' && b.built >= 1
        ? '<button id="sh-gate" class="sh-go' +
          (b.gate || _canPay(_newCost('wall')) ? '' : ' poor') + '">' +
          _esc(_t(b.gate ? 'sh_gate_shut' : 'sh_gate_cut')) +
          (b.gate ? '' : ' · ' + _costLabel(_newCost('wall'), true)) + '</button>'
        : '') +
      // The refund is on the button, not in the confirmation: whether pulling
      // something down is worth it is decided while looking at it.
      (b.keep ? '' : '<button id="sh-del" class="sh-del">' + _esc(_t('sh_demolish')) +
        ' · ' + _refundLabel(b) + '</button>');

    panel.style.display = 'flex';
    if (!_panelSet(panel, 'b' + b.id, html)) return;
    panel.querySelector('#sh-x').onclick = () => { _selected = null; _closePanel(); };
    const up = panel.querySelector('#sh-up');
    if (up) up.onclick = () => _upgrade(b);
    const gate = panel.querySelector('#sh-gate');
    if (gate) gate.onclick = () => _gateWay(b);
    const del = panel.querySelector('#sh-del');
    if (del) del.onclick = () => { if (confirm(_t('sh_demolish_ask'))) _demolish(b); };
  }

  // Why this building is standing there doing nothing, when it is. A finished
  // building that produces nothing looks identical to one that is working, and
  // a player watching a forge make no rounds for five minutes has no way to
  // tell whether it is broken, slow, or waiting for something. It is almost
  // always waiting for something, and the panel is where they will look.
  // Damage is mended by the same hands that raise scaffolding, so a chewed
  // building is work in hand and not a fault: say whether anybody is on it.
  function _mending(b) {
    if (b.built < 1 || b.up != null || !_hurt(b)) return '';
    const on = _hold.workers.some(w => w.job === 'build' && w.target === b.id);
    return '<div class="sh-note">' + _esc(_t(on ? 'sh_mending' : 'sh_mend_wait')) + '</div>';
  }

  function _stalled(b) {
    if (b.built < 1) return '';
    let why = null;

    if (b.type === 'workshop') {
      const per = _lv('workshop', b.lvl, 'iron_per_ammo');
      // Iron is the only thing a forge consumes, and running out is silent.
      if (per > 0 && (_hold.iron || 0) < per) {
        why = _t('sh_why_no_iron');
      } else if ((b.ammo || 0) >= _lv('workshop', b.lvl, 'stock')) {
        // A full floor is not a fault, but it does explain the stopped forge.
        why = _t('sh_why_shop_full');
      }
    } else if (b.type === 'barracks') {
      if (!_canPay(_armCost(b.lvl))) why = _t('sh_why_no_arms');
    } else if (b.type === 'house') {
      // A full house is doing its whole job and still looks asleep.
      if (_hold.workers.length >= (_hold._cap || 0)) why = _t('sh_why_house_full');
    }

    return why ? '<div class="sh-why">' + _esc(why) + '</div>' : '';
  }

  // The same panel, for a building that does not exist yet: what it does, what
  // it would be worth at level 1, and what it costs. Deciding what to build is
  // the one moment a player has no way to look any of that up, because until
  // now it could only be read off something already standing.
  function _previewPanel(type) {
    const panel = _panel();
    // The keep is a special case: it is not built, it is where the hold begins,
    // so there is no price to show and the stat table has nothing to read a
    // level off. What matters is where it is being put down.
    const found = type === 'keep';
    const cost = found ? null : _newCost(type);
    const html =
      '<div class="sh-head"><span class="sh-gl">' + GLYPH[type] + '</span>' +
      '<span><b>' + _esc(_t('sh_b_' + type)) + '</b>' +
      '<small>' + _esc(_t(found ? 'sh_found_free' : 'sh_preview')) + '</small></span>' +
      '<button id="sh-x" class="sh-x">✕</button></div>' +
      '<div class="sh-desc">' + _esc(_t('sh_d_' + type)) + '</div>' +
      (found ? '' : _statTable(type, 1, null, false) +
                    _statRow(_t('sh_stat_cost'), _stripTags(_costLabel(cost)))) +
      '<div class="sh-note">' +
        _esc(found ? _t(_touch ? 'sh_found_touch' : 'sh_found_hint')
                   : _t(_touch ? (LAID_IN_RUNS.has(type) ? 'sh_place_run_touch' : 'sh_place_touch')
                               : (LAID_IN_RUNS.has(type) ? 'sh_place_run' : 'sh_place_hint'))) + '</div>' +
      (found ? '<div class="sh-why">' + _esc(_t('sh_found_where')) + '</div>' : '');

    panel.style.display = 'flex';
    if (!_panelSet(panel, 'p' + type, html)) return;
    // Closing the keep's card only puts the card away: there is nothing to give
    // up on, so the map stays in founding mode underneath it.
    panel.querySelector('#sh-x').onclick = () => { if (found) _closePanel(); else _cancelPlacing(); };
  }

  // What one of the four corners is up to. Everything in here is something the
  // player could have worked out by looking at the camp, which is the point:
  // it reads what is on the map rather than telling the player a secret. How
  // many men are standing about, how many it wants before it marches, how many
  // it has already sent and how many of those never went home again.
  // Who their champion is, in one line: what he carries and what the keep was
  // at when it made him. He does not grow after he walks out — a keep raised
  // behind him makes the next one better, not this one.
  function _bossLine(f) {
    const b = f.army.find(s => s.boss) ||
              _raiders.find(r => r.fx === f.id && r.boss);
    if (!b) return _t('sh_boss_none');
    return _t('sh_boss_at', {
      power: _t('sh_boss_' + (b.power || 'warlord')),
      n: b.blvl || 1,
    });
  }

  function _renderFacPanel() {
    const f = _selFac;
    if (!f) { _closePanel(); return; }
    const panel = _panel();
    const out   = _raiders.filter(r => r.fx === f.id).length;
    const need  = _facNeed(f);
    const known = f.known;
    const rows =
      _statRow(_t('sh_fac_level'), String(f.lvl)) +
      _statRow(_t('sh_fac_people'), f.workers.length + ' / ' + _facCap(f)) +
      // No ceiling on either of these any more, on either side of the map: a
      // camp buys what it can pay for, exactly as the hold does, so what is
      // worth showing is what is standing.
      _statRow(_t('sh_fac_huts'), _facCount(f, 'hut')) +
      _statRow(_t('sh_fac_barracks'), _facCount(f, 'barracks')) +
      _statRow(_t('sh_fac_army'),
               _facMen(f) + ' / ' + (known ? need : '?')) +
      // Their keep's own man, and what he does. A power the player cannot read
      // is a power the player cannot answer.
      _statRow(_t('sh_fac_boss'), _bossLine(f)) +
      // What their last look told them, which is the only thing they act on.
      _statRow(_t('sh_fac_scout'),
               f.scout ? _t('sh_scout_out')
               : known ? _t('sh_scout_done')
               : _t('sh_scout_home', { have: f.army.length, n: f.needFloor || _sc().scout_min || 1 })) +
      _statRow(_t('sh_fac_counted'),
               known ? _t('sh_fac_counted_at', { n: known.threat, t: known.towers })
                     : _t('sh_fac_never')) +
      _statRow(_t('sh_fac_marching'), String(out)) +
      _statRow(_t('sh_fac_sent'), String(f.stats.sent || 0)) +
      _statRow(_t('sh_fac_killed'), String(f.stats.lost || 0)) +
      _statRow(_t('sh_fac_store'),
               _stripTags(_costLabel({ wood: Math.floor(f.wood || 0),
                                       stone: Math.floor(f.stone || 0),
                                       iron: Math.floor(f.iron || 0) })));
    const note = f.grace > 0 ? _t('sh_fac_quiet', { n: Math.ceil(f.grace) })
               : out ? _t('sh_fac_attacking')
               : f.scout ? _t('sh_fac_looking')
               : !known ? _t('sh_fac_no_report')
               : f.army.length >= need ? _t('sh_fac_ready')
               : _t('sh_fac_too_weak', { n: need, have: f.army.length });

    const html =
      '<div class="sh-head"><span class="sh-gl" style="color:' + f.color + '">' + GLYPH.fkeep + '</span>' +
      '<span><b>' + _esc(_facName(f)) + '</b><small>' + _esc(_t('sh_fac_camp')) + '</small></span>' +
      '<button id="sh-x" class="sh-x">✕</button></div>' +
      '<div class="sh-desc">' + _esc(_t('sh_fac_about')) + '</div>' +
      rows +
      '<div class="sh-note">' + _esc(note) + '</div>';
    panel.style.display = 'flex';
    if (!_panelSet(panel, 'f' + f.id, html)) return;
    panel.querySelector('#sh-x').onclick = () => { _selFac = null; _closePanel(); };
  }

  function _closePanel() {
    const panel = _root && _root.querySelector('#sh-panel');
    if (panel) panel.style.display = 'none';
    // Shut and reopened is a fresh panel, whatever it last held: the markup it
    // is compared against goes with it.
    _panelHtml = ''; _panelKey = ''; _panelDown = 0;
  }

  // ── The placing strip ─────────────────────────────────────────────────────
  // On a phone the panel used to open the moment a building was picked up, and
  // it covered the map — so the player was reading about a tower instead of
  // looking at where the tower was going. The strip is what a phone gets
  // instead: one line above the dock saying what is in hand and what it costs,
  // with the description one tap away for anyone who wants it. On a wide
  // screen there is room for both, and the panel opens as it always did.
  function _renderStrip() {
    if (!_strip) return;
    // The dock changes height when the strip comes and goes, and the panel is
    // measured off the dock, so the measurement is retaken every time.
    if (!_placing) { _strip.innerHTML = ''; _strip.style.display = 'none'; _measure(); return; }
    // The keep is founded, not bought: no price, and no ✕ — there is nothing to
    // go back to until it stands.
    const found = _placing === 'keep';
    const cost = found ? null : _newCost(_placing);
    _strip.style.display = 'flex';
    _strip.innerHTML =
      '<span class="sh-gl">' + GLYPH[_placing] + '</span>' +
      '<span class="sh-pnm">' + _esc(_t('sh_b_' + _placing)) + '</span>' +
      '<span class="sh-pcost">' + (found ? _esc(_t('sh_found_free')) : _costLabel(cost, true)) + '</span>' +
      '<button class="sh-pb" data-p="info">ℹ</button>' +
      '<button class="sh-pb ok" data-p="ok">✓</button>' +
      (found ? '' : '<button class="sh-pb" data-p="no">✕</button>');
    _strip.querySelectorAll('[data-p]').forEach(el => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const what = el.dataset.p;
        if (what === 'no') return _cancelPlacing();
        if (what === 'info') return _previewPanel(_placing);
        // ✓ puts it down where the ghost is standing. On a touch screen the
        // ghost is aimed by tapping the map, so this is the second half of
        // "point, then confirm" — and it is what stops a finger that meant to
        // drag the map from dropping a wall in the wrong field.
        if (!_ghost) return _say(_t('sh_aim_first'));
        _place(_placing, _ghost.x, _ghost.y);
      };
    });
    _measure();
    _syncStrip();
  }

  // Twice a second, cheap: only whether what is in hand can be paid for.
  function _syncStrip() {
    if (!_strip || !_placing || !_hold) return;
    const cost = _placing === 'keep' ? null : _newCost(_placing);
    const ok = !!_ghost && _canPlace(_placing, _ghost.x, _ghost.y) === null;
    _strip.classList.toggle('poor', !!cost && !_canPay(cost));
    if (cost) _strip.querySelectorAll('.sh-c').forEach(tag => {
      tag.classList.toggle('short', (_hold[tag.dataset.res] || 0) < (cost[tag.dataset.res] || 0));
    });
    const okBtn = _strip.querySelector('[data-p="ok"]');
    if (okBtn) okBtn.classList.toggle('dim', !ok);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  function _css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // The colours everything on the map is built out of. Read once a frame: the
  // theme cannot change halfway through one, and asking the stylesheet per
  // building would cost a layout lookup for every hut on the map.
  let _pal = null;
  function _palette() {
    return {
      timber: _css('--peach', '#cba06a'),
      beam:   '#8a6a45',
      stone:  _css('--fg2', '#a6adc8'),
      slab:   '#6c7086',
      roof:   _css('--red', '#f38ba8'),
      canvas: _css('--green', '#a6e3a1'),
      flag:   _css('--accent', '#89b4fa'),
      fire:   _css('--yellow', '#f9e2af'),
      hole:   '#11111b',
      // The ground: standing timber and bare rock, which are neither built nor
      // painted in the hold's own colours.
      trunk:   '#6b4a30',
      leaf:    '#3c7546',
      leaf2:   '#54a063',
      rock:       '#6c7086',
      rockTop:    '#8b90a6',
      oreRock:    '#6f6157',
      oreRockTop: '#8f7e6f',
      ore:        '#e09a55',
    };
  }

  function _poly(pts, fill) {
    _g.fillStyle = fill;
    _g.beginPath();
    _g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) _g.lineTo(pts[i][0], pts[i][1]);
    _g.closePath(); _g.fill();
  }
  function _box(x, y, w, h, fill) { _g.fillStyle = fill; _g.fillRect(x, y, w, h); }
  // Battlements along the top of something stone: four teeth across the width.
  function _crenels(x, y, w, h, fill) {
    const n = 4, step = w / (n * 2 - 1);
    for (let i = 0; i < n; i++) _box(x + i * step * 2, y, step, h, fill);
  }

  // ── The ground itself ─────────────────────────────────────────────────────
  // A forest is trees and a seam is rock, both of them spread over the ground
  // they actually occupy. One icon on a pin said "wood is somewhere hereabouts"
  // and nothing else — not how much of it there is, and not which ground it is
  // that no workshop may be dropped on. What is drawn here is what the rule in
  // _canPlace refuses and what the tap in _pick lands on, so the map cannot lie
  // about its own edges.
  //
  // Trees and rocks stand where they stand. As the resource is carried away the
  // patch closes in from the rim, and whatever is now outside it is simply gone
  // — a wood being felled, not a wood shrinking away from the axe.
  function _rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function _tree(x, y, s, p) {
    _box(x - 1.1 * s, y - 1.5 * s, 2.2 * s, 4.6 * s, p.trunk);
    _poly([[x - 4.6 * s, y - 0.8 * s], [x, y - 8.2 * s], [x + 4.6 * s, y - 0.8 * s]], p.leaf);
    _poly([[x - 3.4 * s, y - 4.2 * s], [x, y - 11 * s], [x + 3.4 * s, y - 4.2 * s]], p.leaf2);
  }
  function _rock(x, y, s, p, ore) {
    _poly([[x - 4.4 * s, y + 2 * s], [x - 3 * s, y - 2.4 * s], [x + 0.4 * s, y - 4 * s],
           [x + 3.9 * s, y - 1.4 * s], [x + 3.4 * s, y + 2.4 * s]],
          ore ? p.oreRock : p.rock);
    _poly([[x - 3 * s, y - 2.4 * s], [x + 0.4 * s, y - 4 * s], [x + 1.6 * s, y - 1 * s],
           [x - 1.4 * s, y - 0.4 * s]], ore ? p.oreRockTop : p.rockTop);
    // What makes a seam an iron seam and not a heap of stone: the ore showing
    // in the broken faces. Small, but the only thing telling the two apart at
    // a glance, so it is drawn in the one colour nothing else on the map uses.
    if (ore) {
      _poly([[x - 2.2 * s, y + 1.6 * s], [x - 0.4 * s, y + 0.4 * s], [x + 0.6 * s, y + 2.2 * s]], p.ore);
      _poly([[x + 1.2 * s, y - 2.4 * s], [x + 2.8 * s, y - 1.6 * s], [x + 1.4 * s, y - 0.6 * s]], p.ore);
    }
  }
  const DEP_ART = {
    wood:  { ground: '#243021', room: 12, per: 115, draw: (x, y, s, p) => _tree(x, y, s, p) },
    stone: { ground: '#2c3145', room: 13, per: 150, draw: (x, y, s, p) => _rock(x, y, s, p, false) },
    iron:  { ground: '#312822', room: 13, per: 150, draw: (x, y, s, p) => _rock(x, y, s, p, true) },
  };

  // Where every tree of one wood stands, worked out once. Kept beside the
  // deposit rather than on it: what the server is told about a forest is how
  // much timber is in it, not the address of each tree.
  const _depArt = new WeakMap();
  function _depGrowth(d) {
    const full = _depMaxR(d);
    let art = _depArt.get(d);
    if (art && art.full === full) return art;
    const art0 = DEP_ART[d.kind] || DEP_ART.stone;
    const rnd = _rng(Math.round(d.x * 73 + d.y * 149 + d.kind.charCodeAt(0) * 7919));
    const want = Math.max(5, Math.min(70, Math.round((full * full) / art0.per)));
    const items = [];
    for (let n = 0; n < want * 40 && items.length < want; n++) {
      const a = rnd() * Math.PI * 2;
      // Square-rooted so they fall evenly over the ground instead of crowding
      // into the middle of it.
      const rr = Math.sqrt(rnd()) * (full - 4);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (items.some(i => Math.hypot(i.x - x, i.y - y) < art0.room)) continue;
      items.push({ x: x, y: y, s: 0.8 + rnd() * 0.5, r: Math.hypot(x, y) });
    }
    // Furthest out first, so what is drawn last is what stands nearest the eye.
    items.sort((p, q) => p.y - q.y);
    const edge = [];
    for (let i = 0; i < 14; i++) edge.push(0.82 + rnd() * 0.18);
    art = { full: full, items: items, edge: edge, art: art0 };
    _depArt.set(d, art);
    return art;
  }

  function _drawDeposit(d, v) {
    const r = _depR(d);
    if (r <= 0 || d.amount <= 0) return;
    if (v && v.k) {
      const x0 = -v.tx / v.k, y0 = -v.ty / v.k;
      if (d.x + r < x0 || d.y + r < y0 ||
          d.x - r > x0 + v.w / v.k || d.y - r > y0 + v.h / v.k) return;
    }
    const g = _depGrowth(d);
    const p = _pal || (_pal = _palette());
    // The ground it covers, drawn as one uneven patch. Uneven because a circle
    // reads as a marker drawn on the map and this is meant to read as ground.
    _g.globalAlpha = 0.75;
    _g.fillStyle = g.art.ground;
    _g.beginPath();
    for (let i = 0; i < g.edge.length; i++) {
      const a = (i / g.edge.length) * Math.PI * 2;
      const rr = r * g.edge[i];
      const x = d.x + Math.cos(a) * rr, y = d.y + Math.sin(a) * rr * 0.88;
      if (i === 0) _g.moveTo(x, y); else _g.lineTo(x, y);
    }
    _g.closePath(); _g.fill();
    _g.globalAlpha = 1;
    for (const it of g.items) {
      if (it.r > r) continue;                 // this one has been carried away
      g.art.draw(d.x + it.x, d.y + it.y * 0.88, it.s, p);
    }
  }

  // Every building has a body of its own, drawn from the same short list of
  // materials. A hold used to be a field of emoji — perfectly readable, but
  // nothing you would call a town, and a workshop looked no more built than a
  // spanner lying on the grass. The icons are still the icons: they belong on
  // the buttons and in the panel, where a name is what is wanted.
  //
  // Everything is drawn in units of r, the building's own size, so the same
  // body serves the ghost, the scaffolding and the finished thing.
  const BODY = {
    house: (r, c, p) => {
      _box(-0.68 * r, -0.12 * r, 1.36 * r, 0.82 * r, c('timber'));
      _poly([[-0.92 * r, -0.1 * r], [0, -0.92 * r], [0.92 * r, -0.1 * r]], c('roof'));
      _box(-0.16 * r, 0.26 * r, 0.32 * r, 0.44 * r, c('hole'));      // doorway
      _box(0.24 * r, 0.06 * r, 0.24 * r, 0.22 * r, c('fire'));       // lit window
    },
    // What the four corners build. Deliberately not the player's own shapes:
    // from across the map a camp has to read as somebody else's at a glance,
    // and the colour alone is not enough at the zoom the whole world is at.
    hut: (r, c, p) => {
      // A round shelter under hide, banded in the camp's own colour.
      _g.fillStyle = c('timber');
      _g.beginPath(); _g.ellipse(0, 0.22 * r, 0.82 * r, 0.6 * r, 0, Math.PI, 0); _g.fill();
      _g.fillStyle = c('flag');
      _g.beginPath(); _g.ellipse(0, -0.06 * r, 0.84 * r, 0.42 * r, 0, Math.PI, 0); _g.fill();
      _box(-0.2 * r, 0.16 * r, 0.4 * r, 0.5 * r, c('hole'));         // the doorway
      _box(-0.05 * r, -0.95 * r, 0.1 * r, 0.5 * r, c('beam'));       // the roof pole
    },
    barracks_f: (r, c, p) => {
      // A long shed behind a spiked line, with the camp's standard over it.
      _box(-0.95 * r, -0.02 * r, 1.9 * r, 0.66 * r, c('timber'));
      _poly([[-1.05 * r, 0], [0, -0.72 * r], [1.05 * r, 0]], c('flag'));
      _box(-0.16 * r, 0.22 * r, 0.32 * r, 0.44 * r, c('hole'));
      for (const dx of [-0.7, -0.35, 0, 0.35, 0.7]) {
        _poly([[dx * r - 0.06 * r, 0.72 * r], [dx * r, 0.4 * r],
               [dx * r + 0.06 * r, 0.72 * r]], c('beam'));
      }
    },
    fkeep: (r, c, p) => {
      // A stockade: a ring of stakes round a hall, and a mast with their
      // colours on it that can be picked out from the far side of the map.
      _g.fillStyle = c('beam');
      _g.beginPath(); _g.ellipse(0, 0.3 * r, 1.15 * r, 0.62 * r, 0, 0, Math.PI * 2); _g.fill();
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const sx = Math.cos(a) * 1.12 * r, sy = 0.3 * r + Math.sin(a) * 0.6 * r;
        _poly([[sx - 0.07 * r, sy], [sx, sy - 0.42 * r], [sx + 0.07 * r, sy]], c('timber'));
      }
      _box(-0.62 * r, -0.42 * r, 1.24 * r, 0.92 * r, c('stone'));
      _poly([[-0.75 * r, -0.4 * r], [0, -1 * r], [0.75 * r, -0.4 * r]], c('flag'));
      _box(-0.18 * r, 0.06 * r, 0.36 * r, 0.44 * r, c('hole'));
      _box(-0.04 * r, -1.9 * r, 0.08 * r, 0.95 * r, c('beam'));      // the mast
      _poly([[0.04 * r, -1.9 * r], [0.85 * r, -1.66 * r], [0.04 * r, -1.42 * r]], c('flag'));
    },
    workshop: (r, c, p) => {
      _box(-0.8 * r, -0.1 * r, 1.6 * r, 0.78 * r, c('stone'));
      _poly([[-0.92 * r, -0.08 * r], [-0.5 * r, -0.72 * r], [0.92 * r, -0.72 * r],
             [0.92 * r, -0.08 * r]], c('beam'));                     // a shed roof
      _box(0.42 * r, -1.12 * r, 0.3 * r, 0.44 * r, c('slab'));       // chimney
      _box(-0.52 * r, 0.14 * r, 0.62 * r, 0.54 * r, c('hole'));      // open front
      _box(-0.42 * r, 0.3 * r, 0.42 * r, 0.3 * r, c('fire'));        // the forge, lit
    },
    barracks: (r, c, p) => {
      _box(-0.95 * r, -0.05 * r, 1.9 * r, 0.72 * r, c('timber'));
      // A grey roof, not the red of a house: from across the map the long hall
      // and the cottage are otherwise the same building.
      _poly([[-1.05 * r, -0.03 * r], [-0.6 * r, -0.66 * r], [0.6 * r, -0.66 * r],
             [1.05 * r, -0.03 * r]], c('slab'));
      _box(-0.14 * r, 0.22 * r, 0.28 * r, 0.45 * r, c('hole'));
      _box(-0.62 * r, 0.16 * r, 0.22 * r, 0.2 * r, c('hole'));
      _box(0.4 * r, 0.16 * r, 0.22 * r, 0.2 * r, c('hole'));
      _box(-0.86 * r, -1.15 * r, 0.08 * r, 1.1 * r, c('beam'));      // the standard
      _poly([[-0.78 * r, -1.15 * r], [-0.2 * r, -0.95 * r], [-0.78 * r, -0.75 * r]], c('flag'));
    },
    tower: (r, c, p) => {
      _box(-0.62 * r, 0.42 * r, 1.24 * r, 0.3 * r, c('slab'));       // plinth
      _box(-0.5 * r, -0.62 * r, 1 * r, 1.1 * r, c('stone'));
      _crenels(-0.6 * r, -0.86 * r, 1.2 * r, 0.26 * r, c('slab'));
      _box(-0.6 * r, -0.66 * r, 1.2 * r, 0.14 * r, c('slab'));       // the walkway
      _box(-0.1 * r, -0.34 * r, 0.2 * r, 0.44 * r, c('hole'));       // arrow slit
    },
    keep: (r, c, p) => {
      _box(-0.72 * r, -0.5 * r, 1.44 * r, 1.2 * r, c('stone'));      // the hall
      _box(-1.02 * r, -0.72 * r, 0.42 * r, 1.42 * r, c('slab'));     // corner turrets
      _box(0.6 * r, -0.72 * r, 0.42 * r, 1.42 * r, c('slab'));
      _crenels(-1.02 * r, -0.92 * r, 0.42 * r, 0.22 * r, c('stone'));
      _crenels(0.6 * r, -0.92 * r, 0.42 * r, 0.22 * r, c('stone'));
      _crenels(-0.6 * r, -0.72 * r, 1.2 * r, 0.24 * r, c('slab'));
      // The gate: an arch, because a hold is a place people walk into.
      _g.fillStyle = c('hole');
      _g.beginPath();
      _g.moveTo(-0.24 * r, 0.7 * r); _g.lineTo(-0.24 * r, 0.12 * r);
      _g.arc(0, 0.12 * r, 0.24 * r, Math.PI, 0);
      _g.lineTo(0.24 * r, 0.7 * r);
      _g.closePath(); _g.fill();
      _box(-0.04 * r, -1.6 * r, 0.08 * r, 0.72 * r, c('beam'));
      _poly([[0.04 * r, -1.6 * r], [0.72 * r, -1.4 * r], [0.04 * r, -1.2 * r]], c('flag'));
    },
  };

  // Draws the body of one building at its own place on the map. `tint` paints
  // the whole thing in a single colour, which is what a ghost is; `over`
  // replaces named materials only, which is how each camp gets its own
  // colours without needing four copies of every shape.
  function _drawBody(type, x, y, r, tint, alpha, over) {
    const p = _pal || (_pal = _palette());
    const shape = BODY[type];
    if (!shape) return;
    _g.save();
    _g.translate(x, y);
    if (alpha != null) _g.globalAlpha = alpha;
    if (!tint) {
      // Without a shadow every building floats above the ground.
      _g.fillStyle = 'rgba(0,0,0,.3)';
      _g.beginPath(); _g.ellipse(0, r * 0.72, r * 0.95, r * 0.34, 0, 0, Math.PI * 2); _g.fill();
    }
    shape(r, (name) => tint || (over && over[name]) || p[name], p);
    _g.restore();
    _g.globalAlpha = 1;
  }

  // ── Their side of the map ─────────────────────────────────────────────────
  // The camps are drawn exactly the way the hold is: buildings that go up piece
  // by piece, people walking to and from the ground they are working, soldiers
  // standing about outside. That is the whole answer to "I never see them" —
  // there is nothing here the player cannot watch happening.
  function _drawFactions(v) {
    for (const f of _hold.factions) {
      const over = { flag: f.color, roof: f.color };
      // The ground they hold, so a corner reads as somebody's even at the zoom
      // where the buildings are a few pixels across.
      _g.globalAlpha = 0.13;
      _g.fillStyle = f.color;
      _g.beginPath(); _g.arc(f.x, f.y, 300, 0, Math.PI * 2); _g.fill();
      _g.globalAlpha = 1;

      for (const b of f.buildings) {
        const type = b.type === 'keep' ? 'fkeep' : b.type === 'barracks' ? 'barracks_f' : 'hut';
        const r = _facSize(b.type);
        if (b.built < 1) {
          // Scaffolding, same as the player's: a camp getting bigger is
          // something that takes time and shows while it is taking it.
          _drawBody(type, b.x, b.y, r, f.color, 0.22 + 0.5 * b.built);
          _g.strokeStyle = f.color; _g.globalAlpha = 0.7; _g.lineWidth = 2 / _cam.z;
          _g.strokeRect(b.x - r, b.y - r * 0.9, r * 2, r * 1.8);
          _g.globalAlpha = 1;
          _badge(b, r);
        } else {
          _drawBody(type, b.x, b.y, r, null, null, over);
          if (b.hp < b.maxHp - 0.5) {
            _g.fillStyle = 'rgba(0,0,0,.45)'; _g.fillRect(b.x - r, b.y - r - 8, r * 2, 3);
            _g.fillStyle = f.color;
            _g.fillRect(b.x - r, b.y - r - 8, r * 2 * Math.max(0, b.hp / b.maxHp), 3);
          }
          // How deep it is, and the level going up in it — the same badge the
          // hold wears and in the same colours, so four level-one barracks and
          // four level-five barracks are two different corners at a glance.
          // They raise buildings now rather than only putting more of them
          // down, and a camp getting deeper is worth as much warning as a camp
          // getting wider.
          if (b.up != null || b.lvl > 1) _badge(b, r);
        }
      }
      // Their people, carrying the same marks the player's do — a camp digging
      // iron looks like a camp digging iron.
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      for (const u of f.workers) {
        _fig('worker', u.x, u.y, 22, f.color, 0.95);
        _g.font = '11px serif';
        // Crossed blades over anybody who has walked into another colour: a
        // fight between two camps is worth seeing, and it is over quickly.
        if (u._lock) {
          _g.fillText('⚔', u.x, u.y - 13);
        } else if (u.job === 'mine') {
          // Read on the same terms as your own: pale on the way out, solid on
          // the way home. A camp working iron is a camp arming itself, and
          // that is worth seeing a walk earlier than the load arriving.
          const dep = _depById(u.dep);
          const gl = RES_GLYPH[(dep && dep.kind) || u.res] || '⛏';
          if (u.carry) {
            _g.fillText(gl, u.x, u.y - 13);
          } else {
            // Filling as they cut it, exactly as the hold's own do — a corner
            // standing over a seam is a corner about to be richer, and that is
            // worth watching happen.
            _glyphFill(gl, u.x, u.y - 13, 11,
                       u.phase === 'work' && dep
                         ? (u.t || 0) / (_gat(dep.kind).time || 5) : 0);
          }
        }
        if (u.hp != null && u.hp < B.worker.hp) {
          _g.fillStyle = 'rgba(0,0,0,.45)'; _g.fillRect(u.x - 8, u.y - 20, 16, 3);
          _g.fillStyle = f.color;
          _g.fillRect(u.x - 8, u.y - 20, 16 * Math.max(0, u.hp / B.worker.hp), 3);
        }
      }
      // The men who have been armed and are waiting for the rest of the party.
      // Counting them is how the player judges when the next raid is coming.
      for (const s of f.army) {
        const size = s.boss ? _bossSize(s.blvl || 1) - 3 : 23;
        if (s.boss) _drawChampion(s, f, size);
        _fig('raider', s.x, s.y, size, f.color);
        if (s.boss) {
          _g.font = '12px serif';
          _g.fillText(BOSS_GLYPH[s.power] || '👑', s.x, s.y - size * 0.6);
        } else if (s._lock) {
          _g.font = '11px serif'; _g.fillText('⚔', s.x, s.y - 14);
        }
        if (s.maxHp && s.hp < s.maxHp - 0.05) {
          const w = s.boss ? size * 0.6 : 9;
          _g.fillStyle = 'rgba(0,0,0,.45)'; _g.fillRect(s.x - w, s.y - 20, w * 2, 3);
          _g.fillStyle = f.color;
          _g.fillRect(s.x - w, s.y - 20, w * 2 * Math.max(0, s.hp / s.maxHp), 3);
        }
      }
      // Their scout: one unarmed man walking to the hold and back. Nothing in
      // the hold can touch him, so he is drawn plainly and marked with his
      // glass — what the player sees is a camp taking a look, not a raid.
      if (f.scout) {
        const u = f.scout;
        _fig('scout', u.x, u.y, 22, f.color, 0.7);
        _g.font = '11px serif';
        _g.fillText('🔭', u.x, u.y - 13);
      }
    }
  }

  function _draw() {
    if (!_g || !_hold) return;
    const v = _view();
    _g.setTransform(1, 0, 0, 1, 0, 0);
    _g.clearRect(0, 0, v.w, v.h);
    _g.setTransform(v.k, 0, 0, v.k, v.tx, v.ty);

    _pal = _palette();
    const dim   = _css('--fg2', '#a6adc8');
    const acc   = _css('--accent', '#89b4fa');
    const red   = _css('--red', '#f38ba8');
    const green = _css('--green', '#a6e3a1');

    // Where the hold ends. On a wide screen there is now room beside the map,
    // and without this nothing says which part of it is playable.
    _g.fillStyle = _css('--surface1', '#181825');
    _g.fillRect(0, 0, W(), W());
    _g.strokeStyle = dim; _g.globalAlpha = 0.35; _g.lineWidth = 2 / _cam.z;
    _g.strokeRect(0, 0, W(), W());
    _g.globalAlpha = 1;

    _g.textAlign = 'center'; _g.textBaseline = 'middle';
    for (const d of _hold.deposits) _drawDeposit(d, v);
    _g.globalAlpha = 1;

    // A tapped deposit marks itself, so what the tap picked out is never in
    // doubt on a map with a dozen woods on it.
    if (_selDep && _hold.deposits.includes(_selDep)) {
      const dr = _depR(_selDep);
      _ring(_selDep.x, _selDep.y, dr + 10, green, 0.6);
      // What is left in it, on the thing itself. The ring answers "how far from
      // this can I build"; it never answered "is this worth walking to", and
      // there is no panel behind a deposit to answer it either.
      _g.font = 'bold 14px serif';
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      const txt = (RES_GLYPH[_selDep.kind] || '') + ' ' + Math.ceil(_selDep.amount);
      const ty = _selDep.y - dr - 16;
      _g.lineWidth = 4; _g.strokeStyle = 'rgba(0,0,0,.6)';
      _g.strokeText(txt, _selDep.x, ty);
      _g.fillStyle = RES_TINT[_selDep.kind] || green;
      _g.fillText(txt, _selDep.x, ty);
      _g.lineWidth = 1;
    }
    // The camp whose panel is open, marked the same way and in its own colour.
    if (_selFac && _hold.factions.includes(_selFac)) {
      _ring(_selFac.x, _selFac.y, 300, _selFac.color, 0.7);
    }

    // Range of whatever is selected. While a tower is being placed every tower
    // shows its own, so the gaps between them are visible before the choice is
    // made rather than after — see _drawGhost.
    if (_selected && _selected.type === 'tower') {
      _ring(_selected.x, _selected.y, _lv('tower', _selected.lvl, 'range'), dim);
    }

    for (const p of _dust) {
      _g.globalAlpha = Math.max(0, p.life / 0.35);
      _g.fillStyle = p.color;
      _g.beginPath(); _g.arc(p.x, p.y, 3, 0, Math.PI * 2); _g.fill();
    }
    _g.globalAlpha = 1;

    _drawFactions(v);
    for (const b of _hold.buildings) _drawBuilding(b, acc, green, red);
    // Over the buildings, never under them: a wall fills its whole cell, so a
    // mark drawn before it is a mark the wall paints over.
    if (_selected && _hold.buildings.includes(_selected)) _drawPick(_selected);

    // People, soldiers, raiders. They are drawn as what they are rather than as
    // coloured dots: a player has to be able to tell at a glance who is theirs,
    // who is fighting and what each person is busy with.
    _g.textAlign = 'center'; _g.textBaseline = 'middle';
    for (const w of _hold.workers) {
      // Your own people wear your own colour, the same way theirs wear theirs:
      // with four camps walking about the map, "mine or theirs" has to be one
      // look, and the look is the man himself rather than a mark beside him.
      _fig('worker', w.x, w.y, 24, acc);
      // What a man has in his hands, over his head. Anyone walking out to a
      // seam is carrying nothing yet and so shows nothing: the mark used to go
      // up the moment he set off, with a green tick under his feet for the load
      // itself, which said the same thing twice, in two places, at two
      // different times — and said the first half of it before it was true.
      // Now the mark is the load. It appears when he picks the stuff up and
      // walks home with him, so which of the three the hold is bringing in can
      // still be read off the map, and the trip out is quiet.
      //
      // A builder is the exception: his hammer is not a load but the work
      // itself, and it marks where the work is happening.
      _g.font = '12px serif';
      let jg, faint = false, fill = null;
      if (w.job === 'mine') {
        const dep = _depById(w.dep);
        jg = RES_GLYPH[(dep && dep.kind) || w.res] || JOB_GLYPH.mine;
        faint = !w.carry;
        // Digging: the load fills up over him while he cuts it, so the swing
        // and the wait read as the same thing. On the way out there is nothing
        // in it yet and the mark is only the ghost.
        if (faint) {
          fill = w.phase === 'mine' && dep
            ? (w.t || 0) / (_gat(dep.kind).time || 5) : 0;
        }
      } else if (w.job === 'ammo') {
        jg = JOB_GLYPH.ammo;
        faint = !w.carry;
      } else {
        jg = JOB_GLYPH[w.job] || JOB_GLYPH.idle;
      }
      if (fill != null) {
        _glyphFill(jg, w.x, w.y - 14, 12, fill);
      } else {
        if (faint) _g.globalAlpha = 0.4;
        _g.fillText(jg, w.x, w.y - 14);
        _g.globalAlpha = 1;
      }
      // Hurt people are shown bleeding out, so nobody is ever simply gone.
      if (w.hp != null && w.hp < B.worker.hp) {
        _g.fillStyle = 'rgba(0,0,0,.45)'; _g.fillRect(w.x - 9, w.y - 22, 18, 3);
        _g.fillStyle = red; _g.fillRect(w.x - 9, w.y - 22, 18 * Math.max(0, w.hp / B.worker.hp), 3);
      }
    }
    // A soldier is one of your people too, not a floating shield: the same
    // build as the workers, in the guard's own green with a helmet and a shield
    // of his own, carrying what he is doing over his head — a shield while he
    // walks his rounds, crossed blades once he is in a fight.
    for (const s2 of _hold.soldiers) {
      _fig('soldier', s2.x, s2.y, 24, green);
      _g.font = '12px serif';
      _g.fillText(s2.fighting ? '⚔' : s2.healing ? '✚' : '🛡', s2.x, s2.y - 14);
      // A hair off full is full: the mark is for wounds, not for arithmetic.
      if (s2.maxHp && s2.hp < s2.maxHp - 0.05) {
        _g.fillStyle = 'rgba(0,0,0,.45)'; _g.fillRect(s2.x - 9, s2.y - 22, 18, 3);
        _g.fillStyle = red; _g.fillRect(s2.x - 9, s2.y - 22, 18 * Math.max(0, s2.hp / s2.maxHp), 3);
      }
    }
    for (const r of _raiders) {
      // A raider wears his own camp's colour, so a hold being hit from two
      // corners at once can tell which of them is which.
      const f = _facById(r.fx);
      const size = r.boss ? _bossSize(r.blvl || 1) : 26;
      if (r.boss) _drawChampion(r, f, size);
      _fig('raider', r.x, r.y, size, (f && f.color) || red);
      // Two parties that ran into each other on the way in. It is not the
      // player's fight, but it is the player's business: the ones who walk out
      // of it are the ones who arrive.
      if (r.boss) {
        _g.font = '13px serif';
        _g.fillText(BOSS_GLYPH[r.power] || '👑', r.x, r.y - size * 0.62);
      } else if (r._lock) {
        _g.font = '12px serif'; _g.fillText('⚔', r.x, r.y - 25);
      }
      if (r.hp < r.maxHp) {
        const w = r.boss ? size * 0.6 : 10;
        _g.fillStyle = 'rgba(0,0,0,.45)'; _g.fillRect(r.x - w, r.y - 17, w * 2, 3);
        _g.fillStyle = green;
        _g.fillRect(r.x - w, r.y - 17, w * 2 * Math.max(0, r.hp / r.maxHp), 3);
      }
    }
    // Their bolts, in the colour of the camp that threw them — never the
    // hold's yellow, which is what a round of the player's own looks like.
    for (const p of _shots) {
      const f = _facById(p.fx);
      _g.fillStyle = (f && f.color) || red;
      _g.beginPath(); _g.arc(p.x, p.y, 4.5, 0, Math.PI * 2); _g.fill();
    }
    _g.fillStyle = _css('--yellow', '#f9e2af');
    for (const p of _bullets) { _g.beginPath(); _g.arc(p.x, p.y, 4, 0, Math.PI * 2); _g.fill(); }

    // Every level badge on the map, over everything on it. They are labels, not
    // things standing on the ground: a badge covered by the next wall along, or
    // by somebody walking past, is a badge at exactly the moment it is being
    // read — see _drawBadge.
    _flushBadges();

    // The gains, last of everything on the ground: a number worth reading is
    // worth reading over the top of whoever walked it in.
    if (_floats.length) {
      _g.font = 'bold 13px serif';
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      _g.lineWidth = 4;
      const x0 = -v.tx / v.k, y0 = -v.ty / v.k;
      for (const f of _floats) {
        // Four camps deliver into their own corners all game. What is off the
        // screen is not worth a word of text.
        if (f.x < x0 - 40 || f.y < y0 - 60 ||
            f.x > x0 + v.w / v.k + 40 || f.y > y0 + v.h / v.k + 40) continue;
        const t = 1 - f.life / FLOAT_LIFE;
        const y = f.y - 18 - t * 26 + f.drop;
        const txt = f.glyph + f.n;
        // Solid while it is worth reading, fading only at the end of the climb.
        _g.globalAlpha = Math.min(1, f.life / 0.5);
        _g.strokeStyle = 'rgba(0,0,0,.6)';
        _g.strokeText(txt, f.x, y);
        _g.fillStyle = f.color || green;
        _g.fillText(txt, f.x, y);
      }
      _g.globalAlpha = 1;
      _g.lineWidth = 1;
    }

    if (_placing) _drawGhost(acc, green, red, dim);

    // From here on, screen space: a banner has to stay on the screen whatever
    // the camera is doing.
    _g.setTransform(1, 0, 0, 1, 0, 0);
    _offscreenRaiders(v, red);

    // The controls float over the map, so text drawn on the canvas has to keep
    // out from under them — it is the one thing that cannot be moved away.
    const s = Math.min(v.w, v.h);
    const top    = _gap(_hud, v);
    const bottom = v.h - _gap(_dock, v);
    if (_raidFlash > 0) {
      _g.globalAlpha = Math.min(0.8, _raidFlash / 3);
      // In the colour of whoever is coming, not in alarm-red: red says only
      // that something is happening, and with four camps on the map the one
      // thing worth knowing is which of them. The arrows off the edges of the
      // screen are already drawn this way — see _offscreenRaiders — so the
      // warning and the marks it is about now agree.
      _g.fillStyle = _raidColor || red;
      _g.font = 'bold ' + Math.round(s * 0.045) + 'px system-ui, sans-serif';
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      // Written over its own shadow: a camp's colour is chosen to be seen on
      // the ground, and some of them are pale enough to vanish against a hold
      // in daylight.
      _g.lineWidth = 4;
      _g.strokeStyle = 'rgba(0,0,0,.55)';
      _g.strokeText(_t('sh_raid'), v.w / 2, top + s * 0.045);
      _g.lineWidth = 1;
      _g.fillText(_t('sh_raid'), v.w / 2, top + s * 0.045);
      _g.globalAlpha = 1;
    }
    if (_toast > 0) {
      _g.globalAlpha = Math.min(1, _toast);
      _g.fillStyle = _css('--fg', '#cdd6f4');
      _g.font = Math.round(s * 0.028) + 'px system-ui, sans-serif';
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      _g.fillText(_toastText, v.w / 2, bottom - s * 0.035);
      _g.globalAlpha = 1;
    }
  }

  // How much of the canvas a floating strip covers, in canvas pixels.
  function _gap(el, v) {
    const h = (el && el.offsetHeight) || 0;
    const css = _canvas.clientHeight || 0;
    return css ? h * (v.h / css) : h;
  }

  // Zoomed in on one tower you would never see the raid coming. Anyone outside
  // the view is marked on the edge nearest to them.
  function _offscreenRaiders(v, red) {
    // No zoom test any more: with the controls floating over the map, somebody
    // can be off the visible band at any zoom, and the check below is the one
    // that actually knows.
    if (!_raiders.length) return;
    const m = 14;
    for (const r of _raiders) {
      const f = _facById(r.fx);
      _g.fillStyle = (f && f.color) || red;
      // The band between the HUD and the dock, not the whole canvas: an arrow
      // pinned behind the build bar is an arrow nobody sees.
      const t = v.top + m, bo = v.h - v.bot - m;
      const px = r.x * v.k + v.tx, py = r.y * v.k + v.ty;
      if (px >= 0 && px <= v.w && py >= t && py <= bo) continue;
      const x = Math.max(m, Math.min(v.w - m, px));
      const y = Math.max(t, Math.min(Math.max(bo, t), py));
      const a = Math.atan2(py - (v.top + v.h - v.bot) / 2, px - v.w / 2);
      _g.save();
      _g.translate(x, y); _g.rotate(a);
      _g.beginPath();
      _g.moveTo(m * 0.8, 0); _g.lineTo(-m * 0.5, m * 0.55); _g.lineTo(-m * 0.5, -m * 0.55);
      _g.closePath(); _g.fill();
      _g.restore();
    }
  }

  // Everybody on the map is drawn as one of four little figures, in the colour
  // of whoever they belong to. They are kept here as drawings rather than as
  // emoji for one reason: an emoji arrives in its own colours whatever the fill
  // is set to, so with emoji the side had to be said by a ring beside the feet.
  // These are authored in white, and the white is swapped for the side's colour
  // before the picture is made — cloth takes the colour, while steel stays
  // steel and wood stays wood, so a pickaxe never vanishes into a blue villager.
  //
  // Four silhouettes, told apart without reading anything: a pickaxe over the
  // shoulder, a shield and a raised blade, horns and an axe, a hood and a staff.
  // They are drawn about twenty pixels tall, which is why the shapes are thick
  // and the outline is dark — thin detail is gone at that size, and the outline
  // is what holds the figure against grass, stone and water alike.
  const FIGURES = {
    worker:
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g stroke-linejoin="round" stroke-linecap="round"><path d="M22 46 L46 18" stroke="#141018" stroke-width="7" fill="none"/><path d="M22 46 L46 18" stroke="#7a5a3a" stroke-width="3.5" fill="none"/><path d="M37 9 Q47 6 56 14 L52 19 Q46 13 39 15 Z" fill="#cfd6dd" stroke="#141018" stroke-width="2.4"/><path d="M21 34 Q20 26 27 25 L37 25 Q44 26 43 34 L45 48 L39 60 L34 60 L32 50 L30 60 L25 60 L19 48 Z" fill="#ffffff" stroke="#141018" stroke-width="2.6"/><path d="M32 50 L30 60 L25 60 L19 48 L20 42 L32 42 Z" fill="#b4b4b4" stroke="none"/><path d="M41 31 L34 37" stroke="#141018" stroke-width="9.5" fill="none"/><path d="M41 31 L34 37" stroke="#ffffff" stroke-width="5" fill="none"/><ellipse cx="32" cy="17" rx="9.5" ry="8.5" fill="#ffffff" stroke="#141018" stroke-width="2.6"/><path d="M23 15 Q26 8 32 8 Q38 8 41 15 Z" fill="#b4b4b4" stroke="none"/></g></svg>',
    soldier:
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g stroke-linejoin="round" stroke-linecap="round"><path d="M48 8 L52 18 L52 32 L44 32 L44 18 Z" fill="#cfd6dd" stroke="#141018" stroke-width="2.4"/><path d="M41 34 L55 34" stroke="#141018" stroke-width="5" fill="none"/><path d="M48 36 L48 43" stroke="#7a5a3a" stroke-width="4.5" fill="none"/><path d="M21 34 Q20 26 27 25 L37 25 Q44 26 43 34 L45 48 L39 60 L34 60 L32 50 L30 60 L25 60 L19 48 Z" fill="#ffffff" stroke="#141018" stroke-width="2.6"/><path d="M32 50 L30 60 L25 60 L19 48 L20 42 L32 42 Z" fill="#b4b4b4" stroke="none"/><path d="M40 32 L47 39" stroke="#141018" stroke-width="9.5" fill="none"/><path d="M40 32 L47 39" stroke="#ffffff" stroke-width="5" fill="none"/><ellipse cx="32" cy="17" rx="9.5" ry="8.5" fill="#ffffff" stroke="#141018" stroke-width="2.6"/><path d="M22 16 Q23 7 32 7 Q41 7 42 16 Z" fill="#cfd6dd" stroke="#141018" stroke-width="2.2"/><circle cx="15" cy="38" r="10.5" fill="#ffffff" stroke="#141018" stroke-width="2.6"/><circle cx="15" cy="38" r="4" fill="#cfd6dd" stroke="#141018" stroke-width="2"/></g></svg>',
    raider:
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g stroke-linejoin="round" stroke-linecap="round"><path d="M24 48 L48 22" stroke="#141018" stroke-width="7" fill="none"/><path d="M24 48 L48 22" stroke="#7a5a3a" stroke-width="3.5" fill="none"/><path d="M44 12 Q57 17 54 29 Q47 27 43 22 Q47 18 44 12 Z" fill="#cfd6dd" stroke="#141018" stroke-width="2.4"/><path d="M19 36 Q17 27 25 25 L35 23 Q42 23 42 32 L46 46 L42 59 L37 59 L33 49 L28 60 L23 59 L18 48 Z" fill="#ffffff" stroke="#141018" stroke-width="2.6"/><path d="M33 49 L28 60 L23 59 L18 48 L19 41 L32 41 Z" fill="#b4b4b4" stroke="none"/><path d="M39 30 L32 36" stroke="#141018" stroke-width="9.5" fill="none"/><path d="M39 30 L32 36" stroke="#ffffff" stroke-width="5" fill="none"/><path d="M18 16 Q12 13 12 5 Q20 8 21 15 Z" fill="#cfd6dd" stroke="#141018" stroke-width="2.2"/><path d="M36 16 Q42 13 42 5 Q34 8 33 15 Z" fill="#cfd6dd" stroke="#141018" stroke-width="2.2"/><ellipse cx="27" cy="19" rx="9.5" ry="8.5" fill="#ffffff" stroke="#141018" stroke-width="2.6"/><path d="M18 18 Q18 10 27 10 Q36 10 36 18 Z" fill="#b4b4b4" stroke="none"/></g></svg>',
    scout:
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g stroke-linejoin="round" stroke-linecap="round"><path d="M48 9 L45 57" stroke="#141018" stroke-width="6" fill="none"/><path d="M48 9 L45 57" stroke="#7a5a3a" stroke-width="3" fill="none"/><path d="M32 7 Q42 11 43 24 L46 47 L38 58 L34 58 L32 49 L30 58 L25 58 L18 47 L21 24 Q22 11 32 7 Z" fill="#ffffff" stroke="#141018" stroke-width="2.6"/><path d="M32 49 L30 58 L25 58 L18 47 L20 35 L32 35 Z" fill="#b4b4b4" stroke="none"/><path d="M40 30 L45 34" stroke="#141018" stroke-width="9" fill="none"/><path d="M40 30 L45 34" stroke="#ffffff" stroke-width="4.6" fill="none"/><path d="M22 22 Q22 10 32 10 Q42 10 42 22 Q32 26 22 22 Z" fill="#b4b4b4" stroke="#141018" stroke-width="2.4"/><ellipse cx="32" cy="20" rx="5" ry="2.6" fill="#141018" stroke="none"/></g></svg>',
  };

  // One picture per figure per colour, made once and kept. Swapping the two
  // greys for a colour and its shadow is a string replace, so a side costs four
  // small images and nothing per frame.
  const _figCache = new Map();

  // A darker cast of the same colour, for the half of the figure turned away
  // from the light. Anything the stylesheet hands back that is not a plain hex
  // is left alone: a flat figure is a small loss, a broken one is not.
  function _darker(color, f) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const c = [0, 2, 4].map(i => Math.round(parseInt(h.substr(i, 2), 16) * f));
    return '#' + c.map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
  }

  function _figure(kind, color) {
    const key = kind + '|' + color;
    let img = _figCache.get(key);
    if (img) return img;
    const svg = FIGURES[kind]
      .split('#ffffff').join(color)
      .split('#b4b4b4').join(_darker(color, 0.66));
    img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    _figCache.set(key, img);
    return img;
  }

  // A figure standing on a point, the point being where his feet are. Until the
  // picture is ready — the first frame or two of a game, and never again — a
  // plain disc in the same colour stands in for him, so a hold is never empty
  // while the map is waiting on a drawing.
  // A mark that fills as the work behind it does, from the bottom up: the ghost
  // of what is coming, and as much of it in full colour as is actually done.
  // Standing at a seam used to look exactly like standing at a seam doing
  // nothing — the load appeared out of nowhere when the timer ran out — and a
  // man frozen mid-swing for five seconds reads as a man who is stuck. It is
  // the same language the level badges are written in, which is the point:
  // filling upwards means "this is being made" wherever it appears.
  function _glyphFill(glyph, x, y, size, p) {
    const a = _g.globalAlpha;
    _g.globalAlpha = a * 0.3;
    _g.fillText(glyph, x, y);
    _g.globalAlpha = a;
    if (!(p > 0)) return;
    // A shade taller than the type size: an emoji is drawn as a picture and
    // hangs past the box the letters of the same size would fit in.
    const h = size * 1.3;
    _g.save();
    _g.beginPath();
    _g.rect(x - size, y + h / 2 - h * Math.min(1, p), size * 2, h * Math.min(1, p));
    _g.clip();
    _g.fillText(glyph, x, y);
    _g.restore();
  }

  function _fig(kind, x, y, size, color, alpha) {
    const img = _figure(kind, color);
    if (alpha != null && alpha < 1) _g.globalAlpha = alpha;
    if (img.complete && img.naturalWidth) {
      _g.drawImage(img, x - size / 2, y + 1 - size / 2, size, size);
    } else {
      _g.fillStyle = color;
      _g.beginPath(); _g.arc(x, y + 1, size * 0.3, 0, Math.PI * 2); _g.fill();
    }
    _g.globalAlpha = 1;
  }

  // The colours in play are known before anything moves, so the pictures are
  // built up front. Left to the first frame that needs one, a raiding party
  // would arrive as a row of discs.
  function _figWarm() {
    const cols = [_css('--accent', '#89b4fa'), _css('--green', '#a6e3a1'),
                  _css('--red', '#f38ba8')]
      .concat(((_hold && _hold.factions) || []).map(f => f.color));
    for (const c of cols)
      for (const k in FIGURES) _figure(k, c);
  }

  // A champion, marked as one. He is bigger than the men around him, which is
  // most of the answer, but a big figure among thirty figures is still a figure
  // — so he stands in a ring of his camp's colour.
  //
  // What his power reaches is a circle two hundred paces across, and four of
  // them on one map is a map nobody can read: it used to be drawn all the time
  // and it covered the ground the fight was happening on. It is drawn when he
  // is tapped and not before — the answer to "how far does that one reach" is
  // worth having exactly when it is asked.
  function _drawChampion(s, f, size) {
    const col = (f && f.color) || _css('--red', '#f38ba8');
    const lvl = s.blvl || 1;
    const c = _bs()[s.power] || {};
    const reach = s === _selBoss
      ? (s.power === 'bolt'
          ? (c.range || 0) + (c.range_step || 0) * (lvl - 1)
          : (c.radius || 0))
      : 0;
    if (reach > 0) {
      _g.globalAlpha = 0.07;
      _g.fillStyle = col;
      _g.beginPath(); _g.arc(s.x, s.y, reach, 0, Math.PI * 2); _g.fill();
      _g.globalAlpha = 1;
      _ring(s.x, s.y, reach, col, 0.16);
    }
    _g.globalAlpha = 0.5;
    _g.strokeStyle = col; _g.lineWidth = 2;
    _g.beginPath(); _g.ellipse(s.x, s.y + size * 0.34, size * 0.42, size * 0.17,
                               0, 0, Math.PI * 2);
    _g.stroke();
    _g.globalAlpha = 1; _g.lineWidth = 1;
  }

  function _ring(x, y, r, color, alpha) {
    if (!r) return;
    _g.strokeStyle = color; _g.globalAlpha = alpha == null ? 0.2 : alpha; _g.lineWidth = 2;
    _g.beginPath(); _g.arc(x, y, r, 0, Math.PI * 2); _g.stroke();
    _g.globalAlpha = 1;
  }

  // The building you are holding, drawn where it would go. Placing used to be
  // blind: you tapped, and only then found out the spot was too close to
  // something or out of reach of the deposit. Now the answer is on the map
  // before the tap — green means it would go there, red means it would not.
  //
  // A tower carries its range with it, and every tower already standing shows
  // its own at the same time, so the hole in the cover you are trying to fill
  // is visible while you are aiming at it rather than after.
  function _drawGhost(acc, green, red, dim) {
    const at = _ghost;
    if (!at) return;
    const c  = _bc(_placing);
    const r  = c.size;
    const ok = _canPlace(_placing, at.x, at.y) === null;
    const col = ok ? green : red;

    // Founding: the ground the corners keep for themselves is drawn as well,
    // because "too close to a camp" is not something to find out by tapping.
    if (_placing === 'keep') {
      for (const f of _hold.factions) _ring(f.x, f.y, _foundClear(), red, 0.3);
      _ring(at.x, at.y, _lv('tower', 1, 'range'), col, 0.55);
    }
    if (_placing === 'tower') {
      for (const b of _hold.buildings) {
        if (b.type !== 'tower' || b.keep) continue;
        _ring(b.x, b.y, _lv('tower', b.lvl, 'range'), dim, 0.22);
      }
      const keep = _keep();
      if (keep) _ring(keep.x, keep.y, _lv('tower', keep.lvl, 'range'), dim, 0.22);
      _ring(at.x, at.y, _lv('tower', 1, 'range'), col, 0.55);
    }
    if (_placing === 'wall') {
      _g.globalAlpha = 0.5;
      _g.fillStyle = col;
      _g.fillRect(at.x - r, at.y - r, r * 2, r * 2);
      _g.globalAlpha = 1;
    } else {
      // The building itself, in the colour of the answer: what will stand here
      // is easier to judge as its own shape than as a disc with a mark on it.
      _g.globalAlpha = 0.2;
      _g.fillStyle = col;
      _g.beginPath(); _g.arc(at.x, at.y, r, 0, Math.PI * 2); _g.fill();
      _g.globalAlpha = 1;
      _drawBody(_placing, at.x, at.y, r, col, 0.75);
    }
  }

  function _drawBuilding(b, acc, green, red) {
    const c = _bc(b.type);
    const r = c.size;
    const done = b.built >= 1;

    // A finished building is its mark and nothing else. The ring around it used
    // to stay for good, which made every hold a field of blue circles and left
    // the ring saying nothing — it belongs to the scaffolding, and it goes when
    // the scaffolding does. A wall is the exception: it is a shape rather than
    // a mark, so it is what gets drawn.
    if (b.type === 'wall') {
      // Timber while it is a palisade, stone once it has been rebuilt as one.
      const stone = c.stone_from && b.lvl >= c.stone_from;
      const mat = stone ? _css('--fg2', '#a6adc8') : _css('--peach', '#cba06a');
      _g.globalAlpha = done ? 1 : 0.45;
      _g.fillStyle = mat;
      // A square that fills its cell, so a row of them reads as one wall
      // rather than as a row of separate bricks — unless there is a way
      // through it, which is drawn as what it is.
      if (b.gate) _drawGate(b, r, mat);
      else _g.fillRect(b.x - r, b.y - r, r * 2, r * 2);
      _g.globalAlpha = 1;
      if (done) _cracks(b, r);
    } else {
      if (!done) {
        // Being built: the ground cleared for it and the shape of what is
        // coming, so a site is something on the map from the first moment.
        _g.globalAlpha = 0.25;
        _g.fillStyle = b.keep ? _css('--yellow', '#f9e2af') : acc;
        _g.beginPath(); _g.arc(b.x, b.y, r, 0, Math.PI * 2); _g.fill();
        _g.globalAlpha = 1;
      }
      _drawBody(b.keep ? 'keep' : b.type, b.x, b.y, r, null, done ? 1 : 0.4);
    }

    // Integrity, and the magazine of a tower — the two things worth seeing at
    // a glance while a raid is on.
    const maxHp = _maxHp(b.type, b.lvl, b.keep);
    if (b.hp < maxHp) {
      const left = Math.max(0, b.hp / maxHp);
      const col = left > 0.4 ? green : red;
      _g.fillStyle = 'rgba(0,0,0,.45)'; _g.fillRect(b.x - r, b.y - r - 10, r * 2, 4);
      _g.fillStyle = col;
      _g.fillRect(b.x - r, b.y - r - 10, r * 2 * left, 4);
      // How much of it is left, in figures, over the bar. The bar says which
      // way this is going and the falling numbers say how fast, but neither of
      // them answers the question a raid is actually asking — whether this
      // holds long enough to be worth sending anyone to. A short bar on a keep
      // and a short bar on a hut are not the same amount of trouble.
      //
      // Rounded up, never to nought: a building still standing must not read as
      // gone, and the last sliver is exactly when the number is being read.
      _g.font = 'bold 11px system-ui, sans-serif';
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      const txt = Math.max(1, Math.ceil(left * 100)) + '%';
      _g.lineWidth = 3; _g.strokeStyle = 'rgba(0,0,0,.6)';
      _g.strokeText(txt, b.x, b.y - r - 19);
      _g.fillStyle = col;
      _g.fillText(txt, b.x, b.y - r - 19);
      _g.lineWidth = 1;
    }
    if (b.type === 'tower' && done) {
      // Rounds in the magazine, written out: a tower with 0 here is a tower
      // that is not firing, and that has to be readable across the map.
      // The keep shows the store, because for the keep the store is the
      // magazine — the same rounds it will fire.
      const mag = b.keep ? _keepStore(b.lvl) : _lv('tower', b.lvl, 'mag');
      // Rounded, not floored: firing spends a fractional volley (ammo_per
      // grows in fractions of a round from level 2 on), so the true count
      // almost never lands on a whole number again once a tower has fired.
      // Flooring that made a magazine read one short of full forever — the
      // number shown has to be the nearest whole round, not the last one
      // strictly complete.
      const have = Math.round(_mag(b));
      _g.font = 'bold 13px system-ui, sans-serif';
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      // Red only once the number on screen is genuinely short of a volley —
      // comparing the raw fractional ammo against ammo_per turned red at a
      // threshold the player could never see, on a bar that still read as
      // having rounds left.
      _g.fillStyle = have >= Math.ceil(_volley(b.lvl)) ? _css('--yellow', '#f9e2af') : red;
      _g.fillText('🎯' + have + '/' + mag, b.x, b.y + r + 10);
    }
    if (b.type === 'workshop' && done && (b.ammo || 0) >= 1) {
      // Finished rounds waiting for somebody to carry them. A workshop with a
      // full floor and nobody collecting is a hold that has forgotten its
      // towers, and that has to be visible from across the map.
      _g.font = 'bold 13px system-ui, sans-serif';
      _g.textAlign = 'center'; _g.textBaseline = 'middle';
      _g.fillStyle = _css('--yellow', '#f9e2af');
      _g.fillText('📦' + Math.floor(b.ammo), b.x, b.y + r + 10);
    }
    // The work in hand and the level it is buying, both in the badge — see
    // _drawBadge. The clock face that used to go round the building went with
    // them: on a wall it was drawn across the two walls either side of it, and
    // whichever of the three was drawn last won.
    // A badge also appears on its own on a level one that can be raised right
    // now: the pulse is the offer, so an affordable upgrade is something the
    // map says rather than something found by tapping every building in turn.
    // Never on wall — a ring of it is cheap, always affordable and dozens of
    // pieces long, so the offer said nothing and the whole wall flickered at
    // once. Never while peeking either: that hold is somebody else's to spend.
    const ready = !_peekFor && b.type !== 'wall' && _canUp(b);
    if (!done || b.up != null || b.lvl > 1 || ready) _badge(b, r, null, ready);
  }

  // Cheap, repeatable randomness. A crack has to be in the same place on the
  // same stone every frame — a wall whose damage crawls about is a wall that
  // shimmers — and it must not cost a stored field on something that is saved,
  // so it is worked out from the piece's own id every time it is drawn.
  function _seeded(n) {
    let s = (n >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // A wall coming apart, drawn on the wall. The bar over it says how much is
  // left in figures; this says it in the only language a wall has. Cracks
  // spread from the edges inwards as the piece is beaten, more of them and
  // deeper the further down it goes, and they close again as it is repaired —
  // the same number, read the other way. It is the whole point of drawing it:
  // a ring of wall is thirty pieces, and which of them is the one about to go
  // is otherwise a matter of reading thirty little bars.
  function _cracks(b, r) {
    const maxHp = _maxHp(b.type, b.lvl, b.keep);
    const hurt = 1 - Math.max(0, Math.min(1, b.hp / maxHp));
    if (hurt < 0.1) return;
    const rnd = _seeded(b.id * 2654435761);
    const n = Math.min(7, Math.ceil(hurt * 7));
    const cl = (v) => Math.max(-r, Math.min(r, v));
    _g.save();
    _g.lineCap = 'round';
    _g.strokeStyle = 'rgba(0,0,0,' + (0.3 + 0.4 * hurt).toFixed(2) + ')';
    for (let i = 0; i < n; i++) {
      // Every crack starts on an edge, because that is where a wall is hit,
      // and works its way in.
      const side = Math.floor(rnd() * 4);
      const along = (rnd() * 1.7 - 0.85) * r;
      let x = side === 0 ? along : side === 1 ? along : side === 2 ? -r : r;
      let y = side === 0 ? -r    : side === 1 ? r     : along;
      _g.lineWidth = 1 + rnd() * 1.4 * (0.4 + hurt);
      _g.beginPath();
      _g.moveTo(b.x + x, b.y + y);
      const legs = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < legs; k++) {
        // Inwards, with a wander on it: a straight line reads as a scratch.
        x = cl(x * 0.55 + (rnd() - 0.5) * r * 0.9);
        y = cl(y * 0.55 + (rnd() - 0.5) * r * 0.9);
        _g.lineTo(b.x + x, b.y + y);
      }
      _g.stroke();
    }
    // And at the end of it, pieces missing out of the rim rather than lines on
    // it: a wall at a tenth is a wall with holes in it.
    if (hurt > 0.65) {
      _g.fillStyle = 'rgba(0,0,0,.4)';
      const bites = Math.round((hurt - 0.65) * 9);
      for (let i = 0; i < bites; i++) {
        const a = rnd() * Math.PI * 2, br = r * (0.25 + rnd() * 0.3);
        _g.beginPath();
        _g.arc(b.x + Math.cos(a) * r * 0.9, b.y + Math.sin(a) * r * 0.9, br, 0, Math.PI * 2);
        _g.fill();
      }
    }
    _g.restore();
  }

  // Which way the wall runs here, so the doorway can be set in it the right way
  // round. Read off the neighbours rather than stored: a gate at the end of a
  // run that is later built past has to turn with the run, and a piece asked to
  // remember which way it was facing would be answering about a wall that is no
  // longer there. A gate with nothing either side of it is drawn across, which
  // is what a lone doorway looks like from above.
  function _gateAxis(b) {
    const r = _bc('wall').size;
    let across = 0, down = 0;
    for (const o of _hold.buildings) {
      if (o === b || o.type !== 'wall') continue;
      const dx = Math.abs(o.x - b.x), dy = Math.abs(o.y - b.y);
      if (dy < r && dx <= r * 2 + 2) across++;
      else if (dx < r && dy <= r * 2 + 2) down++;
    }
    return down > across ? 'v' : 'h';
  }

  // The way in. Two posts where the wall carries on, the ground between them
  // left open, and both leaves standing back against the wall — a gate that is
  // open is a gate that says what it is without a single frame of animation,
  // and this one is never shut: it is shut to everybody who does not live here
  // whatever it looks like, and open to everybody who does.
  function _drawGate(b, r, mat) {
    const vert = _gateAxis(b) === 'v';
    _g.save();
    _g.translate(b.x, b.y);
    if (vert) _g.rotate(Math.PI / 2);
    const pw = r * 0.5;
    // The posts: the wall itself, carrying on to either side of the opening.
    _g.fillStyle = mat;
    _g.fillRect(-r, -r, pw, r * 2);
    _g.fillRect(r - pw, -r, pw, r * 2);
    // The threshold. Trodden ground rather than stone, so the gap reads as a
    // gap at any zoom the wall itself is visible at.
    const a0 = _g.globalAlpha;
    _g.globalAlpha = a0 * 0.3;
    _g.fillRect(-r + pw, -r, (r - pw) * 2, r * 2);
    _g.globalAlpha = a0;
    // And the two leaves, swung back out of the way.
    const len = (r - pw) * 1.15, th = Math.max(2, r * 0.26);
    for (const s of [-1, 1]) {
      _g.save();
      _g.translate(s * (r - pw), 0);
      // One leaf back against the wall on each side of the road, which is what
      // says "through here" rather than "here is a hole".
      _g.rotate(s < 0 ? -1.25 : Math.PI - 1.25);
      _g.fillStyle = mat;
      _g.fillRect(0, -th / 2, len, th);
      _g.strokeStyle = 'rgba(0,0,0,.45)';
      _g.lineWidth = 1;
      _g.strokeRect(0, -th / 2, len, th);
      _g.restore();
    }
    _g.restore();
  }

  // A rounded rectangle as a path, because a badge with square corners reads as
  // part of the building rather than as a label on it.
  function _rrect(x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    _g.beginPath();
    _g.moveTo(x + rad, y);
    _g.arcTo(x + w, y,     x + w, y + h, rad);
    _g.arcTo(x + w, y + h, x,     y + h, rad);
    _g.arcTo(x,     y + h, x,     y,     rad);
    _g.arcTo(x,     y,     x + w, y,     rad);
    _g.closePath();
  }

  // A colour to a level, so depth is something the map says rather than
  // something the player counts. Every badge on the screen is one of these, on
  // both sides of the map: level four on a camp's barracks is the same colour
  // as level four on the hold's, because the whole point of a badge is being
  // able to compare the two without reading either.
  //
  // Timber, stone, and then up through the palette. Past the end of the ramp
  // the top colour is kept — the figure in the badge is the exact answer, the
  // colour is only ever the glance.
  const LEVEL_TINT = [
    ['--peach',  '#cba06a'],   // 1 — timber, only ever seen while it goes up
    ['--fg2',    '#a6adc8'],   // 2 — stone
    ['--accent', '#89b4fa'],   // 3
    ['--green',  '#a6e3a1'],   // 4
    ['--yellow', '#f9e2af'],   // 5
    ['--peach2', '#fab387'],   // 6
    ['--red',    '#f38ba8'],   // 7
  ];
  const _lvlTint = (lvl) => {
    const t = LEVEL_TINT[Math.min(LEVEL_TINT.length, Math.max(1, lvl)) - 1];
    return _css(t[0], t[1]);
  };

  // Badges are collected while the map is drawn and put down after all of it.
  // A badge is a label rather than a thing on the ground: a wall raised next to
  // another wall was drawing straight over its neighbour's, which is exactly
  // when the number matters most.
  let _badges = [];
  const _badge = (b, r, tint, ready) => _badges.push({
    ready: !!ready,
    x: b.x + r, y: b.y - r,
    lvl: b.lvl,
    // What is being paid for. A building going up is working towards the level
    // it already has; one being raised is working towards the next.
    to: b.built < 1 ? b.lvl : (b.up != null ? b.lvl + 1 : b.lvl),
    prog: b.built < 1 ? b.built : (b.up != null ? b.up : 1),
    tint: tint,
  });

  // The level, as a badge rather than as a bare number — and the scaffolding
  // with it. Grey figures over a grey wall were the one thing on the map you
  // had to lean in to read, and the level is exactly what a ring of wall is
  // judged on: which lengths have been rebuilt in stone and which are still
  // the timber that went up first.
  //
  // The work is inside the badge and not a ring round the building, because a
  // ring round a wall is a ring drawn over the two walls either side of it. It
  // fills from the bottom in the colour of the level being bought, and the
  // figure only turns over when the badge is full: what a building is now is
  // read off the number, what it is about to be is read off the colour coming
  // up behind it. A level one has no badge at all until somebody starts paying
  // for the second — then it is an empty one, filling.
  function _drawBadge(bg) {
    const done = bg.prog >= 1;
    const txt = done ? String(bg.lvl) : (bg.lvl > 1 ? String(bg.lvl) : '');
    const w = 15 + (Math.max(1, txt.length) - 1) * 7;  // a circle, a pill at two figures
    const x = bg.x, y = bg.y, h = 15;
    const tint = bg.tint || _lvlTint(done ? bg.lvl : bg.to);
    // Something that can be raised now breathes: a slow swell and a halo in the
    // colour the badge is about to become. Slow and small on purpose — a map
    // where a dozen badges twitch at once is a map nobody can read.
    let swell = 0;
    if (bg.ready) {
      swell = 0.5 + 0.5 * Math.sin(performance.now() / 480);
      _g.save();
      _g.globalAlpha = 0.15 + 0.3 * swell;
      _g.strokeStyle = _lvlTint(Math.min(LEVEL_TINT.length, bg.lvl + 1));
      _g.lineWidth = 2;
      const g = 2 + 3 * swell;
      _rrect(x - w / 2 - g, y - h / 2 - g, w + g * 2, h + g * 2, (h + g * 2) / 2);
      _g.stroke();
      _g.restore();
      const s = 1 + 0.08 * swell;
      _g.save();
      _g.translate(x, y);
      _g.scale(s, s);
      _g.translate(-x, -y);
    }
    _rrect(x - w / 2, y - h / 2, w, h, h / 2);
    if (done) {
      _g.fillStyle = tint;
      _g.fill();
    } else {
      // An empty vessel with the new colour rising in it.
      _g.fillStyle = 'rgba(0,0,0,.5)';
      _g.fill();
      _g.save();
      _g.clip();
      _g.fillStyle = tint;
      _g.fillRect(x - w / 2, y + h / 2 - h * bg.prog, w, h * bg.prog);
      _g.restore();
      _rrect(x - w / 2, y - h / 2, w, h, h / 2);
    }
    _g.strokeStyle = 'rgba(0,0,0,.55)'; _g.lineWidth = 2;
    _g.stroke();
    _g.lineWidth = 1;
    if (!txt) { if (bg.ready) _g.restore(); return; }
    _g.font = 'bold 11px system-ui, sans-serif';
    _g.textAlign = 'center'; _g.textBaseline = 'middle';
    if (done) {
      _g.fillStyle = _css('--bg', '#181825');
    } else {
      // Still the old level, over a badge that is half the new colour and half
      // dark ground: outlined, so it holds up over either.
      _g.lineWidth = 3; _g.strokeStyle = 'rgba(0,0,0,.7)';
      _g.strokeText(txt, x, y + 0.5);
      _g.lineWidth = 1;
      _g.fillStyle = _lvlTint(bg.lvl);
    }
    _g.fillText(txt, x, y + 0.5);
    if (bg.ready) _g.restore();
  }

  function _flushBadges() {
    for (const bg of _badges) _drawBadge(bg);
    _badges.length = 0;
  }

  // What is selected, marked where it stands. The panel says what you tapped;
  // the map never did, and on a ring of identical wall lengths that is the one
  // place it matters most — every piece looks like every other piece, so
  // "which one am I about to upgrade" was a question the screen could not
  // answer. Drawn over everything, twice: a dark halo under a bright line, so
  // the mark holds up on a lit building and on bare ground both.
  function _drawPick(b) {
    const r = _bc(b.type).size;
    const path = () => {
      // A wall is a square that fills its cell and a boxed square is the only
      // mark that fits it; everything else is a mark on the ground and is
      // ringed.
      if (b.type === 'wall') _rrect(b.x - r - 3, b.y - r - 3, (r + 3) * 2, (r + 3) * 2, 5);
      else { _g.beginPath(); _g.arc(b.x, b.y, r + 6, 0, Math.PI * 2); }
    };
    _g.setLineDash([]);
    _g.lineWidth = 5; _g.strokeStyle = 'rgba(0,0,0,.55)'; path(); _g.stroke();
    _g.lineWidth = 2.5; _g.strokeStyle = _css('--yellow', '#f9e2af'); path(); _g.stroke();
    _g.lineWidth = 1;
  }

  // ── Overlays ──────────────────────────────────────────────────────────────
  // How long the hold stood, in the biggest unit that still reads as a number.
  function _fmtSpan(sec) {
    if (sec >= 86400) return _t('sh_t_days',  { n: Math.round(sec / 86400) });
    if (sec >= 3600)  return _t('sh_t_hours', { n: Math.round(sec / 3600) });
    return _t('sh_t_min', { n: Math.max(1, Math.round(sec / 60)) });
  }

  function _showOver() {
    const secs = Math.round(_hold.elapsed || 0);
    _overlay.style.display = 'flex';
    _overlay.innerHTML =
      '<div class="sh-card">' +
      '<div style="font-size:2.4rem;line-height:1">🏯</div>' +
      '<div class="sh-card-t">' + _esc(_t('sh_over_title')) + '</div>' +
      '<div class="sh-big">' + (_hold.stats.score || 0) + '</div>' +
      '<div class="sh-card-s">' + _esc(_t('sh_final_score')) + '</div>' +
      '<div class="sh-card-s">' + _esc(_t('sh_over_stats', {
        threat: _worstLvl(), kills: _hold.stats.kills || 0,
        raids: _hold.stats.raids || 0, time: _fmtSpan(secs),
      })) + '</div>' +
      '<div class="sh-card-r">' +
      '<button id="sh-again" class="sh-go">' + _esc(_t('sh_play_again')) + '</button>' +
      '<a href="/pub/gamehub/?game=' + GAME_ID + '" class="sh-link">' + _esc(_t('sh_back_to_hub')) + '</a>' +
      '</div></div>';

    // A room is one hold: it ended when the keep fell, so a new one means
    // asking Game Hub for a fresh room rather than resetting here.
    _overlay.querySelector('#sh-again').onclick = async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = _t('sh_starting');
      try {
        const r = await fetch('/api/pub/gamehub/mp/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-GH-Token': window.GameHub.getToken() || '' },
          body: JSON.stringify({ game_id: GAME_ID, max_players: 1, settings: {} }),
        });
        // 409 means the choice is not this page's to make — an unfinished hold
        // or a saved one is waiting, and Game Hub is where that is answered.
        if (r.status === 409) { location.href = '/pub/gamehub/?game=' + GAME_ID; return; }
        if (!r.ok) throw new Error('room');
        const d = await r.json();
        location.href = d.play_url;
      } catch (_) {
        btn.disabled = false;
        btn.textContent = _t('sh_play_again');
        alert(_t('sh_error_new_game'));
      }
    };
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  // Registered at load time, not inside renderGame: sh_start follows the
  // framework's game_started immediately, and a handler attached any later
  // would miss it.
  mp.on('sh_start', (msg) => {
    if (_root && _canvas) _begin(msg);
    else _pending = msg;
  });

  // The framework re-broadcasts the roster on every join, leave and
  // reconnect — that alone keeps a chip's connected/gone state live, with
  // no game-specific message needed for it.
  mp.on('roster', () => _renderPresence());

  mp.on('sh_score_update', (msg) => {
    const o = _others[msg.player_id] || (_others[msg.player_id] = {});
    o.score = msg.score; o.elapsed = msg.elapsed;
    _renderPresence();
  });

  mp.on('sh_player_fell', (msg) => {
    const o = _others[msg.player_id] || (_others[msg.player_id] = {});
    o.score = msg.score; o.fallen = true;
    _renderPresence();
    if (msg.player_id !== mp.youId()) {
      const p = mp.players().find(pl => pl.id === msg.player_id) || {};
      _say(_t('sh_mp_fell', { name: p.display_name || '?' }));
    }
  });

  mp.on('sh_game_over', (msg) => _showFinalStandings(msg.standings || []));

  mp.on('sh_peek_result', (msg) => _drawPeek(msg));

  mp.registerGame({
    id:   GAME_ID,
    name: _t('sh_title'),
    renderSetup,
    renderGame,
    // The HUD already has an exit button, so the hub does not add its own.
    exitButton: false,
    // The room holds the hold: push the newest one and let the server stamp it.
    snapshot: () => { _push(); return null; },
    pause:    () => { _paused = true; },
    resume:   () => { _paused = false; _last = performance.now(); },
  });
})();
