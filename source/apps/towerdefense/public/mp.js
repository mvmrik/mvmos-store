/*
 * Tower Defense — the client half of the game.
 *
 * Runs on Game Hub's generic play page (NOT inside mvmOS): the page loads
 * gamehub/widget.js, this file, and nothing else of ours. GameHub.mp owns the
 * socket, the lobby and the roster; this file registers the setup screen and
 * the game itself, and talks to mp_game.py over GameHub.mp.send/on.
 *
 * The waves are not received from the server — the *seed* is. Both halves grow
 * the same waves out of it with the same arithmetic, so a second player added
 * later fights an identical run without a byte of per-enemy traffic. Anything
 * that decides what the run looks like therefore has to stay in sync with
 * mp_game.py; anything cosmetic below is free.
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
  const TOWER_RANGE  = 300;
  const TOWER_RELOAD = 0.42;   // seconds between shots
  const BULLET_SPEED = 620;
  const BULLET_DMG   = 34;
  const SPAWN_RADIUS = 700;    // enemies walk in from outside the visible box

  const KILL_POINTS  = 10;
  const WAVE_POINTS  = 50;

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
  let _raf = 0, _last = 0;

  let _tower, _enemies, _bullets, _particles;
  let _wave, _waveQueue, _spawnTimer, _breakTimer;
  let _score, _kills, _elapsed, _reload, _over, _reported;
  let _reportTimer, _skipWaveBonus;
  // The exit dialog stops the clock. Deciding whether to save is not part of
  // the game, and the tower must not fall while the player is reading.
  let _paused = false;

  // ── Setup screen (host, in the lobby) ─────────────────────────────────────
  function renderSetup(box, settings) {
    box.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:6px">' +
      '<label style="font-size:.72rem;color:var(--fg2,#a6adc8);text-transform:uppercase;letter-spacing:.5px">' +
      _esc(_t('td_difficulty')) + '</label>' +
      '<select id="td-diff" style="background:var(--surface2,#313244);color:var(--fg,#cdd6f4);' +
      'border:1px solid var(--border,#45475a);border-radius:6px;padding:8px 10px;font-size:.9rem;width:100%">' +
      '<option value="easy">'   + _esc(_t('td_easy'))   + '</option>' +
      '<option value="normal">' + _esc(_t('td_normal')) + '</option>' +
      '<option value="hard">'   + _esc(_t('td_hard'))   + '</option>' +
      '</select></div>';
    const sel = box.querySelector('#td-diff');
    sel.value = (settings && settings.difficulty) || 'normal';
    // Returned to the framework: called when the host presses Start, and the
    // result becomes the room's settings for everyone.
    return () => ({ difficulty: sel.value });
  }

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

    _fitCanvas();
    window.addEventListener('resize', _fitCanvas);

    if (_pending) { const m = _pending; _pending = null; _begin(m); }
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
    if (_over) _draw(0);
  }

  // ── Run lifecycle ─────────────────────────────────────────────────────────
  function _begin(msg) {
    _tuning = msg.tuning || { enemy_hp: 1, enemy_speed: 1, spawn_rate: 1, tower_hp: 100 };
    _rand   = rng(msg.seed || 1);

    _tower     = { hp: _tuning.tower_hp, maxHp: _tuning.tower_hp, angle: -Math.PI / 2 };
    _enemies   = [];
    _bullets   = [];
    _particles = [];
    _wave      = 0;
    _waveQueue = [];
    _spawnTimer = 0;
    _breakTimer = 2.5;           // a breath before the first wave
    _score = 0; _kills = 0; _elapsed = 0; _reload = 0;
    _over = false; _reported = false;
    _reportTimer = 0; _skipWaveBonus = false;
    _paused = false;

    _resume(msg.resume);

    _renderHud();
    if (_over) { _showGameOver(); _draw(); return; }

    _overlay.style.display = 'none';
    _last = performance.now();
    cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(_loop);
  }

  // Pick the run back up where the server last saw it. Enemies on the field
  // are not restored — they are cheap and they are the part nobody can agree
  // on after a disconnect — so the run resumes at the start of the wave it was
  // in, with the score, kills and tower it had.
  function _resume(r) {
    if (!r) return;

    _score   = r.score   || 0;
    _kills   = r.kills   || 0;
    _elapsed = r.seconds || 0;
    if (r.hp != null) _tower.hp = Math.max(1, Math.min(_tower.maxHp, r.hp));

    if (r.over) {
      // Came back to a finished run: show the result, do not report it again.
      _wave = r.wave || 1;
      _over = true; _reported = true;
      return;
    }

    // The waves come out of one RNG stream, so the stream has to be wound
    // forward through the waves already fought for wave N to be the same wave
    // it would have been without the reload.
    const wave = Math.max(1, r.wave || 1);
    for (let i = 1; i < wave; i++) _buildWave(i);
    _wave = wave - 1;            // _startWave puts it back
    // The same pause the wave would have had, so reloading on a wave boundary
    // gives back the run you left, not a slightly harder one.
    _breakTimer = 3.5;
    // Those earlier waves were already paid for in r.score.
    _skipWaveBonus = true;
  }

  function _loop(now) {
    _raf = requestAnimationFrame(_loop);
    // Clamped so a backgrounded tab does not resume with one enormous step
    // that teleports every enemy into the tower.
    const dt = Math.min(0.05, (now - _last) / 1000);
    _last = now;
    if (!_over && !_paused) _update(dt);
    _draw(dt);
  }

  // ── Waves ─────────────────────────────────────────────────────────────────
  // Grown from the seed, so this must stay identical on every client.
  function _buildWave(n) {
    const count = 4 + Math.floor(n * 1.8);
    const list  = [];
    for (let i = 0; i < count; i++) {
      const hp    = (24 + n * 7) * _tuning.enemy_hp * (0.85 + _rand() * 0.4);
      const speed = (38 + n * 2.4) * _tuning.enemy_speed * (0.85 + _rand() * 0.35);
      list.push({
        angle:  _rand() * Math.PI * 2,
        hp:     hp,
        maxHp:  hp,
        speed:  speed,
        radius: 11 + Math.min(9, n * 0.5) * _rand(),
        damage: 8 + n * 0.6,
      });
    }
    return list;
  }

  function _startWave() {
    _wave += 1;
    _waveQueue  = _buildWave(_wave);
    _spawnTimer = 0;
    _renderHud();
  }

  function _update(dt) {
    _elapsed += dt;

    // Wave pacing: spawn what is queued, then rest until the field is clear.
    if (_waveQueue.length) {
      _spawnTimer -= dt;
      if (_spawnTimer <= 0) {
        const spec = _waveQueue.shift();
        _spawnTimer = 0.75 / _tuning.spawn_rate;
        _enemies.push({
          x: CX + Math.cos(spec.angle) * SPAWN_RADIUS,
          y: CY + Math.sin(spec.angle) * SPAWN_RADIUS,
          hp: spec.hp, maxHp: spec.maxHp,
          speed: spec.speed, radius: spec.radius, damage: spec.damage,
        });
      }
    } else if (!_enemies.length) {
      _breakTimer -= dt;
      if (_breakTimer <= 0) {
        if (_wave > 0 && !_skipWaveBonus) _score += WAVE_POINTS;
        _skipWaveBonus = false;
        _breakTimer = 3.5;
        _startWave();
        _report();
      }
    }

    // Snapshot to the server on a timer as well as at every wave, so a reload
    // in the middle of a long wave loses seconds, not the run.
    _reportTimer -= dt;
    if (_reportTimer <= 0) { _reportTimer = 2; _report(); }

    // Enemies walk straight at the tower; touching it costs integrity.
    for (let i = _enemies.length - 1; i >= 0; i--) {
      const e  = _enemies[i];
      const dx = CX - e.x, dy = CY - e.y;
      const d  = Math.hypot(dx, dy) || 1;
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
      if (d <= TOWER_R + e.radius) {
        _tower.hp -= e.damage;
        _burst(e.x, e.y, '#f38ba8', 10);
        _enemies.splice(i, 1);
        if (_tower.hp <= 0) { _tower.hp = 0; _end(); return; }
        _renderHud();
      }
    }

    // The tower fires on its own at whatever is closest and in range.
    _reload -= dt;
    const target = _nearestInRange();
    if (target) {
      _tower.angle = Math.atan2(target.y - CY, target.x - CX);
      if (_reload <= 0) {
        _reload = TOWER_RELOAD;
        _bullets.push({ x: CX, y: CY, target: target, life: 2.5 });
      }
    }

    // Bullets home in, so a shot fired at a moving target still lands.
    for (let i = _bullets.length - 1; i >= 0; i--) {
      const b = _bullets[i];
      b.life -= dt;
      const alive = _enemies.indexOf(b.target) !== -1;
      if (!alive || b.life <= 0) { _bullets.splice(i, 1); continue; }
      const dx = b.target.x - b.x, dy = b.target.y - b.y;
      const d  = Math.hypot(dx, dy) || 1;
      const step = BULLET_SPEED * dt;
      if (d <= step + b.target.radius) {
        b.target.hp -= BULLET_DMG;
        _burst(b.target.x, b.target.y, '#f9e2af', 4);
        _bullets.splice(i, 1);
        if (b.target.hp <= 0) {
          const idx = _enemies.indexOf(b.target);
          if (idx !== -1) _enemies.splice(idx, 1);
          _kills += 1;
          _score += KILL_POINTS;
          _burst(b.target.x, b.target.y, '#a6e3a1', 14);
          _renderHud();
        }
      } else {
        b.x += (dx / d) * step;
        b.y += (dy / d) * step;
      }
    }

    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];
      p.life -= dt;
      if (p.life <= 0) { _particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function _nearestInRange() {
    let best = null, bestD = TOWER_RANGE;
    for (const e of _enemies) {
      const d = Math.hypot(e.x - CX, e.y - CY);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  function _burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 160;
      _particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, color });
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  function _css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function _draw() {
    if (!_ctx2d) return;
    const g = _ctx2d;
    const size = _canvas.width;
    const s = size / W;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    g.setTransform(s, 0, 0, s, 0, 0);

    const accent = _css('--accent', '#89b4fa');
    const dim    = _css('--fg2', '#a6adc8');
    const red    = _css('--red', '#f38ba8');
    const green  = _css('--green', '#a6e3a1');

    // Range ring
    g.strokeStyle = dim;
    g.globalAlpha = 0.18;
    g.lineWidth = 2;
    g.beginPath(); g.arc(CX, CY, TOWER_RANGE, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;

    // Particles
    for (const p of _particles) {
      g.globalAlpha = Math.max(0, p.life / 0.35);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // Enemies
    for (const e of _enemies) {
      g.fillStyle = red;
      g.beginPath(); g.arc(e.x, e.y, e.radius, 0, Math.PI * 2); g.fill();
      if (e.hp < e.maxHp) {
        const w = e.radius * 2;
        g.fillStyle = 'rgba(0,0,0,.45)';
        g.fillRect(e.x - w / 2, e.y - e.radius - 9, w, 4);
        g.fillStyle = green;
        g.fillRect(e.x - w / 2, e.y - e.radius - 9, w * Math.max(0, e.hp / e.maxHp), 4);
      }
    }

    // Bullets
    g.fillStyle = _css('--yellow', '#f9e2af');
    for (const b of _bullets) {
      g.beginPath(); g.arc(b.x, b.y, 5, 0, Math.PI * 2); g.fill();
    }

    // Tower — body, then a barrel pointing at the current target
    g.save();
    g.translate(CX, CY);
    g.rotate(_tower.angle);
    g.fillStyle = accent;
    g.fillRect(0, -7, TOWER_R + 20, 14);
    g.restore();
    g.fillStyle = accent;
    g.beginPath(); g.arc(CX, CY, TOWER_R, 0, Math.PI * 2); g.fill();
    g.fillStyle = _css('--surface1', '#181825');
    g.beginPath(); g.arc(CX, CY, TOWER_R - 9, 0, Math.PI * 2); g.fill();
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  function _cell(label, value, color) {
    return '<div style="flex:1;min-width:90px;background:var(--surface1,#181825);' +
      'border:1px solid var(--border,#45475a);border-radius:10px;padding:8px 12px;text-align:center">' +
      '<div style="font-size:1.05rem;font-weight:700' + (color ? ';color:' + color : '') + '">' + _esc(value) + '</div>' +
      '<div style="font-size:.68rem;color:var(--fg2,#a6adc8);text-transform:uppercase;letter-spacing:.5px">' +
      _esc(label) + '</div></div>';
  }

  function _renderHud() {
    if (!_hud) return;
    const pct = Math.round((_tower.hp / _tower.maxHp) * 100);
    _hud.innerHTML =
      _cell(_t('td_wave'), _wave || 1) +
      _cell(_t('td_score'), _score) +
      _cell(_t('td_kills'), _kills) +
      _cell(_t('td_integrity'), pct + '%', pct > 50 ? 'var(--green,#a6e3a1)' : pct > 20 ? 'var(--yellow,#f9e2af)' : 'var(--red,#f38ba8)') +
      (_over ? '' :
        '<button id="td-exit" style="margin-left:auto;align-self:center;background:var(--surface2,#313244);' +
        'color:var(--fg,#cdd6f4);border:1px solid var(--border,#45475a);border-radius:10px;padding:8px 14px;' +
        'font-weight:600;font-size:.82rem;cursor:pointer">' + _esc(_t('td_exit')) + '</button>');
    const exit = _hud.querySelector('#td-exit');
    if (exit) exit.onclick = () => mp.exitPrompt();
  }

  // ── Stopping for now ─────────────────────────────────────────────────────
  // The prompt, the save and the room closing are Game Hub's, shared by every
  // solo game. Tower Defense only pauses its own clock while the question is
  // on screen and makes sure the room has the very latest numbers before the
  // save is taken.

  // ── Reporting ─────────────────────────────────────────────────────────────
  // One message, two purposes: the others see score and wave, the server keeps
  // the whole thing as this player's resume point.
  function _report() {
    mp.send({
      type: 'td_progress',
      score: _score, wave: _wave || 1, kills: _kills,
      hp: Math.round(_tower.hp), seconds: Math.round(_elapsed),
    });
  }

  function _end() {
    _over = true;
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
  }

  function _showGameOver() {
    const mins = Math.floor(_elapsed / 60), secs = Math.round(_elapsed % 60);
    _overlay.style.display = 'flex';
    _overlay.innerHTML =
      '<div style="background:var(--surface1,#181825);border:1px solid var(--border,#45475a);' +
      'border-radius:16px;padding:28px 32px;text-align:center;display:flex;flex-direction:column;gap:14px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:90%">' +
      '<div style="font-size:2.4rem;line-height:1">🏰</div>' +
      '<div style="font-size:1.15rem;font-weight:700">' + _esc(_t('td_game_over')) + '</div>' +
      '<div style="font-size:2rem;font-weight:700;color:var(--accent,#89b4fa)">' + _score + '</div>' +
      '<div style="font-size:.78rem;color:var(--fg2,#a6adc8)">' + _esc(_t('td_final_score')) + '</div>' +
      '<div style="font-size:.85rem;color:var(--fg2,#a6adc8)">' +
        _esc(_t('td_wave')) + ' ' + _wave + ' · ' +
        _esc(_t('td_kills')) + ' ' + _kills + ' · ' +
        _esc(_t('td_survived')) + ' ' + mins + 'm ' + secs + 's' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      '<button id="td-again" style="background:var(--accent,#89b4fa);color:#1e1e2e;border:none;border-radius:8px;' +
      'padding:9px 18px;font-weight:700;font-size:.9rem;cursor:pointer">' + _esc(_t('td_play_again')) + '</button>' +
      '<a href="/pub/gamehub/?game=' + GAME_ID + '" style="background:var(--surface2,#313244);color:var(--fg,#cdd6f4);' +
      'border:1px solid var(--border,#45475a);border-radius:8px;padding:9px 18px;font-weight:600;font-size:.9rem;' +
      'text-decoration:none">' + _esc(_t('td_back_to_hub')) + '</a>' +
      '</div></div>';

    // A room is one run: it is finished the moment the tower falls, so playing
    // again means asking Game Hub for a fresh one rather than resetting here.
    _overlay.querySelector('#td-again').onclick = async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      btn.textContent = _t('td_starting');
      try {
        const r = await fetch('/api/pub/gamehub/mp/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-GH-Token': window.GameHub.getToken() || '' },
          body: JSON.stringify({ game_id: GAME_ID, max_players: 1, settings: mp.settings() || {} }),
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
    };
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  // Registered at load time, not inside renderGame: td_start follows the
  // framework's game_started immediately, and a handler attached any later
  // would miss it.
  mp.on('td_start', (msg) => {
    if (_root && _canvas) _begin(msg);
    else _pending = msg;          // renderGame has not run yet
  });

  mp.registerGame({
    id:   GAME_ID,
    name: _t('td_title'),
    renderSetup,
    renderGame,
    // The HUD already has an exit button, so the hub does not add its own.
    exitButton: false,
    snapshot: () => { _report(); return null; },   // the room keeps the state
    pause:    () => { _paused = true; },
    resume:   () => { _paused = false; _last = performance.now(); },
  });
})();
